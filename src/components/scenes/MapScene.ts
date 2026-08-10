import { Scene, GameObjects, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene } from "../../common/Thunks";
import { getEnergyStatus, getFactoryEnergyCost } from "../../common/Utils";
import { generateMap } from "../../common/MapGenerator";
import { ShipData } from "../../common/ShipData";
import { Faction, NodeKind, FactoryKind, ShipType, MAP_SIZE, CELL_SIZE, METAL_TICK_MS, METAL_PER_MINING_STATION } from "../../../enum";

const GREEN = 0x33ff55
const GREEN_DIM = 0x114422
const GREY_DIM = 0x666666

const PLACEMENT_RADIUS_PX = 200
const EXTRACTOR_RADIUS_PX = PLACEMENT_RADIUS_PX/2
const TWO_PI = Math.PI*2

// Once a ship finishes its route it loiters in a circle around the final waypoint.
const ORBIT_RADIUS_PX = CELL_SIZE * 1.5
const ORBIT_ANGULAR_SPEED = 0.0005 // radians per ms

// Stable per-ship angular offset so multiple ships orbiting the same point spread out instead of stacking.
const shipOrbitPhase = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return ((h >>> 0) % 1000) / 1000 * TWO_PI
}

// Solar Mills spin slowly in place — one full rotation roughly every 40 seconds.
const SOLAR_MILL_ROTATION_SPEED = 0.00016 // radians per ms

// A CRV's 23mm cannon: how often it can fire, how much damage a hit does, and how long a burst's
// tracer dots stay on screen. Tracers render in the same wireframe green as everything else. Its
// cannon can also target an incoming missile instead of a ship, with a chance to shoot it down.
const CRV_FIRE_COOLDOWN_MS = 350
const CRV_DAMAGE = 1
const TRACER_LIFETIME_MS = 220
const MISSILE_INTERCEPT_CHANCE = 0.4

// A DDG fires a homing missile at its nearest target in range once a second. It always eventually
// catches a non-evasive target (its speed comfortably outruns any ship), unless intercepted first.
const DDG_FIRE_COOLDOWN_MS = 1000
const MISSILE_DAMAGE = 5
const MISSILE_SPEED_PX_S = 220
const MISSILE_MAX_LIFETIME_MS = 8000

// Wreckage left behind by a destroyed ship (or a missile detonating) lingers for 10 seconds, fading
// out over that time.
const SHATTER_LIFETIME_MS = 10000

// How many CRVs the enemy base launches at the player, once, at the start of the match.
const ENEMY_RAID_SIZE = 3

// Mining stations and solar mills project a smaller placement radius than bases/shipyards.
const getStructureRadius = (structure:BaseData|FactoryData) =>
    'kind' in structure && structure.kind !== FactoryKind.Shipyard ? EXTRACTOR_RADIUS_PX : PLACEMENT_RADIUS_PX

// A DDG's missile: a scene-local (not app-state) homing projectile, tracked only while in flight.
interface Missile {
    id: string
    faction: Faction
    targetId: string
    x: number
    y: number
    createdAt: number
}

// All ships render at one standardized NATO map-symbol size, regardless of their actual sizeHex footprint.
const NATO_ICON_SIZE = CELL_SIZE * 1.5

// Physical footprints used to keep ships and buildings from overlapping each other.
const BASE_FOOTPRINT_RADIUS = CELL_SIZE * 1.5
const FACTORY_FOOTPRINT_RADIUS = CELL_SIZE * 0.75
const SHIP_BUILDING_CLEARANCE_PX = 20

// Simple deterministic PRNG so a node's jagged shape stays stable across redraws.
const seededRandom = (seed:string) => {
    let h = 0
    for(let i=0; i<seed.length; i++) h = (h*31 + seed.charCodeAt(i)) | 0
    return () => {
        h = (h*1664525 + 1013904223) | 0
        return ((h >>> 0) / 0xffffffff)
    }
}

const normalizeAngle = (a:number) => {
    a = a % TWO_PI
    return a < 0 ? a + TWO_PI : a
}

// Removes [hideStart,hideEnd] (within [0,TWO_PI], hideStart<=hideEnd) from a set of non-wrapping visible intervals.
const subtractArc = (intervals:Array<[number,number]>, hideStart:number, hideEnd:number):Array<[number,number]> => {
    const result:Array<[number,number]> = []
    intervals.forEach(([s,e]) => {
        const hs = Math.max(s, hideStart)
        const he = Math.min(e, hideEnd)
        if(hs >= he){
            result.push([s,e])
            return
        }
        if(hs > s) result.push([s, hs])
        if(he < e) result.push([he, e])
    })
    return result
}

// Same as subtractArc but accepts a raw (possibly negative or >TWO_PI) angle range and handles wraparound.
const subtractCircularRange = (intervals:Array<[number,number]>, rawStart:number, rawEnd:number):Array<[number,number]> => {
    if(rawEnd - rawStart >= TWO_PI) return []
    const start = normalizeAngle(rawStart)
    const end = normalizeAngle(rawEnd)
    if(start <= end) return subtractArc(intervals, start, end)
    return subtractArc(subtractArc(intervals, start, TWO_PI), 0, end)
}

export default class MapScene extends Scene {

    g: GameObjects.Graphics
    previewG: GameObjects.Graphics
    selectionG: GameObjects.Graphics
    progressG: GameObjects.Graphics
    shipG: GameObjects.Graphics
    ordersG: GameObjects.Graphics
    solarMillG: GameObjects.Graphics
    combatG: GameObjects.Graphics
    shatterG: GameObjects.Graphics
    missileG: GameObjects.Graphics
    shipLabels: Map<string, GameObjects.Text> = new Map()
    orderLabels: Array<GameObjects.Text> = []
    lastOrdersKey: string = ''
    tracers: Array<{ x1:number, y1:number, x2:number, y2:number, createdAt:number }> = []
    shatters: Array<{ x:number, y:number, createdAt:number, seed:string }> = []
    missiles: Array<Missile> = []
    enemyShipyardId: string
    enemyRaidLaunched: boolean = false
    mapData: MapData
    origDragPoint: Phaser.Math.Vector2
    hoveredCell: {x:number, y:number}
    unsubscribe: () => void

