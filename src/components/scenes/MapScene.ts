import { Scene, GameObjects, Physics, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene, onShowModal } from "../../common/Thunks";
import { getShipRelicCost } from "../../common/Utils";
import { spawnEnemyRaid, checkEnemyRaid, updateEnemyZel, updateEnemyGain } from "../../common/AIPlayers";
import { drawSightRadii } from "../../common/SightRadius";
import ShipSprite from "../sprites/ShipSprite";
import { Faction, ShipType, Modal, ShipData, ObjectiveSprite, ObjectiveSpriteIndex, AsteroidSpriteIndexesLarge, AsteroidSpriteIndexesMed, AsteroidSpriteIndexesSmall, ShipTypeSpriteIndex, ShipTypeSpriteIndexEnemy, Maps } from "../../../enum";
import {
    MAP_SIZE, CELL_SIZE, gridToWorld, worldToGrid, SHIP_SEPARATION_PX,
    MAX_QUEUE, MAX_WAYPOINTS,
    DOUBLE_CLICK_MS,
    BULLET_SPEED_PX_S, BULLET_MAX_LIFETIME_MS,
    ATD_BLAST_RADIUS_PX,
    MISSILE_SALVO_SIZE, MISSILE_SPEED_PX_S, MISSILE_MAX_LIFETIME_MS, SALVO_STAGGER_MS,
    MISSILE_ARC_HEIGHT_PX, CONTRAIL_INTERVAL_MS, CONTRAIL_LIFETIME_MS,
    MISSILE_IMPACT_LIFETIME_MS, MISSILE_IMPACT_MIN_RADIUS_PX, MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX,
    SHIP_FRAGMENT_LIFETIME_MS, SHIP_FRAGMENT_MIN_DISTANCE_PX, SHIP_FRAGMENT_MAX_DISTANCE_PX,
    OBJECTIVE_CAPTURE_RADIUS_PX, OBJECTIVE_ICON_SIZE, OBJECTIVE_CAPTURE_TIME_MS,
    HARVESTER_RANGE_PX, HARVESTER_COLLECTION_RATE_PER_S,
    HARVESTER_METAL_CAPACITY, HARVESTER_RESUPPLY_RANGE_PX, HARVESTER_RESUPPLY_INTERVAL_MS, HARVESTER_REPAIR_METAL_COST,
    HARVESTER_ORBIT_RADIUS_PX, HARVESTER_ORBIT_ANGULAR_SPEED, HARVESTER_BEAM_FLICKER_MIN_MS, HARVESTER_BEAM_FLICKER_MAX_MS,
    ASTEROID_AVG_METAL, ASTEROID_METAL_VARIANCE,
    GREEN_HEX, GREEN_DIM_HEX, YELLOW_HEX, RED_HEX,
} from "../../common/Constants";
import { colors } from "../../styles/AppStyles";

const TWO_PI = Math.PI*2

const ZOOM_LEVELS = [1, 2]

const SHIP_LABEL_GAP_PX = 10

const AMMO_LABEL_GAP_PX = 4

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

export default class MapScene extends Scene {

    g: GameObjects.Graphics
    rangeG: GameObjects.Graphics
    rangeShadeBrush: GameObjects.Graphics
    rangeShadeRT: GameObjects.RenderTexture
    selectionG: GameObjects.Graphics
    progressG: GameObjects.Graphics
    healthG: GameObjects.Graphics
    harvesterMetalG: GameObjects.Graphics
    ordersG: GameObjects.Graphics
    missileImpactG: GameObjects.Graphics
    trailG: GameObjects.Graphics
    objectiveRangeG: GameObjects.Graphics
    harvesterBeamG: GameObjects.Graphics
    harvesterSupportBeamG: GameObjects.Graphics
    starfield: GameObjects.TileSprite
    dragSelectG: GameObjects.Graphics

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
    shipLabels: Map<string, GameObjects.Text> = new Map()
    ammoLabels: Map<string, GameObjects.Text> = new Map()
    objectiveSprites: Map<string, GameObjects.Image> = new Map()
    objectiveLabels: Map<string, GameObjects.Text> = new Map()
    resourceNodeSprites: Map<string, GameObjects.Image> = new Map()

    orderLabels: Array<GameObjects.Text> = []
    lastOrdersKey: string = ''
    shiftDown: boolean = false
    dragSelectStart: { x:number, y:number } | null = null
    dragSelectCurrent: { x:number, y:number } | null = null
    pointerDownWorld: { x:number, y:number } | null = null
    // Tracks the last single ship clicked (and when) so handleClick can tell a genuine double-click
    // (same ship, within DOUBLE_CLICK_MS) apart from two unrelated single clicks.
    lastClickShipId: string | null = null
    lastClickAtMs: number = 0
    impactFlashes: Array<{ x:number, y:number, createdAt:number, damage:number }> = []
    contrails: Array<{ x:number, y:number, createdAt:number, missileId:string }> = []

    harvesterMiningTarget: Map<string, string> = new Map()
    harvesterBeamState: Map<string, { on:boolean, nextToggleAt:number }> = new Map()
    // Whichever ship each GAIN is currently in range of and actively resupplying/repairing — recomputed
    // every frame by updateHarvesterSupport regardless of its own spend cooldown, purely so
    // drawHarvesterSupportBeams has something live to draw a beam to.
    harvesterSupportTarget: Map<string, string> = new Map()
    harvesterSupportBeamState: Map<string, { on:boolean, nextToggleAt:number }> = new Map()

