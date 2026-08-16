import { Scene, GameObjects, Physics, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene, onShowModal } from "../../common/Thunks";
import { getLogisticsStatus, getShipLogisticsCost, seededRandom } from "../../common/Utils";
import { spawnEnemyRaid, checkEnemyRaid } from "../../common/AIPlayers";
import { SHIP_SIDC_FUNCTION, buildSidc, renderAppSixIcon } from "../../common/AppSix";
import { Faction, ShipType, Modal, ShipData, ObjectiveSprite, ObjectiveSpriteIndex, ResourceNodeType, AsteroidSpriteIndexes, CloudIndexes, Maps } from "../../../enum";
import {
    MAP_SIZE, CELL_SIZE, gridToWorld, worldToGrid,
    TRACER_LIFETIME_MS,
    ATD_BLAST_RADIUS_PX,
    MISSILE_SALVO_SIZE, MISSILE_SPEED_PX_S, MISSILE_MAX_LIFETIME_MS, SALVO_STAGGER_MS,
    MISSILE_ARC_HEIGHT_PX, CONTRAIL_INTERVAL_MS, CONTRAIL_LIFETIME_MS,
    SHATTER_LIFETIME_MS,
    OBJECTIVE_CAPTURE_RADIUS_PX, OBJECTIVE_ICON_SIZE, OBJECTIVE_CAPTURE_TIME_MS,
    HARVESTER_RANGE_PX, HARVESTER_COLLECTION_RATE_PER_S, RESOURCE_ASTEROID_COUNT, RESOURCE_GAS_CLOUD_COUNT,
    ASTEROID_AVG_METAL, ASTEROID_METAL_VARIANCE, RESOURCE_NODE_MIN_SPACING_PX,
    NATO_ICON_SIZE, GREEN_HEX, GREEN_DIM_HEX, GREY_DIM_HEX,
} from "../../common/Constants";
import { colors } from "../../styles/AppStyles";

const TWO_PI = Math.PI*2

// Only two zoom levels for now (see enableCameraControls' wheel handler) — plain in/out toggle rather
// than the continuous zoom this used to be.
const ZOOM_LEVELS = [1, 2]

// Once a ship finishes its route it loiters in a circle around the final waypoint.
const ORBIT_RADIUS_PX = CELL_SIZE * 1.5
const ORBIT_ANGULAR_SPEED = 0.0005 // radians per ms

// How far above a ship's own position its type label floats — clear of the (now unframed) icon
// itself, which is roughly NATO_ICON_SIZE*0.6 tall, so the text never sits on top of it.
const SHIP_LABEL_OFFSET_PX = NATO_ICON_SIZE * 0.7

// Stable per-ship angular offset so multiple ships orbiting the same point spread out instead of stacking.
const shipOrbitPhase = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return ((h >>> 0) % 1000) / 1000 * TWO_PI
}

// The only two ship kinds that self-destruct on contact with a hostile ship (see
// isHostileDroneShipPair/onDroneShipContact/detonateDrone) — every other kind (MLRS, AWACS, ARMOR,
// Base) just collides and bounces off physically, nothing happens.
const DRONE_TYPES = new Set<ShipType>([ShipType.KK, ShipType.ATD])

// Applies accumulated damage to any {id, hp} collection, removing anything that drops to 0 HP or
// below. `onDeath` lets the caller leave its own effect at the death location — shared by every
// damage-dealing pass (MLRS/ARMOR fire, every drone detonation, a missile impact).
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

// Used by drawPlacementRanges to trim a circle's stroked boundary wherever a SAME-faction circle
// covers it, so same-faction sight bubbles merge into one seamless shape with no interior line
// (opposing-faction circles are left full — see fillCircleOverlap for how their overlap is shown instead).
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

// The union counterpart to subtractArc — used by drawPlacementRanges to build up an enemy circle's
// revealed arcs (unrevealed by default) as the union of wherever it overlaps a player sight circle.
// Doesn't bother re-merging touching/overlapping intervals across separate calls into one contiguous
// span — a few adjacent stroked arcs draw identically to one, so it's not worth the extra bookkeeping.
const addArc = (intervals:Array<[number,number]>, addStart:number, addEnd:number):Array<[number,number]> => {
    let s = addStart, e = addEnd
    const untouched:Array<[number,number]> = []
    intervals.forEach(([is, ie]) => {
        if(ie < s || is > e) untouched.push([is, ie])
        else { s = Math.min(s, is); e = Math.max(e, ie) }
    })
    untouched.push([s, e])
    return untouched
}

// Same as addArc but accepts a raw (possibly negative or >TWO_PI) angle range and handles wraparound.
const addCircularRange = (intervals:Array<[number,number]>, rawStart:number, rawEnd:number):Array<[number,number]> => {
    if(rawEnd - rawStart >= TWO_PI) return [[0, TWO_PI]]
    const start = normalizeAngle(rawStart)
    const end = normalizeAngle(rawEnd)
    if(start <= end) return addArc(intervals, start, end)
    return addArc(addArc(intervals, start, TWO_PI), 0, end)
}

// The two tile indices (local to the tileset's own firstgid — see spawnEntitiesFromMap) that mark each
// faction's Base on the map file's entities layer. There are no buildings in this game anymore — every
// other tile that layer might still contain is simply ignored, there's nothing left to spawn for it.
const BASE_SPRITE_INDEX:Record<Faction, number> = { [Faction.Enemy]: 13, [Faction.Player]: 0 }

// One shape per body kind, tagged on every physics sprite via setData('kind', ...) so overlap/query
// callbacks (which only see raw Arcade bodies) can tell what they actually hit.
type BodyKind = 'ship' | 'missile'

export default class MapScene extends Scene {

    // Static/decorative art: the map grid, terrain. None of this needs a physics body — it never moves
    // and nothing ever collides with it.
    g: GameObjects.Graphics
    // Territory/sight-range bubbles get their own layer, redrawn every frame (see drawPlacementRanges)
    // since unit sight range moves continuously.
    rangeG: GameObjects.Graphics
    // Opposing-faction sight-circle overlap shading (see drawPlacementRanges' fillCircleOverlap pass)
    // can't just be a series of fillPath calls on a normal Graphics object — wherever more than one
    // lens/whole-circle shape covers the same point (e.g. three-plus circles all overlapping near each
    // other), each shape's own alpha would blend on top of the last and that spot would end up brighter
    // than a simple two-circle overlap. rangeShadeBrush draws every shape fully opaque (solid fills
    // don't stack in brightness, they just overwrite) onto rangeShadeRT, a RenderTexture that flattens
    // them into one single opaque mask; only THAT flattened result gets one uniform alpha applied, as
    // a single texture — so no matter how many shapes cover a point, it reads exactly the same brightness.
    rangeShadeBrush: GameObjects.Graphics
    rangeShadeRT: GameObjects.RenderTexture
    selectionG: GameObjects.Graphics
    progressG: GameObjects.Graphics
    healthG: GameObjects.Graphics
    ordersG: GameObjects.Graphics
    combatG: GameObjects.Graphics
    shatterG: GameObjects.Graphics
    trailG: GameObjects.Graphics
    ammoG: GameObjects.Graphics
    objectiveRangeG: GameObjects.Graphics
    // Repeating starfield backdrop, sized to cover the camera's full scroll bounds (see centerCameraBounds)
    // — a plain Image would stretch/tile awkwardly at that size, a TileSprite repeats the source texture
    // at its native resolution instead. Sits behind everything else (see create's setDepth) purely for
    // atmosphere; it isn't part of game state.
    starfield: GameObjects.TileSprite
    // Plain left-drag rectangle for selecting a group of the player's own ships (see
    // enableSelectionControls' pointerdown/enableCameraControls' pointermove) — shift+left-drag is
    // reserved for panning.
    dragSelectG: GameObjects.Graphics

