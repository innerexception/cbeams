import { Scene, Physics } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene, onShowModal } from "../../common/Thunks";
import { getLogisticsStatus, getShipLogisticsCost } from "../../common/Utils";
import { spawnEnemyRaid, checkEnemyRaid, updateEnemyZel, updateEnemyGain } from "../../common/AIPlayers";
import ShipSprite from "../sprites/ShipSprite";
import { Faction, ShipType, Modal, ShipData, ObjectiveSprite, ObjectiveSpriteIndex, AsteroidSpriteIndexesLarge, AsteroidSpriteIndexesMed, AsteroidSpriteIndexesSmall, ShipTypeSpriteIndex, ShipTypeSpriteIndexEnemy, Maps } from "../../../enum";
import {
    MAP_SIZE, CELL_SIZE, gridToWorld, worldToGrid, SHIP_SEPARATION_PX,
    MAX_QUEUE, MAX_WAYPOINTS,
    BULLET_SPEED_PX_S, BULLET_MAX_LIFETIME_MS,
    ATD_BLAST_RADIUS_PX,
    MISSILE_SALVO_SIZE, MISSILE_SPEED_PX_S, MISSILE_MAX_LIFETIME_MS, SALVO_STAGGER_MS,
    MISSILE_ARC_HEIGHT_PX, CONTRAIL_INTERVAL_MS, CONTRAIL_LIFETIME_MS,
    MISSILE_IMPACT_LIFETIME_MS, MISSILE_IMPACT_MIN_RADIUS_PX, MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX,
    OBJECTIVE_CAPTURE_RADIUS_PX, OBJECTIVE_ICON_SIZE, OBJECTIVE_CAPTURE_TIME_MS,
    HARVESTER_RANGE_PX, HARVESTER_COLLECTION_RATE_PER_S,
    HARVESTER_METAL_CAPACITY, HARVESTER_RESUPPLY_RANGE_PX, HARVESTER_RESUPPLY_INTERVAL_MS, HARVESTER_REPAIR_METAL_COST,
    HARVESTER_ORBIT_RADIUS_PX, HARVESTER_ORBIT_ANGULAR_SPEED, HARVESTER_BEAM_FLICKER_MIN_MS, HARVESTER_BEAM_FLICKER_MAX_MS,
    ASTEROID_AVG_METAL, ASTEROID_METAL_VARIANCE,
    GREEN_HEX, YELLOW_HEX, RED_HEX,
} from "../../common/Constants";

const TWO_PI = Math.PI*2

const IDLE_TURN_RATE_PER_MS = 0.002
const MOVE_TURN_RATE_PER_MS = 0.001

const stableAngularPhase = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return ((h >>> 0) % 1000) / 1000 * TWO_PI
}

const ASTEROID_TIER_FRAMES = { large:AsteroidSpriteIndexesLarge, med:AsteroidSpriteIndexesMed, small:AsteroidSpriteIndexesSmall }
type AsteroidTier = keyof typeof ASTEROID_TIER_FRAMES
const asteroidTier = (node:ResourceNodeData):AsteroidTier => {
    const metal = node.metal ?? 0
    if(metal > 40) return 'large'
    if(metal > 20) return 'med'
    return 'small'
}

const DRONE_TYPES = new Set<ShipType>([ShipType.KKZ, ShipType.BOM])

// Index of the closest waypoint at or after minIndex, so a retargeted route resumes from wherever the
// ship already is without ever sending it back to a waypoint it has already passed.
const nearestWaypointIndex = (shipX:number, shipY:number, waypoints:Array<{x:number,y:number}>, minIndex = 0) => {
    let bestIndex = Math.min(minIndex, waypoints.length-1)
    let bestDistSq = Infinity
    for(let i=minIndex; i<waypoints.length; i++){
        const p = gridToWorld(waypoints[i].x, waypoints[i].y)
        const distSq = (p.x-shipX)**2 + (p.y-shipY)**2
        if(distSq < bestDistSq){ bestDistSq = distSq; bestIndex = i }
    }
    return bestIndex
}

const BASE_SPRITE_INDEX:Record<Faction, number> = { [Faction.Enemy]: 13, [Faction.Player]: 0 }

type BodyKind = 'ship' | 'missile' | 'bullet'

// The game's simulation. Phaser runs this headless (see Viewport.tsx) — there is no Phaser renderer, no
// camera, no canvas. Every visual concern now belongs to the Three.js renderer (src/render3d/Scene3D.ts),
// which reads this scene's state each frame and draws it. What stays here is everything that decides
// what's *true* in the match: movement, combat, capture, harvesting, production, fog of war.
//
// Anything below that looks visual (a ship's `visible` flag, an asteroid's sprite frame, mining-beam
// flicker timing) is state the simulation owns and the renderer merely obeys — kept here so both
// renderers, and the game rules themselves, agree on one answer.
export default class MapScene extends Scene {

    shipsGroup: Physics.Arcade.Group
    missilesGroup: Physics.Arcade.Group
    // PDF's own real, travel-time projectiles (see spawnBullet/updatePdf) — deliberately a separate
    // group from missilesGroup: a bullet is a straight-line, non-homing shot with its own short
    // lifetime, not an offensive missile's arced/retargeting flight.
    bulletsGroup: Physics.Arcade.Group
    // The single source of truth for every ship, both factions' — see ShipSprite's own doc comment for
    // why its high-frequency state lives entirely on the instance rather than in the Zustand store.
    // Iterate via `this.ships` (a fresh array snapshot) rather than this Map directly wherever a system
    // might spawn/destroy ships mid-iteration.
    shipSprites: Map<string, ShipSprite> = new Map()
    // Which tiles.png frame each Asteroid currently shows. A node's art steps down through the size tiers
    // as it's mined out (see asteroidTier), and that choice is the sim's — the renderer just draws
    // whichever frame is recorded here rather than re-deriving the tier thresholds itself.
    resourceNodeFrames: Map<string, number> = new Map()

    // Transient effects the renderer draws and the sim owns the lifetime of: a flash where a missile
    // landed, and the fading dots tracing each missile's flight. Pruned by age in update().
    impactFlashes: Array<{ x:number, y:number, createdAt:number, damage:number }> = []
    contrails: Array<{ x:number, y:number, createdAt:number, missileId:string }> = []

    harvesterMiningTarget: Map<string, string> = new Map()
    // Whether each mining beam is currently lit, and when it next flips. Purely cosmetic flicker, but it
    // has to be stable frame to frame (rolling fresh randomness per frame would strobe), so it's state
    // rather than something the renderer can derive on the fly.
    harvesterBeamState: Map<string, { on:boolean, nextToggleAt:number }> = new Map()

    enemyBaseId: string
    enemyRaidLaunched: boolean = false
    gameOver: boolean = false
    mapData: MapData
    unsubscribe: () => void

    constructor(config){
        super(config)
        onSetScene(this)
    }