    constructor(config){
        super(config)
        onSetScene(this)
    }

    create = () => {
        this.cameras.main.setBackgroundColor('#000000')
        this.input.mouse.disableContextMenu()
        this.g = this.add.graphics()
        this.previewG = this.add.graphics()
        this.selectionG = this.add.graphics()
        this.progressG = this.add.graphics()
        this.shipG = this.add.graphics()
        this.ordersG = this.add.graphics()
        this.solarMillG = this.add.graphics()
        this.combatG = this.add.graphics()
        this.shatterG = this.add.graphics()
        this.missileG = this.add.graphics()

        this.mapData = useAppStore.getState().activeMap || generateMap(MAP_SIZE)

        this.cameras.main.setZoom(1)
        this.centerCameraBounds()

        this.spawnEnemyShipyard()
        this.drawMap()
        this.enableCameraControls()
        this.enablePlacementControls()
        this.spawnEnemyRaid()

        this.time.addEvent({ delay: METAL_TICK_MS, loop: true, callback: this.tickResources })
        this.time.addEvent({ delay: 500, loop: true, callback: this.tickProduction })

        this.unsubscribe = useAppStore.subscribe((state, prevState) => {
            if(state.placingFactory !== prevState.placingFactory) this.updatePreview()
        })
        this.events.once('shutdown', () => this.unsubscribe())

        useAppStore.getState().setLoaded(true)
    }

    // Pulsating octagon around the currently selected shipyard, redrawn every frame for the animation.
    update = (time:number, delta:number) => {
        this.moveShips(time, delta)
        this.updateCombat(time)
        this.updateMissiles(time, delta)
        this.checkEnemyRaid()
        this.drawProductionProgress()
        this.drawShips()
        this.drawOrders()
        this.drawSolarMills(time)
        this.drawCombat(time)
        this.drawShatters(time)
        this.drawMissiles()

        this.selectionG.clear()
        const { selectedFactoryId, factories } = useAppStore.getState()
        const selectedFactory = factories.find(f => f.id === selectedFactoryId)
        if(!selectedFactory) return

        const { x, y } = this.toWorld(selectedFactory.x, selectedFactory.y)
        const pulse = 0.85 + Math.sin(time*0.006)*0.15
        const r = CELL_SIZE * 1.3 * pulse
        const points = []
        for(let i=0; i<8; i++){
            const angle = (i/8)*Math.PI*2 + Math.PI/8
            points.push(new Phaser.Math.Vector2(x + Math.cos(angle)*r, y + Math.sin(angle)*r))
        }
        this.selectionG.lineStyle(2, GREEN, 1)
        this.selectionG.strokePoints(points, true, true)
    }