    // Every ship and missile is a real Arcade Physics sprite so collision (a drone touching a hostile
    // ship, a missile hitting its target) is detected by Phaser's overlap system instead of a
    // hand-rolled O(n^2) distance sweep every frame. Ranged targeting (an MLRS/ARMOR picking a target
    // "in range") uses physics.overlapCirc — a spatial query — instead of scanning every ship. Zustand
    // remains the source of truth for game *state* (hp, faction, orders, ...); each sprite just carries
    // that entity's id via setData so the two can be looked up from one another.
    shipsGroup: Physics.Arcade.Group
    missilesGroup: Physics.Arcade.Group
    shipSprites: Map<string, Physics.Arcade.Sprite> = new Map()
    shipLabels: Map<string, GameObjects.Text> = new Map()
    // Objectives have no physics body at all (capture is a plain distance check, not a collision — see
    // updateObjectives) — just a plain Image, tinted per current owner.
    objectiveSprites: Map<string, GameObjects.Image> = new Map()
    objectiveLabels: Map<string, GameObjects.Text> = new Map()
    // Resource nodes (Asteroids/GasClouds) have no physics body either — a Harvester's own gathering
    // range check (updateHarvesters) is a plain distance loop, not a collision. Always visible, unlike
    // a ship — nothing about them is worth hiding behind fog of war.
    resourceNodeSprites: Map<string, GameObjects.Image> = new Map()

    orderLabels: Array<GameObjects.Text> = []
    lastOrdersKey: string = ''
    // Box-select drag state (world coordinates) — set on pointerdown while Shift is not held, updated
    // on every pointermove, resolved into a selectedShipIds set on pointerup. null whenever no drag is
    // in progress, which is also what tells enableCameraControls' pointermove to skip the normal pan.
    shiftDown: boolean = false
    dragSelectStart: { x:number, y:number } | null = null
    dragSelectCurrent: { x:number, y:number } | null = null
    tracers: Array<{ x1:number, y1:number, x2:number, y2:number, createdAt:number }> = []
    shatters: Array<{ x:number, y:number, createdAt:number, seed:string }> = []
    // Decaying vapor-trail points left behind an offensive missile's actual (arced) flight path — see
    // startMissileLeg/updateMissiles for how the arc itself is computed, drawMissileTrails for the draw.
    // Tagged per-missile (missileId) so drawMissileTrails can connect each missile's own points into its
    // own polyline instead of drawing every missile's dots into one shared cloud.
    contrails: Array<{ x:number, y:number, createdAt:number, missileId:string }> = []

    // Enemy AI state — read/written by the helper functions in src/common/AIPlayers.ts, which take
    // this scene as their first argument rather than owning the state themselves. enemyBaseId is set
    // the moment spawnEntitiesFromMap finds the enemy's Base on the map file's entities layer.
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
        // Not added to the display list (make(..., false)) — this is purely a brush passed to
        // rangeShadeRT.draw(), never rendered on its own.
        this.rangeShadeBrush = this.make.graphics({}, false)
        this.rangeShadeRT = this.add.renderTexture(0, 0, MAP_SIZE*CELL_SIZE, MAP_SIZE*CELL_SIZE).setOrigin(0, 0).setAlpha(0.12)
        this.selectionG = this.add.graphics()
        this.progressG = this.add.graphics()
        this.healthG = this.add.graphics()
        this.ordersG = this.add.graphics()
        this.combatG = this.add.graphics()
        this.shatterG = this.add.graphics()
        this.trailG = this.add.graphics()
        this.ammoG = this.add.graphics()
        this.objectiveRangeG = this.add.graphics()
        this.dragSelectG = this.add.graphics()

        this.input.keyboard.on('keydown-SHIFT', () => this.shiftDown = true)
        this.input.keyboard.on('keyup-SHIFT', () => this.shiftDown = false)

        this.generateTextures()
        this.shipsGroup = this.physics.add.group()
        this.missilesGroup = this.physics.add.group()

        // Contact damage: a drone (KK/ATD) touching a hostile ship — the process callback does the
        // faction/type filtering so the collide callback only ever sees a real detonation.
        this.physics.add.overlap(this.shipsGroup, this.shipsGroup, this.onDroneShipContact, this.isHostileDroneShipPair, this)
        // Impact damage: an MLRS missile touching a hostile ship.
        this.physics.add.overlap(this.missilesGroup, this.shipsGroup, this.onMissileShipContact, this.isHostileMissileShipPair, this)

        this.mapData = useAppStore.getState().activeMap || { width:MAP_SIZE, height:MAP_SIZE, objectives:[], terrain:null }
        // Grid dimensions now come from the actual loaded map file, not the MAP_SIZE default — camera
        // bounds (centerCameraBounds, right below) and everything else that reads mapData.width/height
        // all need this to line up with where the entities layer's own tiles actually are (see
        // spawnEntitiesFromMap).
        const tiledMap = this.make.tilemap({ key: Maps.Sandbox })
        if(tiledMap.width && tiledMap.height){
            this.mapData.width = tiledMap.width
            this.mapData.height = tiledMap.height
        }

        this.cameras.main.setZoom(1)
        this.centerCameraBounds()

        // Sized/positioned to the camera's own bounds rect (set just above) so the tiling covers
        // everywhere the player can ever scroll to, not just the map itself.
        const bounds = this.cameras.main.getBounds()
        this.starfield = this.add.tileSprite(bounds.centerX, bounds.centerY, bounds.width, bounds.height, 'starfield').setDepth(-1000).setScrollFactor(0.5)

        this.spawnEntitiesFromMap()
        // Resource nodes scatter after entities so they can avoid overlapping a faction's Base.
        this.spawnResourceNodes()
        this.drawMap()
        this.enableCameraControls()
        this.enableSelectionControls()

        // There's no placement/building phase anymore — the match is live the instant every ship the
        // map file placed (both factions' Bases included) exists, so the enemy's opening raid can be
        // queued right away.
        spawnEnemyRaid(this)

        this.time.addEvent({ delay: 500, loop: true, callback: this.tickProduction })

        this.unsubscribe = useAppStore.subscribe((state, prevState) => {
            // A drag-selected ship that dies stays a dangling id in selectedShipIds forever otherwise
            // (nothing else ever prunes it) — drop it the moment the ship list actually shrinks, and
            // close the selection panel entirely (empty array) once none of the selected ships survive.
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
            // Solid black behind every hand-drawn icon too, same as renderAppSixIcon does for the
            // milsymbol ones — so it reads as an opaque tile rather than letting the grid/terrain under
            // it show through the gaps in its own linework.
            tmp.fillStyle(0x000000, 1)
            tmp.fillRect(0, 0, size, size)
            draw(tmp, size/2, size/2)
            tmp.generateTexture(key, size, size)
        }

        const shipSize = Math.ceil(NATO_ICON_SIZE)

        Object.values(ShipType).forEach(type => {
            const fn = SHIP_SIDC_FUNCTION[type]
            this.textures.addCanvas('ship_friend_'+type, renderAppSixIcon(buildSidc(Faction.Player, fn), shipSize, GREEN_HEX))
            this.textures.addCanvas('ship_hostile_'+type, renderAppSixIcon(buildSidc(Faction.Enemy, fn), shipSize, GREY_DIM_HEX))
        })

        bake('missile_dot', 8, (g, cx, cy) => { g.fillStyle(GREEN_HEX, 0.9); g.fillCircle(cx, cy, 2) })

        tmp.destroy()
    }