    enemyBaseId: string
    enemyRaidLaunched: boolean = false
    gameOver: boolean = false
    mapData: MapData
    origDragPoint: Phaser.Math.Vector2
    hoveredCell: {x:number, y:number}
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
        this.cameras.main.setBackgroundColor('#000000')
        this.input.mouse.disableContextMenu()
        this.g = this.add.graphics()
        this.rangeG = this.add.graphics()
        this.rangeShadeBrush = this.make.graphics({}, false)
        this.rangeShadeRT = this.add.renderTexture(0, 0, MAP_SIZE*CELL_SIZE, MAP_SIZE*CELL_SIZE).setOrigin(0, 0).setAlpha(0.12)
        this.selectionG = this.add.graphics()
        this.progressG = this.add.graphics()
        this.healthG = this.add.graphics()
        this.harvesterMetalG = this.add.graphics()
        this.ordersG = this.add.graphics()
        this.missileImpactG = this.add.graphics()
        this.trailG = this.add.graphics()
        this.objectiveRangeG = this.add.graphics()
        this.dragSelectG = this.add.graphics()
        this.harvesterBeamG = this.add.graphics()
        this.harvesterSupportBeamG = this.add.graphics()

        this.input.keyboard.on('keydown-SHIFT', () => this.shiftDown = true)
        this.input.keyboard.on('keyup-SHIFT', () => this.shiftDown = false)

        this.generateTextures()
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

        this.cameras.main.setZoom(1)
        this.centerCameraBounds()

        const bounds = this.cameras.main.getBounds()
        this.starfield = this.add.tileSprite(bounds.centerX, bounds.centerY, bounds.width, bounds.height, 'starfield').setDepth(-1000).setScrollFactor(0.5)

        this.spawnEntitiesFromMap()
        this.drawMap()
        this.enableCameraControls()
        this.enableSelectionControls()

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

    generateTextures = () => {
        const tmp = this.add.graphics()
        const bake = (key:string, size:number, draw:(g:GameObjects.Graphics, cx:number, cy:number) => void) => {
            tmp.clear()
            draw(tmp, size/2, size/2)
            tmp.generateTexture(key, size, size)
        }

        bake('missile_dot', 8, (g, cx, cy) => { g.fillStyle(GREEN_HEX, 0.9); g.fillCircle(cx, cy, 2) })
        // Bigger/brighter than missile_dot, with a soft glow ring — a bullet only lives up to
        // BULLET_MAX_LIFETIME_MS and covers its whole (short) range in well under a second, so it needs
        // to read clearly at a glance or PDF actually firing is easy to miss entirely.
        bake('bullet_dot', 10, (g, cx, cy) => {
            g.fillStyle(YELLOW_HEX, 0.35)
            g.fillCircle(cx, cy, 5)
            g.fillStyle(YELLOW_HEX, 1)
            g.fillCircle(cx, cy, 2.5)
        })

        Object.values(ShipType).filter(type => type !== ShipType.CATH).forEach(type => this.generateHostileShipTexture(type))
    }