    // A fresh array snapshot of every ship — safe to iterate even when the system doing so might spawn
    // or destroy ships partway through (spawning appends to shipSprites but never to a snapshot already
    // taken; destroying doesn't retroactively remove an entry from one either), unlike iterating
    // shipSprites directly. Every per-frame system reads through this rather than the Map.
    get ships():Array<ShipSprite> {
        return Array.from(this.shipSprites.values())
    }

    create = () => {
        this.generateProjectileTextures()
        this.shipsGroup = this.physics.add.group()
        this.missilesGroup = this.physics.add.group()
        this.bulletsGroup = this.physics.add.group()

        this.physics.add.overlap(this.shipsGroup, this.shipsGroup, this.onDroneShipContact, this.isHostileDroneShipPair, this)
        this.physics.add.overlap(this.missilesGroup, this.shipsGroup, this.onMissileShipContact, this.isHostileMissileShipPair, this)
        this.physics.add.overlap(this.bulletsGroup, this.missilesGroup, this.onBulletMissileContact, this.isHostileBulletMissilePair, this)

        this.mapData = useAppStore.getState().activeMap || { width:MAP_SIZE, height:MAP_SIZE, objectives:[], terrain:null }
        const tiledMap = this.make.tilemap({ key: Maps.Sandbox })
        if(tiledMap.width && tiledMap.height){
            this.mapData.width = tiledMap.width
            this.mapData.height = tiledMap.height
        }

        this.spawnEntitiesFromMap()

        spawnEnemyRaid(this)

        this.time.addEvent({ delay: 500, loop: true, callback: this.tickProduction })

        this.unsubscribe = useAppStore.subscribe((state, prevState) => {
            if(state.selectedShipIds.length > 0 && state.ships.length !== prevState.ships.length){
                const stillAlive = state.selectedShipIds.filter(id => state.ships.some(s => s.id === id))
                if(stillAlive.length !== state.selectedShipIds.length) useAppStore.getState().setSelectedShipIds(stillAlive)
            }
        })
        this.events.once('shutdown', () => this.unsubscribe())

        useAppStore.getState().setLoaded(true)
    }

    // A missile/bullet is a real physics body, and a body takes its default size from its texture — so
    // these still need to exist even though nothing here draws them anymore (the renderer draws its own
    // dots). Built on a plain 2D canvas via addCanvas rather than Graphics.generateTexture: the latter
    // needs a live renderer to rasterize through, and there isn't one in headless mode.
    generateProjectileTextures = () => {
        const bake = (key:string, size:number, draw:(ctx:CanvasRenderingContext2D, c:number) => void) => {
            if(this.textures.exists(key)) return
            const canvas = document.createElement('canvas')
            canvas.width = size
            canvas.height = size
            draw(canvas.getContext('2d'), size/2)
            this.textures.addCanvas(key, canvas)
        }

        bake('missile_dot', 8, (ctx, c) => {
            ctx.fillStyle = 'rgba(85,255,85,0.9)'
            ctx.beginPath(); ctx.arc(c, c, 2, 0, Math.PI*2); ctx.fill()
        })
        bake('bullet_dot', 10, (ctx, c) => {
            ctx.fillStyle = 'rgba(255,255,85,0.35)'
            ctx.beginPath(); ctx.arc(c, c, 5, 0, Math.PI*2); ctx.fill()
            ctx.fillStyle = 'rgba(255,255,85,1)'
            ctx.beginPath(); ctx.arc(c, c, 2.5, 0, Math.PI*2); ctx.fill()
        })
    }

    update = (time:number, delta:number) => {
        this.updateHarvesterMiningTargets()
        this.moveShips(time, delta)
        this.updateMlrs(time)
        this.updateDrn(time)
        this.updatePdf(time)
        this.updateBullets(time)
        this.updateHarvesters(delta)
        this.updateHarvesterSupport(time)
        this.updateObjectives(time)
        this.updateMissiles(time, delta)
        checkEnemyRaid(this)
        updateEnemyZel(this)
        updateEnemyGain(this)
        this.updateFogOfWar()
        this.updateHarvesterBeamFlicker(time)
        this.expireEffects(time)
    }

    // Advances each active mining beam's own on/off flicker. Cosmetic, but it lives here rather than in
    // the renderer because it has to persist across frames — re-rolling the timing every frame would
    // strobe rather than flicker. Beams for harvesters that stopped mining are dropped outright.
    updateHarvesterBeamFlicker = (time:number) => {
        this.harvesterBeamState.forEach((_, id) => {
            if(!this.harvesterMiningTarget.has(id)) this.harvesterBeamState.delete(id)
        })
        this.harvesterMiningTarget.forEach((_, harvesterId) => {
            let state = this.harvesterBeamState.get(harvesterId)
            if(!state){
                state = { on:true, nextToggleAt: time + this.randomFlickerIntervalMs() }
                this.harvesterBeamState.set(harvesterId, state)
            }
            if(time < state.nextToggleAt) return
            state.on = !state.on
            state.nextToggleAt = time + this.randomFlickerIntervalMs()
        })
    }

    // Impact flashes and contrails are spawned by combat and simply age out. The pruning used to happen
    // inside the draw passes that consumed them; with drawing gone it has to happen here, or they'd grow
    // without bound whether or not anything was looking at them.
    expireEffects = (time:number) => {
        this.impactFlashes = this.impactFlashes.filter(f => time - f.createdAt < MISSILE_IMPACT_LIFETIME_MS)
        this.contrails = this.contrails.filter(c => time - c.createdAt < CONTRAIL_LIFETIME_MS)
    }

    tickProduction = () => {
        this.ships.forEach(ship => {
            const item = ship.queue[0]
            if(!item?.startedAt || Date.now() - item.startedAt < ShipData[item.type].productionTimeMs) return
            if(getLogisticsStatus(ship.faction).logisticsRemaining - getShipLogisticsCost(item.type) < 0) return

            this.completeQueueItem(ship.id)
            this.spawnShip(ship, item.type)
        })
    }

    // Places a newly completed ship near its Base (or DRN, for a KKZ), trying to avoid overlapping other
    // loitering ships.
    spawnShip = (base:ShipSprite, type:ShipType) => {
        const center = { x:base.x, y:base.y }
        const size = ShipData[type].sizeHex * CELL_SIZE
        let pos = center

        for(let attempt=0; attempt<40; attempt++){
            const radius = CELL_SIZE*1.5 + attempt*4
            const angle = Math.random()*Math.PI*2
            const candidate = { x: center.x+Math.cos(angle)*radius, y: center.y+Math.sin(angle)*radius }
            const overlapsShip = this.ships.some(s => {
                const minDist = (size + ShipData[s.type].sizeHex*CELL_SIZE)/2 + 12
                return Phaser.Math.Distance.Between(candidate.x, candidate.y, s.x, s.y) < minDist
            })
            if(!overlapsShip){ pos = candidate; break }
        }

        this.createShipSprite(v4(), base.faction, type, pos.x, pos.y)
        this.syncShipSummaries()
    }