    update = (time:number, delta:number) => {
        this.moveShips(time, delta)
        this.updateMlrs(time)
        this.updateArmor(time)
        this.updateHarvesters(time, delta)
        this.updateObjectives(time)
        this.updateMissiles(time, delta)
        checkEnemyRaid(this)
        this.updateFogOfWar()
        this.drawPlacementRanges()
        this.drawObjectiveRanges(time)

        this.drawProductionProgress()
        this.drawShipHealth()
        this.drawAmmoGauges()
        this.drawOrders()
        this.drawCombat(time)
        this.drawShatters(time)
        this.drawMissileTrails(time)

        // Pulsating octagon selection ring around every selected ship — a faction's Base included, at a
        // base radius scaled to its own (larger) icon size, same treatment as any other ship.
        this.selectionG.clear()
        const { selectedShipIds, ships } = useAppStore.getState()
        selectedShipIds.forEach(id => {
            const ship = ships.find(s => s.id === id)
            if(!ship) return
            this.drawSelectionRing(ship.x, ship.y, ShipData[ship.type].sizeHex * CELL_SIZE * 0.7, time)
        })
    }

    // Pulsating octagon selection ring, shared by every selected ship.
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

    // Progress bar above a Base currently building something — only a Base ever has a queue (see
    // ShipData in types.d.ts). Skips any Base whose sprite is currently hidden by fog of war (see
    // updateFogOfWar) — the bar is drawn on its own Graphics layer, not attached to the sprite, so
    // without this check it would still show through the fog and give away a hidden enemy Base's position.
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

    // HP bar below any ship that's taken damage — hidden entirely at full health so an undamaged fleet
    // doesn't clutter the map with empty bars. Also skips anything currently hidden by fog of war, same
    // as drawProductionProgress.
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

    drawAmmoGauges = () => {
        const g = this.ammoG
        g.clear()

        useAppStore.getState().ships.forEach(ship => {
            const maxAmmo = ShipData[ship.type].ammo
            if(!maxAmmo || ship.ammoRemaining === undefined) return
            const sprite = this.shipSprites.get(ship.id)
            if(!sprite || sprite.visible === false) return
            this.drawAmmoGauge(g, sprite.x, sprite.y, sprite.width, sprite.height, ship.ammoRemaining/maxAmmo)
        })
    }

    drawAmmoGauge = (g:GameObjects.Graphics, x:number, y:number, spriteWidth:number, spriteHeight:number, ratio:number) => {
        const percent = PhaserMath.Clamp(ratio, 0, 1)
        const w = 4, h = spriteHeight * 0.8
        const barX = x + spriteWidth/2 + 6
        const barY = y - h/2

        g.lineStyle(1, GREEN_HEX, 1)
        g.strokeRect(barX, barY, w, h)
        g.fillStyle(GREEN_HEX, 0.9)
        const filledH = h * percent
        g.fillRect(barX, barY + (h-filledH), w, filledH)
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

    // Completes a Base's front-of-queue item once its production time has elapsed. If the faction's
    // logistics budget has no room left for it (e.g. it filled up while this item was building), the
    // ready item just holds at the front of the queue — production stays complete, it deploys the
    // moment logistics frees up, without eating another full production cycle.
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

    // Places a newly completed ship near its Base, trying to avoid overlapping other loitering ships.
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

        const ship:ShipData = { id:v4(), faction:base.faction, type, x:pos.x, y:pos.y, waypoints:[...(base.waypoints||[])], pathIndex:0, hp:ShipData[type].hp, ammoRemaining:ShipData[type].ammo }
        useAppStore.getState().addShip(ship)
        this.createShipSprite(ship)
    }

