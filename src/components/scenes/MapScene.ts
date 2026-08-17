import { Scene, GameObjects, Physics, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene, onShowModal } from "../../common/Thunks";
import { getLogisticsStatus, getShipLogisticsCost } from "../../common/Utils";
import { spawnEnemyRaid, checkEnemyRaid } from "../../common/AIPlayers";
import { drawSightRadii } from "../../common/SightRadius";
import { Faction, ShipType, Modal, ShipData, ObjectiveSprite, ObjectiveSpriteIndex, AsteroidSpriteIndexesLarge, AsteroidSpriteIndexesMed, AsteroidSpriteIndexesSmall, ShipTypeSpriteIndex, ShipTypeSpriteIndexEnemy, Maps } from "../../../enum";
import {
    MAP_SIZE, CELL_SIZE, gridToWorld, worldToGrid, SHIP_SEPARATION_PX,
    TRACER_LIFETIME_MS,
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

const applyDamage = <T extends { id:string, hp:number }>(items:Array<T>, damageByTarget:Map<string, number>, onDeath?:(item:T) => void) =>
    items.map(item => {
        const damage = damageByTarget.get(item.id)
        if(damage === undefined) return item
        const hp = item.hp - damage
        if(hp <= 0){
            onDeath?.(item)
            return null
        }
        return { ...item, hp }
    }).filter(item => item !== null)

const BASE_SPRITE_INDEX:Record<Faction, number> = { [Faction.Enemy]: 13, [Faction.Player]: 0 }

type BodyKind = 'ship' | 'missile'

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
    combatG: GameObjects.Graphics
    missileImpactG: GameObjects.Graphics
    trailG: GameObjects.Graphics
    objectiveRangeG: GameObjects.Graphics
    harvesterBeamG: GameObjects.Graphics
    starfield: GameObjects.TileSprite
    dragSelectG: GameObjects.Graphics

    shipsGroup: Physics.Arcade.Group
    missilesGroup: Physics.Arcade.Group
    shipSprites: Map<string, Physics.Arcade.Sprite> = new Map()
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
    tracers: Array<{ x1:number, y1:number, x2:number, y2:number, createdAt:number }> = []
    impactFlashes: Array<{ x:number, y:number, createdAt:number, damage:number }> = []
    contrails: Array<{ x:number, y:number, createdAt:number, missileId:string }> = []

    harvesterMiningTarget: Map<string, string> = new Map()
    harvesterBeamState: Map<string, { on:boolean, nextToggleAt:number }> = new Map()

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
        this.combatG = this.add.graphics()
        this.missileImpactG = this.add.graphics()
        this.trailG = this.add.graphics()
        this.objectiveRangeG = this.add.graphics()
        this.dragSelectG = this.add.graphics()
        this.harvesterBeamG = this.add.graphics()

        this.input.keyboard.on('keydown-SHIFT', () => this.shiftDown = true)
        this.input.keyboard.on('keyup-SHIFT', () => this.shiftDown = false)

        this.generateTextures()
        this.shipsGroup = this.physics.add.group()
        this.missilesGroup = this.physics.add.group()

        this.physics.add.overlap(this.shipsGroup, this.shipsGroup, this.onDroneShipContact, this.isHostileDroneShipPair, this)
        this.physics.add.overlap(this.missilesGroup, this.shipsGroup, this.onMissileShipContact, this.isHostileMissileShipPair, this)

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

        // Every ship's own art is baked in the game's exact 4-color palette (black outline, green hull,
        // yellow highlight) — setTint can't recolor an enemy copy of that without breaking straight out
        // of the palette, since it multiplies the tint against whatever's already there (green*red isn't
        // red, it's an off-palette olive/brown) rather than replacing it. So instead of tinting at
        // render time, this bakes a real enemy-colored texture once here: an exact pixel swap of hull
        // green for RED_HEX, black/yellow left alone, registered under key+'_enemy'. CATH (Base) already
        // has its own bespoke enemy texture (base_enemy, baseB.png) so it's skipped here.
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
        this.updateArmor(time)
        this.updateHarvesters(delta)
        this.updateHarvesterSupport(time)
        this.updateObjectives(time)
        this.updateMissiles(time, delta)
        checkEnemyRaid(this)
        this.updateFogOfWar()
        this.updateShipLabels()
        drawSightRadii(this.rangeG)
        this.drawObjectiveCaptureProgress(time)

        this.drawProductionProgress()
        this.drawShipHealth()
        this.drawHarvesterMetalGauge()
        this.updateAmmoLabels()
        this.drawOrders()
        this.drawCombat(time)
        this.drawHarvesterBeams(time)
        this.drawMissileImpacts(time)
        this.drawMissileTrails(time)

        this.selectionG.clear()
        const { selectedShipIds, ships } = useAppStore.getState()
        selectedShipIds.forEach(id => {
            const ship = ships.find(s => s.id === id)
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

    drawProductionProgress = () => {
        const g = this.progressG
        g.clear()

        useAppStore.getState().ships.forEach(s => {
            const item = s.queue?.[0]
            if(!item?.startedAt) return
            if(this.shipSprites.get(s.id)?.visible === false) return

            const percent = PhaserMath.Clamp((Date.now()-item.startedAt) / ShipData[item.type].productionTimeMs, 0, 1)
            const w = CELL_SIZE * 1.6, h = 4
            const barX = s.x - w/2, barY = s.y - CELL_SIZE*2 - h

            g.lineStyle(1, GREEN_HEX, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(GREEN_HEX, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    drawShipHealth = () => {
        const g = this.healthG
        g.clear()

        useAppStore.getState().ships.forEach(s => {
            const maxHp = ShipData[s.type].hp
            if(s.hp >= maxHp) return
            const sprite = this.shipSprites.get(s.id)
            if(!sprite || sprite.visible === false) return

            const percent = PhaserMath.Clamp(s.hp / maxHp, 0, 1)
            const w = CELL_SIZE * 1.4, h = 4
            const footprint = ShipData[s.type].sizeHex * CELL_SIZE / 2
            const barX = s.x - w/2, barY = s.y + footprint + h

            g.lineStyle(1, GREEN_HEX, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(GREEN_HEX, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    // How full a GAIN ship's carried metal is (see ShipData's metalCarried/HARVESTER_METAL_CAPACITY) —
    // always shown, not just when partially empty like drawShipHealth's HP bar, since "currently empty"
    // is itself useful info here rather than clutter to hide. Drawn on its own row below the HP bar's
    // (offset an extra bar-height further out) so a damaged, partially-full Harvester can show both at
    // once without them overlapping.
    drawHarvesterMetalGauge = () => {
        const g = this.harvesterMetalG
        g.clear()

        useAppStore.getState().ships.forEach(s => {
            if(s.type !== ShipType.GAIN) return
            const sprite = this.shipSprites.get(s.id)
            if(!sprite || sprite.visible === false) return

            const percent = PhaserMath.Clamp((s.metalCarried ?? 0) / HARVESTER_METAL_CAPACITY, 0, 1)
            const w = CELL_SIZE * 1.4, h = 4
            const footprint = ShipData[s.type].sizeHex * CELL_SIZE / 2
            const barX = s.x - w/2, barY = s.y + footprint + h*2 + 2

            g.lineStyle(1, YELLOW_HEX, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(YELLOW_HEX, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    updateAmmoLabels = () => {
        useAppStore.getState().ships.forEach(ship => {
            const label = this.ammoLabels.get(ship.id)
            if(!label) return
            const sprite = this.shipSprites.get(ship.id)
            const visible = !!sprite && sprite.visible
            label.setVisible(visible)
            if(!visible) return

            label.setText(String(ship.ammoRemaining ?? 0))
            label.setPosition(sprite.x - sprite.displayWidth/2 - AMMO_LABEL_GAP_PX, sprite.y + sprite.displayHeight/2 + AMMO_LABEL_GAP_PX)
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
        const { ships, completeQueueItem } = useAppStore.getState()

        ships.forEach(s => {
            const item = s.queue?.[0]
            if(!item?.startedAt || Date.now() - item.startedAt < ShipData[item.type].productionTimeMs) return
            if(getLogisticsStatus(s.faction).logisticsRemaining - getShipLogisticsCost(item.type) < 0) return

            completeQueueItem(s.id)
            this.spawnShip(s, item.type)
        })
    }

    spawnShip = (base:ShipData, type:ShipType) => {
        const center = { x:base.x, y:base.y }
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
            if(!overlapsShip){ pos = candidate; break }
        }

        const ship:ShipData = { id:v4(), faction:base.faction, type, x:pos.x, y:pos.y, hp:ShipData[type].hp, ammoRemaining:ShipData[type].ammo }
        useAppStore.getState().addShip(ship)
        this.createShipSprite(ship)
    }

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
                    const base:ShipData = { id:v4(), faction:baseFaction, type:ShipType.CATH, x, y, hp:ShipData[ShipType.CATH].hp }
                    useAppStore.getState().addShip(base)
                    this.createShipSprite(base)
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
                    const ship:ShipData = { id:v4(), faction, type, x, y, hp:ShipData[type].hp, ammoRemaining:ShipData[type].ammo }
                    useAppStore.getState().addShip(ship)
                    this.createShipSprite(ship)
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
        const { objectives, ships, setObjectives } = useAppStore.getState()
        if(objectives.length === 0) return

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

            g.lineStyle(1, color, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(color, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    handleBaseDestroyed = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        onShowModal(faction === Faction.Player ? Modal.Defeat : Modal.Victory)
    }

    updateFogOfWar = () => {
        const { ships } = useAppStore.getState()

        ships.filter(s => s.faction === Faction.Enemy).forEach(s => {
            const visible = this.isWithinFactionSightRange(s.x, s.y, Faction.Player)
            this.shipSprites.get(s.id)?.setVisible(visible)
        })
    }

    updateShipLabels = () => {
        const { selectedShipIds } = useAppStore.getState()
        this.shipLabels.forEach((label, id) => {
            label.setVisible(selectedShipIds.includes(id) && !!this.shipSprites.get(id)?.visible)
        })
    }

    createShipSprite = (ship:ShipData) => {
        const isFriend = ship.faction === Faction.Player
        // A real baked enemy-colored texture (see generateHostileShipTexture), not a tint — setTint
        // multiplies against whatever colors are already in the art, which for a sprite already using
        // more than one palette color (black outline, green hull, yellow highlight) produces off-palette
        // blends rather than a clean recolor. CATH (Base) has its own bespoke enemy texture instead.
        const textureKey = isFriend ? ship.type : (ship.type === ShipType.CATH ? 'base_enemy' : ship.type+'_enemy')
        const sprite = this.physics.add.sprite(ship.x, ship.y, textureKey)
        this.centerCircleBody(sprite)
        sprite.setData('kind', 'ship' as BodyKind)
        sprite.setData('id', ship.id)
        this.shipsGroup.add(sprite)
        this.shipSprites.set(ship.id, sprite)

        const label = this.add.text(ship.x, ship.y-this.shipLabelOffsetPx(sprite), ship.type.toUpperCase(), { fontFamily:'Body', fontSize:'12px', color: colors.green }).setOrigin(0.5).setDepth(4).setVisible(false)
        this.shipLabels.set(ship.id, label)

        if(ShipData[ship.type].ammo){
            const ammoLabel = this.add.text(ship.x, ship.y, String(ship.ammoRemaining ?? 0), { fontFamily:'Body', fontSize:'11px', color:colors.green }).setOrigin(1, 0).setDepth(4).setVisible(false)
            this.ammoLabels.set(ship.id, ammoLabel)
        }

        if(!isFriend) sprite.setVisible(false)
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

    applyShipDamage = (ships:Array<ShipData>, damageByTarget:Map<string,number>) =>
        applyDamage(ships, damageByTarget, dead => {
            const sprite = this.shipSprites.get(dead.id)
            if(sprite) this.spawnDeathFragments(sprite)
            this.destroyShipSprite(dead.id)
            if(dead.type === ShipType.CATH) this.handleBaseDestroyed(dead.faction)
        })

    moveShips = (time:number, deltaMs:number) => {
        const { ships, setShips, resourceNodes, objectives } = useAppStore.getState()
        const arrivedAtds:Array<{ ship:ShipData, sprite:Physics.Arcade.Sprite }> = []

        const updated = ships.map(ship => {
            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return ship

            const ownWaypoints = ship.waypoints || []
            const waypoints = ship.type === ShipType.BOM ? ownWaypoints.slice(0, 1) : ownWaypoints
            const pathIndex = ship.pathIndex ?? 0
            const speed = ShipData[ship.type].speed
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
                        return Phaser.Math.Distance.Between(sprite.x, sprite.y, x, y) <= OBJECTIVE_CAPTURE_RADIUS_PX
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
                target = idle ? { x:sprite.x, y:sprite.y } : this.toWorld(waypoints[pathIndex].x, waypoints[pathIndex].y)
            }

            const prevX = sprite.x, prevY = sprite.y

            const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, target.x, target.y)
            const nextPathIndex = (!miningNode && !latchedObjectiveWorld && !movementLocked && waypoints.length > 0 && pathIndex < waypoints.length) ? pathIndex+1 : pathIndex
            const arrivedAtRouteEnd = nextPathIndex !== pathIndex && nextPathIndex >= waypoints.length

            if(dist <= step){
                sprite.setPosition(target.x, target.y)
                sprite.setVelocity(0, 0)
            }
            else {
                this.physics.moveTo(sprite, target.x, target.y, speed)
            }

            if(ship.type !== ShipType.CATH){
                const hasDirectionalTarget = !!miningNode || !!latchedObjectiveWorld || !idle
                const desiredRotation = hasDirectionalTarget ? Phaser.Math.Angle.Between(prevX, prevY, target.x, target.y) + Math.PI/2 : 0
                const turnRatePerMs = hasDirectionalTarget ? MOVE_TURN_RATE_PER_MS : IDLE_TURN_RATE_PER_MS
                sprite.setRotation(Phaser.Math.Angle.RotateTo(sprite.rotation, desiredRotation, Math.min(1, turnRatePerMs*deltaMs)))
            }

            this.shipLabels.get(ship.id)?.setPosition(sprite.x, sprite.y-this.shipLabelOffsetPx(sprite))

            if(ship.type === ShipType.BOM && arrivedAtRouteEnd && dist <= step) arrivedAtds.push({ ship, sprite })

            const objectiveAttached = !!latchedObjectiveWorld && dist <= step
            const justLockedIn = ship.type === ShipType.EYE && !movementLocked && arrivedAtRouteEnd && dist <= step

            return { ...ship, x:sprite.x, y:sprite.y, pathIndex: dist <= step ? nextPathIndex : pathIndex, latchedObjectiveId, objectiveAttached, movementLocked: movementLocked || justLockedIn }
        })

        this.applyShipSeparation(updated)

        setShips(updated)
        arrivedAtds.forEach(({ ship, sprite }) => this.detonateDrone(ship, sprite, null))
    }

    applyShipSeparation = (updated:Array<ShipData>) => {
        for(let i=0; i<updated.length; i++){
            const a = updated[i]
            const spriteA = this.shipSprites.get(a.id)
            if(!spriteA) continue
            const bodyA = spriteA.body as Physics.Arcade.Body
            const immovableA = ShipData[a.type].speed === 0

            for(let j=i+1; j<updated.length; j++){
                const b = updated[j]
                const spriteB = this.shipSprites.get(b.id)
                if(!spriteB) continue
                const bodyB = spriteB.body as Physics.Arcade.Body
                const immovableB = ShipData[b.type].speed === 0
                if(immovableA && immovableB) continue

                const minDist = bodyA.halfWidth + bodyB.halfWidth + SHIP_SEPARATION_PX
                const dx = spriteB.x - spriteA.x
                const dy = spriteB.y - spriteA.y
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

                if(shareA > 0){
                    spriteA.setPosition(spriteA.x - nx*overlap*shareA, spriteA.y - ny*overlap*shareA)
                    a.x = spriteA.x; a.y = spriteA.y
                }
                if(shareB > 0){
                    spriteB.setPosition(spriteB.x + nx*overlap*shareB, spriteB.y + ny*overlap*shareB)
                    b.x = spriteB.x; b.y = spriteB.y
                }
            }
        }
    }

    getShipEntry = (sprite:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const id = (sprite as any).getData('id')
        return useAppStore.getState().ships.find(s => s.id === id)
    }

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
        const spriteA = a as Physics.Arcade.Sprite
        const spriteB = b as Physics.Arcade.Sprite
        const shipA = this.getShipEntry(a)
        const shipB = this.getShipEntry(b)
        if(!shipA || !shipB) return

        if(DRONE_TYPES.has(shipA.type)) this.detonateDrone(shipA, spriteA, { id:shipB.id })

        const survivingShipB = this.shipSprites.has(shipB.id) ? this.getShipEntry(b) : null
        if(survivingShipB && DRONE_TYPES.has(survivingShipB.type)) this.detonateDrone(survivingShipB, spriteB, { id:shipA.id })
    }

    detonateDrone = (drone:ShipData, sprite:Physics.Arcade.Sprite, primary:{ id:string } | null) => {
        const time = this.time.now
        const shipDamage = new Map<string, number>([[drone.id, drone.hp]])
        const damage = ShipData[drone.type].damage

        if(drone.type === ShipType.KKZ && primary){
            shipDamage.set(primary.id, (shipDamage.get(primary.id) || 0) + damage)
        }
        else if(drone.type === ShipType.BOM){
            const hits = this.physics.overlapCirc(sprite.x, sprite.y, ATD_BLAST_RADIUS_PX, true, false)
            hits.forEach(body => {
                const obj = (body as Physics.Arcade.Body).gameObject
                if(obj.getData('kind') !== 'ship') return
                const hitShip = this.getShipEntry(obj as Phaser.Types.Physics.Arcade.GameObjectWithBody)
                if(hitShip && hitShip.faction !== drone.faction) shipDamage.set(hitShip.id, (shipDamage.get(hitShip.id) || 0) + damage)
            })
        }

        const { ships, setShips } = useAppStore.getState()
        setShips(applyDamage(ships, shipDamage, dead => {
            if(dead.id === drone.id){
                this.impactFlashes.push({ x:sprite.x, y:sprite.y, createdAt:time, damage })
            }
            else {
                const deadSprite = this.shipSprites.get(dead.id)
                if(deadSprite) this.spawnDeathFragments(deadSprite)
            }
            this.destroyShipSprite(dead.id)
            if(dead.type === ShipType.CATH) this.handleBaseDestroyed(dead.faction)
        }))
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

        const { ships, setShips } = useAppStore.getState()
        setShips(this.applyShipDamage(ships, new Map([[ship.id, damage]])))
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

    updateMlrs = (time:number) => {
        const { ships, setShips } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const shotsFired = new Map<string, number>()

        ships.forEach(ship => {
            if(ship.type !== ShipType.SPR) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.SPR].cooldownMs) return
            if(!ship.ammoRemaining) return

            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return

            const targetShip = this.findNearestHostileShip(ship.faction, sprite.x, sprite.y, ShipData[ShipType.SPR].rangePx)
            if(!targetShip) return

            const shots = Math.min(MISSILE_SALVO_SIZE, ship.ammoRemaining)
            shooterIds.add(ship.id)
            shotsFired.set(ship.id, shots)
            const targetId = targetShip.getData('id')
            const aimX = targetShip.x, aimY = targetShip.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!sprite.active) return
                    this.spawnMissile(ship.faction, sprite.x, sprite.y, targetId, ShipData[ShipType.SPR].damage, aimX, aimY)
                })
            }
        })

        if(shooterIds.size > 0){
            setShips(ships.map(ship => shooterIds.has(ship.id)
                ? { ...ship, lastFiredAtMs:time, ammoRemaining:ship.ammoRemaining-shotsFired.get(ship.id) }
                : ship))
        }
    }

    updateArmor = (time:number) => {
        const { ships, setShips } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const damageByTarget = new Map<string, number>()

        ships.forEach(ship => {
            if(ship.type !== ShipType.ZEL) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.ZEL].cooldownMs) return

            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return

            const targetShip = this.findNearestHostileShip(ship.faction, sprite.x, sprite.y, ShipData[ShipType.ZEL].rangePx)
            if(!targetShip) return

            shooterIds.add(ship.id)
            this.tracers.push({ x1:sprite.x, y1:sprite.y, x2:targetShip.x, y2:targetShip.y, createdAt:time })
            const targetId = targetShip.getData('id')
            damageByTarget.set(targetId, (damageByTarget.get(targetId) || 0) + ShipData[ShipType.ZEL].damage)
        })

        if(shooterIds.size === 0) return

        setShips(this.applyShipDamage(ships.map(ship => shooterIds.has(ship.id) ? { ...ship, lastFiredAtMs:time } : ship), damageByTarget))
    }

    updateHarvesterMiningTargets = () => {
        const { ships, resourceNodes } = useAppStore.getState()
        this.harvesterMiningTarget.clear()
        ships.filter(s => s.type === ShipType.GAIN).forEach(harvester => {
            if((harvester.metalCarried ?? 0) >= HARVESTER_METAL_CAPACITY) return
            const sprite = this.shipSprites.get(harvester.id)
            if(!sprite) return

            let nearest:ResourceNodeData = null
            let nearestDist = Infinity
            resourceNodes.forEach(node => {
                if((node.metal ?? 0) <= 0) return
                const d = Phaser.Math.Distance.Between(sprite.x, sprite.y, node.x, node.y)
                if(d <= HARVESTER_RANGE_PX && d < nearestDist){ nearestDist = d; nearest = node }
            })
            if(nearest) this.harvesterMiningTarget.set(harvester.id, nearest.id)
        })
    }

    // A Harvester no longer deposits what it mines into a shared faction stockpile — it carries the
    // metal itself (see ShipData's metalCarried), capped at HARVESTER_METAL_CAPACITY, spent later
    // refilling ammo/repairing hp (see updateHarvesterSupport). Stops drawing from its target the instant it's full,
    // same as updateHarvesterMiningTargets already refuses to assign one a target once it is.
    updateHarvesters = (deltaMs:number) => {
        const { ships, resourceNodes, setShips, setResourceNodes } = useAppStore.getState()
        if(this.harvesterMiningTarget.size === 0) return

        const drawdown = new Map<string, number>() // asteroid id -> metal drawn this frame so far
        const metalGainedByShip = new Map<string, number>()

        ships.filter(s => s.type === ShipType.GAIN).forEach(harvester => {
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
            metalGainedByShip.set(harvester.id, gathered)
        })

        if(drawdown.size === 0) return

        if(metalGainedByShip.size > 0){
            setShips(ships.map(s => {
                const gained = metalGainedByShip.get(s.id)
                return gained ? { ...s, metalCarried: (s.metalCarried ?? 0) + gained } : s
            }))
        }

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
        const { ships, setShips } = useAppStore.getState()
        const harvesters = ships.filter(s => s.type === ShipType.GAIN && (s.metalCarried ?? 0) >= 1
            && (!s.lastResupplyAtMs || time - s.lastResupplyAtMs >= HARVESTER_RESUPPLY_INTERVAL_MS))
        if(harvesters.length === 0) return

        const metalSpent = new Map<string, number>() // harvester id -> metal spent this tick
        const ammoGained = new Map<string, number>() // ship id -> ammo gained this tick
        const hpGained = new Map<string, number>() // ship id -> hp gained this tick
        const supportedHarvesterIds = new Set<string>()

        const inRange = (harvester:ShipData, t:ShipData) => t.faction === harvester.faction
            && Phaser.Math.Distance.Between(harvester.x, harvester.y, t.x, t.y) <= HARVESTER_RESUPPLY_RANGE_PX

        harvesters.forEach(harvester => {
            const ammoTarget = ships.find(t => inRange(harvester, t)
                && ShipData[t.type].ammo && (t.ammoRemaining ?? 0) < ShipData[t.type].ammo)
            if(ammoTarget){
                metalSpent.set(harvester.id, 1)
                ammoGained.set(ammoTarget.id, (ammoGained.get(ammoTarget.id) || 0) + 1)
                supportedHarvesterIds.add(harvester.id)
                return
            }

            if((harvester.metalCarried ?? 0) < HARVESTER_REPAIR_METAL_COST) return
            const repairTarget = ships.find(t => inRange(harvester, t) && t.hp < ShipData[t.type].hp)
            if(!repairTarget) return

            metalSpent.set(harvester.id, HARVESTER_REPAIR_METAL_COST)
            hpGained.set(repairTarget.id, (hpGained.get(repairTarget.id) || 0) + 1)
            supportedHarvesterIds.add(harvester.id)
        })

        if(supportedHarvesterIds.size === 0) return

        setShips(ships.map(s => {
            const spent = metalSpent.get(s.id)
            const ammoAdd = ammoGained.get(s.id)
            const hpAdd = hpGained.get(s.id)
            if(!spent && !ammoAdd && !hpAdd) return s
            return {
                ...s,
                metalCarried: spent ? (s.metalCarried ?? 0) - spent : s.metalCarried,
                ammoRemaining: ammoAdd ? Math.min(ShipData[s.type].ammo, (s.ammoRemaining ?? 0) + ammoAdd) : s.ammoRemaining,
                hp: hpAdd ? Math.min(ShipData[s.type].hp, s.hp + hpAdd) : s.hp,
                lastResupplyAtMs: spent ? time : s.lastResupplyAtMs,
            }
        }))
    }

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
                child.destroy()
                this.impactFlashes.push({ x:legTargetX, y:legTargetY, createdAt:time, damage:child.getData('damage') })
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
                g.fillStyle(GREEN_HEX, (1-progress) * (1-i*0.2))
                g.fillCircle(x, y, 1.5)
            }
        })
    }

    drawHarvesterBeams = (time:number) => {
        const g = this.harvesterBeamG
        g.clear()

        this.harvesterBeamState.forEach((_, id) => {
            if(!this.harvesterMiningTarget.has(id)) this.harvesterBeamState.delete(id)
        })

        const { resourceNodes } = useAppStore.getState()
        this.harvesterMiningTarget.forEach((nodeId, harvesterId) => {
            const sprite = this.shipSprites.get(harvesterId)
            const node = resourceNodes.find(n => n.id === nodeId)
            if(!sprite || !node) return

            let state = this.harvesterBeamState.get(harvesterId)
            if(!state){
                state = { on:true, nextToggleAt: time + this.randomFlickerIntervalMs() }
                this.harvesterBeamState.set(harvesterId, state)
            }
            if(time >= state.nextToggleAt){
                state.on = !state.on
                state.nextToggleAt = time + this.randomFlickerIntervalMs()
            }
            if(!state.on) return

            g.lineStyle(1, YELLOW_HEX)
            g.lineBetween(sprite.x, sprite.y, node.x, node.y)
        })
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
        const { selectedShipIds, ships } = useAppStore.getState()

        this.lastOrdersKey = ''
        const g = this.ordersG
        g.clear()
        this.orderLabels.forEach(label => label.destroy())
        this.orderLabels = []

        selectedShipIds.forEach(id => {
            const ship = ships.find(s => s.id === id)
            if(!ship || !ship.waypoints || ship.waypoints.length === 0) return
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
        const ownShips = useAppStore.getState().ships.filter(s => s.faction === faction)
        return ownShips.some(s => Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= ShipData[s.type].sightRadius)
    }

    findOwnShipAt = (worldX:number, worldY:number) => {
        return useAppStore.getState().ships.find(s => {
            if(s.faction !== Faction.Player || s.type === ShipType.CATH) return false
            const r = Math.max(ShipData[s.type].sizeHex * CELL_SIZE/2, 10)
            return Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= r
        })
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
        const { ships, selectedShipIds, setSelectedShipIds, addShipWaypoints, setShipWaypoints, removeShipWaypoints } = useAppStore.getState()

        const clicked = this.findOwnShipAt(worldX, worldY)
        if(clicked){
            setSelectedShipIds([clicked.id])
            return
        }

        if(selectedShipIds.length > 0){
            const { x, y } = this.hoveredCell
            if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return
            const orderableIds = ships.filter(s => selectedShipIds.includes(s.id) && s.type !== ShipType.CATH && !s.movementLocked).map(s => s.id)
            if(orderableIds.length === 0) return
            if(!this.shiftDown){
                setShipWaypoints(orderableIds, x, y)
                return
            }
            const selectedShips = ships.filter(s => orderableIds.includes(s.id))
            const clickedExisting = selectedShips.some(s => s.waypoints?.some(w => w.x === x && w.y === y))
            if(clickedExisting) removeShipWaypoints(orderableIds, x, y)
            else addShipWaypoints(orderableIds, x, y)
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

            const { ships, setSelectedShipIds } = useAppStore.getState()
            const hitIds = ships
                .filter(s => s.faction === Faction.Player && s.type !== ShipType.CATH && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
                .map(s => s.id)
            setSelectedShipIds(hitIds)
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

    onTransitionIn = () => {
    }
}