    generateHostileShipTexture = (key:string) => {
        const source = this.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement
        const w = source.width, h = source.height
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(source as CanvasImageSource, 0, 0)

        const imageData = ctx.getImageData(0, 0, w, h)
        const data = imageData.data
        for(let i=0; i<data.length; i += 4){
            if(data[i+3] === 0) continue
            if(data[i] === 0x55 && data[i+1] === 0xff && data[i+2] === 0x55){
                data[i] = 0xff; data[i+1] = 0x55; data[i+2] = 0x55
            }
        }
        ctx.putImageData(imageData, 0, 0)

        this.textures.addCanvas(key+'_enemy', canvas)
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
        this.updateShipLabels()
        drawSightRadii(this.rangeG, this.ships)
        this.drawObjectiveCaptureProgress(time)

        this.drawProductionProgress()
        this.drawShipHealth()
        this.drawHarvesterMetalGauge()
        this.updateAmmoLabels()
        this.drawOrders()
        this.drawHarvesterBeams(time)
        this.drawHarvesterSupportBeams(time)
        this.drawMissileImpacts(time)
        this.drawMissileTrails(time)

        this.selectionG.clear()
        const { selectedShipIds } = useAppStore.getState()
        selectedShipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            this.drawSelectionRing(ship.x, ship.y, ShipData[ship.type].sizeHex * CELL_SIZE * 0.7, time)
        })
    }

    drawSelectionRing = (x:number, y:number, baseRadius:number, time:number) => {
        const pulse = 0.85 + Math.sin(time*0.006)*0.15
        const r = baseRadius * pulse
        const points = []
        for(let i=0; i<8; i++){
            const angle = (i/8)*Math.PI*2 + Math.PI/8
            points.push(new Phaser.Math.Vector2(x + Math.cos(angle)*r, y + Math.sin(angle)*r))
        }
        this.selectionG.lineStyle(2, GREEN_HEX, 1)
        this.selectionG.strokePoints(points, true, true)
    }

    // Shared outline+fill bar draw, used by every progress/gauge readout below.
    drawBar = (g:GameObjects.Graphics, barX:number, barY:number, w:number, h:number, percent:number, color:number) => {
        g.lineStyle(1, color, 1)
        g.strokeRect(barX, barY, w, h)
        g.fillStyle(color, 0.9)
        g.fillRect(barX, barY, w*percent, h)
    }

    drawProductionProgress = () => {
        const g = this.progressG
        g.clear()

        this.ships.forEach(s => {
            const item = s.queue[0]
            if(!item?.startedAt) return
            if(!s.visible) return

            const percent = PhaserMath.Clamp((Date.now()-item.startedAt) / ShipData[item.type].productionTimeMs, 0, 1)
            const w = CELL_SIZE * 1.6, h = 4
            const barX = s.x - w/2, barY = s.y - CELL_SIZE*2 - h
            this.drawBar(g, barX, barY, w, h, percent, GREEN_HEX)
        })
    }

    drawShipHealth = () => {
        const g = this.healthG
        g.clear()

        this.ships.forEach(s => {
            const maxHp = ShipData[s.type].hp
            if(s.hp >= maxHp) return
            if(!s.visible) return

            const percent = PhaserMath.Clamp(s.hp / maxHp, 0, 1)
            const w = CELL_SIZE * 1.4, h = 4
            const footprint = ShipData[s.type].sizeHex * CELL_SIZE / 2
            const barX = s.x - w/2, barY = s.y + footprint + h
            this.drawBar(g, barX, barY, w, h, percent, GREEN_HEX)
        })
    }

    // How full a GAIN ship's carried metal is (see ShipSprite's metalCarried/HARVESTER_METAL_CAPACITY) —
    // always shown, not just when partially empty like drawShipHealth's HP bar, since "currently empty"
    // is itself useful info here rather than clutter to hide. Drawn on its own row below the HP bar's
    // (offset an extra bar-height further out) so a damaged, partially-full Harvester can show both at
    // once without them overlapping.
    drawHarvesterMetalGauge = () => {
        const g = this.harvesterMetalG
        g.clear()

        this.ships.forEach(s => {
            if(s.type !== ShipType.GAIN) return
            if(!s.visible) return

            const percent = PhaserMath.Clamp((s.metalCarried ?? 0) / HARVESTER_METAL_CAPACITY, 0, 1)
            const w = CELL_SIZE * 1.4, h = 4
            const footprint = ShipData[s.type].sizeHex * CELL_SIZE / 2
            const barX = s.x - w/2, barY = s.y + footprint + h*2 + 2
            this.drawBar(g, barX, barY, w, h, percent, YELLOW_HEX)
        })
    }

    updateAmmoLabels = () => {
        this.ships.forEach(ship => {
            const label = this.ammoLabels.get(ship.id)
            if(!label) return
            const visible = ship.visible
            label.setVisible(visible)
            if(!visible) return

            label.setText(String(ship.ammoRemaining ?? 0))
            label.setPosition(ship.x - ship.displayWidth/2 - AMMO_LABEL_GAP_PX, ship.y + ship.displayHeight/2 + AMMO_LABEL_GAP_PX)
        })
    }

    floatText = (gridX:number, gridY:number, text:string) => {
        const { x, y } = this.toWorld(gridX, gridY)
        const label = this.add.text(x, y, text, { fontFamily:'Body', fontSize:'20px', color:colors.green }).setOrigin(0.5).setDepth(5)
        this.tweens.add({
            targets: label,
            y: y-20,
            duration: 2000,
            onComplete: () => label.destroy()
        })
    }

    tickProduction = () => {
        this.ships.forEach(ship => {
            const item = ship.queue[0]
            if(!item?.startedAt || Date.now() - item.startedAt < ShipData[item.type].productionTimeMs) return
            const relicCost = getShipRelicCost(item.type)
            const relicsAvailable = useAppStore.getState().machineRelics[ship.faction] ?? 0
            if(relicsAvailable < relicCost) return

            useAppStore.getState().addMachineRelics(ship.faction, -relicCost)
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
                    this.createResourceNodeSprite(node)
                    continue
                }

                const spriteName = ObjectiveSpriteIndex[localIndex] as ObjectiveSprite | undefined
                if(!spriteName) continue

                const spawn:ObjectiveSpawn = { id:v4(), x:tx, y:ty, sprite:spriteName }
                this.mapData.objectives.push(spawn)
                const objective:ObjectiveData = { id:spawn.id, owner:null, capturingFaction:null, captureStartedAtMs:null }
                useAppStore.getState().addObjective(objective)
                this.createObjectiveSprite(spawn)
            }
        }

        // One bulk sync at the end rather than one per entity — this runs once at match start with
        // potentially dozens of ships, and nothing needs to see them appear one at a time.
        this.syncShipSummaries()
    }

    createResourceNodeSprite = (node:ResourceNodeData) => {
        const frames = ASTEROID_TIER_FRAMES[asteroidTier(node)]
        const sprite = this.add.image(node.x, node.y, 'tiles', frames[Math.floor(Math.random()*frames.length)]).setDepth(1)
        sprite.setData('asteroidTier', asteroidTier(node))
        this.resourceNodeSprites.set(node.id, sprite)
    }

    updateResourceNodeSprite = (node:ResourceNodeData) => {
        const sprite = this.resourceNodeSprites.get(node.id)
        if(!sprite) return
        const tier = asteroidTier(node)
        if(sprite.getData('asteroidTier') === tier) return
        sprite.setData('asteroidTier', tier)
        const frames = ASTEROID_TIER_FRAMES[tier]
        sprite.setFrame(frames[Math.floor(Math.random()*frames.length)])
    }

    destroyResourceNodeSprite = (id:string) => {
        this.resourceNodeSprites.get(id)?.destroy()
        this.resourceNodeSprites.delete(id)
    }

    getObjectiveOwnerColor = (owner:Faction | null) => owner === Faction.Player ? GREEN_HEX : owner === Faction.Enemy ? RED_HEX : YELLOW_HEX

    createObjectiveSprite = (spawn:ObjectiveSpawn) => {
        const { x, y } = this.toWorld(spawn.x, spawn.y)
        const sprite = this.add.image(x, y, 'tiles', ObjectiveSpriteIndex[spawn.sprite]).setDepth(2)
        this.objectiveSprites.set(spawn.id, sprite)

        const label = this.add.text(x, y + OBJECTIVE_ICON_SIZE*0.5 + 4, spawn.sprite, { fontFamily:'Body', fontSize:'11px', color:colors.green }).setOrigin(0.5, 0).setDepth(2)
        this.objectiveLabels.set(spawn.id, label)
    }

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
            this.objectiveSprites.get(objective.id)?.setTint(this.getObjectiveOwnerColor(contestingFaction))
            // The one and only source of Machine Relics — see store's machineRelics/addMachineRelics.
            useAppStore.getState().addMachineRelics(contestingFaction, 1)
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

    drawObjectiveCaptureProgress = (time:number) => {
        const g = this.objectiveRangeG
        g.clear()

        useAppStore.getState().objectives.forEach(objective => {
            const spawn = this.mapData.objectives.find(o => o.id === objective.id)
            if(!spawn) return
            const { x, y } = this.toWorld(spawn.x, spawn.y)

            if(objective.capturingFaction === null || objective.captureStartedAtMs === null) return
            const percent = PhaserMath.Clamp((time-objective.captureStartedAtMs) / OBJECTIVE_CAPTURE_TIME_MS, 0, 1)
            const color = this.getObjectiveOwnerColor(objective.capturingFaction)
            const w = OBJECTIVE_ICON_SIZE, h = 4
            const barX = x - w/2, barY = y + OBJECTIVE_ICON_SIZE*0.5 + 20
            this.drawBar(g, barX, barY, w, h, percent, color)
        })
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

    updateShipLabels = () => {
        const { selectedShipIds } = useAppStore.getState()
        this.shipLabels.forEach((label, id) => {
            label.setVisible(selectedShipIds.includes(id) && !!this.shipSprites.get(id)?.visible)
        })
    }

    // --- Physics sprite lifecycle -------------------------------------------------------------------
    // Every ShipSprite is created exactly once (spawnShip; spawnEntitiesFromMap for a faction's Base
    // and every map-placed starting ship), and destroyed exactly once, the instant damage actually
    // drops its hp to 0 (killIfDead/detonateDrone).

    createShipSprite = (id:string, faction:Faction, type:ShipType, x:number, y:number):ShipSprite => {
        const isFriend = faction === Faction.Player
        // A real baked enemy-colored texture (see generateHostileShipTexture), not a tint — setTint
        // multiplies against whatever colors are already in the art, which for a sprite already using
        // more than one palette color (black outline, green hull, yellow highlight) produces off-palette
        // blends rather than a clean recolor. CATH (Base) has its own bespoke enemy texture instead.
        const textureKey = isFriend ? type : (type === ShipType.CATH ? 'base_enemy' : type+'_enemy')
        const ship = new ShipSprite(this, x, y, textureKey, id, faction, type)
        this.add.existing(ship)
        this.physics.add.existing(ship)
        this.centerCircleBody(ship)
        ship.setData('kind', 'ship' as BodyKind)
        ship.setData('id', id)
        this.shipsGroup.add(ship)
        this.shipSprites.set(id, ship)

        const label = this.add.text(x, y-this.shipLabelOffsetPx(ship), type.toUpperCase(), { fontFamily:'Body', fontSize:'12px', color: colors.green }).setOrigin(0.5).setDepth(4).setVisible(false)
        this.shipLabels.set(id, label)

        if(ShipData[type].ammo){
            const ammoLabel = this.add.text(x, y, String(ship.ammoRemaining ?? 0), { fontFamily:'Body', fontSize:'11px', color:colors.green }).setOrigin(1, 0).setDepth(4).setVisible(false)
            this.ammoLabels.set(id, ammoLabel)
        }

        if(!isFriend) ship.setVisible(false)
        return ship
    }

    shipLabelOffsetPx = (sprite:Physics.Arcade.Sprite) => sprite.displayHeight/2 + SHIP_LABEL_GAP_PX

    destroyShipSprite = (id:string) => {
        this.shipSprites.get(id)?.destroy()
        this.shipSprites.delete(id)
        this.shipLabels.get(id)?.destroy()
        this.shipLabels.delete(id)
        this.ammoLabels.get(id)?.destroy()
        this.ammoLabels.delete(id)
    }

    spawnDeathFragments = (sprite:Physics.Arcade.Sprite) => {
        const w = sprite.width, h = sprite.height
        if(w <= 0 || h <= 0) return

        const cutAcrossWidth = w <= h
        const segments = 4
        const sweepHalf = cutAcrossWidth ? w/2 : h/2
        const tiltHalf = cutAcrossWidth ? h/2 : w/2
        const startTilt = (Math.random()-0.5) * tiltHalf*0.6
        const endTilt = (Math.random()-0.5) * tiltHalf*0.6
        const jaggedPoints:Array<{x:number,y:number}> = []
        for(let i=0; i<=segments; i++){
            const t = i/segments
            const sweep = -sweepHalf + sweepHalf*2*t
            const jitter = (i===0 || i===segments) ? 0 : (Math.random()-0.5) * tiltHalf*0.6
            const tilt = startTilt+(endTilt-startTilt)*t + jitter
            jaggedPoints.push(cutAcrossWidth ? { x:sweep, y:tilt } : { x:tilt, y:sweep })
        }

        const topLeft = { x:-w/2, y:-h/2 }, topRight = { x:w/2, y:-h/2 }
        const bottomLeft = { x:-w/2, y:h/2 }, bottomRight = { x:w/2, y:h/2 }
        const pieceAPolygon = cutAcrossWidth ? [topLeft, ...jaggedPoints, topRight] : [topLeft, ...jaggedPoints, bottomLeft]
        const pieceBPolygon = cutAcrossWidth ? [bottomLeft, ...[...jaggedPoints].reverse(), bottomRight] : [topRight, ...[...jaggedPoints].reverse(), bottomRight]
        const pieceALocalDir = cutAcrossWidth ? { x:0, y:-1 } : { x:-1, y:0 }
        const pieceBLocalDir = cutAcrossWidth ? { x:0, y:1 } : { x:1, y:0 }

        ;[
            { polygon:pieceAPolygon, localDir:pieceALocalDir, spinSign:-1 },
            { polygon:pieceBPolygon, localDir:pieceBLocalDir, spinSign:1 },
        ].forEach(({ polygon, localDir, spinSign }) => {
            const piece = this.add.image(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)
                .setOrigin(0.5).setRotation(sprite.rotation).setScale(sprite.scaleX, sprite.scaleY).setDepth(sprite.depth)

            const mask = this.make.graphics({}, false)
                .setPosition(sprite.x, sprite.y).setRotation(sprite.rotation).setScale(sprite.scaleX, sprite.scaleY)
            mask.fillStyle(0xFFFFFF).fillPoints(polygon, true)
            piece.setMask(mask.createGeometryMask())

            const distance = SHIP_FRAGMENT_MIN_DISTANCE_PX + Math.random()*(SHIP_FRAGMENT_MAX_DISTANCE_PX-SHIP_FRAGMENT_MIN_DISTANCE_PX)
            const worldDx = (localDir.x*Math.cos(sprite.rotation) - localDir.y*Math.sin(sprite.rotation)) * distance
            const worldDy = (localDir.x*Math.sin(sprite.rotation) + localDir.y*Math.cos(sprite.rotation)) * distance
            const spin = spinSign * (0.3 + Math.random()*0.5)

            this.tweens.add({
                targets: [piece, mask],
                x: sprite.x+worldDx,
                y: sprite.y+worldDy,
                rotation: sprite.rotation+spin,
                duration: SHIP_FRAGMENT_LIFETIME_MS,
                ease: 'Cubic.Out',
                onComplete: () => { piece.destroy(); mask.destroy() },
            })
        })
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
        this.spawnDeathFragments(ship)
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

            this.shipLabels.get(ship.id)?.setPosition(ship.x, ship.y-this.shipLabelOffsetPx(ship))

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

    // Shared by findNearestHostileShip/findNearestThreat below — nearest in-sight body matching `eligible`.
    findNearestInRange = (fromFaction:Faction, x:number, y:number, range:number, eligible:(obj:Physics.Arcade.Sprite) => boolean) => {
        const hits = this.physics.overlapCirc(x, y, range, true, false)
        let nearest:Physics.Arcade.Sprite = null
        let nearestDist = Infinity

        hits.forEach(body => {
            const obj = (body as Physics.Arcade.Body).gameObject as Physics.Arcade.Sprite
            if(!obj.active) return
            if(!this.isWithinFactionSightRange(obj.x, obj.y, fromFaction)) return
            if(!eligible(obj)) return
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y)
            if(d < nearestDist){ nearestDist = d; nearest = obj }
        })

        return nearest
    }

    findNearestHostileShip = (fromFaction:Faction, x:number, y:number, range:number) =>
        this.findNearestInRange(fromFaction, x, y, range, obj => {
            if(obj.getData('kind') !== 'ship') return false
            const ship = this.getShipEntry(obj)
            return !!ship && ship.faction !== fromFaction
        })

    // Same shape as findNearestHostileShip, but for PDF's own targeting: the nearest hostile *missile*
    // within range — never a ship, drones (KKZ/BOM) included, PDF is purely anti-missile point-defense.
    // "One target at a time": this only ever returns a single nearest result, never a list, so a PDF
    // ship's cooldown-gated shot (see updatePdf) always commits to just the one thing.
    findNearestThreat = (fromFaction:Faction, x:number, y:number, range:number) =>
        this.findNearestInRange(fromFaction, x, y, range, obj =>
            obj.getData('kind') === 'missile' && obj.getData('faction') !== fromFaction)

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
        depletedIds.forEach(id => this.destroyResourceNodeSprite(id))
        drawdown.forEach((_, id) => {
            if(depletedIds.includes(id)) return
            this.updateResourceNodeSprite(updated.find(n => n.id === id))
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
        this.harvesterSupportTarget.clear()

        const inRange = (harvester:ShipSprite, t:ShipSprite) => t.faction === harvester.faction
            && Phaser.Math.Distance.Between(harvester.x, harvester.y, t.x, t.y) <= HARVESTER_RESUPPLY_RANGE_PX

        // Picking a target happens every frame (so there's always something live for
        // drawHarvesterSupportBeams to draw a beam to) — only actually spending metal on it is gated by
        // lastResupplyAtMs below, same one-unit-per-interval cap as before.
        ships.filter(s => s.type === ShipType.GAIN && (s.metalCarried ?? 0) >= 1).forEach(harvester => {
            const ammoTarget = ships.find(t => inRange(harvester, t)
                && ShipData[t.type].ammo && (t.ammoRemaining ?? 0) < ShipData[t.type].ammo)
            const repairTarget = !ammoTarget && (harvester.metalCarried ?? 0) >= HARVESTER_REPAIR_METAL_COST
                ? ships.find(t => inRange(harvester, t) && t.hp < ShipData[t.type].hp)
                : undefined
            const target = ammoTarget ?? repairTarget
            if(!target) return
            this.harvesterSupportTarget.set(harvester.id, target.id)

            if(harvester.lastResupplyAtMs && time - harvester.lastResupplyAtMs < HARVESTER_RESUPPLY_INTERVAL_MS) return
            harvester.lastResupplyAtMs = time
            if(ammoTarget){
                harvester.metalCarried = (harvester.metalCarried ?? 0) - 1
                ammoTarget.gainAmmo(1)
            }
            else {
                harvester.metalCarried = (harvester.metalCarried ?? 0) - HARVESTER_REPAIR_METAL_COST
                repairTarget.heal(1)
            }
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

    // Shared by drawHarvesterBeams (mining, yellow) and drawHarvesterSupportBeams (resupply/repair,
    // green) below — same flickering beam from a Harvester to whatever it's currently working, just a
    // different target map/color/end-point lookup.
    drawFlickerBeams = (g:GameObjects.Graphics, time:number, targets:Map<string,string>, state:Map<string,{on:boolean,nextToggleAt:number}>, color:number, width:number, resolveEnd:(targetId:string) => {x:number,y:number} | undefined) => {
        g.clear()

        state.forEach((_, id) => {
            if(!targets.has(id)) state.delete(id)
        })

        targets.forEach((targetId, harvesterId) => {
            const sprite = this.shipSprites.get(harvesterId)
            const end = resolveEnd(targetId)
            if(!sprite || !end) return

            let s = state.get(harvesterId)
            if(!s){
                s = { on:true, nextToggleAt: time + this.randomFlickerIntervalMs() }
                state.set(harvesterId, s)
            }
            if(time >= s.nextToggleAt){
                s.on = !s.on
                s.nextToggleAt = time + this.randomFlickerIntervalMs()
            }
            if(!s.on) return

            g.lineStyle(width, color)
            g.lineBetween(sprite.x, sprite.y, end.x, end.y)
        })
    }

    drawHarvesterBeams = (time:number) => {
        const { resourceNodes } = useAppStore.getState()
        this.drawFlickerBeams(this.harvesterBeamG, time, this.harvesterMiningTarget, this.harvesterBeamState, YELLOW_HEX, 1,
            nodeId => resourceNodes.find(n => n.id === nodeId))
    }

    drawHarvesterSupportBeams = (time:number) => {
        this.drawFlickerBeams(this.harvesterSupportBeamG, time, this.harvesterSupportTarget, this.harvesterSupportBeamState, GREEN_HEX, 2,
            targetId => this.shipSprites.get(targetId))
    }

    randomFlickerIntervalMs = () => HARVESTER_BEAM_FLICKER_MIN_MS + Math.random()*(HARVESTER_BEAM_FLICKER_MAX_MS-HARVESTER_BEAM_FLICKER_MIN_MS)

    drawMissileImpacts = (time:number) => {
        const g = this.missileImpactG
        g.clear()

        this.impactFlashes = this.impactFlashes.filter(f => time - f.createdAt < MISSILE_IMPACT_LIFETIME_MS)
        this.impactFlashes.forEach(f => {
            const progress = (time - f.createdAt) / MISSILE_IMPACT_LIFETIME_MS
            const radius = MISSILE_IMPACT_MIN_RADIUS_PX + f.damage*MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX
            g.fillStyle(YELLOW_HEX, 1-progress)
            g.fillCircle(f.x, f.y, radius)
        })
    }

    drawMissileTrails = (time:number) => {
        const g = this.trailG
        g.clear()

        this.contrails = this.contrails.filter(c => time - c.createdAt < CONTRAIL_LIFETIME_MS)

        const byMissile = new Map<string, Array<{ x:number, y:number, createdAt:number }>>()
        this.contrails.forEach(c => {
            const points = byMissile.get(c.missileId) || []
            points.push(c)
            byMissile.set(c.missileId, points)
        })

        byMissile.forEach(points => {
            points.sort((a, b) => a.createdAt - b.createdAt)
            for(let i=1; i<points.length; i++){
                const prev = points[i-1], cur = points[i]
                const alpha = (1 - (time-cur.createdAt)/CONTRAIL_LIFETIME_MS) * 0.5
                g.lineStyle(1.5, GREEN_HEX, alpha)
                g.lineBetween(prev.x, prev.y, cur.x, cur.y)
            }
        })
    }

    toWorld = gridToWorld
    toGrid = worldToGrid

    drawMap = () => {
        const g = this.g
        g.clear()

        const worldSize = this.mapData.width * CELL_SIZE

        for(let i=0; i<=this.mapData.width; i++){
            const isMajor = i % 5 === 0
            g.lineStyle(1, GREEN_DIM_HEX, isMajor ? 0.6 : 0.25)
            g.lineBetween(i*CELL_SIZE, 0, i*CELL_SIZE, worldSize)
            g.lineBetween(0, i*CELL_SIZE, worldSize, i*CELL_SIZE)
        }

        this.drawTerrain()
    }

    drawTerrain = () => {


    }

    drawOrders = () => {
        const { selectedShipIds } = useAppStore.getState()

        this.lastOrdersKey = ''
        const g = this.ordersG
        g.clear()
        this.orderLabels.forEach(label => label.destroy())
        this.orderLabels = []

        selectedShipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship || ship.waypoints.length === 0) return
            this.drawRouteAndMarkers(g, { x:ship.x, y:ship.y }, ship.waypoints)
        })
    }

    drawRouteAndMarkers = (g:GameObjects.Graphics, originWorld:{x:number,y:number}, waypoints:Array<{x:number,y:number}>) => {
        const points = [originWorld, ...waypoints.map(w => this.toWorld(w.x, w.y))]
        g.lineStyle(1.5, GREEN_HEX, 0.5)
        for(let i=0; i<points.length-1; i++) g.lineBetween(points[i].x, points[i].y, points[i+1].x, points[i+1].y)

        waypoints.forEach((w, i) => {
            const { x, y } = this.toWorld(w.x, w.y)
            g.fillStyle(GREEN_HEX, 0.9)
            g.fillCircle(x, y, 5)
            g.lineStyle(1, GREEN_HEX, 1)
            g.strokeCircle(x, y, 8)
            const label = this.add.text(x, y-16, String(i+1), { fontFamily:'Body', fontSize:'11px', color:colors.green }).setOrigin(0.5).setDepth(5)
            this.orderLabels.push(label)
        })
    }

    isWithinFactionSightRange = (worldX:number, worldY:number, faction:Faction) => {
        return this.ships.some(s => s.faction === faction && Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= ShipData[s.type].sightRadius)
    }

    findOwnShipAt = (worldX:number, worldY:number) => {
        return this.ships.find(s => {
            if(s.faction !== Faction.Player || s.type === ShipType.CATH) return false
            const r = Math.max(ShipData[s.type].sizeHex * CELL_SIZE/2, 10)
            return Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= r
        })
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

    // A group ordered to one destination lines up abreast there instead of all converging on the same
    // point — each ship gets its own cell, evenly spaced along the axis perpendicular to the direction
    // of travel, in whatever left-to-right order the group is already standing in (so nobody has to
    // cross through the middle of the line to reach its spot). A single ship just gets the exact
    // destination, same as before. KKZ/BOM are excluded outright (see DRONE_TYPES) — kamikaze drones are
    // usually massed to converge and detonate together, so they always just head straight for the
    // clicked point instead.
    computeLineFormation = (shipIds:Array<string>, destX:number, destY:number):Map<string,{x:number,y:number}> => {
        const allShips = shipIds.map(id => this.shipSprites.get(id)).filter(s => !!s)
        const formation = new Map<string,{x:number,y:number}>()
        allShips.filter(s => DRONE_TYPES.has(s.type)).forEach(s => formation.set(s.id, { x:destX, y:destY }))
        const ships = allShips.filter(s => !DRONE_TYPES.has(s.type))

        if(ships.length <= 1){
            ships.forEach(s => formation.set(s.id, { x:destX, y:destY }))
            return formation
        }

        const destWorld = this.toWorld(destX, destY)
        const centroidX = ships.reduce((sum, s) => sum+s.x, 0) / ships.length
        const centroidY = ships.reduce((sum, s) => sum+s.y, 0) / ships.length
        const toDestX = destWorld.x-centroidX, toDestY = destWorld.y-centroidY
        const dist = Math.hypot(toDestX, toDestY)
        const dirX = dist > 0.001 ? toDestX/dist : 1, dirY = dist > 0.001 ? toDestY/dist : 0
        const perpX = -dirY, perpY = dirX

        const spacing = Math.max(...ships.map(s => ShipData[s.type].sizeHex)) * CELL_SIZE + SHIP_SEPARATION_PX
        const ordered = [...ships].sort((a, b) =>
            ((a.x-centroidX)*perpX + (a.y-centroidY)*perpY) - ((b.x-centroidX)*perpX + (b.y-centroidY)*perpY))

        const gridFor = (worldX:number, worldY:number) => {
            const grid = this.toGrid(worldX, worldY)
            return { x: PhaserMath.Clamp(grid.x, 0, this.mapData.width-1), y: PhaserMath.Clamp(grid.y, 0, this.mapData.height-1) }
        }

        const claimed = new Set<string>()
        ordered.forEach((s, i) => {
            const baseOffset = (i - (ordered.length-1)/2) * spacing
            // A grid cell (CELL_SIZE px) is often coarser than the gap between two adjacent formation
            // slots, especially for just 2-3 ships — their offsets can floor/round straight back to the
            // same cell, which is exactly what a "still converges on one point" bug looks like. So push
            // any collision one more full cell further out along the same line, as many times as it
            // takes, until it lands somewhere no earlier ship in the line already claimed.
            const sign = baseOffset < 0 ? -1 : 1
            let extra = 0
            let grid = gridFor(destWorld.x + perpX*baseOffset, destWorld.y + perpY*baseOffset)
            while(claimed.has(`${grid.x},${grid.y}`) && extra < 50){
                extra++
                const offset = baseOffset + sign*extra*CELL_SIZE
                grid = gridFor(destWorld.x + perpX*offset, destWorld.y + perpY*offset)
            }
            claimed.add(`${grid.x},${grid.y}`)
            formation.set(s.id, grid)
        })

        return formation
    }

    // Appends one waypoint onto each selected ship's own route — used for a drag-selected group of
    // combat ships (a Base itself is never included; MapScene's handleClick filters it out before
    // calling this, since it never actually moves and doesn't hand orders down to newly produced ships
    // anymore either — see spawnShip). Each ship keeps whatever progress it's already made; this only
    // adds on.
    addShipWaypoints = (shipIds:Array<string>, x:number, y:number) => {
        const speed = this.groupSpeedPxS(shipIds)
        const formation = this.computeLineFormation(shipIds, x, y)
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship || ship.waypoints.length >= MAX_WAYPOINTS) return
            // A new order overrides ZEL's own Objective-latch the same way it overrides anything else it
            // was doing — see ShipSprite's latchedObjectiveId/objectiveAttached.
            ship.waypoints = [...ship.waypoints, formation.get(id) ?? { x, y }]
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
        const formation = this.computeLineFormation(shipIds, x, y)
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            ship.waypoints = [formation.get(id) ?? { x, y }]
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

    enableSelectionControls = () => {
        this.input.on('pointerdown', (pointer:Phaser.Input.Pointer) => {
            if(!this.hoveredCell) return
            if(!pointer.leftButtonDown()) return

            const worldPoint = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y)
            this.pointerDownWorld = { x:worldPoint.x, y:worldPoint.y }

            if(!this.shiftDown){
                this.dragSelectStart = { x:worldPoint.x, y:worldPoint.y }
                this.dragSelectCurrent = this.dragSelectStart
            }
        })

        this.input.keyboard.on('keydown-ESC', () => {
            useAppStore.getState().setSelectedShipIds([])
        })
    }

    handleClick = (worldX:number, worldY:number) => {
        if(!this.hoveredCell) return
        const { selectedShipIds, setSelectedShipIds } = useAppStore.getState()

        const clicked = this.findOwnShipAt(worldX, worldY)
        if(clicked){
            const now = this.time.now
            const isDoubleClick = this.lastClickShipId === clicked.id && now - this.lastClickAtMs <= DOUBLE_CLICK_MS
            this.lastClickShipId = clicked.id
            this.lastClickAtMs = now

            if(isDoubleClick){
                // Select every one of the player's own ships of the same type, not just this one.
                const sameTypeIds = this.ships.filter(s => s.faction === Faction.Player && s.type === clicked.type).map(s => s.id)
                setSelectedShipIds(sameTypeIds)
                // A third click right after shouldn't chain into yet another double-click.
                this.lastClickShipId = null
                return
            }

            setSelectedShipIds([clicked.id])
            return
        }

        if(selectedShipIds.length > 0){
            const { x, y } = this.hoveredCell
            if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return
            const orderableIds = this.ships.filter(s => selectedShipIds.includes(s.id) && s.type !== ShipType.CATH && !s.movementLocked).map(s => s.id)
            if(orderableIds.length === 0) return

            // Clicking directly on an existing waypoint marker always removes it — for every selected
            // ship that actually has one there, not just whichever ship's marker happens to render on
            // top — regardless of shift, taking priority over shift's usual replace-vs-append order-giving.
            const selectedShips = this.ships.filter(s => orderableIds.includes(s.id))
            const clickedExisting = selectedShips.some(s => s.waypoints.some(w => w.x === x && w.y === y))
            if(clickedExisting){
                this.removeShipWaypoints(orderableIds, x, y)
                return
            }

            if(!this.shiftDown){
                this.setShipWaypoints(orderableIds, x, y)
                return
            }
            this.addShipWaypoints(orderableIds, x, y)
            return
        }

        setSelectedShipIds([])
    }

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

            if(this.dragSelectStart){
                this.dragSelectCurrent = { x:worldPoint.x, y:worldPoint.y }
                this.drawDragSelectBox()
                return
            }

            const pointer = this.input.activePointer
            if(pointer.rightButtonDown() || pointer.leftButtonDown()){
                if(this.origDragPoint){
                    this.cameras.main.scrollX += (this.origDragPoint.x - pointer.position.x) / this.cameras.main.zoom
                    this.cameras.main.scrollY += (this.origDragPoint.y - pointer.position.y) / this.cameras.main.zoom
                }
                this.origDragPoint = pointer.position.clone()
            }
            else {
                this.origDragPoint = null
            }
        })

        this.input.on('pointerup', () => {
            const pointer = this.input.activePointer
            const isClick = Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.upX, pointer.upY) < 6

            if(!this.dragSelectStart){
                if(this.pointerDownWorld && isClick) this.handleClick(this.pointerDownWorld.x, this.pointerDownWorld.y)
                this.pointerDownWorld = null
                return
            }

            const start = this.dragSelectStart
            const end = this.dragSelectCurrent || start
            this.dragSelectStart = null
            this.dragSelectCurrent = null
            this.pointerDownWorld = null
            this.dragSelectG.clear()

            if(isClick){
                this.handleClick(start.x, start.y)
                return
            }

            const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
            const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)

            const hitIds = this.ships
                .filter(s => s.faction === Faction.Player && s.type !== ShipType.CATH && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
                .map(s => s.id)
            useAppStore.getState().setSelectedShipIds(hitIds)
        })

        this.input.on('wheel', (_pointer, _objs, _dx, dy:number) => {
            this.cameras.main.setZoom(dy < 0 ? ZOOM_LEVELS[ZOOM_LEVELS.length-1] : ZOOM_LEVELS[0])
        })
    }

    drawDragSelectBox = () => {
        const g = this.dragSelectG
        g.clear()
        if(!this.dragSelectStart || !this.dragSelectCurrent) return
        const { x:sx, y:sy } = this.dragSelectStart
        const { x:ex, y:ey } = this.dragSelectCurrent
        const x = Math.min(sx, ex), y = Math.min(sy, ey)
        const w = Math.abs(ex-sx), h = Math.abs(ey-sy)
        g.fillStyle(GREEN_HEX, 0.08)
        g.fillRect(x, y, w, h)
        g.lineStyle(1, GREEN_HEX, 0.8)
        g.strokeRect(x, y, w, h)
    }
}