    // Every ship (both factions' Bases included) and every Objective comes straight off the loaded map
    // file's own entities layer — there are no other buildings left to place, so any tile on that layer
    // that isn't a Base or an Objective is simply ignored.
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
                    const base:ShipData = { id:v4(), faction:baseFaction, type:ShipType.Base, x, y, hp:ShipData[ShipType.Base].hp }
                    useAppStore.getState().addShip(base)
                    this.createShipSprite(base)
                    if(baseFaction === Faction.Enemy) this.enemyBaseId = base.id
                    continue
                }

                // ObjectiveSpriteIndex is a numeric enum, so this reverse lookup (value -> key) is just
                // indexing it — TS generates that mapping automatically. The resulting key string is
                // exactly one of ObjectiveSprite's own values (they're named identically on purpose).
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

    // Scatters RESOURCE_ASTEROID_COUNT Asteroids and RESOURCE_GAS_CLOUD_COUNT GasClouds randomly across
    // the map — there's no tile reserved for these on the map file the way a Base or Objective has, so
    // (unlike spawnEntitiesFromMap) this is pure procedural placement, each candidate point rejected and
    // retried if it lands too close to an existing ship or another resource node.
    spawnResourceNodes = () => {
        const placeNode = (kind:ResourceNodeType) => {
            for(let attempt=0; attempt<60; attempt++){
                const gridX = Math.random()*this.mapData.width
                const gridY = Math.random()*this.mapData.height
                const { x, y } = this.toWorld(gridX, gridY)

                const tooCloseToShip = useAppStore.getState().ships.some(s => Phaser.Math.Distance.Between(x, y, s.x, s.y) < RESOURCE_NODE_MIN_SPACING_PX)
                if(tooCloseToShip) continue
                const tooCloseToNode = useAppStore.getState().resourceNodes.some(n => Phaser.Math.Distance.Between(x, y, n.x, n.y) < RESOURCE_NODE_MIN_SPACING_PX)
                if(tooCloseToNode) continue

                const metal = kind === ResourceNodeType.Asteroid ? Math.round(ASTEROID_AVG_METAL + (Math.random()*2-1)*ASTEROID_METAL_VARIANCE) : undefined
                const node:ResourceNodeData = { id:v4(), kind, x, y, metal, maxMetal:metal }
                useAppStore.getState().addResourceNode(node)
                this.createResourceNodeSprite(node)
                return
            }
        }

        for(let i=0; i<RESOURCE_ASTEROID_COUNT; i++) placeNode(ResourceNodeType.Asteroid)
        for(let i=0; i<RESOURCE_GAS_CLOUD_COUNT; i++) placeNode(ResourceNodeType.GasCloud)
    }

    // An Asteroid's sprite shrinks as its metal depletes (see updateHarvesters) — clamped so it stays a
    // visible chunk right up until the moment it's actually removed, rather than fading down to an
    // imperceptible speck first.
    asteroidScale = (node:ResourceNodeData) => {
        if(!node.maxMetal) return 1
        const ratio = PhaserMath.Clamp((node.metal ?? 0) / node.maxMetal, 0, 1)
        return 0.4 + ratio*0.6
    }

    createResourceNodeSprite = (node:ResourceNodeData) => {
        // Both node kinds pick one frame at random out of their own block in the 'tiles' spritesheet
        // (AsteroidSpriteIndexes/CloudIndexes) instead of a single procedurally-drawn shape — chosen
        // once here, at creation, so it stays the same frame for that node's whole lifetime.
        const frames = node.kind === ResourceNodeType.Asteroid ? AsteroidSpriteIndexes : CloudIndexes
        const sprite = this.add.image(node.x, node.y, 'tiles', frames[Math.floor(Math.random()*frames.length)]).setDepth(1)
        if(node.kind === ResourceNodeType.Asteroid) sprite.setScale(this.asteroidScale(node))
        this.resourceNodeSprites.set(node.id, sprite)
    }

    updateResourceNodeSprite = (node:ResourceNodeData) => {
        if(node.kind !== ResourceNodeType.Asteroid) return
        this.resourceNodeSprites.get(node.id)?.setScale(this.asteroidScale(node))
    }

    destroyResourceNodeSprite = (id:string) => {
        this.resourceNodeSprites.get(id)?.destroy()
        this.resourceNodeSprites.delete(id)
    }

    // Neutral is a dim green, deliberately not GREY_DIM_HEX — that colour reads as "hostile" everywhere
    // else in this game (ship_hostile_*, ...), and an unclaimed Objective shouldn't look like it's
    // already the enemy's.
    getObjectiveOwnerColor = (owner:Faction | null) => owner === Faction.Player ? GREEN_HEX : owner === Faction.Enemy ? GREY_DIM_HEX : GREEN_DIM_HEX

    createObjectiveSprite = (spawn:ObjectiveSpawn) => {
        const { x, y } = this.toWorld(spawn.x, spawn.y)
        // ObjectiveSpriteIndex maps each ObjectiveSprite name straight onto its frame in the 'tiles'
        // spritesheet — the same reverse lookup spawnEntitiesFromMap used to identify spawn.sprite in
        // the first place, just applied forwards this time to render it.
        const sprite = this.add.image(x, y, 'tiles', ObjectiveSpriteIndex[spawn.sprite]).setDepth(2)
        this.objectiveSprites.set(spawn.id, sprite)

        const label = this.add.text(x, y + OBJECTIVE_ICON_SIZE*0.5 + 4, spawn.sprite, { fontFamily:'Body', fontSize:'11px', color:colors.green }).setOrigin(0.5, 0).setDepth(2)
        this.objectiveLabels.set(spawn.id, label)
    }

    // Every frame: for each Objective, does either faction currently have ARMOR within
    // OBJECTIVE_CAPTURE_RADIUS_PX of it, AND does the *other* faction have no ship also within that
    // same radius? That faction is "contesting" it — checked for both, so contest can be held by either
    // side. The instant contest starts (or switches sides), capturingFaction/captureStartedAtMs are
    // (re)set to track that hold; the instant it breaks (no one contesting, or ARMOR simply
    // leaving/dying resolves the same way — hasArmor just goes false), they reset to null, discarding
    // whatever progress had built up. Only once a single faction has held it uncontested for a full
    // OBJECTIVE_CAPTURE_TIME_MS does owner actually flip — see ObjectiveData for the full model. Also
    // checks the win condition every pass: one faction holding every Objective on the map at once ends
    // the match immediately (handleAllObjectivesCaptured).
    updateObjectives = (time:number) => {
        const { objectives, ships, setObjectives } = useAppStore.getState()
        if(objectives.length === 0) return

        let changed = false
        const updated = objectives.map(objective => {
            const spawn = this.mapData.objectives.find(o => o.id === objective.id)
            if(!spawn) return objective
            const { x, y } = this.toWorld(spawn.x, spawn.y)

            const contestingFaction = [Faction.Player, Faction.Enemy].find(faction => {
                const hasArmor = ships.some(s => s.faction === faction && s.type === ShipType.ARMOR
                    && Phaser.Math.Distance.Between(x, y, s.x, s.y) <= OBJECTIVE_CAPTURE_RADIUS_PX)
                if(!hasArmor) return false

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

    // The match also ends the moment one faction holds every Objective on the map at once — same
    // pause+modal path as a destroyed Base (handleBaseDestroyed), just triggered by the other win
    // condition. `faction` here is the *winner* (whoever holds them all), the opposite sense from
    // handleBaseDestroyed's `faction` (whoever's Base just died) — hence the flipped Victory/Defeat.
    handleAllObjectivesCaptured = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        onShowModal(faction === Faction.Player ? Modal.Victory : Modal.Defeat)
    }

    // Phaser's Graphics has no native dashed-stroke option — this just walks the circumference in
    // alternating dash/gap angular steps (sized from real pixel lengths, so the dash length stays
    // consistent regardless of the circle's radius) and strokes each dash as its own short segment.
    drawDashedCircle = (g:GameObjects.Graphics, cx:number, cy:number, radius:number, color:number, alpha:number, dashLenPx:number = 10, gapLenPx:number = 8) => {
        const circumference = TWO_PI * radius
        const dashAngle = (dashLenPx / circumference) * TWO_PI
        const gapAngle = (gapLenPx / circumference) * TWO_PI
        g.lineStyle(1, color, alpha)
        for(let angle = 0; angle < TWO_PI; angle += dashAngle + gapAngle){
            const endAngle = Math.min(angle + dashAngle, TWO_PI)
            g.lineBetween(cx + Math.cos(angle)*radius, cy + Math.sin(angle)*radius, cx + Math.cos(endAngle)*radius, cy + Math.sin(endAngle)*radius)
        }
    }

    // A dashed ring at OBJECTIVE_CAPTURE_RADIUS_PX around each Objective, tinted the same as its icon
    // (see getObjectiveOwnerColor — neutral/player/enemy) so it's obvious both where the capture radius
    // actually is and who currently holds it, at a glance. While a hold is actually in progress (see
    // updateObjectives' capturingFaction/captureStartedAtMs) it also gets a small progress bar under its
    // label, tinted to whoever's currently contesting it, so the 30s hold itself is visible ticking up —
    // not just the range circle it has to happen inside of.
    drawObjectiveRanges = (time:number) => {
        const g = this.objectiveRangeG
        g.clear()

        useAppStore.getState().objectives.forEach(objective => {
            const spawn = this.mapData.objectives.find(o => o.id === objective.id)
            if(!spawn) return
            const { x, y } = this.toWorld(spawn.x, spawn.y)
            this.drawDashedCircle(g, x, y, OBJECTIVE_CAPTURE_RADIUS_PX, this.getObjectiveOwnerColor(objective.owner), 0.5)

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

    // The match ends the moment either faction's Base is destroyed — called from the onDeath callback
    // wherever a ship can die (detonateDrone, onMissileShipContact, updateArmor). Guarded so a
    // simultaneous double-kill (both Bases in one frame) can't show two modals or double-pause.
    handleBaseDestroyed = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        onShowModal(faction === Faction.Player ? Modal.Defeat : Modal.Victory)
    }

    // Fog of war: every player unit's own sight radius (see isWithinFactionSightRange) makes up their
    // sight range. Every enemy ship is only ever visible while it's standing inside that area, evaluated
    // fresh every frame as both sides' ships move around.
    updateFogOfWar = () => {
        const { ships } = useAppStore.getState()

        ships.filter(s => s.faction === Faction.Enemy).forEach(s => {
            const visible = this.isWithinFactionSightRange(s.x, s.y, Faction.Player)
            this.shipSprites.get(s.id)?.setVisible(visible)
            this.shipLabels.get(s.id)?.setVisible(visible)
        })
    }

    // --- Physics sprite lifecycle -------------------------------------------------------------------
    // Every sprite is created exactly once, at the moment its entity is actually added to the store
    // (spawnShip; spawnEntitiesFromMap for a faction's Base), and destroyed exactly once, at the moment
    // damage actually drops that entity's HP to 0 (the onDeath callbacks passed to applyDamage in
    // detonateDrone/onMissileShipContact/updateArmor). None of this is polled or diffed against the
    // store in the per-frame update loop.

    createShipSprite = (ship:ShipData) => {
        const isFriend = ship.faction === Faction.Player
        const textureKey = (isFriend ? 'ship_friend_' : 'ship_hostile_') + ship.type
        const sprite = this.physics.add.sprite(ship.x, ship.y, textureKey)
        this.centerCircleBody(sprite)
        sprite.setData('kind', 'ship' as BodyKind)
        sprite.setData('id', ship.id)
        this.shipsGroup.add(sprite)
        this.shipSprites.set(ship.id, sprite)

        const label = this.add.text(ship.x, ship.y-SHIP_LABEL_OFFSET_PX, ship.type.toUpperCase(), { fontFamily:'Body', fontSize:'12px', color: colors.green }).setOrigin(0.5).setDepth(4)
        this.shipLabels.set(ship.id, label)

        // Fog of war: an enemy ship starts hidden regardless — updateFogOfWar (run every frame) is what
        // actually decides visibility from here, based on the player's sight range. Starting hidden
        // just avoids a one-frame flash of visibility before that first check runs.
        if(!isFriend){
            sprite.setVisible(false)
            label.setVisible(false)
        }
    }

    destroyShipSprite = (id:string) => {
        this.shipSprites.get(id)?.destroy()
        this.shipSprites.delete(id)
        this.shipLabels.get(id)?.destroy()
        this.shipLabels.delete(id)
    }

    // A physics body's offset is relative to its texture frame's top-left corner — this centers a
    // circle within whatever frame the sprite is currently showing. The radius is derived from the
    // texture's own dimensions rather than passed in: milsymbol's asCanvas() bakes each icon's canvas
    // to exactly its symbol bounding box (see AppSix.ts/renderAppSixIcon), so sprite.width/height
    // already *is* the real rendered icon footprint — friendly rectangle frames and hostile diamond
    // frames alike. Half the shorter side keeps the circle inscribed inside that frame on both shapes.
    centerCircleBody = (sprite:Physics.Arcade.Sprite) => {
        const radius = Math.min(sprite.width, sprite.height) / 2
        const body = sprite.body as Physics.Arcade.Body
        body.setCircle(radius, sprite.width/2 - radius, sprite.height/2 - radius)
    }

    // Applies damage to ships and handles the shared "any ship death" side effects (destroy sprite,
    // shatter effect, and — since a faction's Base is now just another (if critical) ship — ending the
    // match the instant a Base actually dies), so most ship-damage call sites don't have to repeat all
    // three. (detonateDrone applies its own damage inline instead, since it needs to skip the shatter
    // for the drone itself — it already pushed one manually at the moment of detonation.)
    applyShipDamage = (ships:Array<ShipData>, damageByTarget:Map<string,number>, time:number) =>
        applyDamage(ships, damageByTarget, dead => {
            this.destroyShipSprite(dead.id)
            this.shatters.push({ x:dead.x, y:dead.y, createdAt:time, seed:dead.id })
            if(dead.type === ShipType.Base) this.handleBaseDestroyed(dead.faction)
        })

    // Advances every ship one step towards its own route (waypoints — a copy taken from its Base at
    // spawn time, see spawnShip, independently editable afterwards either through that Base
    // (addShipWaypoints, which also pushes the update onto every ship already spawned from it since the
    // Base's own route is just another entry in the same ships array) or by drag-selecting the ship
    // directly). Once a ship has worked through every waypoint it loiters in a slow orbit around the
    // last one; a ship whose orders were cleared instead orbits wherever it was when that happened. The
    // actual stepping — and the collision detection that comes from it — is Arcade Physics' job now
    // (physics.moveTo sets velocity towards the target, the physics step integrates position); this
    // just decides *where* that target is and detects arrival to advance the route. A Base's own
    // speed:0 means physics.moveTo never actually moves it regardless of what target this computes.
    moveShips = (time:number, deltaMs:number) => {
        const { ships, setShips } = useAppStore.getState()
        // ATDs that reach the end of their route detonate — but not mid-map (that would clobber this
        // very setShips call below with a store snapshot that still has them in it), so they're
        // collected here and only actually detonated once this pass's positions have been committed.
        const arrivedAtds:Array<{ ship:ShipData, sprite:Physics.Arcade.Sprite }> = []

        const updated = ships.map(ship => {
            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return ship

            const ownWaypoints = ship.waypoints || []
            // An ATD is a guided munition, not a patrol ship — it only ever follows its route to the
            // first waypoint (its detonation target), never any further ones.
            const waypoints = ship.type === ShipType.ATD ? ownWaypoints.slice(0, 1) : ownWaypoints
            const pathIndex = ship.pathIndex ?? 0
            const speed = ShipData[ship.type].speed
            const step = speed * (deltaMs/1000)

            let target:{x:number,y:number}
            let orbitAnchor = ship.orbitAnchor
            let arrivedAtRouteEnd = false
            if(waypoints.length === 0){
                orbitAnchor = orbitAnchor || { x:sprite.x, y:sprite.y }
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

            const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, target.x, target.y)
            const nextPathIndex = waypoints.length > 0 && pathIndex < waypoints.length ? pathIndex+1 : pathIndex
            if(nextPathIndex !== pathIndex && nextPathIndex >= waypoints.length) arrivedAtRouteEnd = true

            if(dist <= step){
                sprite.setPosition(target.x, target.y)
                sprite.setVelocity(0, 0)
            }
            else {
                this.physics.moveTo(sprite, target.x, target.y, speed)
            }

            this.shipLabels.get(ship.id)?.setPosition(sprite.x, sprite.y-SHIP_LABEL_OFFSET_PX)

            // ATD is a one-shot guided munition: reaching the end of its (single-waypoint) route
            // detonates it right here, same as a contact hit does in onDroneShipContact.
            if(ship.type === ShipType.ATD && arrivedAtRouteEnd && dist <= step) arrivedAtds.push({ ship, sprite })

            return { ...ship, x:sprite.x, y:sprite.y, pathIndex: dist <= step ? nextPathIndex : pathIndex, orbitAnchor }
        })

        setShips(updated)
        arrivedAtds.forEach(({ ship, sprite }) => this.detonateDrone(ship, sprite, null))
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

    // A drone touching a hostile ship detonates immediately, right here — no queueing. If both sides of
    // the pair are hostile drones, shipA goes off first; shipB is only then re-checked (its detonation
    // may have already killed it, e.g. caught in shipA's ATD blast) before it gets to detonate too.
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

    // A drone (KK/ATD) detonates: it always self-destructs, plus damages whatever it hit — a single
    // primary target for KK, or an area blast (physics.overlapCirc — the same "who's nearby" query
    // MLRS/ARMOR's own range check uses) for ATD, which ignores `primary` and just blasts everything
    // hostile nearby. Called exactly once per detonation, directly from whatever triggered it (a
    // contact overlap callback above, or — for an ATD reaching its route's end — moveShips).
    detonateDrone = (drone:ShipData, sprite:Physics.Arcade.Sprite, primary:{ id:string } | null) => {
        const time = this.time.now
        const shipDamage = new Map<string, number>([[drone.id, drone.hp]])

        this.shatters.push({ x:sprite.x, y:sprite.y, createdAt:time, seed:drone.id })

        if(drone.type === ShipType.KK && primary){
            const damage = ShipData[ShipType.KK].damage
            shipDamage.set(primary.id, (shipDamage.get(primary.id) || 0) + damage)
        }
        else if(drone.type === ShipType.ATD){
            const damage = ShipData[ShipType.ATD].damage
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
            this.destroyShipSprite(dead.id)
            if(dead.id !== drone.id) this.shatters.push({ x:dead.x, y:dead.y, createdAt:time, seed:dead.id })
            if(dead.type === ShipType.Base) this.handleBaseDestroyed(dead.faction)
        }))
    }

    // A missile touching its (or any hostile) ship detonates immediately, right here — no queueing.
    onMissileShipContact = (missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missile = missileObj as Physics.Arcade.Sprite
        if(!missile.active) return
        const ship = this.getShipEntry(shipObj)
        if(!ship) return

        const time = this.time.now
        const x = missile.x, y = missile.y, seed = missile.getData('id'), damage = missile.getData('damage')
        missile.destroy()
        this.shatters.push({ x, y, createdAt:time, seed })

        const { ships, setShips } = useAppStore.getState()
        setShips(this.applyShipDamage(ships, new Map([[ship.id, damage]]), time))
    }

    // Nearest hostile ship within radius of a point, found via a spatial physics query
    // (physics.overlapCirc) instead of sweeping every ship in the game. Used by MLRS/ARMOR's own weapon
    // targeting. Every candidate also has to fall within the *shooter's own faction's* sight range (see
    // updateFogOfWar) — weapon range alone isn't enough to fire on something that faction can't
    // actually see, whichever faction's ship is doing the shooting. This is what stops the AI sniping
    // things it has no business knowing about; it never gets to peek at the player's own fog of war
    // (which is all "faction" meant here before — always Faction.Player, regardless of who was actually
    // shooting).
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

    // Each MLRS, on cooldown, launches a whole salvo (MISSILE_SALVO_SIZE) of missiles, SALVO_STAGGER_MS
    // apart so they read as a salvo instead of one stacked blob, all homing on whichever hostile ship is
    // nearest in range. Only the salvo's first shot needs a live target (to justify firing at all);
    // every shot after that fires regardless of whether that target is still around by the time its
    // delay elapses — if it's gone, the missile just retargets or fizzles onward (see updateMissiles),
    // it isn't skipped. Each MLRS starts with a fixed ammoRemaining (see ShipData's ammo) that's spent
    // 1-per-missile and never refills — once it's at 0 it can no longer fire at all, cooldown or not; a
    // salvo that would otherwise fire more shots than remain just fires however many it can still afford
    // instead.
    updateMlrs = (time:number) => {
        const { ships, setShips } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const shotsFired = new Map<string, number>()

        ships.forEach(ship => {
            if(ship.type !== ShipType.MLRS) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.MLRS].cooldownMs) return
            if(!ship.ammoRemaining) return

            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return

            const targetShip = this.findNearestHostileShip(ship.faction, sprite.x, sprite.y, ShipData[ShipType.MLRS].rangePx)
            if(!targetShip) return

            const shots = Math.min(MISSILE_SALVO_SIZE, ship.ammoRemaining)
            shooterIds.add(ship.id)
            shotsFired.set(ship.id, shots)
            const targetId = targetShip.getData('id')
            const aimX = targetShip.x, aimY = targetShip.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!sprite.active) return
                    this.spawnMissile(ship.faction, sprite.x, sprite.y, targetId, ShipData[ShipType.MLRS].damage, aimX, aimY)
                })
            }
        })

        if(shooterIds.size > 0){
            setShips(ships.map(ship => shooterIds.has(ship.id)
                ? { ...ship, lastFiredAtMs:time, ammoRemaining:ship.ammoRemaining-shotsFired.get(ship.id) }
                : ship))
        }
    }

    // Each ARMOR unit, on cooldown, fires a single instant shot (not a homing missile) at whichever
    // hostile ship is nearest in range.
    updateArmor = (time:number) => {
        const { ships, setShips } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const damageByTarget = new Map<string, number>()

        ships.forEach(ship => {
            if(ship.type !== ShipType.ARMOR) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < ShipData[ShipType.ARMOR].cooldownMs) return

            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return

            const targetShip = this.findNearestHostileShip(ship.faction, sprite.x, sprite.y, ShipData[ShipType.ARMOR].rangePx)
            if(!targetShip) return

            shooterIds.add(ship.id)
            this.tracers.push({ x1:sprite.x, y1:sprite.y, x2:targetShip.x, y2:targetShip.y, createdAt:time })
            const targetId = targetShip.getData('id')
            damageByTarget.set(targetId, (damageByTarget.get(targetId) || 0) + ShipData[ShipType.ARMOR].damage)
        })

        if(shooterIds.size === 0) return

        setShips(this.applyShipDamage(ships.map(ship => shooterIds.has(ship.id) ? { ...ship, lastFiredAtMs:time } : ship), damageByTarget, time))
    }

    // Each Harvester draws HARVESTER_COLLECTION_RATE_PER_S metal/second from whichever Asteroid is
    // nearest within HARVESTER_RANGE_PX of it (a plain distance loop, not a physics query — there are
    // few enough resource nodes that this is cheap, and they have no physics body to query against
    // anyway). GasClouds aren't drawn from at all here — a GasCloud's whole effect is passive, read
    // straight off proximity by Utils' getLogisticsStatus, nothing to do per-frame for it. Multiple
    // Harvesters draining the same Asteroid within one frame all see each other's draw-down (via
    // `drawdown`, a running total per node this pass) rather than each reading the same stale value, so
    // they can't collectively over-draw it below 0.
    updateHarvesters = (time:number, deltaMs:number) => {
        const { ships, resourceNodes, addMetal, setResourceNodes } = useAppStore.getState()
        const harvesters = ships.filter(s => s.type === ShipType.Harvester)
        if(harvesters.length === 0 || resourceNodes.length === 0) return

        const drawdown = new Map<string, number>() // asteroid id -> metal drawn this frame so far
        const metalGained = new Map<Faction, number>()

        harvesters.forEach(harvester => {
            const sprite = this.shipSprites.get(harvester.id)
            if(!sprite) return

            let nearest:ResourceNodeData = null
            let nearestDist = Infinity
            resourceNodes.forEach(node => {
                if(node.kind !== ResourceNodeType.Asteroid) return
                const remaining = (node.metal ?? 0) - (drawdown.get(node.id) || 0)
                if(remaining <= 0) return
                const d = Phaser.Math.Distance.Between(sprite.x, sprite.y, node.x, node.y)
                if(d <= HARVESTER_RANGE_PX && d < nearestDist){ nearestDist = d; nearest = node }
            })
            if(!nearest) return

            const remaining = (nearest.metal ?? 0) - (drawdown.get(nearest.id) || 0)
            const gathered = Math.min(remaining, HARVESTER_COLLECTION_RATE_PER_S * (deltaMs/1000))
            drawdown.set(nearest.id, (drawdown.get(nearest.id) || 0) + gathered)
            metalGained.set(harvester.faction, (metalGained.get(harvester.faction) || 0) + gathered)
        })

        if(drawdown.size === 0) return

        metalGained.forEach((amount, faction) => addMetal(faction, amount))

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

        // Flies its arc as an explicit leg from launch to aim point — see startMissileLeg — driven by
        // directly moving the sprite each frame (updateMissiles), never by velocity, so its rendered
        // position and its physics/collision body are always the exact same point. No separate "ground
        // truth vs visual" tracking of any kind.
        this.startMissileLeg(missile, x, y, aimPointX, aimPointY)
    }

    // (Re)starts a missile's current straight-line "leg": legOrigin is where it departs from right now,
    // legTarget is the aim point it's heading for, and legDurationMs is how long that leg should take at
    // MISSILE_SPEED_PX_S — together these are the one shared basis both updateMissiles' position
    // interpolation and its cosmetic sin-bump arc height read progress from. Called once at spawn, and
    // again on every retarget (see updateMissiles), so a new leg always starts fresh from wherever the
    // missile actually is at that moment.
    startMissileLeg = (missile:Physics.Arcade.Sprite, originX:number, originY:number, targetX:number, targetY:number) => {
        missile.setData('legOriginX', originX)
        missile.setData('legOriginY', originY)
        missile.setData('legTargetX', targetX)
        missile.setData('legTargetY', targetY)
        missile.setData('legStartAt', this.time.now)
        const legDistance = Phaser.Math.Distance.Between(originX, originY, targetX, targetY)
        missile.setData('legDurationMs', (legDistance / MISSILE_SPEED_PX_S) * 1000)
    }

    // Every frame, a missile's position is computed directly from its current leg (see
    // startMissileLeg) — straight-line progress from legOrigin to legTarget, plus a sin-bump height for
    // the cosmetic arc — and written into the sprite via body.reset(), which moves the physics body and
    // the rendered sprite together as one single update. There is deliberately no "ground truth vs
    // visual" split of any kind: whatever position is used for collision is exactly the position drawn
    // on screen, always. If the original target died, it retargets by starting a brand new leg from its
    // current (already-arced) position to whatever hostile ship is now nearest (searched over the whole
    // map — a missile mid-flight has no "range" of its own the way a stationary weapon does), and keeps
    // trying every frame right up until its leg completes in case something comes into range before
    // then. If nothing's ever found, it's destroyed (with a shatter effect, same as an actual impact)
    // the instant its leg's arc finishes, rather than flying on forever with nothing to hit.
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

            // The leg's run its full course (rawProgress could only still exceed 1 here if nothing was
            // found to retarget onto above) with nothing to show for it — fizzle right where the arc
            // came back down instead of flying on forever in a straight line.
            if(rawProgress > 1){
                child.destroy()
                this.shatters.push({ x:legTargetX, y:legTargetY, createdAt:time, seed:child.getData('id') })
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
                g.fillStyle(GREEN_HEX, (1-progress) * (1-i*0.2))
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

            g.lineStyle(1.5, GREEN_HEX, alpha)
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

    // Every missile renders itself now (its sprite's real position *is* its physics/collision position
    // — see updateMissiles) — this only draws the decaying vapor trail left behind it, as a single
    // polyline per missile (each segment's alpha fading with its own age) rather than a cloud of
    // independent dots, so a trail actually reads as one continuous contrail curving through the arc.
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

        // faint grid, brighter every 5 cells
        for(let i=0; i<=this.mapData.width; i++){
            const isMajor = i % 5 === 0
            g.lineStyle(1, GREEN_DIM_HEX, isMajor ? 0.6 : 0.25)
            g.lineBetween(i*CELL_SIZE, 0, i*CELL_SIZE, worldSize)
            g.lineBetween(0, i*CELL_SIZE, worldSize, i*CELL_SIZE)
        }

        this.drawTerrain()
    }

    // mapData.terrain is always null now — nothing populates it anymore (ships/objectives are read
    // directly off Phaser's own tilemap loader instead, see spawnEntitiesFromMap) — so this is
    // currently a permanent no-op, left in place in case terrain annotation via a separate Tiled layer
    // comes back later.
    drawTerrain = () => {
        const g = this.g
        const terrain = this.mapData.terrain
        if(!terrain) return

        const scaleX = CELL_SIZE / terrain.tilewidth
        const scaleY = CELL_SIZE / terrain.tileheight
        const tileW = terrain.tilewidth * scaleX
        const tileH = terrain.tileheight * scaleY

        g.lineStyle(1, GREEN_DIM_HEX, 0.6)
        terrain.layers.forEach(layer => {
            for(let ty=0; ty<layer.height; ty++){
                for(let tx=0; tx<layer.width; tx++){
                    // if(!layer.data[ty*layer.width + tx]) continue
                    // g.strokeRect(tx*tileW, ty*tileH, tileW, tileH)
                }
            }
        })
    }

    // Draws each selected ship's own route (line + numbered waypoint markers) — a selected Base's own
    // route reads identically to any other ship's, since it's the exact same field (see ShipData in
    // types.d.ts). Always redraws (ships move, so nothing here can be cached the way a stationary
    // building's route once was).
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

    // Shared marker/line renderer for drawOrders: a line from originWorld through every waypoint (grid
    // coordinates, converted here), each waypoint marked with a numbered circle — individually
    // cancellable by clicking the marker (see the selection click handler and removeShipWaypoints).
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

    // Every ship's own sight-radius circle — units move, so this runs every frame from update() rather
    // than only whenever drawMap's static art changes. Same-faction circles merge into one seamless
    // shape (each one's boundary is trimmed wherever a same-faction circle covers it, so there's no
    // interior line through the overlap). A non-player (enemy) circle starts fully hidden instead of
    // full — the player has no business seeing the full extent of an enemy's sight radius, only the arcs
    // of it that actually fall within the player's own sight radius get revealed. The overlap itself is
    // additionally communicated with a light fill over the lens-shaped intersection.
    drawPlacementRanges = () => {
        const g = this.rangeG
        g.clear()

        const circles = useAppStore.getState().ships.map(s => ({ x: s.x, y: s.y, r: ShipData[s.type].sightRadius, faction: s.faction }))

        g.lineStyle(1, GREEN_HEX, 0.25)
        circles.forEach((circle, i) => {
            let visible:Array<[number,number]> = circle.faction === Faction.Player ? [[0, TWO_PI]] : []

            // Reveal only the arcs of an enemy circle that overlap a player sight circle — everywhere
            // else, the player has no way of knowing how far that enemy can actually see.
            if(circle.faction !== Faction.Player) circles.forEach(player => {
                if(player.faction !== Faction.Player) return
                const dx = player.x - circle.x
                const dy = player.y - circle.y
                const d = Math.hypot(dx, dy)
                if(d < 0.001 || d >= circle.r + player.r) return
                if(d + circle.r <= player.r){ visible = [[0, TWO_PI]]; return } // whole enemy bubble sits inside player's own
                if(d + player.r <= circle.r) return // player bubble fully inside this one — doesn't touch the boundary

                const cosTheta = PhaserMath.Clamp((d*d + circle.r*circle.r - player.r*player.r) / (2*d*circle.r), -1, 1)
                const theta = Math.acos(cosTheta)
                const alpha = Math.atan2(dy, dx)
                visible = addCircularRange(visible, alpha-theta, alpha+theta)
            })

            circles.forEach((other, j) => {
                if(i === j || other.faction !== circle.faction) return
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

        g.fillStyle(GREEN_HEX, 0.12)
        circles.forEach((circle, i) => {
            circles.forEach((other, j) => {
                if(j <= i || other.faction === circle.faction) return
                this.fillCircleOverlap(g, circle, other)
            })
        })
    }

    // The shaded region where two opposing-faction sight circles overlap: either the lens bounded by
    // their two intersection points (the common "two arcs meeting at both crossing points" construction),
    // or, if one circle sits entirely inside the other, that whole smaller circle.
    fillCircleOverlap = (g:GameObjects.Graphics, circle:{x:number,y:number,r:number}, other:{x:number,y:number,r:number}) => {
        const dx = other.x - circle.x
        const dy = other.y - circle.y
        const d = Math.hypot(dx, dy)
        if(d >= circle.r + other.r) return // no overlap at all

        if(d < 0.001 || d <= Math.abs(circle.r - other.r)){
            const inner = circle.r <= other.r ? circle : other
            g.fillCircle(inner.x, inner.y, inner.r)
            return
        }

        const alpha = Math.atan2(dy, dx)
        const thetaA = Math.acos(PhaserMath.Clamp((d*d + circle.r*circle.r - other.r*other.r) / (2*d*circle.r), -1, 1))
        const alphaB = alpha + Math.PI
        const thetaB = Math.acos(PhaserMath.Clamp((d*d + other.r*other.r - circle.r*circle.r) / (2*d*other.r), -1, 1))

        g.beginPath()
        g.arc(circle.x, circle.y, circle.r, alpha-thetaA, alpha+thetaA, false)
        g.arc(other.x, other.y, other.r, alphaB-thetaB, alphaB+thetaB, false)
        g.closePath()
        g.fillPath()
    }

    // Full sight range: every one of that faction's own ships projecting its own ShipStats.sightRadius
    // around itself — a faction's Base contributes exactly the same way any other ship does, it just
    // never moves. Used by updateFogOfWar and every findNearestHostile* weapon-targeting query.
    isWithinFactionSightRange = (worldX:number, worldY:number, faction:Faction) => {
        const ownShips = useAppStore.getState().ships.filter(s => s.faction === faction)
        return ownShips.some(s => Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= ShipData[s.type].sightRadius)
    }

    // Hit-tests the player's own ships against a world point (single click, not a drag) — used to
    // select exactly one ship, most usefully the player's own Base (opening its production panel, see
    // FactoryToolbar) but works the same for any ship.
    findOwnShipAt = (worldX:number, worldY:number) => {
        return useAppStore.getState().ships.find(s => {
            if(s.faction !== Faction.Player) return false
            const r = Math.max(ShipData[s.type].sizeHex * CELL_SIZE/2, 10)
            return Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= r
        })
    }

    enableSelectionControls = () => {
        this.input.on('pointerdown', (pointer:Phaser.Input.Pointer) => {
            if(!this.hoveredCell) return
            if(!pointer.leftButtonDown()) return

            // Plain left-mousedown always starts a potential unit-selection box (resolved into either a
            // click or a full box-select on pointerup, by drag distance — see enableCameraControls'
            // pointerup/handleClick below). Shift+left-drag and right-drag are both reserved for panning
            // the camera instead, handled entirely by pointermove/pointerup, so there's nothing to do
            // here for either.
            if(!this.shiftDown){
                const worldPoint = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y)
                this.dragSelectStart = { x:worldPoint.x, y:worldPoint.y }
                this.dragSelectCurrent = this.dragSelectStart
            }
        })

        this.input.keyboard.on('keydown-ESC', () => {
            useAppStore.getState().setSelectedShipIds([])
        })
    }

    // A shift-less pointerdown/up with negligible movement (see enableCameraControls' pointerup, which
    // decides click vs. box-select by drag distance) — click-to-select/order handling lives here rather
    // than pointerdown itself so it only fires once we know the gesture wasn't actually a drag.
    handleClick = (worldX:number, worldY:number) => {
        if(!this.hoveredCell) return
        const { ships, selectedShipIds, setSelectedShipIds, addShipWaypoints, removeShipWaypoints } = useAppStore.getState()

        // Clicking directly on one of the player's own ships always (re)selects just that ship, even
        // while a different group is already selected — takes priority over handing the existing
        // selection a new waypoint.
        const clicked = this.findOwnShipAt(worldX, worldY)
        if(clicked){
            setSelectedShipIds([clicked.id])
            return
        }

        // A selection (a drag-selected group of combat ships, or a single selected Base) takes
        // orders the same way either way — every click adds one more waypoint onto each selected
        // ship's own route. Clicking a cell that's already a waypoint for any of the selected ships
        // removes it from every selected ship that has one there instead (removeShipWaypoints), same
        // click-to-remove gesture, just applied across the whole selection at once.
        if(selectedShipIds.length > 0){
            const { x, y } = this.hoveredCell
            if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return
            const selectedShips = ships.filter(s => selectedShipIds.includes(s.id))
            const clickedExisting = selectedShips.some(s => s.waypoints?.some(w => w.x === x && w.y === y))
            if(clickedExisting) removeShipWaypoints(selectedShipIds, x, y)
            else addShipWaypoints(selectedShipIds, x, y)
            return
        }

        setSelectedShipIds([])
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

            // A box-select drag in progress (see enableSelectionControls' pointerdown) owns the
            // drag entirely — no camera panning while it's live.
            if(this.dragSelectStart){
                this.dragSelectCurrent = { x:worldPoint.x, y:worldPoint.y }
                this.drawDragSelectBox()
                return
            }

            // Panning fires for right-drag (either button) or shift+left-drag — dragSelectStart being
            // null already rules out a plain (non-shift) left-drag, which owns the drag for box-select
            // instead (see the early return above).
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
            if(!this.dragSelectStart) return
            const start = this.dragSelectStart
            const end = this.dragSelectCurrent || start
            this.dragSelectStart = null
            this.dragSelectCurrent = null
            this.dragSelectG.clear()

            // Every shift-less mousedown starts a potential box-select (so the box can be drawn live as
            // the pointer moves — see pointermove above), but most of them are actually just clicks. A
            // pointer that barely moved from its down position is a click, not a drag — hand it to the
            // same select/order logic a click has always used (see enableSelectionControls' handleClick)
            // instead of resolving it as an (empty) box-select.
            const pointer = this.input.activePointer
            if(Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.upX, pointer.upY) < 6){
                this.handleClick(start.x, start.y)
                return
            }

            const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
            const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)

            const { ships, setSelectedShipIds } = useAppStore.getState()
            const hitIds = ships
                .filter(s => s.faction === Faction.Player && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
                .map(s => s.id)
            setSelectedShipIds(hitIds)
        })

        this.input.on('wheel', (_pointer, _objs, _dx, dy:number) => {
            // Straight toggle between the two levels rather than stepping through an index — exact so
            // long as ZOOM_LEVELS only ever holds two entries (see its own comment).
            this.cameras.main.setZoom(dy < 0 ? ZOOM_LEVELS[ZOOM_LEVELS.length-1] : ZOOM_LEVELS[0])
        })
    }

    // Draws the live box-select selection rectangle in world space (see dragSelectStart/Current).
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