    // Progress bar above every shipyard currently building something.
    drawProductionProgress = () => {
        const g = this.progressG
        g.clear()

        useAppStore.getState().factories.forEach(f => {
            const item = f.queue?.[0]
            if(f.kind !== FactoryKind.Shipyard || !item?.startedAt) return

            const { x, y } = this.toWorld(f.x, f.y)
            const percent = PhaserMath.Clamp((Date.now()-item.startedAt) / ShipData[item.type].productionTimeMs, 0, 1)
            const w = CELL_SIZE * 1.6, h = 4
            const barX = x - w/2, barY = y - CELL_SIZE*2 - h

            g.lineStyle(1, GREEN, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(GREEN, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    // Every mining station the player owns yields metal on each tick.
    tickResources = () => {
        const { factories, addMetal } = useAppStore.getState()
        const miningStations = factories.filter(f => f.faction === Faction.Player && f.kind === FactoryKind.MiningStation)
        if(miningStations.length === 0) return

        addMetal(miningStations.length * METAL_PER_MINING_STATION)
        miningStations.forEach(f => this.floatText(f.x, f.y, '+'+METAL_PER_MINING_STATION))
    }

    floatText = (gridX:number, gridY:number, text:string) => {
        const { x, y } = this.toWorld(gridX, gridY)
        const label = this.add.text(x, y, text, { fontFamily:'Body', fontSize:'20px', color:'#33ff55' }).setOrigin(0.5).setDepth(5)
        this.tweens.add({
            targets: label,
            y: y-20,
            duration: 2000,
            onComplete: () => label.destroy()
        })
    }

    // Completes any shipyard's front-of-queue item once its production time has elapsed.
    tickProduction = () => {
        const { factories, completeQueueItem } = useAppStore.getState()
        const now = Date.now()
        let spawned = false

        factories.forEach(f => {
            const item = f.queue?.[0]
            if(item?.startedAt && now - item.startedAt >= ShipData[item.type].productionTimeMs){
                completeQueueItem(f.id)
                this.spawnShip(f, item.type)
                spawned = true
            }
        })

        if(spawned) this.drawMap()
    }

    // Places a newly completed ship near its shipyard, trying to avoid overlapping other loitering ships or any building.
    spawnShip = (shipyard:FactoryData, type:ShipType) => {
        const center = this.toWorld(shipyard.x, shipyard.y)
        const size = ShipData[type].sizeHex * CELL_SIZE
        const existingShips = useAppStore.getState().ships
        let pos = center

        for(let attempt=0; attempt<40; attempt++){
            const radius = CELL_SIZE*1.5 + attempt*4
            const angle = Math.random()*Math.PI*2
            const candidate = { x: center.x+Math.cos(angle)*radius, y: center.y+Math.sin(angle)*radius }
            const overlapsShip = existingShips.some(s => {
                const minDist = (size + ShipData[s.type].sizeHex*CELL_SIZE)/2 + 12
                return Phaser.Math.Distance.Between(candidate.x, candidate.y, s.x, s.y) < minDist
            })
            if(!overlapsShip && !this.buildingOverlapsPoint(candidate.x, candidate.y, size/2 + SHIP_BUILDING_CLEARANCE_PX)){ pos = candidate; break }
        }

        useAppStore.getState().addShip({ id:v4(), faction:shipyard.faction, type, shipyardId:shipyard.id, x:pos.x, y:pos.y, pathIndex:0, hp:ShipData[type].hp })
    }

    // One-time opening move: the enemy base plants a shipyard on whichever valid, empty spot along the
    // edge of its territory would newly bring the most currently-unclaimed resource nodes into range,
    // pushing their border outward to encompass them (the same way a player's own placement radius
    // works — see isNearOwnStructure/drawPlacementRanges). The shipyard itself must sit off any node;
    // it's the radius it projects that annexes nearby ones for future mining stations/solar mills.
    spawnEnemyShipyard = () => {
        const uncovered = this.mapData.nodes.filter(n => !this.isNearOwnStructure(n.x, n.y, Faction.Enemy))
        let best:{x:number, y:number} = null
        let bestScore = -1

        for(let x=0; x<this.mapData.width; x++){
            for(let y=0; y<this.mapData.height; y++){
                if(!this.isValidPlacement(FactoryKind.Shipyard, x, y, Faction.Enemy)) continue

                const { x:wx, y:wy } = this.toWorld(x, y)
                const score = uncovered.filter(n => {
                    const p = this.toWorld(n.x, n.y)
                    return Phaser.Math.Distance.Between(wx, wy, p.x, p.y) <= PLACEMENT_RADIUS_PX
                }).length

                if(score > bestScore){ bestScore = score; best = { x, y } }
            }
        }

        if(!best) return
        const id = v4()
        useAppStore.getState().addFactory({ id, x:best.x, y:best.y, kind:FactoryKind.Shipyard, faction:Faction.Enemy })
        this.enemyShipyardId = id
    }

    // One-time opening move: the enemy shipyard queues up a handful of CRVs — going through the same
    // build queue/production timer as any player-built ship, rather than spawning them for free — and
    // then just sits on them once built. checkEnemyRaid is what actually sends them at the player.
    spawnEnemyRaid = () => {
        const { queueShip } = useAppStore.getState()
        if(!this.enemyShipyardId) return
        for(let i=0; i<ENEMY_RAID_SIZE; i++) queueShip(this.enemyShipyardId, ShipType.CRV)
    }

    // Watches the enemy shipyard's own production output and, the moment it has massed a full raid's
    // worth of ships loitering by it, gives it standing orders at the player's base — the same
    // shipyard-orders mechanism the player uses, just driven by the AI instead of a click on the map.
    // Runs once (checked every frame, but a no-op after firing) since it can't hook a "ship completed" event.
    checkEnemyRaid = () => {
        if(this.enemyRaidLaunched || !this.enemyShipyardId) return

        const { ships, addWaypoint } = useAppStore.getState()
        const massed = ships.filter(s => s.shipyardId === this.enemyShipyardId).length
        if(massed < ENEMY_RAID_SIZE) return

        const playerBase = this.mapData.bases.find(b => b.faction === Faction.Player)
        if(!playerBase) return

        addWaypoint(this.enemyShipyardId, playerBase.x, playerBase.y)
        this.enemyRaidLaunched = true
    }

    // Advances every ship one step towards its shipyard's current route, read live off the shipyard each
    // frame (rather than a copy taken at spawn) so edited orders steer ships that are already underway.
    // Once a ship has worked through every waypoint it loiters in a slow orbit around the last one; a
    // ship whose orders were cleared instead orbits wherever it was when that happened.
    moveShips = (time:number, deltaMs:number) => {
        const { ships, factories, setShips } = useAppStore.getState()
        let changed = false

        const updated = ships.map(ship => {
            const shipyard = factories.find(f => f.id === ship.shipyardId)
            const waypoints = shipyard?.waypoints || []
            const pathIndex = ship.pathIndex ?? 0
            const step = ShipData[ship.type].speed * (deltaMs/1000)
            changed = true

            let target:{x:number,y:number}
            let orbitAnchor = ship.orbitAnchor
            if(waypoints.length === 0){
                orbitAnchor = orbitAnchor || { x:ship.x, y:ship.y }
                const angle = time*ORBIT_ANGULAR_SPEED + shipOrbitPhase(ship.id)
                target = { x: orbitAnchor.x+Math.cos(angle)*ORBIT_RADIUS_PX, y: orbitAnchor.y+Math.sin(angle)*ORBIT_RADIUS_PX }
            }
            else if(pathIndex < waypoints.length){
                target = this.toWorld(waypoints[pathIndex].x, waypoints[pathIndex].y)
            }
            else {
                const last = this.toWorld(waypoints[waypoints.length-1].x, waypoints[waypoints.length-1].y)
                const angle = time*ORBIT_ANGULAR_SPEED + shipOrbitPhase(ship.id)
                target = { x: last.x+Math.cos(angle)*ORBIT_RADIUS_PX, y: last.y+Math.sin(angle)*ORBIT_RADIUS_PX }
            }

            const dist = Phaser.Math.Distance.Between(ship.x, ship.y, target.x, target.y)
            const nextPathIndex = waypoints.length > 0 && pathIndex < waypoints.length ? pathIndex+1 : pathIndex
            if(dist <= step) return { ...ship, x:target.x, y:target.y, pathIndex:nextPathIndex, orbitAnchor }

            const angle = Math.atan2(target.y-ship.y, target.x-ship.x)
            return { ...ship, x: ship.x+Math.cos(angle)*step, y: ship.y+Math.sin(angle)*step, pathIndex, orbitAnchor }
        })

        if(changed) setShips(updated)
    }

    // Each CRV, on cooldown, hunts down whichever hostile ship OR incoming missile is nearest and — if
    // it's within the cannon's range — fires a burst (a tracer effect is queued for drawCombat to
    // render). A shot at a ship always lands; a shot at a missile only has a chance to bring it down.
    // Ship damage is resolved in a second pass so simultaneous shooters, and multiple shots landing on
    // the same target in one frame, all apply correctly before any ship is removed.
    updateCombat = (time:number) => {
        const { ships, setShips } = useAppStore.getState()
        const range = ShipData[ShipType.CRV].weaponRange
        const shooterIds = new Set<string>()
        const damageByTarget = new Map<string, number>()
        const interceptedMissileIds = new Set<string>()

        ships.forEach(ship => {
            if(ship.type !== ShipType.CRV) return
            if(ship.lastFiredAt && time - ship.lastFiredAt < CRV_FIRE_COOLDOWN_MS) return

            let nearestShip:ShipInstanceData = null
            let nearestMissile:Missile = null
            let nearestDist = Infinity
            ships.forEach(other => {
                if(other.faction === ship.faction) return
                const d = Phaser.Math.Distance.Between(ship.x, ship.y, other.x, other.y)
                if(d < nearestDist){ nearestDist = d; nearestShip = other; nearestMissile = null }
            })
            this.missiles.forEach(missile => {
                if(missile.faction === ship.faction || interceptedMissileIds.has(missile.id)) return
                const d = Phaser.Math.Distance.Between(ship.x, ship.y, missile.x, missile.y)
                if(d < nearestDist){ nearestDist = d; nearestMissile = missile; nearestShip = null }
            })
            if(nearestDist > range || (!nearestShip && !nearestMissile)) return

            shooterIds.add(ship.id)
            if(nearestShip){
                this.tracers.push({ x1:ship.x, y1:ship.y, x2:nearestShip.x, y2:nearestShip.y, createdAt:time })
                damageByTarget.set(nearestShip.id, (damageByTarget.get(nearestShip.id) || 0) + CRV_DAMAGE)
            }
            else {
                this.tracers.push({ x1:ship.x, y1:ship.y, x2:nearestMissile.x, y2:nearestMissile.y, createdAt:time })
                if(Math.random() < MISSILE_INTERCEPT_CHANCE) interceptedMissileIds.add(nearestMissile.id)
            }
        })

        if(interceptedMissileIds.size > 0){
            this.missiles.forEach(m => { if(interceptedMissileIds.has(m.id)) this.shatters.push({ x:m.x, y:m.y, createdAt:time, seed:m.id }) })
            this.missiles = this.missiles.filter(m => !interceptedMissileIds.has(m.id))
        }

        if(shooterIds.size === 0) return

        const updated = ships.map(ship => {
            const damage = damageByTarget.get(ship.id)
            if(damage === undefined) return shooterIds.has(ship.id) ? { ...ship, lastFiredAt:time } : ship

            const hp = ship.hp - damage
            if(hp <= 0){
                this.shatters.push({ x:ship.x, y:ship.y, createdAt:time, seed:ship.id })
                return null
            }
            return shooterIds.has(ship.id) ? { ...ship, hp, lastFiredAt:time } : { ...ship, hp }
        }).filter(ship => ship !== null)

        setShips(updated)
    }

    // Each DDG, once a second, launches a homing missile at its nearest hostile ship in range. The
    // missile is a scene-local projectile (not stored in the app state) that steers towards its
    // target's live position every frame; on arrival it applies its damage and leaves a shatter effect
    // at the impact point, reusing the same wreckage visual as a destroyed ship (see drawShatters).
    updateMissiles = (time:number, deltaMs:number) => {
        const { ships, setShips } = useAppStore.getState()
        const range = ShipData[ShipType.DDG].weaponRange
        const shooterIds = new Set<string>()

        ships.forEach(ship => {
            if(ship.type !== ShipType.DDG) return
            if(ship.lastFiredAt && time - ship.lastFiredAt < DDG_FIRE_COOLDOWN_MS) return

            let nearest:ShipInstanceData = null
            let nearestDist = Infinity
            ships.forEach(other => {
                if(other.faction === ship.faction) return
                const d = Phaser.Math.Distance.Between(ship.x, ship.y, other.x, other.y)
                if(d < nearestDist){ nearestDist = d; nearest = other }
            })
            if(!nearest || nearestDist > range) return

            shooterIds.add(ship.id)
            this.missiles.push({ id:v4(), faction:ship.faction, targetId:nearest.id, x:ship.x, y:ship.y, createdAt:time })
        })

        if(shooterIds.size > 0) setShips(ships.map(ship => shooterIds.has(ship.id) ? { ...ship, lastFiredAt:time } : ship))

        if(this.missiles.length === 0) return

        const liveShips = useAppStore.getState().ships
        const damageByTarget = new Map<string, number>()
        const spentMissileIds = new Set<string>()
        const step = MISSILE_SPEED_PX_S * (deltaMs/1000)

        this.missiles.forEach(missile => {
            const target = liveShips.find(s => s.id === missile.targetId)
            if(!target || time - missile.createdAt > MISSILE_MAX_LIFETIME_MS){
                spentMissileIds.add(missile.id)
                return
            }

            const dist = Phaser.Math.Distance.Between(missile.x, missile.y, target.x, target.y)
            if(dist <= step){
                damageByTarget.set(target.id, (damageByTarget.get(target.id) || 0) + MISSILE_DAMAGE)
                this.shatters.push({ x:target.x, y:target.y, createdAt:time, seed:missile.id })
                spentMissileIds.add(missile.id)
                return
            }

            const angle = Math.atan2(target.y-missile.y, target.x-missile.x)
            missile.x += Math.cos(angle)*step
            missile.y += Math.sin(angle)*step
        })

        if(spentMissileIds.size > 0) this.missiles = this.missiles.filter(m => !spentMissileIds.has(m.id))

        if(damageByTarget.size > 0){
            const afterImpact = useAppStore.getState().ships.map(ship => {
                const damage = damageByTarget.get(ship.id)
                if(damage === undefined) return ship
                const hp = ship.hp - damage
                return hp <= 0 ? null : { ...ship, hp }
            }).filter(ship => ship !== null)
            useAppStore.getState().setShips(afterImpact)
        }
    }

    // Missiles in flight render as small homing dots, same wireframe green as everything else.
    drawMissiles = () => {
        const g = this.missileG
        g.clear()
        this.missiles.forEach(m => {
            g.fillStyle(GREEN, 0.9)
            g.fillCircle(m.x, m.y, 2)
        })
    }

    // Machine-gun tracer fire: a short burst of small dots travelling along the shot's line, fading
    // out quickly. Purely a visual effect layer, redrawn every frame from the transient tracers list.
    drawCombat = (time:number) => {
        const g = this.combatG
        g.clear()

        this.tracers = this.tracers.filter(t => time - t.createdAt < TRACER_LIFETIME_MS)
        this.tracers.forEach(t => {
            const progress = (time - t.createdAt) / TRACER_LIFETIME_MS
            const dotCount = 4
            for(let i=0; i<dotCount; i++){
                const dotProgress = Math.min(1, progress + i*0.12)
                const x = t.x1 + (t.x2-t.x1)*dotProgress
                const y = t.y1 + (t.y2-t.y1)*dotProgress
                g.fillStyle(GREEN, (1-progress) * (1-i*0.2))
                g.fillCircle(x, y, 1.5)
            }
        })
    }

    // Wreckage marking where a ship was destroyed: a jagged scatter of debris fragments (shape kept
    // stable frame-to-frame by seeding the randomness off the dead ship's id), fading out over 10s.
    drawShatters = (time:number) => {
        const g = this.shatterG
        g.clear()

        this.shatters = this.shatters.filter(s => time - s.createdAt < SHATTER_LIFETIME_MS)
        this.shatters.forEach(s => {
            const progress = (time - s.createdAt) / SHATTER_LIFETIME_MS
            const alpha = 1 - progress
            const rand = seededRandom(s.seed)

            g.lineStyle(1.5, GREEN, alpha)
            const pieces = 6
            for(let i=0; i<pieces; i++){
                const angle = rand()*TWO_PI
                const len = CELL_SIZE * (0.3 + rand()*0.5)
                const startX = s.x + (rand()-0.5)*CELL_SIZE*0.6
                const startY = s.y + (rand()-0.5)*CELL_SIZE*0.6
                g.lineBetween(startX, startY, startX+Math.cos(angle)*len, startY+Math.sin(angle)*len)
            }
        })
    }

    // True if a point (with the given clearance around it) would overlap a base or factory footprint.
    buildingOverlapsPoint = (worldX:number, worldY:number, clearance:number) => {
        const overlapsBase = this.mapData.bases.some(b => {
            const p = this.toWorld(b.x, b.y)
            return Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y) < BASE_FOOTPRINT_RADIUS + clearance
        })
        if(overlapsBase) return true

        return useAppStore.getState().factories.some(f => {
            const p = this.toWorld(f.x, f.y)
            return Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y) < FACTORY_FOOTPRINT_RADIUS + clearance
        })
    }

    // Every ship renders as a standard NATO APP-6 "unit" map symbol, same size regardless of ship type:
    // a flattened hexagon frame for friendlies, a diamond frame for hostiles, with a type abbreviation label.
    drawShip = (g:GameObjects.Graphics, ship:ShipInstanceData) => {
        const { x, y } = ship
        const w = NATO_ICON_SIZE, h = NATO_ICON_SIZE*0.6
        const isFriend = ship.faction === Faction.Player

        const points = isFriend ? [
            new Phaser.Math.Vector2(x-w/2, y-h/2),
            new Phaser.Math.Vector2(x+w/2, y-h/2),
            new Phaser.Math.Vector2(x+w/2+h*0.3, y),
            new Phaser.Math.Vector2(x+w/2, y+h/2),
            new Phaser.Math.Vector2(x-w/2, y+h/2),
            new Phaser.Math.Vector2(x-w/2-h*0.3, y),
        ] : [
            new Phaser.Math.Vector2(x, y-w/2),
            new Phaser.Math.Vector2(x+w/2, y),
            new Phaser.Math.Vector2(x, y+w/2),
            new Phaser.Math.Vector2(x-w/2, y),
        ]

        g.fillStyle(GREEN, 0.15)
        g.fillPoints(points, true)
        g.lineStyle(1.5, GREEN, 1)
        g.strokePoints(points, true, true)

        let label = this.shipLabels.get(ship.id)
        if(!label){
            label = this.add.text(x, y, ship.type.toUpperCase(), { fontFamily:'Body', fontSize:'12px', color:'#33ff55' }).setOrigin(0.5).setDepth(4)
            this.shipLabels.set(ship.id, label)
        }
        else {
            label.setPosition(x, y)
        }
    }

    toWorld = (x:number, y:number) => ({
        x: x*CELL_SIZE + CELL_SIZE/2,
        y: y*CELL_SIZE + CELL_SIZE/2
    })

    toGrid = (worldX:number, worldY:number) => ({
        x: Math.floor(worldX/CELL_SIZE),
        y: Math.floor(worldY/CELL_SIZE)
    })

    drawMap = () => {
        const g = this.g
        g.clear()

        const worldSize = this.mapData.width * CELL_SIZE

        // faint grid, brighter every 5 cells
        for(let i=0; i<=this.mapData.width; i++){
            const isMajor = i % 5 === 0
            g.lineStyle(1, GREEN_DIM, isMajor ? 0.6 : 0.25)
            g.lineBetween(i*CELL_SIZE, 0, i*CELL_SIZE, worldSize)
            g.lineBetween(0, i*CELL_SIZE, worldSize, i*CELL_SIZE)
        }

        // dividing line through each base, marking the boundary of that faction's territory
        g.lineStyle(1, GREEN, 0.35)
        this.mapData.bases.forEach(base => {
            const lineX = base.x * CELL_SIZE + CELL_SIZE/2
            g.lineBetween(lineX, 0, lineX, worldSize)
        })

        this.drawPlacementRanges()
        this.mapData.bases.forEach(this.drawBase)
        this.mapData.nodes.forEach(this.drawNode)
        // Solar Mills are drawn separately, every frame, so they can spin in place.
        useAppStore.getState().factories.forEach(f => { if(f.kind !== FactoryKind.SolarMill) this.drawFactory(f) })
    }

    // Solar Mills redraw every frame (separate layer from the mostly-static map) so they can slowly spin.
    drawSolarMills = (time:number) => {
        const g = this.solarMillG
        g.clear()
        const rotation = time * SOLAR_MILL_ROTATION_SPEED
        useAppStore.getState().factories.forEach(f => {
            if(f.kind !== FactoryKind.SolarMill) return
            this.drawFactoryShape(g, FactoryKind.SolarMill, f.x, f.y, GREEN, 1, rotation)
        })
    }

    // Ships redraw every frame (separate layer from the mostly-static map) so movement animates smoothly.
    drawShips = () => {
        const g = this.shipG
        g.clear()

        const ships = useAppStore.getState().ships
        ships.forEach(ship => this.drawShip(g, ship))
        const liveShipIds = new Set(ships.map(s => s.id))
        this.shipLabels.forEach((label, id) => {
            if(!liveShipIds.has(id)){
                label.destroy()
                this.shipLabels.delete(id)
            }
        })
    }

    // Draws the route (line + numbered waypoint markers) for whichever shipyard is currently selected.
    // Rebuilt only when the selected shipyard or its waypoint count changes, not every frame.
    drawOrders = () => {
        const { selectedFactoryId, factories } = useAppStore.getState()
        const factory = factories.find(f => f.id === selectedFactoryId)
        const waypoints = (factory && factory.kind === FactoryKind.Shipyard) ? (factory.waypoints || []) : []

        const key = factory ? factory.id+':'+waypoints.length : ''
        if(key === this.lastOrdersKey) return
        this.lastOrdersKey = key

        const g = this.ordersG
        g.clear()
        this.orderLabels.forEach(label => label.destroy())
        this.orderLabels = []
        if(!factory || waypoints.length === 0) return

        const points = [this.toWorld(factory.x, factory.y), ...waypoints.map(w => this.toWorld(w.x, w.y))]
        g.lineStyle(1.5, GREEN, 0.5)
        for(let i=0; i<points.length-1; i++) g.lineBetween(points[i].x, points[i].y, points[i+1].x, points[i+1].y)

        waypoints.forEach((w, i) => {
            const { x, y } = this.toWorld(w.x, w.y)
            g.fillStyle(GREEN, 0.9)
            g.fillCircle(x, y, 5)
            g.lineStyle(1, GREEN, 1)
            g.strokeCircle(x, y, 8)
            const label = this.add.text(x, y-16, String(i+1), { fontFamily:'Body', fontSize:'11px', color:'#33ff55' }).setOrigin(0.5).setDepth(5)
            this.orderLabels.push(label)
        })
    }

    // Placement circles behave like bubbles: each circle's own arc is only drawn where it isn't touching
    // another bubble, and wherever two bubbles touch they form a flat side (the shared chord) instead of a
    // curved overlap — trimmed by any other bubble covering part of that edge so nothing draws jagged.
    drawPlacementRanges = () => {
        const g = this.g
        const structures = [...this.mapData.bases, ...useAppStore.getState().factories]
        const circles = structures.map(s => ({ ...this.toWorld(s.x, s.y), r: getStructureRadius(s), faction: s.faction }))

        // Rounded portions: each circle's boundary where it doesn't touch any other bubble.
        g.lineStyle(1, GREEN, 0.25)
        circles.forEach((circle, i) => {
            let visible:Array<[number,number]> = [[0, TWO_PI]]

            circles.forEach((other, j) => {
                if(i === j) return
                const dx = other.x - circle.x
                const dy = other.y - circle.y
                const d = Math.hypot(dx, dy)
                if(d < 0.001 || d >= circle.r + other.r) return
                if(d + circle.r <= other.r){ visible = []; return } // swallowed whole by the other bubble
                if(d + other.r <= circle.r) return // other bubble fully inside this one, doesn't hide anything

                const cosTheta = PhaserMath.Clamp((d*d + circle.r*circle.r - other.r*other.r) / (2*d*circle.r), -1, 1)
                const theta = Math.acos(cosTheta)
                const alpha = Math.atan2(dy, dx)
                visible = subtractCircularRange(visible, alpha-theta, alpha+theta)
            })

            visible.forEach(([start, end]) => {
                if(end-start < 0.001) return
                g.beginPath()
                g.arc(circle.x, circle.y, circle.r, start, end, false)
                g.strokePath()
            })
        })

        // Flat sides: only where two OPPOSING-faction bubbles touch, draw their shared chord (trimmed by any
        // third bubble covering part of it) as a thick front line. Same-faction contacts merge silently.
        circles.forEach((circle, i) => {
            circles.forEach((other, j) => {
                if(j <= i) return
                const dx = other.x - circle.x
                const dy = other.y - circle.y
                const d = Math.hypot(dx, dy)
                if(d < 0.001 || d >= circle.r + other.r) return
                if(d <= Math.abs(circle.r - other.r)) return // one bubble fully swallows the other, no shared edge
                if(other.faction === circle.faction) return // same-faction contacts merge with no interior line at all

                const a = (d*d + circle.r*circle.r - other.r*other.r) / (2*d)
                const h = Math.sqrt(Math.max(circle.r*circle.r - a*a, 0))
                const midX = circle.x + a*dx/d
                const midY = circle.y + a*dy/d
                const perpX = -dy/d
                const perpY = dx/d

                const ax = midX + perpX*h, ay = midY + perpY*h
                const bx = midX - perpX*h, by = midY - perpY*h
                const segDX = bx-ax, segDY = by-ay

                // Trim by power distance (Laguerre/Voronoi), not simple disk membership: wherever a third
                // bubble is a closer/more dominant boundary than circle i, hand that portion of the line
                // over to it. This keeps neighboring pairs' trimmed edges meeting exactly, with no gaps.
                const powerI = circle.x*circle.x + circle.y*circle.y - circle.r*circle.r
                let segVisible:Array<[number,number]> = [[0, 1]]
                circles.forEach((third, k) => {
                    if(k === i || k === j) return
                    const ix = circle.x - third.x
                    const iy = circle.y - third.y
                    const powerK = third.x*third.x + third.y*third.y - third.r*third.r
                    const m = 2*(segDX*ix + segDY*iy)
                    const c = 2*(ax*ix + ay*iy) + powerK - powerI

                    if(Math.abs(m) < 1e-9){
                        if(c < 0) segVisible = subtractArc(segVisible, 0, 1) // third dominates the whole line
                        return
                    }
                    const t0 = -c/m
                    if(m > 0){
                        const hi = Math.min(1, t0)
                        if(hi > 0) segVisible = subtractArc(segVisible, 0, hi)
                    }
                    else {
                        const lo = Math.max(0, t0)
                        if(lo < 1) segVisible = subtractArc(segVisible, lo, 1)
                    }
                })

                g.lineStyle(4, GREEN, 0.9)
                segVisible.forEach(([t0, t1]) => {
                    if(t1-t0 < 0.001) return
                    g.lineBetween(ax+segDX*t0, ay+segDY*t0, ax+segDX*t1, ay+segDY*t1)
                })
            })
        })
    }

    drawBase = (base:BaseData) => {
        const g = this.g
        const { x, y } = this.toWorld(base.x, base.y)
        const r = CELL_SIZE * 1.5
        const isPlayer = base.faction === Faction.Player

        const points = [
            new Phaser.Math.Vector2(x, y-r),
            new Phaser.Math.Vector2(x+r, y),
            new Phaser.Math.Vector2(x, y+r),
            new Phaser.Math.Vector2(x-r, y),
        ]

        if(isPlayer){
            g.fillStyle(GREEN, 0.25)
            g.fillPoints(points, true)
        }
        g.lineStyle(2, GREEN, 1)
        g.strokePoints(points, true, true)
    }

    drawNode = (node:ResourceNodeData) => {
        const g = this.g
        const { x, y } = this.toWorld(node.x, node.y)
        const rand = seededRandom(node.id)

        if(node.kind === NodeKind.Asteroid){
            const baseRadius = CELL_SIZE * 0.4
            const sides = 8
            const points = []
            for(let i=0; i<sides; i++){
                const angle = (i/sides) * Math.PI*2
                const radius = baseRadius * (0.6 + rand()*0.5)
                points.push(new Phaser.Math.Vector2(x + Math.cos(angle)*radius, y + Math.sin(angle)*radius))
            }
            g.lineStyle(1.5, GREEN, 1)
            g.strokePoints(points, true, true)
        }
        else {
            const outerRadius = CELL_SIZE * 0.5
            const innerRadius = outerRadius * 0.45
            const spikes = 5
            const points = []
            for(let i=0; i<spikes*2; i++){
                const angle = (i/(spikes*2)) * Math.PI*2 - Math.PI/2
                const radius = i % 2 === 0 ? outerRadius : innerRadius
                points.push(new Phaser.Math.Vector2(x + Math.cos(angle)*radius, y + Math.sin(angle)*radius))
            }
            g.fillStyle(GREEN, 0.15)
            g.fillPoints(points, true)
            g.lineStyle(1.5, GREEN, 1)
            g.strokePoints(points, true, true)
        }
    }

    drawFactory = (factory:FactoryData) => {
        this.drawFactoryShape(this.g, factory.kind, factory.x, factory.y, GREEN, 1)
    }

    // Shared shape renderer so the placement preview matches the built factory exactly. `rotation`
    // (radians) only affects the Solar Mill's rays, letting it spin in place each frame.
    drawFactoryShape = (g:GameObjects.Graphics, kind:FactoryKind, gridX:number, gridY:number, color:number, alpha:number, rotation:number = 0) => {
        const { x, y } = this.toWorld(gridX, gridY)

        if(kind === FactoryKind.MiningStation){
            const r = CELL_SIZE * 0.65
            g.lineStyle(2, color, alpha)
            g.strokeRect(x-r, y-r, r*2, r*2)
            g.lineBetween(x-r, y, x+r, y)
            g.lineBetween(x, y-r, x, y+r)
        }
        else if(kind === FactoryKind.SolarMill){
            const r = CELL_SIZE * 0.45
            const rayR = CELL_SIZE * 0.7
            g.lineStyle(2, color, alpha)
            g.strokeCircle(x, y, r)
            for(let i=0; i<8; i++){
                const angle = (i/8) * Math.PI*2 + rotation
                g.lineBetween(x + Math.cos(angle)*r, y + Math.sin(angle)*r, x + Math.cos(angle)*rayR, y + Math.sin(angle)*rayR)
            }
        }
        else {
            const r = CELL_SIZE * 0.7
            const points = []
            for(let i=0; i<6; i++){
                const angle = (i/6) * Math.PI*2
                points.push(new Phaser.Math.Vector2(x + Math.cos(angle)*r, y + Math.sin(angle)*r))
            }
            g.fillStyle(color, alpha*0.2)
            g.fillPoints(points, true)
            g.lineStyle(2, color, alpha)
            g.strokePoints(points, true, true)
        }
    }

    findNodeAt = (gridX:number, gridY:number) => this.mapData.nodes.find(n => n.x === gridX && n.y === gridY)

    findFactoryAt = (gridX:number, gridY:number) => useAppStore.getState().factories.find(f => f.x === gridX && f.y === gridY)

    // Placement is allowed anywhere within the placement radius of one of a faction's own structures
    // (base or factory). Defaults to the player so existing call sites are unaffected; the AI reuses
    // this with Faction.Enemy to evaluate its own territory the same way the player's is evaluated.
    isNearOwnStructure = (gridX:number, gridY:number, faction:Faction = Faction.Player) => {
        const { x, y } = this.toWorld(gridX, gridY)
        const ownBases = this.mapData.bases.filter(b => b.faction === faction)
        const ownFactories = useAppStore.getState().factories.filter(f => f.faction === faction)
        return [...ownBases, ...ownFactories].some(s => {
            const p = this.toWorld(s.x, s.y)
            return Phaser.Math.Distance.Between(x, y, p.x, p.y) <= getStructureRadius(s)
        })
    }

    isValidPlacement = (kind:FactoryKind, gridX:number, gridY:number, faction:Faction = Faction.Player) => {
        if(gridX < 0 || gridY < 0 || gridX >= this.mapData.width || gridY >= this.mapData.height) return false
        if(this.findFactoryAt(gridX, gridY)) return false
        if(this.mapData.bases.some(b => b.x === gridX && b.y === gridY)) return false
        if(getEnergyStatus(faction).energyRemaining - getFactoryEnergyCost(kind) < 0) return false

        const worldPos = this.toWorld(gridX, gridY)
        const overlapsShip = useAppStore.getState().ships.some(s => {
            const minDist = FACTORY_FOOTPRINT_RADIUS + ShipData[s.type].sizeHex*CELL_SIZE/2 + SHIP_BUILDING_CLEARANCE_PX
            return Phaser.Math.Distance.Between(worldPos.x, worldPos.y, s.x, s.y) < minDist
        })
        if(overlapsShip) return false

        const node = this.findNodeAt(gridX, gridY)

        if(kind === FactoryKind.MiningStation) return node?.kind === NodeKind.Asteroid && this.isNearOwnStructure(gridX, gridY, faction)
        if(kind === FactoryKind.SolarMill) return node?.kind === NodeKind.Star && this.isNearOwnStructure(gridX, gridY, faction)
        if(node) return false

        return this.isNearOwnStructure(gridX, gridY, faction)
    }

    updatePreview = () => {
        this.previewG.clear()
        const { placingFactory } = useAppStore.getState()
        if(!placingFactory || !this.hoveredCell) return

        const valid = this.isValidPlacement(placingFactory, this.hoveredCell.x, this.hoveredCell.y)
        this.drawFactoryShape(this.previewG, placingFactory, this.hoveredCell.x, this.hoveredCell.y, valid ? GREEN : GREY_DIM, valid ? 0.9 : 0.5)
    }

    enablePlacementControls = () => {
        this.input.on('pointerdown', () => {
            const { placingFactory, setPlacingFactory, setSelectedFactoryId, addFactory, factories, selectedFactoryId, addWaypoint, removeWaypoint } = useAppStore.getState()
            if(!this.hoveredCell) return

            // Selecting one of the player's own shipyards puts the map straight into orders-editing mode —
            // the Orders button in FactoryToolbar is just a label now, not a prerequisite for this.
            const selectedShipyard = factories.find(f => f.id === selectedFactoryId && f.kind === FactoryKind.Shipyard && f.faction === Faction.Player)
            if(selectedShipyard){
                const { x, y } = this.hoveredCell
                if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return

                // Clicking an existing waypoint removes it instead of dropping a new one on top of it.
                const existingIndex = selectedShipyard.waypoints?.findIndex(w => w.x === x && w.y === y) ?? -1
                if(existingIndex >= 0) removeWaypoint(selectedShipyard.id, existingIndex)
                else addWaypoint(selectedShipyard.id, x, y)
                return
            }

            if(!placingFactory){
                const clicked = this.findFactoryAt(this.hoveredCell.x, this.hoveredCell.y)
                setSelectedFactoryId(clicked && clicked.faction === Faction.Player && clicked.kind === FactoryKind.Shipyard ? clicked.id : null)
                return
            }

            if(!this.isValidPlacement(placingFactory, this.hoveredCell.x, this.hoveredCell.y)) return

            const node = this.findNodeAt(this.hoveredCell.x, this.hoveredCell.y)
            addFactory({
                id: v4(),
                x: this.hoveredCell.x,
                y: this.hoveredCell.y,
                kind: placingFactory,
                faction: Faction.Player,
                resource: node?.resource,
                nodeId: node?.id
            })
            setPlacingFactory(null)
            this.previewG.clear()
            this.drawMap()
        })

        this.input.keyboard.on('keydown-ESC', () => {
            const { setPlacingFactory, setSelectedFactoryId } = useAppStore.getState()
            setPlacingFactory(null)
            setSelectedFactoryId(null)
            this.previewG.clear()
        })
    }

    // Phaser's bounds-clamping pins the camera to the bounds' top-left corner whenever the world is
    // smaller than the viewport (at zoom 1, its "shrink to fit" case degenerates to that instead of
    // centering). Padding the bounds symmetrically around the actual map compensates for that: the
    // clamp still pins to the bounds' edge, but that edge is now offset so the map lands centered.
    centerCameraBounds = () => {
        const cam = this.cameras.main
        const worldSize = this.mapData.width * CELL_SIZE
        const boundsW = Math.max(worldSize, cam.width)
        const boundsH = Math.max(worldSize, cam.height)
        cam.setBounds((worldSize-boundsW)/2, (worldSize-boundsH)/2, boundsW, boundsH)
        cam.centerOn(worldSize/2, worldSize/2)
    }

    enableCameraControls = () => {
        this.input.on('pointermove', () => {
            const worldPoint = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y)
            this.hoveredCell = this.toGrid(worldPoint.x, worldPoint.y)
            this.updatePreview()

            if(this.input.activePointer.isDown){
                if(this.origDragPoint){
                    this.cameras.main.scrollX += (this.origDragPoint.x - this.input.activePointer.position.x) / this.cameras.main.zoom
                    this.cameras.main.scrollY += (this.origDragPoint.y - this.input.activePointer.position.y) / this.cameras.main.zoom
                }
                this.origDragPoint = this.input.activePointer.position.clone()
            }
            else {
                this.origDragPoint = null
            }
        })

        this.input.on('wheel', (_pointer, _objs, _dx, dy:number) => {
            const zoom = PhaserMath.Clamp(this.cameras.main.zoom - dy*0.001, 0.25, 3)
            this.cameras.main.setZoom(zoom)
        })
    }

    onTransitionIn = () => {
    }
}

