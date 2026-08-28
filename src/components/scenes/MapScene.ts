import { Scene, GameObjects, Physics, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSelectShips, onSetScene, onShowModal } from "../../common/Thunks";
import { getShipRelicCost, saveFile, stableAngularPhase } from "../../common/Utils";
import { spawnEnemyRaid, checkEnemyRaid, updateEnemyZel, updateEnemyGain, updateEnemyDrones, updateEnemyBeh, updateEnemyHusk, updateEnemyBlade, updateEnemyEscorts, updateEnemyCaptureEscape, enemyOrderFor } from "../../common/AIPlayers";
import { drawSightRadii } from "../../common/SightRadius";
import ShipSprite from "../sprites/ShipSprite";
import { Faction, ShipType, Modal, ShipData, ObjectiveSprite, ObjectiveSpriteIndex, ObjectiveType, OrderType, PortalSpriteIndex, AsteroidSpriteIndexesLarge, AsteroidSpriteIndexesMed, AsteroidSpriteIndexesSmall, ShipTypeSpriteIndex, ShipTypeSpriteIndexEnemy, Maps, NebulaResource, SoundEffects, DEFAULT_BUILDABLE } from "../../../enum";
import { MAP_METADATA } from "../../assets/MapMetadata";
import {
    CELL_SIZE, gridToWorld, worldToGrid, SHIP_SEPARATION_PX, WAYPOINT_ARRIVAL_RADIUS_PX,
    MAX_QUEUE, MAX_WAYPOINTS,
    DOUBLE_CLICK_MS,
    BULLET_SPEED_PX_S, BULLET_MAX_LIFETIME_MS,
    ATD_BLAST_RADIUS_PX,
    MISSILE_SPEED_PX_S, MISSILE_MAX_LIFETIME_MS, SALVO_STAGGER_MS,
    MISSILE_ARC_HEIGHT_PX, CONTRAIL_INTERVAL_MS, CONTRAIL_LIFETIME_MS,
    MISSILE_IMPACT_LIFETIME_MS, MISSILE_IMPACT_MIN_RADIUS_PX, MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX,
    BEAM_LIFETIME_MS, BEAM_WIDTH_PX,
    SHIP_FRAGMENT_LIFETIME_MS, SHIP_FRAGMENT_MIN_DISTANCE_PX, SHIP_FRAGMENT_MAX_DISTANCE_PX,
    OBJECTIVE_CAPTURE_RADIUS_PX, OBJECTIVE_ICON_SIZE, OBJECTIVE_CAPTURE_TIME_MS,
    ZEL_SHIP_CAPTURE_RADIUS_PX, ZEL_SHIP_CAPTURE_TIME_MS,
    HARVESTER_RANGE_PX, HARVESTER_COLLECTION_RATE_PER_S,
    HARVESTER_METAL_CAPACITY, HARVESTER_RESUPPLY_RANGE_PX, HARVESTER_RESUPPLY_INTERVAL_MS, HARVESTER_REPAIR_METAL_COST, DRN_AMMO_METAL_COST,
    HARVESTER_ORBIT_RADIUS_PX, HARVESTER_ORBIT_ANGULAR_SPEED, HARVESTER_BEAM_FLICKER_MIN_MS, HARVESTER_BEAM_FLICKER_MAX_MS,
    ASTEROID_AVG_METAL, ASTEROID_METAL_VARIANCE,
    NEBULA_SIGHT_RADIUS_PX,
    GREEN_HEX, YELLOW_HEX, RED_HEX, MINIMAP_SIZE_PX, MINIMAP_MARGIN_PX, MISSION_END_REVEAL_MS, MINIMAP_PING_PULSE_MS,
} from "../../common/Constants";
import { colors } from "../../styles/AppStyles";

// A ship standing right at the map's own edge still draws its full sight-radius circle (drawSightRadii
// doesn't clip to map bounds) — so rangeShadeDither, the tiled texture that overlap shading actually
// gets masked against, has to extend at least this far past every edge too, or the mask geometry says
// "shaded" out there but there's no dither texture underneath to actually show it, leaving a gap right
// where a large sight radius crosses the map boundary. The single biggest sightRadius any ShipData
// entry has is the worst case that could ever need covering.
const SIGHT_OVERFLOW_MARGIN_PX = Math.max(...Object.values(ShipData).map(s => s.sightRadius))

const SHIP_LABEL_GAP_PX = 10

const AMMO_LABEL_GAP_PX = 4

const LABEL_TEXT_RESOLUTION = 4
const MAP_FONT_SIZE = '8px'

const MOUSE_CAMERA_PAN_SPEED_MULTIPLIER = 1.5
// A moving ship's turn rate scales with its own speed rather than being one flat number for every ship
// type — a fast KKZ snaps toward its heading much quicker than a sluggish DRN does. 20px/s (SPR/EYE/BEH's
// own speed) is the reference point this is tuned against: a ship moving at exactly that speed turns at
// the same 0.001 rad/ms every ship used to, uniformly, before this scaled by speed at all.
const MOVE_TURN_RATE_PER_SPEED_PX_S = 0.001 / 20

const ASTEROID_TIER_FRAMES = { large:AsteroidSpriteIndexesLarge, med:AsteroidSpriteIndexesMed, small:AsteroidSpriteIndexesSmall }
type AsteroidTier = keyof typeof ASTEROID_TIER_FRAMES
const asteroidTier = (node:ResourceNodeData):AsteroidTier => {
    const metal = node.metal ?? 0
    if(metal > 40) return 'large'
    if(metal > 20) return 'med'
    return 'small'
}