    // Every ship (both factions' Bases included) and every Objective/Asteroid comes straight off the
    // loaded map file's own entities layer.
    spawnEntitiesFromMap = () => {
        const map = this.make.tilemap({ key: Maps.Sandbox })
        const layer = map.getLayer('entities')
        if(!layer) return

        const firstgid = map.tilesets[0]?.firstgid ?? 1

        for(let ty=0; ty<layer.height; ty++){
            for(let tx=0; tx<layer.width; tx++){
                const tile = layer.data[ty][tx]
                if(!tile || tile.index <= 0) continue
                const localIndex = tile.index - firstgid

                const baseFaction = ([Faction.Player, Faction.Enemy] as Array<Faction>).find(f => BASE_SPRITE_INDEX[f] === localIndex)
                if(baseFaction){
                    const { x, y } = this.toWorld(tx, ty)
                    const base = this.createShipSprite(v4(), baseFaction, ShipType.CATH, x, y)
                    if(baseFaction === Faction.Enemy) this.enemyBaseId = base.id
                    continue
                }

                // A ShipTypeSpriteIndex (green, Player) or ShipTypeSpriteIndexEnemy (red, Enemy) tile spawns
                // one ship of that type standing right there at match start — same tile-lookup role
                // BASE_SPRITE_INDEX plays for a Base, just per-ShipType instead of a fixed single type.
                const shipTypeKey = (ShipTypeSpriteIndex[localIndex] ?? ShipTypeSpriteIndexEnemy[localIndex]) as keyof typeof ShipType | undefined
                if(shipTypeKey){
                    const faction = ShipTypeSpriteIndex[localIndex] !== undefined ? Faction.Player : Faction.Enemy
                    const type = ShipType[shipTypeKey]
                    const { x, y } = this.toWorld(tx, ty)
                    this.createShipSprite(v4(), faction, type, x, y)
                    continue
                }

                if(AsteroidSpriteIndexesLarge.includes(localIndex)){
                    const { x, y } = this.toWorld(tx, ty)
                    const metal = Math.round(ASTEROID_AVG_METAL + (Math.random()*2-1)*ASTEROID_METAL_VARIANCE)
                    const node:ResourceNodeData = { id:v4(), x, y, metal, maxMetal:metal }
                    useAppStore.getState().addResourceNode(node)
                    this.assignResourceNodeFrame(node)
                    continue
                }

                const spriteName = ObjectiveSpriteIndex[localIndex] as ObjectiveSprite | undefined
                if(!spriteName) continue

                const spawn:ObjectiveSpawn = { id:v4(), x:tx, y:ty, sprite:spriteName }
                this.mapData.objectives.push(spawn)
                const objective:ObjectiveData = { id:spawn.id, owner:null, capturingFaction:null, captureStartedAtMs:null }
                useAppStore.getState().addObjective(objective)
            }
        }

        // One bulk sync at the end rather than one per entity — this runs once at match start with
        // potentially dozens of ships, and nothing needs to see them appear one at a time.
        this.syncShipSummaries()
    }

    // Which of its tier's frames a node shows is rolled once, at spawn, and again only when it actually
    // drops a tier — rolling per frame would make an asteroid visibly churn through variants as it's mined.
    assignResourceNodeFrame = (node:ResourceNodeData) => {
        const frames = ASTEROID_TIER_FRAMES[asteroidTier(node)]
        this.resourceNodeFrames.set(node.id, frames[Math.floor(Math.random()*frames.length)])
    }

    updateResourceNodeFrame = (node:ResourceNodeData) => {
        const frames = ASTEROID_TIER_FRAMES[asteroidTier(node)]
        if(frames.includes(this.resourceNodeFrames.get(node.id))) return
        this.resourceNodeFrames.set(node.id, frames[Math.floor(Math.random()*frames.length)])
    }

    getObjectiveOwnerColor = (owner:Faction | null) => owner === Faction.Player ? GREEN_HEX : owner === Faction.Enemy ? RED_HEX : YELLOW_HEX

    updateObjectives = (time:number) => {
        const { objectives, setObjectives } = useAppStore.getState()
        if(objectives.length === 0) return
        const ships = this.ships

        let changed = false
        const updated = objectives.map(objective => {
            const spawn = this.mapData.objectives.find(o => o.id === objective.id)
            if(!spawn) return objective
            const { x, y } = this.toWorld(spawn.x, spawn.y)

            const contestingFaction = [Faction.Player, Faction.Enemy].find(faction => {
                const hasAttachedArmor = ships.some(s => s.faction === faction && s.type === ShipType.ZEL
                    && s.latchedObjectiveId === objective.id && s.objectiveAttached)
                if(!hasAttachedArmor) return false

                const enemyShipPresent = ships.some(s => s.faction !== faction
                    && Phaser.Math.Distance.Between(x, y, s.x, s.y) <= OBJECTIVE_CAPTURE_RADIUS_PX)
                return !enemyShipPresent
            }) ?? null

            if(contestingFaction !== objective.capturingFaction){
                changed = true
                objective = { ...objective, capturingFaction: contestingFaction, captureStartedAtMs: contestingFaction ? time : null }
            }

            if(!contestingFaction || objective.owner === contestingFaction || objective.captureStartedAtMs === null) return objective
            if(time - objective.captureStartedAtMs < OBJECTIVE_CAPTURE_TIME_MS) return objective

            changed = true
            return { ...objective, owner: contestingFaction }
        })

        if(changed) setObjectives(updated)

        const owners = updated.map(o => o.owner)
        if(owners.length > 0 && owners[0] && owners.every(owner => owner === owners[0])) this.handleAllObjectivesCaptured(owners[0])
    }