export const DRONE_TYPES = new Set<ShipType>([ShipType.KKZ, ShipType.BOM])

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
    // Overlap-shape source for rangeShadeDither's geometry mask — never itself on the display list.
    rangeShadeBrush: GameObjects.Graphics
    // Enemy-sight shading: a tiled full-alpha red dither pattern, masked to rangeShadeBrush's shape.
    rangeShadeDither: GameObjects.TileSprite
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
    beamG: GameObjects.Graphics
    activePingG: GameObjects.Graphics
    strikeTargetsG: GameObjects.Graphics
    starfield: GameObjects.TileSprite
    nebulaSprites: Array<GameObjects.Image> = []
    dragSelectG: GameObjects.Graphics
    // Screen-fixed (setScrollFactor(0)), toggled by 'M' — see enableSelectionControls/drawMinimap.
    minimapG: GameObjects.Graphics
    minimapVisible: boolean = true

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
    // Backs the `ships` getter below — invalidated (set null) at every one of the handful of places that
    // actually mutate shipSprites (createShipSprite/destroyShipSprite/resetSceneState), rather than
    // rebuilt on every single access. `this.ships`/`scene.ships` is read dozens of times a frame across
    // MapScene and AIPlayers' AI functions; re-running Array.from(shipSprites.values()) on every one of
    // those, every frame, was allocating a fresh full-length array each time even though the underlying
    // Map only actually changes on a spawn or death — comparatively rare events.
    shipsCache: Array<ShipSprite> | null = null
    // A ShipType's footprint radius, in real px — derived from its own texture the first time it's
    // asked for (see getShipFootprintRadiusPx) rather than hand-maintained per type, so a selection
    // ring, click hitbox, or spacing check can never drift out of sync with what the art actually looks
    // like on screen the way a separate sizeHex number could.
    shipFootprintRadiusPx: Map<ShipType, number> = new Map()
    shipLabels: Map<string, GameObjects.Text> = new Map()
    ammoLabels: Map<string, GameObjects.Text> = new Map()
    objectiveSprites: Map<string, GameObjects.Image> = new Map()
    objectiveLabels: Map<string, GameObjects.Text> = new Map()
    portalSprites: Map<string, GameObjects.Image> = new Map()
    resourceNodeSprites: Map<string, GameObjects.Image> = new Map()

    missionShips: Map<string, { faction:Faction, type:ShipType }> = new Map()
    destroyedMissionShipIds: Set<string> = new Set()
    escapedMissionShipIds: Set<string> = new Set()
    escapedVeterans: Array<VeteranShip> = []

    // A CAPTURE_ESCAPE ZEL that's reached a Portal, held back from actually escaping (see updatePortals)
    // for MISSION_END_REVEAL_MS — see resolvePendingCaptureEscape, which is what actually completes the
    // escape (and ends the mission, see its own comment) once that reveal window is up. Kept as its own
    // separate mechanism from the generic pendingMissionEnd* below rather than folded into it, because
    // this one needs to reveal a still-*live* ship (forcing fog-of-war visibility on it — see
    // updateFogOfWar) before it actually disappears, not just pan/ping wherever something already ended
    // up.
    pendingCaptureEscapeShipId?: string
    pendingCaptureEscapeRevealAtMs?: number
    // The Portal the pending ship is actually escaping through (see updatePortals, which is the only
    // place that knows which one it reached) — the pan/ping centers on this, not the ship itself, per
    // startCaptureEscapeReveal's own comment.
    pendingCaptureEscapePortalPos?: { x:number, y:number }
    // Set true only once the camera's own pan-to-it (see startCaptureEscapeReveal) has actually finished
    // — drawActivePing won't draw anything until then, so the ring doesn't show up somewhere off-screen
    // mid-pan.
    captureEscapePingActive: boolean = false

    // The world position of whichever mission-relevant ship died most recently (see destroyShipSprite) —
    // just a live "last one", overwritten on every mission-ship death; startMissionEndReveal snapshots it
    // into pendingMissionEndX/Y the instant it actually needs it; frozen from then on regardless of what
    // dies afterward.
    lastDestroyedShipPosition?: { x:number, y:number }
    // Same idea, but the Portal the most recently escaped ship left through (see escapeShip) — what
    // startMissionEndReveal centers on instead, for an ALL_SHIPS_ESCAPED victory specifically (see
    // updateMissionObjectives).
    lastEscapedShipPortalPosition?: { x:number, y:number }
    // Generic version of the same reveal-then-resolve shape as pendingCaptureEscapeShipId above, for
    // every other way the mission can end (see updateMissionObjectives) — a DESTROY_SHIPS victory, or
    // any defeat condition apart from CAPTURE_ESCAPE's own ENEMY_SHIPS_ESCAPED (which already gets its
    // own richer live-ship reveal and ends the mission directly, see resolvePendingCaptureEscape).
    // pendingMissionEndWon carries which outcome resolvePendingMissionEnd should actually end the
    // mission with once the reveal's run its course.
    pendingMissionEndRevealAtMs?: number
    pendingMissionEndX?: number
    pendingMissionEndY?: number
    pendingMissionEndWon?: boolean
    missionEndPingActive: boolean = false

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
    // Control-group hotkeys (SHIFT+1-9 assigns, 1-9 alone selects/recenters) — see enableSelectionControls.
    // Ship ids only, not live references, so a member that's since died is just quietly skipped rather
    // than needing its own cleanup pass whenever one does.
    shipGroups: Map<number, Array<string>> = new Map()
    impactFlashes: Array<{ x:number, y:number, createdAt:number, damage:number }> = []
    contrails: Array<{ x:number, y:number, createdAt:number, missileId:string }> = []
    // A beam weapon's own instant-hit flash (see updateBeamWeapons/drawBeams) — no projectile to track,
    // just a line that fades out over BEAM_LIFETIME_MS.
    beamFlashes: Array<{ x1:number, y1:number, x2:number, y2:number, createdAt:number }> = []

    harvesterMiningTarget: Map<string, string> = new Map()
    // GAIN ids within mining range as of the last updateHarvesterMiningTargets pass — lets that function
    // tell a harvester newly *entering* range (which should interrupt its route and start mining) apart
    // from one that's simply still sitting in range after an order stopped it mining (which shouldn't
    // have that order immediately re-clobbered just because it hasn't moved out of range yet).
    harvesterInRangeIds: Set<string> = new Set()
    harvesterBeamState: Map<string, { on:boolean, nextToggleAt:number }> = new Map()
    // Whichever ship each GAIN is currently in range of and actively resupplying/repairing — recomputed
    // every frame by updateHarvesterSupport regardless of its own spend cooldown, purely so
    // drawHarvesterSupportBeams has something live to draw a beam to.
    harvesterSupportTarget: Map<string, string> = new Map()
    harvesterSupportBeamState: Map<string, { on:boolean, nextToggleAt:number }> = new Map()

    // Escort ship id -> the ZEL it's currently assigned to babysit — see AIPlayers' assignZelEscorts
    // (which keeps this up to date) and escortZel (which each combat type's own update function falls
    // back to once it has no hostile target of its own to deal with).
    escortAssignments: Map<string, string> = new Map()

    enemyBaseId: string
    enemyRaidLaunched: boolean = false
    gameOver: boolean = false
    // Which Tiled map to actually load — read once from the store's own activeMapKey (see NewGame/
    // Briefing) at the very start of create(), rather than re-reading it everywhere a tilemap gets made.
    mapKey: Maps
    mapData: MapData
    origDragPoint: Phaser.Math.Vector2
    hoveredCell: {x:number, y:number}
    unsubscribe: () => void

    constructor(config){
        super(config)
        onSetScene(this)
    }

    // An array snapshot of every ship — safe to iterate even when the system doing so might spawn or
    // destroy ships partway through (spawning appends to shipSprites but never to a snapshot already
    // taken; destroying doesn't retroactively remove an entry from one either), unlike iterating
    // shipSprites directly. Every per-frame system reads through this rather than the Map. Cached in
    // shipsCache (see its own comment) — still always a *fresh* snapshot relative to the actual roster,
    // just not literally re-materialized on every one of a frame's many reads of it.
    get ships():Array<ShipSprite> {
        if(!this.shipsCache) this.shipsCache = Array.from(this.shipSprites.values())
        return this.shipsCache
    }

    resetSceneState = () => {
        this.shipSprites = new Map()
        this.shipsCache = null
        this.shipLabels = new Map()
        this.ammoLabels = new Map()
        this.objectiveSprites = new Map()
        this.objectiveLabels = new Map()
        this.portalSprites = new Map()
        this.resourceNodeSprites = new Map()
        this.nebulaSprites = []

        this.missionShips = new Map()
        this.destroyedMissionShipIds = new Set()
        this.escapedMissionShipIds = new Set()
        this.escapedVeterans = []
        this.pendingCaptureEscapeShipId = undefined
        this.pendingCaptureEscapeRevealAtMs = undefined
        this.pendingCaptureEscapePortalPos = undefined
        this.captureEscapePingActive = false
        this.lastDestroyedShipPosition = undefined
        this.lastEscapedShipPortalPosition = undefined
        this.pendingMissionEndWon = undefined
        this.pendingMissionEndRevealAtMs = undefined
        this.pendingMissionEndX = undefined
        this.pendingMissionEndY = undefined
        this.missionEndPingActive = false

        this.orderLabels = []
        this.lastOrdersKey = ''
        this.shiftDown = false
        this.dragSelectStart = null
        this.dragSelectCurrent = null
        this.pointerDownWorld = null
        this.lastClickShipId = null
        this.lastClickAtMs = 0
        this.shipGroups = new Map()
        this.impactFlashes = []
        this.contrails = []
        this.beamFlashes = []

        this.harvesterMiningTarget = new Map()
        this.harvesterInRangeIds = new Set()
        this.harvesterBeamState = new Map()
        this.harvesterSupportTarget = new Map()
        this.harvesterSupportBeamState = new Map()

        this.escortAssignments = new Map()

        this.enemyBaseId = undefined
        this.enemyRaidLaunched = false
        this.gameOver = false
    }

    create = () => {
        this.resetSceneState()
        this.input.mouse.disableContextMenu()
        this.g = this.add.graphics()
        this.rangeG = this.add.graphics()
        this.rangeShadeBrush = this.make.graphics({}, false)
        this.selectionG = this.add.graphics()
        this.progressG = this.add.graphics()
        this.healthG = this.add.graphics()
        this.harvesterMetalG = this.add.graphics()
        this.ordersG = this.add.graphics()
        this.missileImpactG = this.add.graphics()
        this.trailG = this.add.graphics()
        this.objectiveRangeG = this.add.graphics()
        this.dragSelectG = this.add.graphics()
        this.minimapG = this.add.graphics().setScrollFactor(0).setDepth(1000)
        this.harvesterBeamG = this.add.graphics()
        this.harvesterSupportBeamG = this.add.graphics()
        this.beamG = this.add.graphics()
        this.activePingG = this.add.graphics()
        this.strikeTargetsG = this.add.graphics()

        this.input.keyboard.on('keydown-SHIFT', () => this.shiftDown = true)
        this.input.keyboard.on('keyup-SHIFT', () => this.shiftDown = false)

        this.mapKey = useAppStore.getState().activeMapKey
        this.mapData = { width:0, height:0, objectives:[], portals:[], terrain:null }
        this.generateTextures()
        this.rangeShadeDither = this.add.tileSprite(-SIGHT_OVERFLOW_MARGIN_PX, -SIGHT_OVERFLOW_MARGIN_PX, this.mapData.width*CELL_SIZE, this.mapData.height*CELL_SIZE, 'dither_red').setOrigin(0, 0).setDepth(-1)
        this.rangeShadeDither.setMask(this.rangeShadeBrush.createGeometryMask())
        this.shipsGroup = this.physics.add.group()
        this.missilesGroup = this.physics.add.group()
        this.bulletsGroup = this.physics.add.group()

        this.physics.add.overlap(this.shipsGroup, this.shipsGroup, this.onDroneShipContact, this.isHostileDroneShipPair, this)
        this.physics.add.overlap(this.missilesGroup, this.shipsGroup, this.onMissileShipContact, this.isHostileMissileShipPair, this)
        this.physics.add.overlap(this.bulletsGroup, this.missilesGroup, this.onBulletMissileContact, this.isHostileBulletMissilePair, this)
        this.physics.add.overlap(this.bulletsGroup, this.shipsGroup, this.onBulletShipContact, this.isHostileBulletShipPair, this)

        const tiledMap = this.make.tilemap({ key: this.mapKey })
        if(tiledMap.width && tiledMap.height){
            this.mapData.width = tiledMap.width
            this.mapData.height = tiledMap.height
        }
        // The red dither is masked to enemy/player sight overlap. It must span the entire loaded map
        // plus SIGHT_OVERFLOW_MARGIN_PX past every edge (see that const's own comment) — not just the
        // map bounds themselves, or an overlap that spills past the edge has no dither underneath it to
        // actually show.
        this.rangeShadeDither.setPosition(-SIGHT_OVERFLOW_MARGIN_PX, -SIGHT_OVERFLOW_MARGIN_PX)
        this.rangeShadeDither.setSize(this.mapData.width*CELL_SIZE + SIGHT_OVERFLOW_MARGIN_PX*2, this.mapData.height*CELL_SIZE + SIGHT_OVERFLOW_MARGIN_PX*2)

        this.cameras.main.setZoom(2)
        this.centerCameraBounds()

        const bounds = this.cameras.main.getBounds()
        this.starfield = this.add.tileSprite(bounds.centerX, bounds.centerY, bounds.width, bounds.height, 'starfield').setDepth(-10).setScrollFactor(0.5)
        this.spawnEntitiesFromMap()
        this.enableCameraControls()
        this.enableSelectionControls()

        spawnEnemyRaid(this)

        this.time.addEvent({ delay: 500, loop: true, callback: this.tickProduction })
        this.time.addEvent({ delay: 1000, loop: true, callback: () => this.runSlowTick(this.time.now) })

        this.unsubscribe = useAppStore.subscribe((state, prevState) => {
            if(state.selectedShipIds.length > 0 && state.ships.length !== prevState.ships.length){
                const stillAlive = state.selectedShipIds.filter(id => state.ships.some(s => s.id === id))
                if(stillAlive.length !== state.selectedShipIds.length) useAppStore.getState().setSelectedShipIds(stillAlive)
            }
        })
        this.events.once('shutdown', () => this.unsubscribe())

        this.sound.get(SoundEffects.Briefing)?.stop()
        this.sound.get(SoundEffects.Main)?.play(undefined, { loop: true, volume: useAppStore.getState().playerSettings.musicVolume })

        useAppStore.getState().setLoaded(true)
    }

    isPointUnderNebulaSprite = (sprite:GameObjects.Image, worldX:number, worldY:number) => sprite.getBounds().contains(worldX,worldY)

    isPointUnderNebula = (worldX:number, worldY:number) =>
        this.nebulaSprites.some(sprite => this.isPointUnderNebulaSprite(sprite, worldX, worldY))

    generateTextures = () => {
        const tmp = this.add.graphics()
        // The texture manager is global to the Game, not this scene, so it's still holding onto every
        // key baked on a previous map load — bake() and generateHostileShipTexture skip a key that's
        // already there instead of re-baking (and warning) into one Phaser refuses to overwrite.
        const bake = (key:string, size:number, draw:(g:GameObjects.Graphics, cx:number, cy:number) => void) => {
            if(this.textures.exists(key)) return
            tmp.clear()
            draw(tmp, size/2, size/2)
            tmp.generateTexture(key, size, size)
        }

        bake('missile_dot', 8, (g, cx, cy) => { g.fillStyle(GREEN_HEX, 0.9); g.fillCircle(cx, cy, 2) })
        // Tiled full-alpha checkerboard, not a translucent fill — see rangeShadeDither.
        bake('dither_red', 8, (g) => {
            g.fillStyle(RED_HEX, 1)
            g.fillRect(0, 0, 1, 1)
        })
        // Bigger/brighter than missile_dot, with a soft glow ring — a bullet only lives up to
        // BULLET_MAX_LIFETIME_MS and covers its whole (short) range in well under a second, so it needs
        // to read clearly at a glance or PDF actually firing is easy to miss entirely.
        bake('bullet_dot', 5, (g, cx, cy) => {
            g.fillStyle(YELLOW_HEX, 1)
            g.fillRect(cx, cy, 1,1)
        })

        Object.values(ShipType).filter(type => type !== ShipType.CATH).forEach(type => this.generateHostileShipTexture(type))
    }

    generateHostileShipTexture = (key:string) => {
        if(this.textures.exists(key+'_enemy')) return
        const source = this.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement
        const w = source.width, h = source.height
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(source as CanvasImageSource, 0, 0)

        // Both palette colors the friendly art actually uses — its green hull and its yellow highlight —
        // go red, leaving black outline (and anything else) untouched. Matched with a small tolerance
        // rather than exact equality: a getImageData/putImageData round-trip can shift a channel by a
        // value or two (premultiplied-alpha unpremultiply rounding), which an exact match would silently
        // skip, leaving stray green/yellow pixels behind.
        const imageData = ctx.getImageData(0, 0, w, h)
        const data = imageData.data
        const COLOR_MATCH_TOLERANCE = 10
        const closeTo = (i:number, cr:number, cg:number, cb:number) =>
            Math.abs(data[i]-cr) <= COLOR_MATCH_TOLERANCE && Math.abs(data[i+1]-cg) <= COLOR_MATCH_TOLERANCE && Math.abs(data[i+2]-cb) <= COLOR_MATCH_TOLERANCE
        const r = (RED_HEX >> 16) & 0xff, g = (RED_HEX >> 8) & 0xff, b = RED_HEX & 0xff
        const greenR = (GREEN_HEX >> 16) & 0xff, greenG = (GREEN_HEX >> 8) & 0xff, greenB = GREEN_HEX & 0xff
        const yellowR = (YELLOW_HEX >> 16) & 0xff, yellowG = (YELLOW_HEX >> 8) & 0xff, yellowB = YELLOW_HEX & 0xff
        for(let i=0; i<data.length; i += 4){
            if(data[i+3] === 0) continue
            if(!closeTo(i, greenR, greenG, greenB) && !closeTo(i, yellowR, yellowG, yellowB)) continue
            data[i] = r; data[i+1] = g; data[i+2] = b
        }
        ctx.putImageData(imageData, 0, 0)

        this.textures.addCanvas(key+'_enemy', canvas)
    }

    update = (time:number, delta:number) => {
        this.updateHarvesterMiningTargets()
        this.moveShips(time, delta)
        this.updateMlrs(time)
        this.updatePdf(time)
        this.updateBulletWeapons(time)
        this.updateBeamWeapons(time)
        this.updateBullets(time)
        this.updateHarvesters(delta)
        this.updatePortals()
        this.updateMissiles(time, delta)
        this.updateFogOfWar()
        this.drawStrikeTargets()
        this.updateShipLabels()

        drawSightRadii(this.rangeG, this.ships.map(s => ({
            x: s.x, y: s.y, type: s.type, faction: s.faction,
            sightRadiusOverride: this.isPointUnderNebula(s.x, s.y) ? NEBULA_SIGHT_RADIUS_PX : undefined,
        })), this.rangeShadeBrush)
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
        this.drawBeams(time)

        this.selectionG.clear()
        const { selectedShipIds } = useAppStore.getState()
        selectedShipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            this.drawSelectionRing(ship.x, ship.y, this.getShipFootprintRadiusPx(ship.type) * 1.4, time)
        })

        this.drawMinimap(time)
        this.drawActivePing(time)
    }

    // Driven by its own TimerEvent (see create()) instead of update()'s 60Hz loop. Everything here
    // decides something rather than moving or drawing a sprite: AI orders, Objective/ship-capture
    // bookkeeping, and win/lose checks. None of it needs to be fresher than SLOW_TICK_INTERVAL_MS to
    // look or play right — every AI function here only ever issues an order to an enemy-controlled ship
    // (routeTowards already no-ops if that order hasn't actually changed), so a player's own orders are
    // never delayed waiting on this, and the 30-second Objective/ship-capture timers don't care which
    // particular second they're checked on. Splitting these out matters because they're the expensive
    // per-ship scans (nearest-hostile/nearest-Objective searches, sight-range checks) that don't need to
    // re-run 60 times a second just to re-confirm the same decision.
    runSlowTick = (time:number) => {
        this.updateHarvesterSupport(time)
        this.updateObjectives(time)
        this.updateShipCaptures(time)
        checkEnemyRaid(this)
        updateEnemyZel(this)
        updateEnemyGain(this)
        updateEnemyDrones(this)
        updateEnemyBeh(this)
        updateEnemyHusk(this)
        updateEnemyBlade(this)
        updateEnemyEscorts(this)
        updateEnemyCaptureEscape(this)
        this.resolvePendingCaptureEscape(time)
        this.resolvePendingMissionEnd(time)
        this.updateMissionObjectives()
    }

    // Phaser's Graphics has no native dashed-stroke option — strokeRect is always solid — so a dashed
    // rectangle is just four edges' worth of short line segments with gaps, drawn by hand. lineStyle is
    // whatever the caller already set; this only issues the actual segments.
    strokeDashedRect = (g:GameObjects.Graphics, x:number, y:number, w:number, h:number, dash:number = 2, gap:number = 3) => {
        const edges:Array<[number,number,number,number]> = [
            [x, y, x+w, y], [x+w, y, x+w, y+h], [x+w, y+h, x, y+h], [x, y+h, x, y],
        ]
        edges.forEach(([x1, y1, x2, y2]) => {
            const length = Phaser.Math.Distance.Between(x1, y1, x2, y2)
            const ux = (x2-x1)/length, uy = (y2-y1)/length
            for(let d=0; d<length; d += dash+gap){
                const segEnd = Math.min(d+dash, length)
                g.lineBetween(x1+ux*d, y1+uy*d, x1+ux*segEnd, y1+uy*segEnd)
            }
        })
    }

    // Shared by drawMinimap and its own click-to-recenter handling (enableSelectionControls) — the
    // minimap's own screen rect, in plain screen pixels (same space pointer.x/y are already in), so the
    // two can never drift apart on where the thing actually is/how big it looks on screen.
    getMinimapRect = () => {
        const cam = this.cameras.main
        return { originX: cam.width-MINIMAP_SIZE_PX-MINIMAP_MARGIN_PX, originY: MINIMAP_MARGIN_PX, size: MINIMAP_SIZE_PX }
    }

    // Toggled by 'M' (see enableSelectionControls) — the whole map's own coordinate space (its full
    // world width/height, not just whatever the camera currently frames) squashed into a fixed square
    // in the top-right corner. Screen-fixed (minimapG has setScrollFactor(0), which cancels the
    // camera's scroll but not its zoom — fixed at 2x, see create's setZoom): the camera still scales
    // everything around its own CENTER point by that zoom, scrollFactor or not, so a naive
    // g.setScale(1/zoom) alone only fixes sizes — it leaves a constant offset of center*(1-1/zoom)
    // pixels, which for a zoom of 2 is fully half the screen, easily enough to push the whole thing
    // off-canvas. Giving the object that same offset as its own position cancels that residual out too,
    // so a plain screen pixel like (originX, originY) below actually lands at (originX, originY) on
    // screen, whatever the zoom is.
    drawMinimap = (time:number) => {
        const g = this.minimapG
        g.clear()
        if(!this.minimapVisible) return

        const cam = this.cameras.main
        const zoomOffsetFactor = 1 - 1/cam.zoom
        g.setScale(1/cam.zoom).setPosition(cam.width/2*zoomOffsetFactor, cam.height/2*zoomOffsetFactor)
        const { originX, originY, size } = this.getMinimapRect()
        const worldW = this.mapData.width * CELL_SIZE, worldH = this.mapData.height * CELL_SIZE
        const toMinimap = (worldX:number, worldY:number) => ({
            x: originX + (worldX/worldW)*size,
            y: originY + (worldY/worldH)*size,
        })

        g.fillStyle(0x000000, 1)
        g.fillRect(originX, originY, size, size)
        g.lineStyle(2, GREEN_HEX, 1)
        this.strokeDashedRect(g, originX, originY, size, size)

        const { objectives } = useAppStore.getState()
        const flashOn = Math.floor(time/250) % 2 === 0
        this.mapData.objectives.forEach(spawn => {
            const objective = objectives.find(o => o.id === spawn.id)
            const beingCapturedByEnemy = objective?.capturingFaction === Faction.Enemy
            if(beingCapturedByEnemy && !flashOn) return
            const world = this.toWorld(spawn.x, spawn.y)
            const p = toMinimap(world.x, world.y)
            g.fillStyle(beingCapturedByEnemy ? RED_HEX : this.getObjectiveOwnerColor(objective?.owner ?? null), 1)
            g.fillCircle(p.x, p.y, 2)
        })

        const { resourceNodes } = useAppStore.getState()
        g.fillStyle(YELLOW_HEX, 1)
        resourceNodes.forEach(node => {
            const p = toMinimap(node.x, node.y)
            g.fillCircle(p.x, p.y, 1)
        })

        this.ships.forEach(ship => {
            if(!ship.visible) return
            const p = toMinimap(ship.x, ship.y)
            g.fillStyle(ship.faction === Faction.Player ? GREEN_HEX : RED_HEX, 1)
            g.fillCircle(p.x, p.y, ship.type === ShipType.CATH ? 2 : 1)
        })

        // Alert markers — an expanding ring, repeating every MINIMAP_PING_PULSE_MS, over any friendly
        // ship an enemy ZEL is actively capturing right now.
        this.ships.forEach(zel => {
            if(zel.type !== ShipType.ZEL || !zel.latchedShipId || !zel.shipCaptureAttached || zel.shipCaptureStartedAtMs === undefined) return
            const target = this.shipSprites.get(zel.latchedShipId)
            if(!target || target.faction !== Faction.Player) return

            const age = ((time - zel.shipCaptureStartedAtMs) % MINIMAP_PING_PULSE_MS) / MINIMAP_PING_PULSE_MS
            const p = toMinimap(target.x, target.y)
            g.lineStyle(1, RED_HEX, 1)
            g.strokeCircle(p.x, p.y, 1 + age*6)
        })

        // The camera's own current world-space view (cam.worldView already accounts for scroll/zoom),
        // squashed into minimap space the same as everything else here — a little box showing where
        // "on-screen right now" actually is within the whole map. Clamped to the minimap's own square
        // (centerCameraBounds lets the camera scroll a bit past the map's actual edges) so this box
        // never draws outside it.
        const view = cam.worldView
        const viewTopLeft = toMinimap(view.x, view.y)
        const viewBottomRight = toMinimap(view.x+view.width, view.y+view.height)
        const clampedX1 = PhaserMath.Clamp(viewTopLeft.x, originX, originX+size)
        const clampedY1 = PhaserMath.Clamp(viewTopLeft.y, originY, originY+size)
        const clampedX2 = PhaserMath.Clamp(viewBottomRight.x, originX, originX+size)
        const clampedY2 = PhaserMath.Clamp(viewBottomRight.y, originY, originY+size)
        g.lineStyle(2, YELLOW_HEX, 1)
        this.strokeDashedRect(g, clampedX1, clampedY1, clampedX2-clampedX1, clampedY2-clampedY1)
    }

    drawPing = (g:GameObjects.Graphics, x:number, y:number, time:number, startedAtMs:number,
        color:number = RED_HEX, minRadius:number = 20, maxRadius:number = 80, pulseMs:number = MINIMAP_PING_PULSE_MS) => {
        const age = ((time - startedAtMs) % pulseMs) / pulseMs
        g.lineStyle(2, color, 1)
        g.strokeCircle(x, y, minRadius + age*(maxRadius-minRadius))
    }

    // Both mission-end reveals (startCaptureEscapeReveal/startMissionEndReveal) share activePingG — they
    // can never both be live at once (the mission can only end one way), so this clears it once and
    // draws whichever (if either) is actually pending, rather than each having its own draw function
    // separately clear the same layer and risk one wiping out the other's ring on the same frame.
    drawActivePing = (time:number) => {
        const g = this.activePingG
        g.clear()

        if(this.captureEscapePingActive && this.pendingCaptureEscapePortalPos && this.pendingCaptureEscapeRevealAtMs !== undefined){
            this.drawPing(g, this.pendingCaptureEscapePortalPos.x, this.pendingCaptureEscapePortalPos.y, time, this.pendingCaptureEscapeRevealAtMs)
            return
        }

        if(this.missionEndPingActive && this.pendingMissionEndRevealAtMs !== undefined && this.pendingMissionEndX !== undefined && this.pendingMissionEndY !== undefined){
            this.drawPing(g, this.pendingMissionEndX, this.pendingMissionEndY, time, this.pendingMissionEndRevealAtMs, this.pendingMissionEndWon ? GREEN_HEX : RED_HEX)
        }
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
        g.fillStyle(color, 1)
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
            const footprint = this.getShipFootprintRadiusPx(s.type)
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
            const footprint = this.getShipFootprintRadiusPx(s.type)
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
        const label = this.add.text(x, y, text, { fontFamily:'Body', fontSize:MAP_FONT_SIZE, color:colors.green }).setOrigin(0.5).setDepth(5).setResolution(LABEL_TEXT_RESOLUTION)
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

            // Only a Base's own queue is paid for in Machine Relics — a DRN's queue (see queueDrnBuild)
            // is already paid for up front, in its own ammo, regardless of which of KKZ/EYE/HUSK it was
            // ordered to build; gating it on relics too would double-charge (and outright block building
            // EYE/HUSK from a DRN, both of which do carry a nonzero relicCost for their normal
            // Base-built case) something that was never meant to touch the relic pool at all.
            if(ship.type === ShipType.CATH){
                const relicCost = getShipRelicCost(item.type)
                const relicsAvailable = useAppStore.getState().machineRelics[ship.faction] ?? 0
                if(relicsAvailable < relicCost) return
                useAppStore.getState().addMachineRelics(ship.faction, -relicCost)
            }

            this.completeQueueItem(ship.id)
            this.spawnShip(ship, item.type)
        })
    }

    // Places a newly completed ship near its Base (or DRN, for whichever type it just finished building),
    // trying to avoid overlapping other loitering ships.
    spawnShip = (base:ShipSprite, type:ShipType) => {
        const center = { x:base.x, y:base.y }
        const footprint = this.getShipFootprintRadiusPx(type)
        let pos = center

        for(let attempt=0; attempt<40; attempt++){
            const radius = CELL_SIZE*1.5 + attempt*4
            const angle = Math.random()*Math.PI*2
            const candidate = { x: center.x+Math.cos(angle)*radius, y: center.y+Math.sin(angle)*radius }
            const overlapsShip = this.ships.some(s => {
                const minDist = footprint + this.getShipFootprintRadiusPx(s.type) + 12
                return Phaser.Math.Distance.Between(candidate.x, candidate.y, s.x, s.y) < minDist
            })
            if(!overlapsShip){ pos = candidate; break }
        }

        // An EYE built by a DRN comes with a mandatory launch destination, picked by the player before
        // the build was even queued (see ShipSprite's own pendingEyeDestination doc comment) — it flies
        // there under its own power same as any other fly-out ship, then just goes idle and stays put
        // once it arrives (nothing else ever gives an EYE further orders — see handleClick's own
        // orderableIds exclusion). An EYE built straight off a Base's own relic-cost menu instead has no
        // such destination and spawns in place like any other Base-built ship, immobile from the moment
        // it appears.
        const eyeDestination = base.type === ShipType.DRN ? base.pendingEyeDestination : undefined
        if(base.type === ShipType.DRN) base.pendingEyeDestination = undefined

        const flyOut = base.type === ShipType.DRN && (type !== ShipType.EYE || !!eyeDestination)
        const ship = this.createShipSprite(v4(), base.faction, type, flyOut ? center.x : pos.x, flyOut ? center.y : pos.y)
        if(type === ShipType.EYE && eyeDestination) ship.waypoints = [eyeDestination]
        else if(flyOut) ship.waypoints = [this.toGrid(pos.x, pos.y)]
        this.syncShipSummaries()
    }

    // Every ship (both factions' Bases included) and every Objective/Asteroid comes straight off the
    // loaded map file's own entities layer.
    spawnEntitiesFromMap = () => {
        const map = this.make.tilemap({ key: this.mapKey })
        const layer = map.getLayer('entities')
        if(!layer) return

        // Veteran ships retain their campaign identity but enter at this map's authored spawn points.
        // A slot consumes one matching type; unmatched veterans remain available for a later map.
        const campaign = useAppStore.getState().mySave
        const remainingVeterans = [...(campaign?.veteranShips ?? [])]
        const takeVeteran = (type:ShipType) => {
            const index = remainingVeterans.findIndex(veteran => veteran.type === type)
            return index < 0 ? undefined : remainingVeterans.splice(index, 1)[0]
        }

        const firstgid = map.tilesets[0]?.firstgid ?? 1

        for(let ty=0; ty<layer.height; ty++){
            for(let tx=0; tx<layer.width; tx++){
                const tile = layer.data[ty][tx]
                if(!tile || tile.index <= 0) continue
                const localIndex = tile.index - firstgid

                const baseFaction = ([Faction.Player, Faction.Enemy] as Array<Faction>).find(f => BASE_SPRITE_INDEX[f] === localIndex)
                if(baseFaction){
                    const { x, y } = this.toWorld(tx, ty)
                    const base = this.createShipSprite(v4(), baseFaction, ShipType.CATH, x, y,
                        baseFaction === Faction.Player ? takeVeteran(ShipType.CATH) : undefined)
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
                    this.createShipSprite(v4(), faction, type, x, y,
                        faction === Faction.Player ? takeVeteran(type) : undefined)
                    if(faction == Faction.Player && shipTypeKey === ShipType.CATH){
                        this.cameras.main.pan(x,y)
                    }
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

                if(NebulaResource[localIndex]){
                    const { x, y } = this.toWorld(tx, ty)
                    this.nebulaSprites.push(this.add.image(x,y,NebulaResource[localIndex]).setDepth(1))
                }

                if(localIndex === PortalSpriteIndex){
                    const spawn:PortalSpawn = { id:v4(), x:tx, y:ty }
                    this.mapData.portals.push(spawn)
                    this.createPortalSprite(spawn)
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
        // potentially dozens of ships, and nothing needs to see them appear one at a time. Keep the
        // roster in the save while this map is active, so reloading mid-map deploys the same veterans.
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

    createPortalSprite = (spawn:PortalSpawn) => {
        const { x, y } = this.toWorld(spawn.x, spawn.y)
        this.portalSprites.set(spawn.id, this.add.image(x, y, 'tiles', PortalSpriteIndex).setDepth(2))
    }

    // Portal entry is cell-based, exactly matching the entity tile authored on the map. A CAPTURE_ESCAPE
    // ZEL reaching one doesn't escape outright — see startCaptureEscapeReveal — everything else escapes
    // immediately, same as always.
    updatePortals = () => {
        if(this.mapData.portals.length === 0) return
        this.ships.forEach(ship => {
            const cell = this.toGrid(ship.x, ship.y)
            const portal = this.mapData.portals.find(p => p.x === cell.x && p.y === cell.y)
            if(!portal) return
            const portalPos = this.toWorld(portal.x, portal.y)
            if(ship.faction === Faction.Enemy && enemyOrderFor(this, ship) === OrderType.CAPTURE_ESCAPE){
                this.startCaptureEscapeReveal(ship, portalPos)
                return
            }
            this.escapeShip(ship.id, portalPos)
        })
    }

    // Holds a CAPTURE_ESCAPE ZEL back from actually escaping (and the defeat that would trigger) the
    // instant it reaches a Portal — instead the camera pans over to (and pings) the Portal itself, the
    // same place any other escape's own reveal centers on (see startMissionEndReveal), while fog-of-war
    // is forced off for the still-live ship (see updateFogOfWar) for MISSION_END_REVEAL_MS, so the player
    // actually gets to see what's slipping away before the mission ends. A no-op if one's already pending
    // (only ever one at a time — the first to reach a Portal is the one that plays out; any others just
    // sit there on top of it, already at their own destination, until this one resolves).
    startCaptureEscapeReveal = (ship:ShipSprite, portalPos:{x:number,y:number}) => {
        if(this.pendingCaptureEscapeShipId) return
        this.pendingCaptureEscapeShipId = ship.id
        this.pendingCaptureEscapePortalPos = portalPos
        this.pendingCaptureEscapeRevealAtMs = this.time.now
        this.captureEscapePingActive = false
        this.cameras.main.pan(portalPos.x, portalPos.y, 800, 'Sine.easeInOut', true, (_camera, progress) => {
            if(progress === 1) this.captureEscapePingActive = true
        })
    }

    resolvePendingCaptureEscape = (time:number) => {
        if(!this.pendingCaptureEscapeShipId || this.pendingCaptureEscapeRevealAtMs === undefined) return
        if(time - this.pendingCaptureEscapeRevealAtMs < MISSION_END_REVEAL_MS) return
        const id = this.pendingCaptureEscapeShipId
        const portalPos = this.pendingCaptureEscapePortalPos
        this.pendingCaptureEscapeShipId = undefined
        this.pendingCaptureEscapePortalPos = undefined
        this.pendingCaptureEscapeRevealAtMs = undefined
        this.captureEscapePingActive = false
        this.escapeShip(id, portalPos)
        this.endMission(false)
    }

    escapeShip = (id:string, portalPos?:{x:number,y:number}) => {
        const ship = this.shipSprites.get(id)
        if(!ship) return
        if(this.missionShips.has(id)) this.escapedMissionShipIds.add(id)
        if(portalPos) this.lastEscapedShipPortalPosition = portalPos
        if(ship.faction === Faction.Player) this.escapedVeterans.push(ship.toVeteran())
        this.destroyShipSprite(id, 'escaped')
        this.syncShipSummaries()
    }

    getObjectiveOwnerColor = (owner:Faction | null) => owner === Faction.Player ? GREEN_HEX : owner === Faction.Enemy ? RED_HEX : YELLOW_HEX

    createObjectiveSprite = (spawn:ObjectiveSpawn) => {
        const { x, y } = this.toWorld(spawn.x, spawn.y)
        const sprite = this.add.image(x, y, 'tiles', ObjectiveSpriteIndex[spawn.sprite]).setDepth(2)
        this.objectiveSprites.set(spawn.id, sprite)

        const label = this.add.text(x, y + OBJECTIVE_ICON_SIZE*0.5 + 4, spawn.sprite, { stroke:'#000000', strokeThickness:4, fontFamily:'Body', fontSize:MAP_FONT_SIZE, color:colors.green }).setOrigin(0.5, 0).setDepth(2).setResolution(LABEL_TEXT_RESOLUTION)
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

            // Whoever's actually nearby, regardless of whether they've got armor attached — this is
            // purely for the CONTESTED label below, separate from contestingFaction's own stricter
            // "uncontested hold" definition just below it.
            const nearbyFactions = new Set(ships
                .filter(s => Phaser.Math.Distance.Between(x, y, s.x, s.y) <= OBJECTIVE_CAPTURE_RADIUS_PX)
                .map(s => s.faction))
            this.objectiveLabels.get(objective.id)?.setText(nearbyFactions.size >= 2 ? 'CONTESTED' : spawn.sprite)

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
            if(objective.owner === null) useAppStore.getState().addMachineRelics(contestingFaction, 1)
            return { ...objective, owner: contestingFaction }
        })

        if(changed) setObjectives(updated)

    }

    // Victory conditions are conjunctive; a single defeat condition ends the mission. Either way the
    // actual ending is deferred to startMissionEndReveal rather than called directly — see its own
    // comment for why, and for CAPTURE_ESCAPE's own separate, richer version of the same idea.
    updateMissionObjectives = () => {
        if(this.gameOver || this.pendingMissionEndWon !== undefined) return
        const metadata = MAP_METADATA[this.mapKey]
        if(metadata.defeat.conditions.some(condition => this.isConditionMet(condition))) return this.startMissionEndReveal(false)
        if(metadata.victory.conditions.every(condition => this.isConditionMet(condition))){
            // An ALL_SHIPS_ESCAPED victory centers its reveal on the Portal the fleet left through,
            // not on whatever mission ship happened to die most recently (startMissionEndReveal's own
            // default) — see its own comment.
            const escaped = metadata.victory.conditions.some(condition => condition.type === ObjectiveType.ALL_SHIPS_ESCAPED)
            this.startMissionEndReveal(true, escaped ? this.lastEscapedShipPortalPosition : undefined)
        }
    }

    isConditionMet = (condition:MapCondition) => {
        const targets = [...this.missionShips.entries()]
        // Bases are stationary infrastructure, not extractable fleet units. They can still be named
        // explicitly in a typed destroy/lose condition.
        const mobileTargets = targets.filter(([, ship]) => ship.type !== ShipType.CATH && ship.type !== ShipType.EYE)
        const units = new Set(condition.units ?? [])
        const matching = (faction:Faction, requireUnits:boolean) => targets.filter(([, ship]) =>
            ship.faction === faction && (!requireUnits || units.has(ship.type)))
        const allDestroyed = (ships:Array<[string, { faction:Faction, type:ShipType }]>) =>
            ships.length > 0 && ships.every(([id]) => this.destroyedMissionShipIds.has(id))
        const allEscaped = (ships:Array<[string, { faction:Faction, type:ShipType }]>) =>
            ships.length > 0 && ships.every(([id]) => this.escapedMissionShipIds.has(id))

        switch(condition.type){
            case ObjectiveType.DESTROY_SHIPS: return allDestroyed(matching(Faction.Enemy, true))
            case ObjectiveType.LOSE_ALL_UNITS: return allDestroyed(mobileTargets.filter(([, ship]) => ship.faction === Faction.Player))
            // EYE effectively never reaches a Portal under its own steam (see moveShips' own comment —
            // its only possible route is a one-shot DRN launch destination, never a player-given escape
            // order) and CATH is already excluded via mobileTargets — neither is excluded here as a
            // special case so much as never actually escaping in practice, but they're filtered out
            // explicitly anyway rather than leaving an escape objective impossible to complete whenever
            // either happens to be in the mission. A ship already in destroyedMissionShipIds is excluded
            // too, for the same reason but the other way round — it's just as permanently unable to ever
            // also land in escapedMissionShipIds (the two sets are mutually exclusive, see
            // destroyShipSprite/escapeShip), so requiring it here would make the objective impossible to
            // complete the instant any single ship died, no matter how many others actually made it out.
            case ObjectiveType.ALL_SHIPS_ESCAPED: return allEscaped(mobileTargets.filter(([id, ship]) => ship.faction === Faction.Player && !this.destroyedMissionShipIds.has(id)))
            case ObjectiveType.LOSE_UNITS: return allDestroyed(matching(Faction.Player, true))
            case ObjectiveType.CAPTURE_OBJECTIVES: return this.allObjectivesOwnedBy(Faction.Player)
            case ObjectiveType.LOSE_OBJECTIVES: return this.allObjectivesOwnedBy(Faction.Enemy)
            // A single target breaking through is enough to fail an enemy-escape objective.
            case ObjectiveType.ENEMY_SHIPS_ESCAPED:
                return matching(Faction.Enemy, true).some(([id]) => this.escapedMissionShipIds.has(id))
            default: return false
        }
    }

    allObjectivesOwnedBy = (faction:Faction) => {
        const objectives = useAppStore.getState().objectives
        return objectives.length > 0 && objectives.every(objective => objective.owner === faction)
    }

    endMission = (won:boolean) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        if(won) this.promoteSurvivingShips()
        onShowModal(won ? Modal.Victory : Modal.Defeat)
    }

    // Holds any victory/defeat outcome back from actually ending the mission — pans to and pings wherever
    // it actually happened, for MISSION_END_REVEAL_MS, so the player gets a moment to actually see what
    // just decided the match — same idea as startCaptureEscapeReveal's own separate version of this for
    // CAPTURE_ESCAPE specifically (which needs to reveal a still-*live* ship instead, hence its own
    // mechanism). Defaults to wherever the mission-relevant ship that died most recently ended up
    // (lastDestroyedShipPosition, set by destroyShipSprite) — updateMissionObjectives passes
    // lastEscapedShipPortalPosition instead for an ALL_SHIPS_ESCAPED victory, so that reveal centers on
    // the Portal the fleet actually left through rather than wherever some earlier casualty happened to
    // fall. Falls back to ending immediately, no reveal, if there's simply nothing to point the camera at
    // (e.g. a LOSE_OBJECTIVES defeat with no ship ever destroyed this match).
    startMissionEndReveal = (won:boolean, posOverride?:{x:number,y:number}) => {
        const pos = posOverride ?? this.lastDestroyedShipPosition
        if(!pos) return this.endMission(won)
        this.pendingMissionEndWon = won
        this.pendingMissionEndRevealAtMs = this.time.now
        this.pendingMissionEndX = pos.x
        this.pendingMissionEndY = pos.y
        this.missionEndPingActive = false
        this.cameras.main.pan(pos.x, pos.y, 800, 'Sine.easeInOut', true, (_camera, progress) => {
            if(progress === 1) this.missionEndPingActive = true
        })
    }

    // Called from runSlowTick — completes whatever startMissionEndReveal started, once its own
    // MISSION_END_REVEAL_MS has actually elapsed.
    resolvePendingMissionEnd = (time:number) => {
        if(this.pendingMissionEndWon === undefined || this.pendingMissionEndRevealAtMs === undefined) return
        if(time - this.pendingMissionEndRevealAtMs < MISSION_END_REVEAL_MS) return
        const won = this.pendingMissionEndWon
        this.pendingMissionEndWon = undefined
        this.pendingMissionEndRevealAtMs = undefined
        this.pendingMissionEndX = undefined
        this.pendingMissionEndY = undefined
        this.missionEndPingActive = false
        this.endMission(won)
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
            const barX = x - w/2, barY = y - OBJECTIVE_ICON_SIZE*0.5 - 20 - h
            this.drawBar(g, barX, barY, w, h, percent, color)
        })

        // Ship boarding has no static map entity to anchor to. Draw its indicator from the target's
        // live sprite instead, so the yellow bar travels with the ship being captured rather than the
        // ZEL doing the capturing.
        this.ships.filter(zel => zel.type === ShipType.ZEL && zel.shipCaptureAttached
            && zel.shipCaptureStartedAtMs !== undefined && zel.latchedShipId).forEach(zel => {
            const target = this.shipSprites.get(zel.latchedShipId)
            if(!target) return

            const percent = PhaserMath.Clamp((time-zel.shipCaptureStartedAtMs) / ZEL_SHIP_CAPTURE_TIME_MS, 0, 1)
            const w = Math.max(OBJECTIVE_ICON_SIZE, target.displayWidth)
            const h = 4
            const barX = target.x - w/2
            const barY = target.y - target.displayHeight/2 - h - 4
            this.drawBar(g, barX, barY, w, h, percent, YELLOW_HEX)
        })
    }

    handleBaseDestroyed = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        if(faction === Faction.Enemy) this.promoteSurvivingShips()
        onShowModal(faction === Faction.Player ? Modal.Defeat : Modal.Victory)
    }

    updateFogOfWar = () => {
        this.ships.filter(s => s.faction === Faction.Enemy).forEach(s => {
            // Forced visible regardless of sight range for as long as it's the ship
            // startCaptureEscapeReveal is currently revealing — see its own comment.
            s.setVisible(s.id === this.pendingCaptureEscapeShipId || this.isWithinFactionSightRange(s.x, s.y, Faction.Player))
        })
    }

    drawStrikeTargets = () => {
        const g = this.strikeTargetsG
        g.clear()
        const targetingShipId = useAppStore.getState().targetingShipId
        const targetingStl = targetingShipId ? this.shipSprites.get(targetingShipId) : undefined
        if(!targetingStl) return

        const strikeRangePx = ShipData[ShipType.STL].rangePx
        g.lineStyle(1, YELLOW_HEX, 1)
        this.ships.filter(s => s.faction === Faction.Enemy && s.visible).forEach(s => {
            if(Phaser.Math.Distance.Between(targetingStl.x, targetingStl.y, s.x, s.y) > strikeRangePx) return
            const r = Math.max(this.getShipFootprintRadiusPx(s.type), 10) + 4
            g.strokeCircle(s.x, s.y, r)
        })
    }

    updateShipLabels = () => {
        const { selectedShipIds } = useAppStore.getState()
        this.shipLabels.forEach((label, id) => {
            label.setVisible(selectedShipIds.includes(id) && !!this.shipSprites.get(id)?.visible)
        })
    }

    createShipSprite = (id:string, faction:Faction, type:ShipType, x:number, y:number, veteran?:VeteranShip):ShipSprite => {
        const isFriend = faction === Faction.Player
        // A real baked enemy-colored texture (see generateHostileShipTexture), not a tint — setTint
        // multiplies against whatever colors are already in the art, which for a sprite already using
        // more than one palette color (black outline, green hull, yellow highlight) produces off-palette
        // blends rather than a clean recolor. CATH (Base) has its own bespoke enemy texture instead.
        const textureKey = isFriend ? type : (type === ShipType.CATH ? 'base_enemy' : type+'_enemy')
        const ship = new ShipSprite(this, x, y, textureKey, id, faction, type, veteran)
        this.add.existing(ship)
        this.physics.add.existing(ship)
        this.centerCircleBody(ship)
        ship.setData('kind', 'ship' as BodyKind)
        ship.setData('id', id)
        this.shipsGroup.add(ship)
        this.shipSprites.set(id, ship)
        this.shipsCache = null
        // Every ship that ever exists — not just the ones the map spawns at mission start, but anything
        // built afterward too (a Base/DRN completing its queue also routes through here) — registers
        // itself the instant it's created, so isConditionMet's own mobileTargets (derived from this map)
        // always reflects the mission's full roster instead of going stale the moment a fresh ship gets
        // built mid-mission.
        this.missionShips.set(id, { faction, type })

        const label = this.add.text(x, y-this.shipLabelOffsetPx(ship), type.toUpperCase(), { fontFamily:'Body', fontSize:MAP_FONT_SIZE, color: colors.green }).setOrigin(0.5).setDepth(4).setVisible(false).setResolution(LABEL_TEXT_RESOLUTION)
        this.shipLabels.set(id, label)

        if(ShipData[type].ammo){
            const ammoLabel = this.add.text(x, y, String(ship.ammoRemaining ?? 0), { fontFamily:'Body', fontSize:MAP_FONT_SIZE, color:colors.yellow }).setOrigin(1, 0).setDepth(4).setVisible(false).setResolution(LABEL_TEXT_RESOLUTION)
            this.ammoLabels.set(id, ammoLabel)
        }

        if(!isFriend) ship.setVisible(false)
        return ship
    }

    shipLabelOffsetPx = (sprite:Physics.Arcade.Sprite) => sprite.displayHeight/2 + SHIP_LABEL_GAP_PX

    destroyShipSprite = (id:string, reason:'destroyed'|'escaped' = 'destroyed') => {
        this.releaseShipCapture(id)
        if(reason === 'destroyed' && this.missionShips.has(id)){
            this.destroyedMissionShipIds.add(id)
            // Captured before the sprite's actually destroyed below — see startMissionEndReveal, which
            // reads this the moment a victory/defeat condition this death just completed is detected.
            const dyingShip = this.shipSprites.get(id)
            if(dyingShip) this.lastDestroyedShipPosition = { x:dyingShip.x, y:dyingShip.y }
        }
        this.shipSprites.get(id)?.destroy()
        this.shipSprites.delete(id)
        this.shipsCache = null
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

    // A type's own real footprint radius, off its texture's actual pixel dimensions — the smaller of
    // width/height, same measure centerCircleBody already uses for the physics body itself, so a
    // selection ring/hitbox/spacing check derived from this always agrees with what actually collides.
    // Cached per type since it never changes once the texture's loaded; friendly and enemy textures for
    // a type are always identical dimensions (the enemy one is a straight pixel recolor), so this is
    // asked for off the plain type key regardless of which faction's ship it's for.
    getShipFootprintRadiusPx = (type:ShipType) => {
        let radius = this.shipFootprintRadiusPx.get(type)
        if(radius !== undefined) return radius
        const source = this.textures.get(type).getSourceImage() as HTMLImageElement | HTMLCanvasElement
        radius = Math.min(source.width, source.height) / 2
        this.shipFootprintRadiusPx.set(type, radius)
        return radius
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
    killIfDead = (ship:ShipSprite, killer?:ShipSprite) => {
        if(ship.isAlive()) return false
        if(killer && killer.faction !== ship.faction) killer.killCount++
        this.spawnDeathFragments(ship)
        const wasBase = ship.type === ShipType.CATH
        const faction = ship.faction
        this.destroyShipSprite(ship.id)
        this.syncShipSummaries()
        if(wasBase) this.handleBaseDestroyed(faction)
        return true
    }

    // Winning a map promotes every survivor. The player fleet is then snapshotted for the next map's
    // authored player spawn slots; enemy survivors are not carried across the campaign.
    promoteSurvivingShips = () => {
        this.ships.forEach(ship => ship.rank++)
        const veterans = [...this.escapedVeterans, ...this.ships
            .filter(ship => ship.faction === Faction.Player)
            .map(ship => ship.toVeteran())]
        const state = useAppStore.getState()
        const campaign:SaveFile = {
            currentMap: this.mapKey,
            completedMaps: state.mySave?.completedMaps.includes(this.mapKey)
                ? state.mySave.completedMaps
                : [...(state.mySave?.completedMaps ?? []), this.mapKey],
            veteranShips: veterans,
            buildableTypes: state.mySave?.buildableTypes ?? [...DEFAULT_BUILDABLE],
        }
        state.setSave(campaign)
        saveFile(campaign)
        this.syncShipSummaries()
    }

    // Pushes a fresh low-frequency summary of every ship into the store — see ShipSummary's own doc
    // comment for why this only ever happens on a discrete event (spawn/death/queue change), never on a
    // physics tick.
    syncShipSummaries = () => {
        useAppStore.getState().setShips(this.ships.map(s => s.toSummary()))
    }

    // Ends a ZEL boarding action from either side.  This is called before either participant is
    // destroyed and when a player gives the ZEL a new order, so a disabled target is never left stuck.
    releaseShipCapture = (shipId:string) => {
        const ship = this.shipSprites.get(shipId)
        if(!ship) return
        if(ship.type === ShipType.ZEL && ship.latchedShipId){
            const target = this.shipSprites.get(ship.latchedShipId)
            if(target?.latchedByZelId === ship.id) target.latchedByZelId = undefined
            ship.latchedShipId = undefined
            ship.shipCaptureAttached = undefined
            ship.shipCaptureStartedAtMs = undefined
        }
        if(ship.latchedByZelId){
            const zel = this.shipSprites.get(ship.latchedByZelId)
            if(zel?.latchedShipId === ship.id){
                zel.latchedShipId = undefined
                zel.shipCaptureAttached = undefined
                zel.shipCaptureStartedAtMs = undefined
            }
            ship.latchedByZelId = undefined
        }
    }

    isShipAttackDisabled = (ship:ShipSprite) => !!ship.latchedByZelId

    updateShipCaptures = (time:number) => {
        this.ships.filter(zel => zel.type === ShipType.ZEL && zel.latchedShipId).forEach(zel => {
            const target = this.shipSprites.get(zel.latchedShipId)
            if(!target || target.faction === zel.faction || target.latchedByZelId !== zel.id || !zel.shipCaptureAttached){
                this.releaseShipCapture(zel.id)
                return
            }
            if(zel.shipCaptureStartedAtMs === undefined) zel.shipCaptureStartedAtMs = time
            if(time - zel.shipCaptureStartedAtMs < ZEL_SHIP_CAPTURE_TIME_MS) return

            // A converted ship starts idle under its new faction.  Its existing route belonged to the
            // previous owner, so retaining it would immediately send it on an enemy-issued order.
            target.faction = zel.faction
            target.waypoints = []
            target.pathIndex = 0
            target.orderSpeedPxS = undefined
            target.setTexture(target.faction === Faction.Player ? target.type : target.type+'_enemy')
            // Only meaningful for a ship under CAPTURE_ESCAPE (see AIPlayers' own updateEnemyCaptureEscape,
            // which reads this to switch from hunting a ship to running for the nearest Portal) — never
            // set for anything else, so a player-controlled ZEL can still capture any number of ships.
            if(enemyOrderFor(this, zel) === OrderType.CAPTURE_ESCAPE) zel.captureEscapeDone = true
            // From here on the captured ship escorts its captor — same escortAssignments AIPlayers'
            // assignZelEscorts/escortZel already drive BEH/HUSK/BLADE through, just assigned directly
            // here instead of picked by that function's own nearest-idle-eligible-ship search. Enemy-only:
            // there's no AI at all driving a Player-faction ship's movement (the player just orders it
            // manually, same as anything else they own), so this would be a no-op assignment for a
            // player-controlled ZEL's own captures anyway.
            if(target.faction === Faction.Enemy) this.escortAssignments.set(target.id, zel.id)
            // The flip side, for the player's own ZEL: capturing a type they can't already build unlocks
            // it into their save's buildableTypes for good, the same permanent-progress way a promoted
            // veteran or a completed map is recorded — see FactoryToolbar's own build list, which is
            // filtered down to just this collection.
            if(target.faction === Faction.Player){
                const state = useAppStore.getState()
                if(state.mySave && !state.mySave.buildableTypes.includes(target.type)){
                    const updatedSave:SaveFile = { ...state.mySave, buildableTypes: [...state.mySave.buildableTypes, target.type] }
                    state.setSave(updatedSave)
                    saveFile(updatedSave)
                }
            }
            this.releaseShipCapture(zel.id)
            this.syncShipSummaries()
        })
    }

    // Advances every ship one step towards its own route (see ShipSprite's waypoints/pathIndex), then
    // sits idle at the end of it — except ZEL, which instead heads for and latches onto a capturable
    // Objective the instant it's in range (overriding its route entirely while latched), and GAIN, which
    // orbits whichever Asteroid updateHarvesterMiningTargets assigned it. EYE isn't specially locked out
    // of moving here at all — it's just never given more than a single route (its mandatory launch
    // destination if built by a DRN, see spawnShip, or none at all otherwise) since handleClick's own
    // orderableIds exclusion means nothing ever hands it a second one, so it naturally goes idle and
    // stays a fixed sentry, huge sightRadius and all, the instant that one route (if any) runs out.
    moveShips = (time:number, deltaMs:number) => {
        const { resourceNodes, objectives } = useAppStore.getState()
        const arrivedBoms:Array<ShipSprite> = []

        this.ships.forEach(ship => {
            const ownWaypoints = ship.waypoints
            const waypoints = ship.type === ShipType.BOM ? ownWaypoints.slice(0, 1) : ownWaypoints
            const pathIndex = ship.pathIndex
            const speed = ship.orderSpeedPxS ?? ShipData[ship.type].speed
            const step = speed * (deltaMs/1000)

            const movementLocked = !!ship.latchedByZelId
            const idle = movementLocked || pathIndex >= waypoints.length
            const miningNodeId = this.harvesterMiningTarget.get(ship.id)
            const miningNode = miningNodeId ? resourceNodes.find(n => n.id === miningNodeId) : undefined

            let latchedObjectiveId = ship.latchedObjectiveId
            let latchedObjectiveWorld:{x:number,y:number} | undefined
            let latchedShip = ship.latchedShipId ? this.shipSprites.get(ship.latchedShipId) : undefined
            if(ship.type === ShipType.ZEL){
                if(latchedShip && (latchedShip.faction === ship.faction || latchedShip.latchedByZelId !== ship.id)){
                    this.releaseShipCapture(ship.id)
                    latchedShip = undefined
                }
                if(latchedObjectiveId){
                    const held = objectives.find(o => o.id === latchedObjectiveId)
                    if(!held || held.owner === ship.faction) latchedObjectiveId = undefined
                }
                // Only ever auto-latches onto something new while idle (no live order of its own) — a
                // ZEL just handed a fresh order (see setShipWaypoints etc., which clear both latch
                // fields the instant a new order comes in) is very likely still standing inside the
                // capture radius of whatever it was just pulled off of, since it hasn't had time to
                // actually move away yet. Without this, it would just re-latch onto that same
                // objective/ship right back on this very frame, making "disengage and move towards the
                // order" impossible. An idle ZEL auto-latching onto whatever it's simply standing next to
                // is still exactly the old behavior.
                // Deliberately NOT gated on `idle`, unlike the Objective auto-latch just below — a ship
                // target moves, so AIPlayers' updateEnemyZel/updateEnemyCaptureEscape re-route toward it
                // (routeTowards -> setShipWaypoints) every time it crosses into a new grid cell, which
                // for an actively-moving target can mean this ZEL rarely if ever goes idle before it's
                // re-routed again. Requiring idle here meant it could get right up next to its target and
                // just never actually latch — CAPTURE_ESCAPE (and ordinary ZEL ship-boarding) chasing a
                // moving hostile ship, effectively never boarding it. avoidLatchId (see disengageZelLatch)
                // already covers the "don't immediately re-latch onto the exact thing a new order just
                // pulled this ZEL off of" case idle was originally added for, so it isn't needed here too.
                if(!latchedObjectiveId && !latchedShip){
                    latchedShip = this.ships
                        .filter(candidate => candidate.type !== ShipType.CATH && candidate.faction !== ship.faction && !candidate.latchedByZelId && candidate.id !== ship.avoidLatchId)
                        .filter(candidate => Phaser.Math.Distance.Between(ship.x, ship.y, candidate.x, candidate.y) <= ZEL_SHIP_CAPTURE_RADIUS_PX)
                        .sort((a, b) => Phaser.Math.Distance.Between(ship.x, ship.y, a.x, a.y) - Phaser.Math.Distance.Between(ship.x, ship.y, b.x, b.y))[0]
                    if(latchedShip){
                        ship.latchedShipId = latchedShip.id
                        latchedShip.latchedByZelId = ship.id
                    }
                }
                if(!latchedObjectiveId && !latchedShip && idle){
                    const spawn = this.mapData.objectives.find(sp => {
                        if(sp.id === ship.avoidLatchId) return false
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
            if(latchedShip){
                target = { x:latchedShip.x, y:latchedShip.y }
            }
            else if(latchedObjectiveWorld){
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
            const nextPathIndex = (!miningNode && !latchedObjectiveWorld && !latchedShip && !movementLocked && waypoints.length > 0 && pathIndex < waypoints.length) ? pathIndex+1 : pathIndex
            const arrivedAtRouteEnd = nextPathIndex !== pathIndex && nextPathIndex >= waypoints.length

            // A plain route waypoint (not a mining orbit or latched Objective — see
            // WAYPOINT_ARRIVAL_RADIUS_PX's own comment) counts as reached from anywhere within this
            // wider dead zone, not just the exact pixel, so a clump of ships routed to the same point
            // settles instead of vibrating against applyShipSeparation forever.
            const arrivalRadius = (miningNode || latchedObjectiveWorld || latchedShip) ? 0 : WAYPOINT_ARRIVAL_RADIUS_PX
            const arrived = dist <= Math.max(step, arrivalRadius)

            if(dist <= step){
                ship.setPosition(target.x, target.y)
                ship.setVelocity(0, 0)
            }
            else if(arrived){
                ship.setVelocity(0, 0)
            }
            else {
                this.physics.moveTo(ship, target.x, target.y, speed)
            }

            // Idle ships just hold whatever heading they last had — no north-facing idle animation.
            if(ship.type !== ShipType.CATH && (!!miningNode || !!latchedObjectiveWorld || !!latchedShip || !idle)){
                const desiredRotation = Phaser.Math.Angle.Between(prevX, prevY, target.x, target.y) + Math.PI/2
                const turnRatePerMs = speed * MOVE_TURN_RATE_PER_SPEED_PX_S
                ship.setRotation(Phaser.Math.Angle.RotateTo(ship.rotation, desiredRotation, Math.min(1, turnRatePerMs*deltaMs)))
            }

            this.shipLabels.get(ship.id)?.setPosition(ship.x, ship.y-this.shipLabelOffsetPx(ship))

            if(ship.type === ShipType.BOM && arrivedAtRouteEnd && arrived) arrivedBoms.push(ship)

            ship.objectiveAttached = !!latchedObjectiveWorld && arrived
            ship.latchedObjectiveId = latchedObjectiveId
            ship.shipCaptureAttached = !!latchedShip && arrived
            // A ship that just consumed its own last waypoint (as opposed to one still latched onto a
            // ship/Objective or orbiting a mining node — none of those feed into arrivedAtRouteEnd, see
            // nextPathIndex above) has nothing left to hold onto its now-fully-walked route for; clearing
            // it here is what makes drawRouteAndMarkers stop drawing it and removeShipWaypoints' own
            // clicked-existing-marker check stop matching stale points the ship already passed.
            if(arrived && arrivedAtRouteEnd){
                ship.waypoints = []
                ship.pathIndex = 0
            }
            else {
                ship.pathIndex = arrived ? nextPathIndex : pathIndex
            }
        })

        this.applyShipSeparation()
        arrivedBoms.forEach(ship => this.detonateDrone(ship, null))
    }

    applyShipSeparation = () => {
        const ships = this.ships
        for(let i=0; i<ships.length; i++){
            const a = ships[i]
            const bodyA = a.body as Physics.Arcade.Body
            const immovableA = ShipData[a.type].speed === 0

            if(a.type === ShipType.CATH) continue

            for(let j=i+1; j<ships.length; j++){
                const b = ships[j]
                if(b.type === ShipType.CATH) continue
                if(a.faction !== b.faction) continue
                if((a.type === ShipType.KKZ && b.type === ShipType.DRN) || (a.type === ShipType.DRN && b.type === ShipType.KKZ)) continue
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
        const droneX = drone.x, droneY = drone.y

        this.impactFlashes.push({ x:droneX, y:droneY, createdAt:time, damage })
        this.destroyShipSprite(drone.id)
        this.syncShipSummaries()

        if(drone.type === ShipType.KKZ && primary){
            primary.lastAttackedFrom = { x:droneX, y:droneY }
            primary.lastAttackedAtMs = time
            if(primary.takeDamage(damage)) this.killIfDead(primary)
        }
        else if(drone.type === ShipType.BOM){
            const hits = this.physics.overlapCirc(droneX, droneY, ATD_BLAST_RADIUS_PX, true, false)
            hits.forEach(body => {
                const obj = (body as Physics.Arcade.Body).gameObject
                if(obj.getData('kind') !== 'ship') return
                const hitShip = this.getShipEntry(obj as Phaser.Types.Physics.Arcade.GameObjectWithBody)
                if(hitShip && hitShip.faction !== drone.faction){
                    hitShip.lastAttackedFrom = { x:droneX, y:droneY }
                    hitShip.lastAttackedAtMs = time
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
        const sourceShip = this.shipSprites.get(missile.getData('sourceShipId'))
        missile.destroy()
        this.impactFlashes.push({ x, y, createdAt:time, damage })

        if(sourceShip){ ship.lastAttackedFrom = { x:sourceShip.x, y:sourceShip.y }; ship.lastAttackedAtMs = time }
        if(ship.takeDamage(damage)) this.killIfDead(ship, sourceShip)
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

    // A bullet is hostile to any ship of a different faction — same shape as isHostileMissileShipPair.
    isHostileBulletShipPair = (bulletObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const bullet = bulletObj as Physics.Arcade.Sprite
        const ship = this.getShipEntry(shipObj)
        return !!ship && ship.faction !== bullet.getData('faction')
    }

    // A bullet that actually reaches a hostile ship (rather than getting shot down first by
    // onBulletMissileContact) hits it for real — same shape as onMissileShipContact.
    onBulletShipContact = (bulletObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const bullet = bulletObj as Physics.Arcade.Sprite
        if(!bullet.active) return
        const ship = this.getShipEntry(shipObj)
        if(!ship) return

        const time = this.time.now
        const x = bullet.x, y = bullet.y, damage = bullet.getData('damage')
        const sourceShip = this.shipSprites.get(bullet.getData('sourceShipId'))
        bullet.destroy()
        this.impactFlashes.push({ x, y, createdAt:time, damage })

        if(sourceShip){ ship.lastAttackedFrom = { x:sourceShip.x, y:sourceShip.y }; ship.lastAttackedAtMs = time }
        if(ship.takeDamage(damage)) this.killIfDead(ship, sourceShip)
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

    // Same shape as findNearestHostileShip, but for PDF's own missile-priority targeting: the nearest
    // hostile *missile* within range — drones (KKZ/BOM) included, never a ship (see updatePdf for the
    // ship fallback once there's no missile threat to shoot down). "One target at a time": this only
    // ever returns a single nearest result, never a list, so a PDF ship's cooldown-gated shot (see
    // updatePdf) always commits to just the one thing.
    findNearestThreat = (fromFaction:Faction, x:number, y:number, range:number) =>
        this.findNearestInRange(fromFaction, x, y, range, obj =>
            obj.getData('kind') === 'missile' && obj.getData('faction') !== fromFaction)

    updateMlrs = (time:number) => {
        this.ships.forEach(ship => {
            if(ship.type !== ShipType.SPR) return
            if(this.isShipAttackDisabled(ship)) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.SPR].cooldownMs) return
            if(!ship.ammoRemaining) return

            const targetShip = this.findNearestHostileShip(ship.faction, ship.x, ship.y, ShipData[ShipType.SPR].rangePx)
            if(!targetShip) return

            const shots = Math.min(ShipData[ShipType.SPR].burstSize ?? 1, ship.ammoRemaining)
            ship.lastFiredAtMs = time
            ship.ammoRemaining -= shots
            const targetId = targetShip.getData('id')
            const aimX = targetShip.x, aimY = targetShip.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!ship.active || this.isShipAttackDisabled(ship)) return
                    this.spawnMissile(ship.faction, ship.x, ship.y, targetId, ShipData[ShipType.SPR].damage, aimX, aimY, ship.id)
                })
            }
        })
    }

    // Each PDF, on cooldown, fires a burst of real bullets (see spawnBullet) at whichever single hostile
    // missile is nearest in range — its own point-defense priority — falling back to the nearest hostile
    // *ship* instead whenever there's no missile threat to shoot down, so it keeps firing rather than
    // going idle just because nothing's currently inbound. Either way this only ever picks one target, so
    // it never splits fire across multiple targets in the same shot, just staggers burstSize shots at
    // that one. No damage is applied here — a bullet only does anything once it actually travels there
    // and connects (onBulletMissileContact/onBulletShipContact).
    updatePdf = (time:number) => {
        this.ships.forEach(ship => {
            if(ship.type !== ShipType.PDF) return
            if(this.isShipAttackDisabled(ship)) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.PDF].cooldownMs) return

            const target = this.findNearestThreat(ship.faction, ship.x, ship.y, ShipData[ShipType.PDF].rangePx)
                ?? this.findNearestHostileShip(ship.faction, ship.x, ship.y, ShipData[ShipType.PDF].rangePx)
            if(!target) return

            ship.lastFiredAtMs = time
            const shots = ShipData[ShipType.PDF].burstSize ?? 1
            const aimX = target.x, aimY = target.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!ship.active || this.isShipAttackDisabled(ship)) return
                    this.spawnBullet(ship.faction, ship.x, ship.y, ShipData[ShipType.PDF].damage, aimX, aimY, ship.id)
                })
            }
        })
    }

    // Any other bullet-weapon ship (BLADE — PDF has its own updatePdf above, with its missile-priority
    // targeting; STL is a missile-weapon ship, manually fired via handleClick's targeting interception,
    // not this loop) just fires a burst at the nearest hostile ship in range, same shape as
    // updateBeamWeapons below.
    updateBulletWeapons = (time:number) => {
        this.ships.forEach(ship => {
            if(ship.type === ShipType.PDF) return
            if(this.isShipAttackDisabled(ship)) return
            const stats = ShipData[ship.type]
            if(stats.weaponType !== 'bullet') return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < stats.cooldownMs) return

            const target = this.findNearestHostileShip(ship.faction, ship.x, ship.y, stats.rangePx)
            if(!target) return

            ship.lastFiredAtMs = time
            const shots = stats.burstSize ?? 1
            const aimX = target.x, aimY = target.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!ship.active || this.isShipAttackDisabled(ship)) return
                    this.spawnBullet(ship.faction, ship.x, ship.y, stats.damage, aimX, aimY, ship.id)
                })
            }
        })
    }

    // Any ship whose weaponType is 'beam' (see ShipStats in types.d.ts, e.g. HUSK) — an instant-hit laser
    // with no travel time at all, unlike missile/bullet's real projectiles: damage lands the same frame
    // it fires, targeting the nearest hostile ship the same way updateMlrs does. burstSize instant hits
    // are staggered by SALVO_STAGGER_MS purely so a burst > 1 still reads as more than one shot.
    updateBeamWeapons = (time:number) => {
        this.ships.forEach(ship => {
            const stats = ShipData[ship.type]
            if(stats.weaponType !== 'beam') return
            if(this.isShipAttackDisabled(ship)) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < stats.cooldownMs) return

            const target = this.findNearestHostileShip(ship.faction, ship.x, ship.y, stats.rangePx)
            if(!target) return

            ship.lastFiredAtMs = time
            const targetId = target.getData('id')
            const shots = stats.burstSize ?? 1
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!ship.active || this.isShipAttackDisabled(ship)) return
                    const liveTarget = this.shipSprites.get(targetId)
                    if(!liveTarget || !liveTarget.isAlive()) return
                    this.spawnBeam(ship.x, ship.y, liveTarget.x, liveTarget.y)
                    liveTarget.lastAttackedFrom = { x:ship.x, y:ship.y }
                    liveTarget.lastAttackedAtMs = this.time.now
                    if(liveTarget.takeDamage(stats.damage)) this.killIfDead(liveTarget, ship)
                })
            }
        })
    }

    spawnBeam = (x1:number, y1:number, x2:number, y2:number) => {
        this.beamFlashes.push({ x1, y1, x2, y2, createdAt:this.time.now })
    }

    drawBeams = (time:number) => {
        const g = this.beamG
        g.clear()

        this.beamFlashes = this.beamFlashes.filter(b => time - b.createdAt < BEAM_LIFETIME_MS)
        this.beamFlashes.forEach(b => {
            const alpha = 1 - (time-b.createdAt)/BEAM_LIFETIME_MS
            g.lineStyle(BEAM_WIDTH_PX, RED_HEX, alpha)
            g.lineBetween(b.x1, b.y1, b.x2, b.y2)
        })
    }

    // A real, non-homing projectile: launched once in a straight line at wherever the target was at the
    // moment of firing (physics.moveTo sets a fixed velocity, it's never retargeted mid-flight the way an
    // offensive missile is) — it either physically reaches and hits a hostile missile (onBulletMissileContact)
    // or ship (onBulletShipContact) itself, whichever it touches first, or is despawned by updateBullets
    // once it's been flying for BULLET_MAX_LIFETIME_MS with nothing to show for it.
    spawnBullet = (faction:Faction, x:number, y:number, damage:number, aimX:number, aimY:number, sourceShipId:string) => {
        const bullet = this.physics.add.sprite(x, y, 'bullet_dot')
        bullet.setData('kind', 'bullet' as BodyKind)
        bullet.setData('faction', faction)
        bullet.setData('damage', damage)
        bullet.setData('sourceShipId', sourceShipId)
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

    // A DRN never produces on its own — see FactoryToolbar's 3-way build-type buttons and Thunks'
    // onDrnBuildTypeClicked, which is what actually spends its ammo and queues a build, one ship at a
    // time, only when the player presses one. queueDrnBuild is what that thunk (and, for EYE, MapScene's
    // own handleClick DRN-launch-targeting interception) actually calls.
    // Refuses if the DRN is already mid-build (queue not empty) or out of ammo (4 total — same
    // ammo/ammoRemaining stat every other ammo-limited ship uses, so it's refilled by a nearby GAIN via
    // updateHarvesterSupport, at ShipData[DRN]'s own DRN_AMMO_METAL_COST rather than the flat 1-for-1 rate
    // everything else resupplies at). Queuing (rather than spawning outright) reuses the exact same
    // ship.queue/tickProduction machinery a Base's own build queue runs on — drawProductionProgress
    // already draws a bar over *any* ship with a live queue[0], so a DRN gets one for free, ticking at
    // that type's own productionTimeMs; tickProduction completing it calls spawnShip, which is what
    // actually gives the finished ship its under-the-DRN fly-out (see spawnShip's own comment).
    queueDrnBuild = (shipId:string, type:ShipType) => {
        const ship = this.shipSprites.get(shipId)
        if(!ship || ship.type !== ShipType.DRN || ship.queue.length > 0 || !ship.ammoRemaining) return false
        ship.ammoRemaining -= 1
        // Date.now(), not the Phaser scene-time `time` this function otherwise runs on — the queue
        // this feeds (tickProduction/drawProductionProgress, same as a Base's own) is timed against
        // wall-clock Date.now() throughout, and mixing the two clocks would make a fresh item read as
        // wildly, instantly overdue.
        ship.queue = [{ id:v4(), type, startedAt:Date.now() }]
        this.syncShipSummaries()
        return true
    }

    updateHarvesterMiningTargets = () => {
        const { resourceNodes } = useAppStore.getState()
        const wasMining = new Set(this.harvesterMiningTarget.keys())
        const wasInRange = this.harvesterInRangeIds
        const nowInRange = new Set<string>()
        this.harvesterMiningTarget.clear()

        this.ships.filter(s => s.type === ShipType.GAIN).forEach(harvester => {
            let nearest:ResourceNodeData = null
            if((harvester.metalCarried ?? 0) < HARVESTER_METAL_CAPACITY){
                let nearestDist = Infinity
                resourceNodes.forEach(node => {
                    if((node.metal ?? 0) <= 0) return
                    const d = Phaser.Math.Distance.Between(harvester.x, harvester.y, node.x, node.y)
                    if(d <= HARVESTER_RANGE_PX && d < nearestDist){ nearestDist = d; nearest = node }
                })
            }
            if(nearest) nowInRange.add(harvester.id)

            // A route given while mining takes over immediately — moveShips prefers the mining orbit
            // over waypoints, so dropping the target here (rather than reassigning it below) is what
            // actually lets the new order take effect.
            if(wasMining.has(harvester.id) && harvester.waypoints.length > 0) return
            if(!nearest) return

            // Only a fresh arrival into range (re-)starts mining. A harvester that's still sitting in
            // range after an order stopped it above stays stopped until it actually leaves and
            // re-enters, rather than having that order immediately undone next tick.
            const justEntered = !wasInRange.has(harvester.id)
            if(!wasMining.has(harvester.id) && !justEntered) return

            if(justEntered){ harvester.waypoints = []; harvester.pathIndex = 0 }
            this.harvesterMiningTarget.set(harvester.id, nearest.id)
        })

        this.harvesterInRangeIds = nowInRange
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

    ammoResupplyMetalCost = (type:ShipType) => type === ShipType.DRN ? DRN_AMMO_METAL_COST : 1

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
                && ShipData[t.type].ammo && (t.ammoRemaining ?? 0) < ShipData[t.type].ammo
                && (harvester.metalCarried ?? 0) >= this.ammoResupplyMetalCost(t.type))
            const repairTarget = !ammoTarget && (harvester.metalCarried ?? 0) >= HARVESTER_REPAIR_METAL_COST
                ? ships.find(t => inRange(harvester, t) && t.hp < ShipData[t.type].hp)
                : undefined
            const target = ammoTarget ?? repairTarget
            if(!target) return
            this.harvesterSupportTarget.set(harvester.id, target.id)

            if(harvester.lastResupplyAtMs && time - harvester.lastResupplyAtMs < HARVESTER_RESUPPLY_INTERVAL_MS) return
            harvester.lastResupplyAtMs = time
            if(ammoTarget){
                harvester.metalCarried = (harvester.metalCarried ?? 0) - this.ammoResupplyMetalCost(ammoTarget.type)
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
    spawnMissile = (faction:Faction, x:number, y:number, targetId:string, damage:number, aimX:number, aimY:number, sourceShipId:string) => {
        const missile = this.physics.add.sprite(x, y, 'missile_dot')
        missile.setData('kind', 'missile' as BodyKind)
        missile.setData('id', v4())
        missile.setData('faction', faction)
        missile.setData('targetId', targetId)
        missile.setData('damage', damage)
        missile.setData('sourceShipId', sourceShipId)
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

            const createdAt = child.getData('createdAt')
            if(time - createdAt > MISSILE_MAX_LIFETIME_MS){
                child.destroy()
                return true
            }

            // No re-targeting once fired, even if the ship it was launched at has since died — it just
            // keeps flying its already-committed leg toward wherever that target was at spawn time (see
            // spawnMissile's own aimX/aimY fallback), landing there and grazing anything it happens to
            // pass through (onMissileShipContact) along the way, same as always.
            const legOriginX = child.getData('legOriginX'), legOriginY = child.getData('legOriginY')
            const legTargetX = child.getData('legTargetX'), legTargetY = child.getData('legTargetY')
            const legStartAt = child.getData('legStartAt'), legDurationMs:number = child.getData('legDurationMs')
            const rawProgress = legDurationMs > 0 ? (time-legStartAt) / legDurationMs : 1

            if(rawProgress > 1){
                const faction:Faction = child.getData('faction')
                const damage = child.getData('damage')
                const sourceShip = this.shipSprites.get(child.getData('sourceShipId'))
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
                    if(sourceShip){ hitShip.lastAttackedFrom = { x:sourceShip.x, y:sourceShip.y }; hitShip.lastAttackedAtMs = time }
                    if(hitShip.takeDamage(damage)) this.killIfDead(hitShip, sourceShip)
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
        g.lineStyle(1.5, GREEN_HEX, 1)
        for(let i=0; i<points.length-1; i++) g.lineBetween(points[i].x, points[i].y, points[i+1].x, points[i+1].y)

        waypoints.forEach((w, i) => {
            const { x, y } = this.toWorld(w.x, w.y)
            g.fillStyle(GREEN_HEX, 1)
            g.fillCircle(x, y, 5)
            g.lineStyle(1, GREEN_HEX, 1)
            g.strokeCircle(x, y, 8)
            const label = this.add.text(x, y-16, String(i+1), { fontFamily:'Body', fontSize:MAP_FONT_SIZE, color:colors.green }).setOrigin(0.5).setDepth(5).setResolution(LABEL_TEXT_RESOLUTION)
            this.orderLabels.push(label)
        })
    }

    // Shared by fog-of-war (updateFogOfWar) and every targeting/detection check (findNearestInRange, so
    // this doubles as "can a weapon actually be aimed at this point" too) — a single definition of
    // "in-sight" so a ship that can't be seen can't be shot at either. Nebula concealment lives here
    // rather than as a separate stealth system: a point sitting inside a nebula's own silhouette can
    // only be seen by a faction ship that's *also* inside a nebula right now (any nebula, not
    // necessarily the same one — being in the cloud at all is what lets you spot something else in it),
    // and every ship's own sight radius drops to NEBULA_SIGHT_RADIUS_PX while it's the one hiding in one.
    isWithinFactionSightRange = (worldX:number, worldY:number, faction:Faction) => {
        const targetHidden = this.isPointUnderNebula(worldX, worldY)
        return this.ships.some(s => {
            if(s.faction !== faction) return false
            const observerHidden = this.isPointUnderNebula(s.x, s.y)
            if(targetHidden && !observerHidden) return false
            const sightRadius = observerHidden ? NEBULA_SIGHT_RADIUS_PX : ShipData[s.type].sightRadius
            return Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= sightRadius
        })
    }

    findOwnShipAt = (worldX:number, worldY:number) => {
        return this.ships.find(s => {
            if(s.faction !== Faction.Player || s.type === ShipType.CATH) return false
            const r = Math.max(this.getShipFootprintRadiusPx(s.type), 10)
            return Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= r
        })
    }

    // Mirrors findOwnShipAt, but for the enemy faction — used by handleClick's STL-targeting
    // interception to resolve whatever the player just clicked on into a strike target. Only requires
    // the ship to actually be visible (fog-of-war); range is unrelated to whether a ship can be clicked
    // at all, so handleClick itself re-checks strikeRangePx (see drawStrikeTargets, which rings exactly
    // the same in-range set) before actually firing.
    findHostileShipAt = (worldX:number, worldY:number) => {
        return this.ships.find(s => {
            if(s.faction !== Faction.Enemy || !s.visible) return false
            const r = Math.max(this.getShipFootprintRadiusPx(s.type), 10)
            return Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= r
        })
    }

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

        const spacing = Math.max(...ships.map(s => this.getShipFootprintRadiusPx(s.type))) * 2 + SHIP_SEPARATION_PX
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

    // A new order overrides ZEL's own Objective/ship latch the same way it overrides anything else the
    // ship was doing — releases the capture and clears both latch fields, same as always, but also
    // records whatever it was actually latched onto (if anything) as avoidLatchId first, so moveShips'
    // auto-latch won't immediately re-claim that exact same target purely because the ship hasn't
    // physically left its capture radius yet (see avoidLatchId's own doc comment on ShipSprite).
    disengageZelLatch = (ship:ShipSprite) => {
        // Always overwritten, not just set — an order given while NOT currently latched onto anything
        // (e.g. re-ordering an already-idle-elsewhere ZEL right back toward the very thing it was
        // avoiding) clears any stale avoidance from a previous order instead of leaving it stuck
        // forever unable to return there even when explicitly told to.
        ship.avoidLatchId = ship.latchedObjectiveId ?? ship.latchedShipId
        this.releaseShipCapture(ship.id)
        ship.latchedObjectiveId = undefined
        ship.objectiveAttached = undefined
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
            ship.waypoints = [...ship.waypoints, formation.get(id) ?? { x, y }]
            this.disengageZelLatch(ship)
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
            this.disengageZelLatch(ship)
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
            this.disengageZelLatch(ship)
        })
    }

    // Selected ships drop their route and just sit wherever they currently are until new orders are given.
    clearShipWaypoints = (shipIds:Array<string>) => {
        shipIds.forEach(id => {
            const ship = this.shipSprites.get(id)
            if(!ship) return
            ship.waypoints = []
            ship.pathIndex = 0
            this.disengageZelLatch(ship)
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
            if(!pointer.leftButtonDown()) return

            // Minimap click-to-recenter takes priority over everything below — pointer.x/y are already
            // real screen pixels, the same space getMinimapRect's own numbers are in, so no conversion
            // is needed to test against it.
            if(this.minimapVisible){
                const { originX, originY, size } = this.getMinimapRect()
                if(pointer.x >= originX && pointer.x <= originX+size && pointer.y >= originY && pointer.y <= originY+size){
                    const worldW = this.mapData.width * CELL_SIZE, worldH = this.mapData.height * CELL_SIZE
                    const worldX = (pointer.x-originX)/size * worldW
                    const worldY = (pointer.y-originY)/size * worldH
                    this.cameras.main.centerOn(worldX, worldY)
                    return
                }
            }

            if(!this.hoveredCell) return

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

        this.input.keyboard.on('keydown-M', () => {
            this.minimapVisible = !this.minimapVisible
        })

        // SHIFT+1-9 assigns the current selection to that control group; 1-9 alone selects it, and
        // pressing the very same key again right after (still holding that exact group as the
        // selection) recenters the camera on it instead — the classic RTS "tap to select, tap again to
        // jump to" control group scheme.
        const GROUP_KEYS:Record<string, number> = { ONE:1, TWO:2, THREE:3, FOUR:4, FIVE:5, SIX:6, SEVEN:7, EIGHT:8, NINE:9 }
        Object.entries(GROUP_KEYS).forEach(([keyName, group]) => {
            this.input.keyboard.on(`keydown-${keyName}`, () => {
                if(this.shiftDown){
                    const { selectedShipIds } = useAppStore.getState()
                    if(selectedShipIds.length > 0) this.shipGroups.set(group, [...selectedShipIds])
                    return
                }
                this.selectOrCenterGroup(group)
            })
        })
    }

    // Drops any member that's since died so a stale id can never silently pile up in the group forever.
    selectOrCenterGroup = (group:number) => {
        const memberIds = (this.shipGroups.get(group) ?? []).filter(id => this.shipSprites.has(id))
        if(memberIds.length === 0) return
        this.shipGroups.set(group, memberIds)

        const { selectedShipIds } = useAppStore.getState()
        const alreadySelected = memberIds.length === selectedShipIds.length && memberIds.every(id => selectedShipIds.includes(id))
        if(alreadySelected){
            const members = memberIds.map(id => this.shipSprites.get(id))
            const centerX = members.reduce((sum, s) => sum+s.x, 0) / members.length
            const centerY = members.reduce((sum, s) => sum+s.y, 0) / members.length
            this.cameras.main.centerOn(centerX, centerY)
            return
        }

        onSelectShips(memberIds)
    }

    handleClick = (worldX:number, worldY:number) => {
        if(!this.hoveredCell) return
        const { selectedShipIds, setSelectedShipIds, targetingShipId, setTargetingShipId, drnEyeTargetShipId, setDrnEyeTargetShipId } = useAppStore.getState()

        // An armed STL (see FactoryToolbar's Strike button / Thunks' onToggleStrikeTargeting) hijacks the
        // very next click entirely — hit or miss, targeting always ends here rather than falling through
        // to normal selection/order handling. Enemies aren't hidden while targeting (see
        // drawStrikeTargets, which rings the same in-range set instead), so range is re-checked here
        // explicitly rather than assumed from what's clickable.
        if(targetingShipId){
            const stl = this.shipSprites.get(targetingShipId)
            const target = this.findHostileShipAt(worldX, worldY)
            const inRange = stl && target && Phaser.Math.Distance.Between(stl.x, stl.y, target.x, target.y) <= ShipData[ShipType.STL].rangePx
            if(stl && target && inRange && stl.ammoRemaining){
                this.spawnMissile(stl.faction, stl.x, stl.y, target.id, ShipData[ShipType.STL].damage, target.x, target.y, stl.id)
                stl.lastFiredAtMs = this.time.now
                stl.ammoRemaining -= 1
            }
            setTargetingShipId(null)
            return
        }

        // An armed DRN (see FactoryToolbar's build-type buttons / Thunks' onDrnBuildTypeClicked) is
        // waiting on exactly this click to know where the EYE it's about to build should fly to — any
        // valid map cell counts, not just one with something on it (unlike STL's targeting above), same
        // as giving a normal move order. Targeting always ends here regardless of whether the click
        // actually lands on a valid cell or the DRN can actually still afford the build by the time it
        // arrives (mid-build already, out of ammo, ...); queueDrnBuild itself is the single source of
        // truth for whether the build actually goes through.
        if(drnEyeTargetShipId){
            const { x, y } = this.hoveredCell
            if(x >= 0 && y >= 0 && x < this.mapData.width && y < this.mapData.height){
                const drn = this.shipSprites.get(drnEyeTargetShipId)
                if(drn) drn.pendingEyeDestination = { x, y }
                this.queueDrnBuild(drnEyeTargetShipId, ShipType.EYE)
            }
            setDrnEyeTargetShipId(null)
            return
        }

        const clicked = this.findOwnShipAt(worldX, worldY)
        if(clicked){
            const now = this.time.now
            const isDoubleClick = this.lastClickShipId === clicked.id && now - this.lastClickAtMs <= DOUBLE_CLICK_MS
            this.lastClickShipId = clicked.id
            this.lastClickAtMs = now

            if(isDoubleClick){
                // Select every one of the player's own ships of the same type, not just this one — but
                // only the ones actually on-screen right now (cam.worldView, same world-space view
                // drawMinimap's own camera box uses), same as a real RTS double-click, so a fleet spread
                // across the whole map doesn't all get swept into the selection at once.
                const view = this.cameras.main.worldView
                const sameTypeIds = this.ships
                    .filter(s => s.faction === Faction.Player && s.type === clicked.type && view.contains(s.x, s.y))
                    .map(s => s.id)
                onSelectShips(sameTypeIds)
                // A third click right after shouldn't chain into yet another double-click.
                this.lastClickShipId = null
                return
            }

            onSelectShips([clicked.id])
            return
        }

        if(selectedShipIds.length > 0){
            const { x, y } = this.hoveredCell
            if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return
            const orderableIds = this.ships.filter(s => selectedShipIds.includes(s.id) && s.type !== ShipType.CATH && s.type !== ShipType.EYE && !s.latchedByZelId).map(s => s.id)
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
        const worldW = this.mapData.width * CELL_SIZE
        const worldH = this.mapData.height * CELL_SIZE
        const boundsW = Math.max(worldW, cam.width)
        const boundsH = Math.max(worldH, cam.height)
        cam.setBounds((worldW-boundsW)/2, (worldH-boundsH)/2, boundsW, boundsH)
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
                    this.cameras.main.scrollX += (this.origDragPoint.x - pointer.position.x) / this.cameras.main.zoom * MOUSE_CAMERA_PAN_SPEED_MULTIPLIER
                    this.cameras.main.scrollY += (this.origDragPoint.y - pointer.position.y) / this.cameras.main.zoom * MOUSE_CAMERA_PAN_SPEED_MULTIPLIER
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
            onSelectShips(hitIds)
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