    handleAllObjectivesCaptured = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        onShowModal(faction === Faction.Player ? Modal.Victory : Modal.Defeat)
    }

    handleBaseDestroyed = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        onShowModal(faction === Faction.Player ? Modal.Defeat : Modal.Victory)
    }

    updateFogOfWar = () => {
        this.ships.filter(s => s.faction === Faction.Enemy).forEach(s => {
            s.setVisible(this.isWithinFactionSightRange(s.x, s.y, Faction.Player))
        })
    }

    // --- Physics sprite lifecycle -------------------------------------------------------------------
    // Every ShipSprite is created exactly once (spawnShip; spawnEntitiesFromMap for a faction's Base
    // and every map-placed starting ship), and destroyed exactly once, the instant damage actually
    // drops its hp to 0 (killIfDead/detonateDrone).

    createShipSprite = (id:string, faction:Faction, type:ShipType, x:number, y:number):ShipSprite => {
        // The texture here is only what gives the physics body its size — which faction's art actually
        // gets drawn is the renderer's business (see Assets3D's getShipTexture). Both factions' art for a
        // type is the same dimensions, so the player's is used for sizing regardless of faction.
        const ship = new ShipSprite(this, x, y, type, id, faction, type)
        this.add.existing(ship)
        this.physics.add.existing(ship)
        this.centerCircleBody(ship)
        ship.setData('kind', 'ship' as BodyKind)
        ship.setData('id', id)
        this.shipsGroup.add(ship)
        this.shipSprites.set(id, ship)

        // Enemy ships start hidden and are revealed only by fog of war (updateFogOfWar).
        if(faction !== Faction.Player) ship.setVisible(false)
        return ship
    }

    destroyShipSprite = (id:string) => {
        this.shipSprites.get(id)?.destroy()
        this.shipSprites.delete(id)
    }

    centerCircleBody = (sprite:Physics.Arcade.Sprite) => {
        const radius = Math.min(sprite.width, sprite.height) / 2
        const body = sprite.body as Physics.Arcade.Body
        body.setCircle(radius, sprite.width/2 - radius, sprite.height/2 - radius)
    }

    // Applies damage to a single ship and, if it dies, handles the shared "a ship just died" side
    // effects (death fragments, sprite/label cleanup, ending the match if it was a Base, syncing the
    // store's summary) — every ship-damage call site funnels through this. detonateDrone handles the
    // *drone's own* death separately (it gets an impact flash, not fragments — it's the one detonating).
    killIfDead = (ship:ShipSprite) => {
        if(ship.isAlive()) return false
        const wasBase = ship.type === ShipType.CATH
        const faction = ship.faction
        this.destroyShipSprite(ship.id)
        this.syncShipSummaries()
        if(wasBase) this.handleBaseDestroyed(faction)
        return true
    }

    // Pushes a fresh low-frequency summary of every ship into the store — see ShipSummary's own doc
    // comment for why this only ever happens on a discrete event (spawn/death/queue change), never on a
    // physics tick.
    syncShipSummaries = () => {
        useAppStore.getState().setShips(this.ships.map(s => s.toSummary()))
    }

    // Advances every ship one step towards its own route (see ShipSprite's waypoints/pathIndex), then
    // sits idle at the end of it — except ZEL, which instead heads for and latches onto a capturable
    // Objective the instant it's in range (overriding its route entirely while latched), GAIN, which
    // orbits whichever Asteroid updateHarvesterMiningTargets assigned it, and EYE, which permanently
    // locks in place the moment it finishes its very first route.
    moveShips = (time:number, deltaMs:number) => {
        const { resourceNodes, objectives } = useAppStore.getState()
        const arrivedBoms:Array<ShipSprite> = []

        this.ships.forEach(ship => {
            const ownWaypoints = ship.waypoints
            const waypoints = ship.type === ShipType.BOM ? ownWaypoints.slice(0, 1) : ownWaypoints
            const pathIndex = ship.pathIndex
            const speed = ship.orderSpeedPxS ?? ShipData[ship.type].speed
            const step = speed * (deltaMs/1000)

            const movementLocked = ship.type === ShipType.EYE && !!ship.movementLocked
            const idle = movementLocked || pathIndex >= waypoints.length
            const miningNodeId = this.harvesterMiningTarget.get(ship.id)
            const miningNode = miningNodeId ? resourceNodes.find(n => n.id === miningNodeId) : undefined

            let latchedObjectiveId = ship.latchedObjectiveId
            let latchedObjectiveWorld:{x:number,y:number} | undefined
            if(ship.type === ShipType.ZEL){
                if(latchedObjectiveId){
                    const held = objectives.find(o => o.id === latchedObjectiveId)
                    if(!held || held.owner === ship.faction) latchedObjectiveId = undefined
                }
                if(!latchedObjectiveId){
                    const spawn = this.mapData.objectives.find(sp => {
                        const candidate = objectives.find(o => o.id === sp.id)
                        if(!candidate || candidate.owner === ship.faction) return false
                        const { x, y } = this.toWorld(sp.x, sp.y)
                        return Phaser.Math.Distance.Between(ship.x, ship.y, x, y) <= OBJECTIVE_CAPTURE_RADIUS_PX
                    })
                    if(spawn) latchedObjectiveId = spawn.id
                }
                if(latchedObjectiveId){
                    const spawn = this.mapData.objectives.find(sp => sp.id === latchedObjectiveId)
                    if(spawn){
                        const { x, y } = this.toWorld(spawn.x, spawn.y)
                        const angle = stableAngularPhase(ship.id)
                        latchedObjectiveWorld = { x: x+Math.cos(angle)*OBJECTIVE_ICON_SIZE/2, y: y+Math.sin(angle)*OBJECTIVE_ICON_SIZE/2 }
                    }
                }
            }

            let target:{x:number,y:number}
            if(latchedObjectiveWorld){
                target = latchedObjectiveWorld
            }
            else if(miningNode){
                const angle = time*HARVESTER_ORBIT_ANGULAR_SPEED + stableAngularPhase(ship.id)
                target = { x: miningNode.x+Math.cos(angle)*HARVESTER_ORBIT_RADIUS_PX, y: miningNode.y+Math.sin(angle)*HARVESTER_ORBIT_RADIUS_PX }
            }
            else {
                target = idle ? { x:ship.x, y:ship.y } : this.toWorld(waypoints[pathIndex].x, waypoints[pathIndex].y)
            }

            const prevX = ship.x, prevY = ship.y

            const dist = Phaser.Math.Distance.Between(ship.x, ship.y, target.x, target.y)
            const nextPathIndex = (!miningNode && !latchedObjectiveWorld && !movementLocked && waypoints.length > 0 && pathIndex < waypoints.length) ? pathIndex+1 : pathIndex
            const arrivedAtRouteEnd = nextPathIndex !== pathIndex && nextPathIndex >= waypoints.length

            if(dist <= step){
                ship.setPosition(target.x, target.y)
                ship.setVelocity(0, 0)
            }
            else {
                this.physics.moveTo(ship, target.x, target.y, speed)
            }

            if(ship.type !== ShipType.CATH){
                const hasDirectionalTarget = !!miningNode || !!latchedObjectiveWorld || !idle
                const desiredRotation = hasDirectionalTarget ? Phaser.Math.Angle.Between(prevX, prevY, target.x, target.y) + Math.PI/2 : 0
                const turnRatePerMs = hasDirectionalTarget ? MOVE_TURN_RATE_PER_MS : IDLE_TURN_RATE_PER_MS
                ship.setRotation(Phaser.Math.Angle.RotateTo(ship.rotation, desiredRotation, Math.min(1, turnRatePerMs*deltaMs)))
            }


            if(ship.type === ShipType.BOM && arrivedAtRouteEnd && dist <= step) arrivedBoms.push(ship)

            ship.objectiveAttached = !!latchedObjectiveWorld && dist <= step
            ship.latchedObjectiveId = latchedObjectiveId
            ship.pathIndex = dist <= step ? nextPathIndex : pathIndex
            if(ship.type === ShipType.EYE && !movementLocked && arrivedAtRouteEnd && dist <= step) ship.movementLocked = true
        })

        this.applyShipSeparation()
        arrivedBoms.forEach(ship => this.detonateDrone(ship, null))
    }

    // Minimum gap kept between any two ship bodies, every frame, on top of whatever movement decision
    // each one already made this frame — this is what makes a pile of ships arriving at the same
    // waypoint spread out instead of stacking exactly on top of each other.
    applyShipSeparation = () => {
        const ships = this.ships
        for(let i=0; i<ships.length; i++){
            const a = ships[i]
            const bodyA = a.body as Physics.Arcade.Body
            const immovableA = ShipData[a.type].speed === 0

            for(let j=i+1; j<ships.length; j++){
                const b = ships[j]
                const bodyB = b.body as Physics.Arcade.Body
                const immovableB = ShipData[b.type].speed === 0
                if(immovableA && immovableB) continue

                const minDist = bodyA.halfWidth + bodyB.halfWidth + SHIP_SEPARATION_PX
                const dx = b.x - a.x
                const dy = b.y - a.y
                let dist = Math.hypot(dx, dy)
                if(dist >= minDist) continue

                let nx:number, ny:number
                if(dist < 0.001){
                    const angle = stableAngularPhase(a.id+b.id)
                    nx = Math.cos(angle); ny = Math.sin(angle)
                    dist = 0
                }
                else {
                    nx = dx/dist; ny = dy/dist
                }

                const overlap = minDist - dist
                const shareA = immovableA ? 0 : (immovableB ? 1 : 0.5)
                const shareB = immovableB ? 0 : (immovableA ? 1 : 0.5)

                if(shareA > 0) a.setPosition(a.x - nx*overlap*shareA, a.y - ny*overlap*shareA)
                if(shareB > 0) b.setPosition(b.x + nx*overlap*shareB, b.y + ny*overlap*shareB)
            }
        }
    }

    getShipEntry = (obj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => obj as unknown as ShipSprite

    isHostileDroneShipPair = (a:Phaser.Types.Physics.Arcade.GameObjectWithBody, b:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        if(a === b) return false
        const shipA = this.getShipEntry(a)
        const shipB = this.getShipEntry(b)
        if(!shipA || !shipB || shipA.faction === shipB.faction) return false
        return DRONE_TYPES.has(shipA.type) || DRONE_TYPES.has(shipB.type)
    }

    isHostileMissileShipPair = (missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missile = missileObj as Physics.Arcade.Sprite
        const ship = this.getShipEntry(shipObj)
        return !!ship && ship.faction !== missile.getData('faction')
    }

    onDroneShipContact = (a:Physics.Arcade.Sprite, b:Physics.Arcade.Sprite) => {
        const shipA = this.getShipEntry(a)
        const shipB = this.getShipEntry(b)
        if(!shipA || !shipB) return

        if(DRONE_TYPES.has(shipA.type)) this.detonateDrone(shipA, shipB)

        if(shipB.active && DRONE_TYPES.has(shipB.type)) this.detonateDrone(shipB, shipA)
    }

    // A drone (KKZ/BOM) detonates: it always self-destructs — a flash at its own position, not the
    // fragment-splitting wreckage a "shot down" ship gets (killIfDead), since it's the one detonating,
    // not being hit — plus damages whatever it hit: a single primary target for KKZ, or an area blast
    // (physics.overlapCirc — the same "who's nearby" query MLRS/ARMOR's own range check uses) for BOM,
    // which ignores `primary` and just blasts everything hostile nearby.
    detonateDrone = (drone:ShipSprite, primary:ShipSprite | null) => {
        const time = this.time.now
        const damage = ShipData[drone.type].damage

        this.impactFlashes.push({ x:drone.x, y:drone.y, createdAt:time, damage })
        this.destroyShipSprite(drone.id)
        this.syncShipSummaries()

        if(drone.type === ShipType.KKZ && primary){
            if(primary.takeDamage(damage)) this.killIfDead(primary)
        }
        else if(drone.type === ShipType.BOM){
            const hits = this.physics.overlapCirc(drone.x, drone.y, ATD_BLAST_RADIUS_PX, true, false)
            hits.forEach(body => {
                const obj = (body as Physics.Arcade.Body).gameObject
                if(obj.getData('kind') !== 'ship') return
                const hitShip = this.getShipEntry(obj as Phaser.Types.Physics.Arcade.GameObjectWithBody)
                if(hitShip && hitShip.faction !== drone.faction){
                    if(hitShip.takeDamage(damage)) this.killIfDead(hitShip)
                }
            })
        }
    }

    onMissileShipContact = (missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missile = missileObj as Physics.Arcade.Sprite
        if(!missile.active) return
        const ship = this.getShipEntry(shipObj)
        if(!ship) return

        const time = this.time.now
        const x = missile.x, y = missile.y, damage = missile.getData('damage')
        missile.destroy()
        this.impactFlashes.push({ x, y, createdAt:time, damage })

        if(ship.takeDamage(damage)) this.killIfDead(ship)
    }

    // A PDF bullet is hostile to any missile of a different faction — same as an offensive missile is to
    // any ship, no further filtering (a bullet doesn't care whose missile it is, only that it's enemy).
    isHostileBulletMissilePair = (bulletObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const bullet = bulletObj as Physics.Arcade.Sprite
        const missile = missileObj as Physics.Arcade.Sprite
        return bullet.getData('faction') !== missile.getData('faction')
    }

    // A bullet hitting a hostile missile destroys both outright — same as any other missile-ending
    // contact, no hp/damage bookkeeping needed since a missile has no hp of its own.
    onBulletMissileContact = (bulletObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const bullet = bulletObj as Physics.Arcade.Sprite
        const missile = missileObj as Physics.Arcade.Sprite
        if(!bullet.active || !missile.active) return

        const time = this.time.now
        const x = missile.x, y = missile.y, damage = missile.getData('damage')
        bullet.destroy()
        missile.destroy()
        this.impactFlashes.push({ x, y, createdAt:time, damage })
    }

    findNearestHostileShip = (fromFaction:Faction, x:number, y:number, range:number) => {
        const hits = this.physics.overlapCirc(x, y, range, true, false)
        let targetShip:Physics.Arcade.Sprite = null
        let nearestShipDist = Infinity

        hits.forEach(body => {
            const obj = (body as Physics.Arcade.Body).gameObject as Physics.Arcade.Sprite
            if(!obj.active) return
            if(obj.getData('kind') !== 'ship') return
            if(!this.isWithinFactionSightRange(obj.x, obj.y, fromFaction)) return
            const ship = this.getShipEntry(obj)
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y)
            if(ship && ship.faction !== fromFaction && d < nearestShipDist){ nearestShipDist = d; targetShip = obj }
        })

        return targetShip
    }

    // Same shape as findNearestHostileShip, but for PDF's own targeting: the nearest hostile *missile*
    // within range — never a ship, drones (KKZ/BOM) included, PDF is purely anti-missile point-defense.
    // "One target at a time": this only ever returns a single nearest result, never a list, so a PDF
    // ship's cooldown-gated shot (see updatePdf) always commits to just the one thing.
    findNearestThreat = (fromFaction:Faction, x:number, y:number, range:number) => {
        const hits = this.physics.overlapCirc(x, y, range, true, false)
        let target:Physics.Arcade.Sprite = null
        let nearestDist = Infinity

        hits.forEach(body => {
            const obj = (body as Physics.Arcade.Body).gameObject as Physics.Arcade.Sprite
            if(!obj.active) return
            if(obj.getData('kind') !== 'missile') return
            if(obj.getData('faction') === fromFaction) return

            if(!this.isWithinFactionSightRange(obj.x, obj.y, fromFaction)) return
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y)
            if(d < nearestDist){ nearestDist = d; target = obj }
        })

        return target
    }

    updateMlrs = (time:number) => {
        this.ships.forEach(ship => {
            if(ship.type !== ShipType.SPR) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.SPR].cooldownMs) return
            if(!ship.ammoRemaining) return

            const targetShip = this.findNearestHostileShip(ship.faction, ship.x, ship.y, ShipData[ShipType.SPR].rangePx)
            if(!targetShip) return

            const shots = Math.min(MISSILE_SALVO_SIZE, ship.ammoRemaining)
            ship.lastFiredAtMs = time
            ship.ammoRemaining -= shots
            const targetId = targetShip.getData('id')
            const aimX = targetShip.x, aimY = targetShip.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!ship.active) return
                    this.spawnMissile(ship.faction, ship.x, ship.y, targetId, ShipData[ShipType.SPR].damage, aimX, aimY)
                })
            }
        })
    }

    // Each PDF, on cooldown, fires one real bullet (see spawnBullet) at whichever single hostile missile
    // is nearest in range — findNearestThreat only ever returns one, so this never splits fire across
    // multiple targets in the same shot. No damage is applied here — a bullet only does anything once it
    // actually travels there and connects (onBulletMissileContact).
    updatePdf = (time:number) => {
        this.ships.forEach(ship => {
            if(ship.type !== ShipType.PDF) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.PDF].cooldownMs) return

            const target = this.findNearestThreat(ship.faction, ship.x, ship.y, ShipData[ShipType.PDF].rangePx)
            if(!target) return

            ship.lastFiredAtMs = time
            this.spawnBullet(ship.faction, ship.x, ship.y, ShipData[ShipType.PDF].damage, target.x, target.y)
        })
    }

    // A real, non-homing projectile: launched once in a straight line at wherever the target was at the
    // moment of firing (physics.moveTo sets a fixed velocity, it's never retargeted mid-flight the way an
    // offensive missile is) — it either physically reaches and hits a hostile missile itself
    // (onBulletMissileContact), or is despawned by updateBullets once it's been flying for
    // BULLET_MAX_LIFETIME_MS with nothing to show for it.
    spawnBullet = (faction:Faction, x:number, y:number, damage:number, aimX:number, aimY:number) => {
        const bullet = this.physics.add.sprite(x, y, 'bullet_dot')
        bullet.setData('kind', 'bullet' as BodyKind)
        // Stable identity for the renderer, so a bullet's dot follows the same projectile frame to frame
        // instead of being rebuilt from scratch (same reason missiles carry one).
        bullet.setData('id', v4())
        bullet.setData('faction', faction)
        bullet.setData('damage', damage)
        bullet.setData('createdAt', this.time.now)
        this.bulletsGroup.add(bullet)
        this.physics.moveTo(bullet, aimX, aimY, BULLET_SPEED_PX_S)
    }

    // Bullets render themselves (a real physics sprite in flight — no separate draw pass) — this only
    // culls whichever ones have been flying for too long without hitting anything.
    updateBullets = (time:number) => {
        this.bulletsGroup.children.each((child:Physics.Arcade.Sprite) => {
            if(child.active && time - child.getData('createdAt') > BULLET_MAX_LIFETIME_MS) child.destroy()
            return true
        })
    }

    // Each DRN, on cooldown, spends one unit of its own ammo (4 total — same ammo/ammoRemaining stat
    // every other ammo-limited ship uses, so it's refilled by a nearby GAIN via updateHarvesterSupport
    // exactly the same way SPR's is) to spawn a KKZ near itself. Once its ammo is fully spent it stops
    // producing until resupplied, same as SPR runs dry — there's no separate lifetime cap beyond that.
    updateDrn = (time:number) => {
        this.ships.forEach(ship => {
            if(ship.type !== ShipType.DRN) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.DRN].cooldownMs) return
            if(!ship.ammoRemaining) return

            ship.lastFiredAtMs = time
            ship.ammoRemaining -= 1
            this.spawnShip(ship, ShipType.KKZ)
        })
    }

    updateHarvesterMiningTargets = () => {
        const { resourceNodes } = useAppStore.getState()
        this.harvesterMiningTarget.clear()
        this.ships.filter(s => s.type === ShipType.GAIN).forEach(harvester => {
            if((harvester.metalCarried ?? 0) >= HARVESTER_METAL_CAPACITY) return

            let nearest:ResourceNodeData = null
            let nearestDist = Infinity
            resourceNodes.forEach(node => {
                if((node.metal ?? 0) <= 0) return
                const d = Phaser.Math.Distance.Between(harvester.x, harvester.y, node.x, node.y)
                if(d <= HARVESTER_RANGE_PX && d < nearestDist){ nearestDist = d; nearest = node }
            })
            if(nearest) this.harvesterMiningTarget.set(harvester.id, nearest.id)
        })
    }

    // A Harvester carries what it mines itself (see ShipSprite's metalCarried), capped at
    // HARVESTER_METAL_CAPACITY, spent later refilling ammo/repairing hp (see updateHarvesterSupport).
    // Stops drawing from its target the instant it's full, same as updateHarvesterMiningTargets already
    // refuses to assign one a target once it is.
    updateHarvesters = (deltaMs:number) => {
        const { resourceNodes, setResourceNodes } = useAppStore.getState()
        if(this.harvesterMiningTarget.size === 0) return

        const drawdown = new Map<string, number>() // asteroid id -> metal drawn this frame so far

        this.ships.filter(s => s.type === ShipType.GAIN).forEach(harvester => {
            const nodeId = this.harvesterMiningTarget.get(harvester.id)
            if(!nodeId) return
            const node = resourceNodes.find(n => n.id === nodeId)
            if(!node) return

            const capacityLeft = HARVESTER_METAL_CAPACITY - (harvester.metalCarried ?? 0)
            if(capacityLeft <= 0) return
            const remaining = (node.metal ?? 0) - (drawdown.get(node.id) || 0)
            if(remaining <= 0) return
            const gathered = Math.min(remaining, capacityLeft, HARVESTER_COLLECTION_RATE_PER_S * (deltaMs/1000))
            drawdown.set(node.id, (drawdown.get(node.id) || 0) + gathered)
            harvester.metalCarried = (harvester.metalCarried ?? 0) + gathered
        })

        if(drawdown.size === 0) return

        const depletedIds:Array<string> = []
        const updated = resourceNodes.map(n => {
            const drawn = drawdown.get(n.id)
            if(!drawn) return n
            const metal = (n.metal ?? 0) - drawn
            if(metal <= 0.001){ depletedIds.push(n.id); return null }
            return { ...n, metal }
        }).filter(n => n !== null)

        setResourceNodes(updated)
        depletedIds.forEach(id => this.resourceNodeFrames.delete(id))
        drawdown.forEach((_, id) => {
            if(depletedIds.includes(id)) return
            this.updateResourceNodeFrame(updated.find(n => n.id === id))
        })
    }

    // Any friendly ship within HARVESTER_RESUPPLY_RANGE_PX of a Harvester gets supported from that
    // Harvester's carried metal, one whole unit at a time every HARVESTER_RESUPPLY_INTERVAL_MS (gated by
    // lastResupplyAtMs, the same cooldown-timestamp pattern lastFiredAtMs uses) rather than a continuous
    // per-second rate, so ammoRemaining/hp/metalCarried never drift off whole numbers. Each Harvester
    // does at most one thing per tick: it prefers topping up an ammo-short target 1-for-1, and only falls
    // back to repairing a damaged target (1 hp for HARVESTER_REPAIR_METAL_COST metal) if no ammo-short
    // target was in range, or it couldn't fully afford one anyway.
    updateHarvesterSupport = (time:number) => {
        const ships = this.ships
        const harvesters = ships.filter(s => s.type === ShipType.GAIN && (s.metalCarried ?? 0) >= 1
            && (!s.lastResupplyAtMs || time - s.lastResupplyAtMs >= HARVESTER_RESUPPLY_INTERVAL_MS))
        if(harvesters.length === 0) return

        const inRange = (harvester:ShipSprite, t:ShipSprite) => t.faction === harvester.faction
            && Phaser.Math.Distance.Between(harvester.x, harvester.y, t.x, t.y) <= HARVESTER_RESUPPLY_RANGE_PX

        harvesters.forEach(harvester => {
            const ammoTarget = ships.find(t => inRange(harvester, t)
                && ShipData[t.type].ammo && (t.ammoRemaining ?? 0) < ShipData[t.type].ammo)
            if(ammoTarget){
                harvester.metalCarried = (harvester.metalCarried ?? 0) - 1
                harvester.lastResupplyAtMs = time
                ammoTarget.gainAmmo(1)
                return
            }

            if((harvester.metalCarried ?? 0) < HARVESTER_REPAIR_METAL_COST) return
            const repairTarget = ships.find(t => inRange(harvester, t) && t.hp < ShipData[t.type].hp)
            if(!repairTarget) return

            harvester.metalCarried = (harvester.metalCarried ?? 0) - HARVESTER_REPAIR_METAL_COST
            harvester.lastResupplyAtMs = time
            repairTarget.heal(1)
        })
    }

    // `damage` is the firing ship's own damage stat (ShipData) — carried on the missile itself so
    // onMissileShipContact doesn't need to look the firer back up (it may well be dead by the time the
    // missile actually lands). `aimX`/`aimY` is the target's position at the moment the caller decided
    // to fire — needed because a staggered salvo shot can spawn well after that (see SALVO_STAGGER_MS):
    // if the target has since died and nothing else was there to retarget onto by spawn time, the live
    // lookup below comes back empty and this is what it aims at instead, so it still launches off in a
    // sensible direction.
    spawnMissile = (faction:Faction, x:number, y:number, targetId:string, damage:number, aimX:number, aimY:number) => {
        const missile = this.physics.add.sprite(x, y, 'missile_dot')
        missile.setData('kind', 'missile' as BodyKind)
        missile.setData('id', v4())
        missile.setData('faction', faction)
        missile.setData('targetId', targetId)
        missile.setData('damage', damage)
        missile.setData('createdAt', this.time.now)
        this.missilesGroup.add(missile)

        const liveTarget = this.shipSprites.get(targetId)
        const aimPointX = liveTarget ? liveTarget.x : aimX, aimPointY = liveTarget ? liveTarget.y : aimY

        this.startMissileLeg(missile, x, y, aimPointX, aimPointY)
    }

    startMissileLeg = (missile:Physics.Arcade.Sprite, originX:number, originY:number, targetX:number, targetY:number) => {
        missile.setData('legOriginX', originX)
        missile.setData('legOriginY', originY)
        missile.setData('legTargetX', targetX)
        missile.setData('legTargetY', targetY)
        missile.setData('legStartAt', this.time.now)
        const legDistance = Phaser.Math.Distance.Between(originX, originY, targetX, targetY)
        missile.setData('legDurationMs', (legDistance / MISSILE_SPEED_PX_S) * 1000)
    }

    updateMissiles = (time:number, deltaMs:number) => {
        this.missilesGroup.children.each((child:Physics.Arcade.Sprite) => {
            if(!child.active) return true

            const targetId = child.getData('targetId')
            const createdAt = child.getData('createdAt')
            if(time - createdAt > MISSILE_MAX_LIFETIME_MS){
                child.destroy()
                return true
            }

            if(!this.shipSprites.get(targetId)){
                const faction:Faction = child.getData('faction')
                const searchRadius = this.mapData.width * CELL_SIZE
                const retargeted = this.findNearestHostileShip(faction, child.x, child.y, searchRadius)

                if(retargeted){
                    child.setData('targetId', retargeted.getData('id'))
                    this.startMissileLeg(child, child.x, child.y, retargeted.x, retargeted.y)
                }
            }

            const legOriginX = child.getData('legOriginX'), legOriginY = child.getData('legOriginY')
            const legTargetX = child.getData('legTargetX'), legTargetY = child.getData('legTargetY')
            const legStartAt = child.getData('legStartAt'), legDurationMs:number = child.getData('legDurationMs')
            const rawProgress = legDurationMs > 0 ? (time-legStartAt) / legDurationMs : 1

            if(rawProgress > 1){
                const faction:Faction = child.getData('faction')
                const damage = child.getData('damage')
                child.destroy()
                this.impactFlashes.push({ x:legTargetX, y:legTargetY, createdAt:time, damage })

                // The overlap callback (onMissileShipContact) only ever catches a hostile ship the
                // missile physically grazes mid-flight. A missile that simply runs out its leg — its
                // target moved off the aim point it was locked onto, or just frame timing — would
                // otherwise vanish here with nothing but a cosmetic flash and no damage at all. Resolve
                // that case explicitly: anything hostile still standing in the blast at the impact point
                // takes the hit, using the same radius the flash is actually drawn at (see
                // drawMissileImpacts) so this always matches what the player sees connect.
                const blastRadius = MISSILE_IMPACT_MIN_RADIUS_PX + damage*MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX
                const hits = this.physics.overlapCirc(legTargetX, legTargetY, blastRadius, true, false)
                hits.forEach(body => {
                    const obj = (body as Physics.Arcade.Body).gameObject as Physics.Arcade.Sprite
                    if(!obj.active || obj.getData('kind') !== 'ship') return
                    const hitShip = this.getShipEntry(obj)
                    if(!hitShip || hitShip.faction === faction) return
                    if(hitShip.takeDamage(damage)) this.killIfDead(hitShip)
                })

                return true
            }

            const progress = Phaser.Math.Clamp(rawProgress, 0, 1)
            const x = Phaser.Math.Linear(legOriginX, legTargetX, progress)
            const y = Phaser.Math.Linear(legOriginY, legTargetY, progress) - Math.sin(progress*Math.PI) * MISSILE_ARC_HEIGHT_PX

            ;(child.body as Physics.Arcade.Body).reset(x, y)

            const lastContrailAt = child.getData('lastContrailAt') || 0
            if(time - lastContrailAt >= CONTRAIL_INTERVAL_MS){
                this.contrails.push({ x, y, createdAt:time, missileId:child.getData('id') })
                child.setData('lastContrailAt', time)
            }

            return true
        })
    }

    randomFlickerIntervalMs = () => HARVESTER_BEAM_FLICKER_MIN_MS + Math.random()*(HARVESTER_BEAM_FLICKER_MAX_MS-HARVESTER_BEAM_FLICKER_MIN_MS)

    toWorld = gridToWorld
    toGrid = worldToGrid

    isWithinFactionSightRange = (worldX:number, worldY:number, faction:Faction) => {
        return this.ships.some(s => s.faction === faction && Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= ShipData[s.type].sightRadius)
    }

    // The order half of what used to be handleClick. Picking which ship (if any) was clicked is now the
    // renderer's job — it owns the camera and therefore the only correct answer about what's under the
    // cursor — but the decision of what an order actually *means* stays here, where the rules live.
    // `additive` is the shift-held variant: append to the route rather than replace it.
    orderSelectedTo = (gridX:number, gridY:number, additive:boolean) => {
        if(gridX < 0 || gridY < 0 || gridX >= this.mapData.width || gridY >= this.mapData.height) return

        const { selectedShipIds } = useAppStore.getState()
        const orderableIds = this.ships
            .filter(s => selectedShipIds.includes(s.id) && s.type !== ShipType.CATH && !s.movementLocked)
            .map(s => s.id)
        if(orderableIds.length === 0) return

        // Clicking an existing waypoint marker always removes it — from every selected ship that has one
        // there, not just whichever ship's marker was drawn on top — and takes priority over shift's
        // usual replace-vs-append behaviour.
        const clickedExisting = this.ships
            .filter(s => orderableIds.includes(s.id))
            .some(s => s.waypoints.some(w => w.x === gridX && w.y === gridY))
        if(clickedExisting){
            this.removeShipWaypoints(orderableIds, gridX, gridY)
            return
        }

        if(additive) this.addShipWaypoints(orderableIds, gridX, gridY)
        else this.setShipWaypoints(orderableIds, gridX, gridY)
    }

    // --- Store-delegated ship orders/production ------------------------------------------------------
    // store.ts's addShipWaypoints/setShipWaypoints/removeShipWaypoints/clearShipWaypoints/queueShip/
    // completeQueueItem just call straight into these — every one of them mutates a real ShipSprite
    // instance directly (see the class's own doc comment for why), never the store.

    // A group ordered together moves together — every ship given this order gets stamped with the
    // slowest member's own top speed (see moveShips, which reads this instead of ShipData[type].speed
    // whenever it's set), rather than each ship racing ahead at its own pace and arriving piecemeal.
    // Ordering a single ship alone still works out to that ship's own natural speed, since it's its own
    // group's minimum.
    groupSpeedPxS = (shipIds:Array<string>) => {
        const speeds = shipIds.map(id => this.shipSprites.get(id)).filter(s => !!s).map(s => ShipData[s.type].speed)
        return Math.min(...speeds)
    }

    // Appends one waypoint onto each selected ship's own route — used for a drag-selected group of
    // combat ships (a Base itself is never included; MapScene's handleClick filters it out before
    // calling this, since it never actually moves and doesn't hand orders down to newly produced ships
    // anymore either — see spawnShip). Each ship keeps whatever progress it's already made; this only
    // adds on.
    addShipWaypoints = (shipIds:Array<string>, x:number, y:number) => {
        const speed = this.groupSpeedPxS(shipIds)
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship || ship.waypoints.length >= MAX_WAYPOINTS) return
            // A new order overrides ZEL's own Objective-latch the same way it overrides anything else it
            // was doing — see ShipSprite's latchedObjectiveId/objectiveAttached.
            ship.waypoints = [...ship.waypoints, { x, y }]
            ship.latchedObjectiveId = undefined
            ship.objectiveAttached = undefined
            ship.orderSpeedPxS = speed
        })
    }

    // A plain (non-shift) order-giving click — wipes whatever route a ship already had and replaces it
    // outright with this one single waypoint, rather than appending onto it. Same latch-clearing as any
    // other new order.
    setShipWaypoints = (shipIds:Array<string>, x:number, y:number) => {
        const speed = this.groupSpeedPxS(shipIds)
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            ship.waypoints = [{ x, y }]
            ship.pathIndex = 0
            ship.latchedObjectiveId = undefined
            ship.objectiveAttached = undefined
            ship.orderSpeedPxS = speed
        })
    }

    // Clicking an existing waypoint marker for a selection removes it from every selected ship that
    // actually has a waypoint there (not just the one whose marker was clicked). Ships with no matching
    // waypoint are left untouched; each ship that does have one keeps its own progress otherwise,
    // resuming from whichever waypoint is nearest to where it currently is.
    removeShipWaypoints = (shipIds:Array<string>, x:number, y:number) => {
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            const index = ship.waypoints.findIndex(w => w.x === x && w.y === y)
            if(index < 0) return
            const newWaypoints = ship.waypoints.filter((_, i) => i !== index)
            const p = ship.pathIndex
            const minIndex = p > index ? p-1 : p
            ship.pathIndex = minIndex >= newWaypoints.length ? newWaypoints.length : nearestWaypointIndex(ship.x, ship.y, newWaypoints, minIndex)
            ship.waypoints = newWaypoints
            ship.latchedObjectiveId = undefined
            ship.objectiveAttached = undefined
        })
    }

    // Selected ships drop their route and just sit wherever they currently are until new orders are given.
    clearShipWaypoints = (shipIds:Array<string>) => {
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            ship.waypoints = []
            ship.pathIndex = 0
            ship.latchedObjectiveId = undefined
            ship.objectiveAttached = undefined
        })
    }

    // Refuses outright — no queue change — if the queue's already full (the Base's own, not necessarily
    // the player: the enemy AI's own queueShip calls go through this exact same gate).
    queueShip = (baseId:string, type:ShipType) => {
        const base = this.shipSprites.get(baseId)
        if(!base || base.queue.length >= MAX_QUEUE) return
        const item:ProductionQueueItem = { id:v4(), type, startedAt: base.queue.length === 0 ? Date.now() : null }
        base.queue = [...base.queue, item]
        this.syncShipSummaries()
    }

    completeQueueItem = (baseId:string) => {
        const base = this.shipSprites.get(baseId)
        if(!base) return
        const [, ...rest] = base.queue
        if(rest.length > 0) rest[0] = { ...rest[0], startedAt: Date.now() }
        base.queue = rest
        this.syncShipSummaries()
    }

    onTransitionIn = () => {
    }
}
