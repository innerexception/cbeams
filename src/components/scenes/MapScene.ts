import { Scene, GameObjects, Physics, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene, onShowModal } from "../../common/Thunks";
import { getLogisticsStatus, getVehicleLogisticsCost, seededRandom } from "../../common/Utils";
import { generateMap } from "../../common/MapGenerator";
import { spawnEnemyLogisticsCenters, spendEnemyBuildingPoints, spawnEnemyRaid, checkEnemyRaid, checkEnemyBlmDefense } from "../../common/AIPlayers";
import { BUILDING_SIDC_FUNCTION, VEHICLE_SIDC_FUNCTION, buildSidc, renderAppSixIcon } from "../../common/AppSix";
import { Faction, BuildingType, VehicleType, Modal, BuildingData, VehicleData, TargetType, ObjectiveSprite } from "../../../enum";
import {
    MAP_SIZE, CELL_SIZE, gridToWorld, worldToGrid,
    PLACEMENT_RADIUS_PX, EXTRACTOR_RADIUS_PX,
    TRACER_LIFETIME_MS,
    ATD_BLAST_RADIUS_PX,
    MISSILE_SALVO_SIZE, MISSILE_SPEED_PX_S, MISSILE_MAX_LIFETIME_MS, SALVO_STAGGER_MS,
    MISSILE_ARC_HEIGHT_PX, CONTRAIL_INTERVAL_MS, CONTRAIL_LIFETIME_MS,
    THADD_SALVO_SIZE,
    UPLINK_REVEAL_DURATION_MS,
    SHATTER_LIFETIME_MS,
    OBJECTIVE_CAPTURE_RADIUS_PX, OBJECTIVE_ICON_SIZE, OBJECTIVE_CAPTURE_TIME_MS,
    LOGISTICS_CENTER_COUNT, LOGISTICS_CENTER_MIN_SPACING_PX,
    NATO_ICON_SIZE, BASE_FOOTPRINT_RADIUS, FACTORY_FOOTPRINT_RADIUS, SHIP_BUILDING_CLEARANCE_PX, BUILDING_MIN_CLEARANCE_PX, GREEN_HEX, GREEN_DIM_HEX, GREY_DIM_HEX,
} from "../../common/Constants";
import { colors } from "../../styles/AppStyles";

const TWO_PI = Math.PI*2

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

// Mining stations and solar mills project a smaller placement radius than bases/shipyards/CRAM turrets.
// This same per-structure radius is also each faction's sight range (see updateFogOfWar) — the
// territory border drawn by drawPlacementRanges doubles as "how far that faction can currently see".
const FULL_RADIUS_KINDS = new Set([BuildingType.LogisticsCenter, BuildingType.CRAM, BuildingType.Base, BuildingType.BLM, BuildingType.THADD, BuildingType.Radar])
// A kind whose BuildingMetaData sets its own sightRadius (currently just Radar) uses that directly,
// overriding the FULL_RADIUS_KINDS binary choice entirely.
const getStructureRadius = (structure:BuildingData) => {
    const override = BuildingData[structure.kind].sightRadius
    if(override !== undefined) return override
    return !FULL_RADIUS_KINDS.has(structure.kind) ? EXTRACTOR_RADIUS_PX : PLACEMENT_RADIUS_PX
}

// Each building kind's max HP now lives on its BuildingMetaData entry in enum.ts (the tougher,
// non-placeable Base has its own, higher, value there).
const getBuildingMaxHp = (kind:BuildingType) => BuildingData[kind].maxHp

// Bases have a bigger physical footprint than an ordinary building.
const getBuildingFootprintRadius = (kind:BuildingType) => kind === BuildingType.Base ? BASE_FOOTPRINT_RADIUS : FACTORY_FOOTPRINT_RADIUS

// Whether a vehicle kind's declared TargetType (see VehicleData in enum.ts) covers a given kind of
// contact target — TargetType.Any covers both. Replaces the old hardcoded KK/ATD type checks that
// decided which drones could detonate against a ship vs. a building.
const vehicleTargets = (type:VehicleType, kind:TargetType) => {
    const targetType = VehicleData[type].targetType
    return targetType === kind || targetType === TargetType.Any
}

// Applies accumulated damage to any {id, hp} collection (ships or buildings alike), removing anything
// that drops to 0 HP or below. `onDeath` lets the caller leave its own effect at the death location —
// shared by the CRAM turret's cannon, MLRS missile impacts, and every drone-detonation damage pass.
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

// One shape per body kind, tagged on every physics sprite via setData('kind', ...) so overlap/query
// callbacks (which only see raw Arcade bodies) can tell what they actually hit.
type BodyKind = 'ship' | 'building' | 'missile'

export default class MapScene extends Scene {

    // Static/decorative art: the map grid, bases, terrain. None of this needs a physics body — it
    // never moves and nothing ever collides with it.
    g: GameObjects.Graphics
    // Territory/sight-range bubbles get their own layer, redrawn every frame (see drawPlacementRanges)
    // since unit sight range moves continuously — unlike the rest of the static art above, which only
    // ever needs to be touched when a building is added or removed.
    rangeG: GameObjects.Graphics
    previewG: GameObjects.Graphics
    // The placement ghost's icon — a real APP-6 'factory_'+kind texture (baked by generateTextures),
    // tinted/faded per showPreviewIcon rather than hand-drawn into previewG. Reassigned per-call, so its
    // initial texture key here is arbitrary.
    previewIcon: GameObjects.Image
    selectionG: GameObjects.Graphics
    progressG: GameObjects.Graphics
    healthG: GameObjects.Graphics
    ordersG: GameObjects.Graphics
    combatG: GameObjects.Graphics
    shatterG: GameObjects.Graphics
    trailG: GameObjects.Graphics
    ammoG: GameObjects.Graphics
    objectiveRangeG: GameObjects.Graphics
    uplinkSweepG: GameObjects.Graphics
    // Shift+left-drag rectangle for selecting a group of the player's own ships (see enablePlacementControls'
    // pointerdown/enableCameraControls' pointermove) — plain left-drag is still reserved for panning.
    dragSelectG: GameObjects.Graphics

    // Every ship, building and missile is a real Arcade Physics sprite so collision (a drone touching a
    // hostile unit/building, a missile hitting its target) is detected by Phaser's overlap system
    // instead of a hand-rolled O(n^2) distance sweep every frame. Ranged targeting (a CRAM turret or an
    // MLRS picking a target "in range") uses physics.overlapCirc — a spatial query — instead of scanning
    // every ship. Zustand remains the source of truth for game *state* (hp, faction, orders, ...); each
    // sprite just carries that entity's id via setData so the two can be looked up from one another.
    shipsGroup: Physics.Arcade.Group
    buildingsGroup: Physics.Arcade.StaticGroup
    missilesGroup: Physics.Arcade.Group
    shipSprites: Map<string, Physics.Arcade.Sprite> = new Map()
    buildingSprites: Map<string, Physics.Arcade.Sprite> = new Map()
    shipLabels: Map<string, GameObjects.Text> = new Map()
    // Objectives have no physics body at all (capture is a plain distance check, not a collision — see
    // updateObjectives) — just a plain Image, tinted per current owner.
    objectiveSprites: Map<string, GameObjects.Image> = new Map()
    objectiveLabels: Map<string, GameObjects.Text> = new Map()

    orderLabels: Array<GameObjects.Text> = []
    lastOrdersKey: string = ''
    // Shift-drag box-select state (world coordinates) — set on pointerdown while Shift is held, updated
    // on every pointermove, resolved into a selectedShipIds set on pointerup. null whenever no drag is
    // in progress, which is also what tells enableCameraControls' pointermove to skip the normal pan.
    shiftDown: boolean = false
    dragSelectStart: { x:number, y:number } | null = null
    dragSelectCurrent: { x:number, y:number } | null = null
    // Set by activateUplink to this.time.now+UPLINK_REVEAL_DURATION_MS — while this.time.now is still
    // under it, isWithinFactionSightRange treats the player's sight range as unlimited, which in turn
    // reveals every hostile building/ship (updateFogOfWar) AND lets every one of the player's own
    // weapons (findNearestHostile*) acquire targets anywhere on the map, not just fog-of-war rendering.
    mapRevealedUntil: number = 0
    tracers: Array<{ x1:number, y1:number, x2:number, y2:number, createdAt:number }> = []
    shatters: Array<{ x:number, y:number, createdAt:number, seed:string }> = []
    // Decaying vapor-trail points left behind an offensive missile's actual (arced) flight path — see
    // startMissileLeg/updateMissiles for how the arc itself is computed, drawMissileTrails for the draw.
    // Tagged per-missile (missileId) so drawMissileTrails can connect each missile's own points into its
    // own polyline instead of drawing every missile's dots into one shared cloud.
    contrails: Array<{ x:number, y:number, createdAt:number, missileId:string }> = []

    // Enemy AI state — read/written by the helper functions in src/common/AIPlayers.ts, which take
    // this scene as their first argument rather than owning the state themselves.
    enemyShipyardId: string
    enemyRaidLaunched: boolean = false
    // Every player BLM the enemy has already reacted to (see AIPlayers' buildEnemyThadd) — tracked by
    // id, not a running count, so a BLM that's destroyed and later rebuilt still triggers a fresh reaction.
    reactedBlmIds: Set<string> = new Set()
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
        this.previewG = this.add.graphics()
        this.selectionG = this.add.graphics()
        this.progressG = this.add.graphics()
        this.healthG = this.add.graphics()
        this.ordersG = this.add.graphics()
        this.combatG = this.add.graphics()
        this.shatterG = this.add.graphics()
        this.trailG = this.add.graphics()
        this.ammoG = this.add.graphics()
        this.objectiveRangeG = this.add.graphics()
        this.uplinkSweepG = this.add.graphics()
        this.dragSelectG = this.add.graphics()

        this.input.keyboard.on('keydown-SHIFT', () => this.shiftDown = true)
        this.input.keyboard.on('keyup-SHIFT', () => this.shiftDown = false)

        this.generateTextures()
        this.previewIcon = this.add.image(0, 0, 'factory_'+BuildingType.LogisticsCenter).setVisible(false)
        this.shipsGroup = this.physics.add.group()
        this.buildingsGroup = this.physics.add.staticGroup()
        this.missilesGroup = this.physics.add.group()

        // Contact damage: a drone (KK/ATD) touching a hostile ship or building. The process callback
        // does the faction/type filtering so the collide callback only ever sees a real detonation.
        this.physics.add.overlap(this.shipsGroup, this.shipsGroup, this.onDroneShipContact, this.isHostileDroneShipPair, this)
        this.physics.add.overlap(this.shipsGroup, this.buildingsGroup, this.onDroneBuildingContact, this.isHostileDroneBuildingPair, this)
        // Impact damage: a missile (MLRS or BLM) touching a hostile ship or building.
        this.physics.add.overlap(this.missilesGroup, this.shipsGroup, this.onMissileShipContact, this.isHostileMissileShipPair, this)
        this.physics.add.overlap(this.missilesGroup, this.buildingsGroup, this.onMissileBuildingContact, this.isHostileMissileBuildingPair, this)
        // Interception: a THADD interceptor touching a hostile missile destroys both, whether or not
        // it's the specific missile that interceptor was actually launched at.
        this.physics.add.overlap(this.missilesGroup, this.missilesGroup, this.onMissileMissileContact, this.isHostileMissilePair, this)

        this.mapData = useAppStore.getState().activeMap || generateMap(MAP_SIZE)
        // Every match starts in the placement phase — the enemy's own building/ships (spawned below)
        // stay hidden and the AI holds its raid until the player finishes placing their 3
        // LogisticsCenters (see startCombatPhase).
        useAppStore.getState().setPhase('placement')

        this.cameras.main.setZoom(1)
        this.centerCameraBounds()

        this.spawnBases()
        this.spawnObjectives()
        spawnEnemyLogisticsCenters(this)
        spendEnemyBuildingPoints(this)
        this.drawMap()
        this.enableCameraControls()
        this.enablePlacementControls()

        this.time.addEvent({ delay: 500, loop: true, callback: this.tickProduction })

        this.unsubscribe = useAppStore.subscribe((state, prevState) => {
            if(state.placingFactory !== prevState.placingFactory) this.updatePreview()
            checkEnemyBlmDefense(this, state)

            // A drag-selected ship that dies stays a dangling id in selectedShipIds forever otherwise
            // (nothing else ever prunes it) — drop it the moment the vehicle list actually shrinks, and
            // close the selection panel entirely (empty array) once none of the selected ships survive.
            if(state.selectedShipIds.length > 0 && state.vehicles.length !== prevState.vehicles.length){
                const stillAlive = state.selectedShipIds.filter(id => state.vehicles.some(v => v.id === id))
                if(stillAlive.length !== state.selectedShipIds.length) useAppStore.getState().setSelectedShipIds(stillAlive)
            }
        })
        this.events.once('shutdown', () => this.unsubscribe())

        useAppStore.getState().setLoaded(true)
    }

    // Every ship/building sprite renders a real APP-6 unit symbol, generated at runtime by milsymbol
    // from a SIDC built out of BUILDING_SIDC_FUNCTION/VEHICLE_SIDC_FUNCTION (see src/common/AppSix.ts)
    // — baked into a texture once, up front, exactly like the old hand-drawn Graphics shapes were, just
    // via addCanvas instead of generateTexture since milsymbol hands back a ready-made canvas.
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
        const buildingSize = Math.ceil(CELL_SIZE*2)

        Object.values(VehicleType).forEach(type => {
            const fn = VEHICLE_SIDC_FUNCTION[type]
            this.textures.addCanvas('ship_friend_'+type, renderAppSixIcon(buildSidc(Faction.Player, fn), shipSize, GREEN_HEX))
            this.textures.addCanvas('ship_hostile_'+type, renderAppSixIcon(buildSidc(Faction.Enemy, fn), shipSize, GREY_DIM_HEX))
        })
        Object.values(BuildingType).forEach(kind => {
            const fn = BUILDING_SIDC_FUNCTION[kind]
            this.textures.addCanvas('factory_'+kind, renderAppSixIcon(buildSidc(Faction.Player, fn), buildingSize, GREEN_HEX))
        })

        bake('missile_dot', 8, (g, cx, cy) => { g.fillStyle(GREEN_HEX, 0.9); g.fillCircle(cx, cy, 2) })

        // Objectives aren't military units/buildings, so they skip the SIDC/milsymbol pipeline entirely
        // — a small hand-drawn pictograph each, baked once in plain white so setTint (see
        // createObjectiveSprite/updateObjectives) can recolor by current owner without rebaking.
        bake('objective_'+ObjectiveSprite.OilField, OBJECTIVE_ICON_SIZE, (g, cx, cy) => {
            g.lineStyle(2, 0xFFFFFF, 1)
            g.lineBetween(cx-16, cy+14, cx+16, cy+14)
            g.strokeTriangle(cx, cy-16, cx-9, cy+14, cx+9, cy+14)
            g.lineBetween(cx-4, cy-2, cx+4, cy-2)
        })
        bake('objective_'+ObjectiveSprite.City, OBJECTIVE_ICON_SIZE, (g, cx, cy) => {
            g.lineStyle(2, 0xFFFFFF, 1)
            const groundY = cy+14
            g.lineBetween(cx-18, groundY, cx+18, groundY)
            const bars = [{ dx:-14, w:6, h:12 }, { dx:-6, w:6, h:20 }, { dx:2, w:6, h:9 }, { dx:9, w:6, h:16 }]
            bars.forEach(b => g.strokeRect(cx+b.dx, groundY-b.h, b.w, b.h))
        })
        bake('objective_'+ObjectiveSprite.NuclearReactor, OBJECTIVE_ICON_SIZE, (g, cx, cy) => {
            g.lineStyle(2, 0xFFFFFF, 1)
            g.fillStyle(0xFFFFFF, 1)
            g.fillCircle(cx, cy, 3)
            for(let i=0; i<3; i++){
                const angle = -Math.PI/2 + i*(Math.PI*2/3)
                const x1 = cx + Math.cos(angle)*7, y1 = cy + Math.sin(angle)*7
                const x2 = cx + Math.cos(angle)*15, y2 = cy + Math.sin(angle)*15
                g.lineBetween(x1, y1, x2, y2)
                g.strokeCircle(x2, y2, 3)
            }
        })

        tmp.destroy()
    }

    // Pulsating octagon around the currently selected shipyard, redrawn every frame for the animation.
    update = (time:number, delta:number) => {
        this.moveShips(time, delta)
        this.updateCramTurrets(time)
        this.updateMlrs(time)
        this.updateArmor(time)
        this.updateBlm(time)
        this.updateThadd(time)
        this.updateAmmoDumps(time)
        this.updateObjectives(time)
        this.updateMissiles(time, delta)
        checkEnemyRaid(this)
        this.updateFogOfWar()
        this.drawPlacementRanges()
        this.drawObjectiveRanges(time)
        this.drawUplinkSweep(time)

        this.drawProductionProgress()
        this.drawBuildingHealth()
        this.drawAmmoGauges(time)
        this.drawOrders()
        this.drawCombat(time)
        this.drawShatters(time)
        this.drawMissileTrails(time)

        this.selectionG.clear()
        const { selectedFactoryId, selectedShipIds, buildings: factories, vehicles } = useAppStore.getState()
        const selectedFactory = factories.find(f => f.id === selectedFactoryId)
        if(selectedFactory){
            const { x, y } = this.toWorld(selectedFactory.x, selectedFactory.y)
            this.drawSelectionRing(x, y, CELL_SIZE * 1.3, time)
        }
        // Every drag-selected ship gets the exact same pulsating-octagon treatment as a selected
        // building, just at a smaller base radius scaled to that ship's own icon size.
        selectedShipIds.forEach(id => {
            const ship = vehicles.find(s => s.id === id)
            if(!ship) return
            this.drawSelectionRing(ship.x, ship.y, VehicleData[ship.type].sizeHex * CELL_SIZE * 0.7, time)
        })
    }

    // Pulsating octagon selection ring, shared by a selected building and every drag-selected ship.
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

    // Progress bar above every shipyard currently building something. Skips any building whose sprite
    // is currently hidden by fog of war (see updateFogOfWar) — the bar is drawn on its own Graphics
    // layer, not attached to the sprite, so without this check it would still show through the fog and
    // give away a hidden enemy LogisticsCenter's position.
    drawProductionProgress = () => {
        const g = this.progressG
        g.clear()

        useAppStore.getState().buildings.forEach(f => {
            const item = f.queue?.[0]
            if(f.kind !== BuildingType.LogisticsCenter || !item?.startedAt) return
            if(this.buildingSprites.get(f.id)?.visible === false) return

            const { x, y } = this.toWorld(f.x, f.y)
            const percent = PhaserMath.Clamp((Date.now()-item.startedAt) / VehicleData[item.type].productionTimeMs, 0, 1)
            const w = CELL_SIZE * 1.6, h = 4
            const barX = x - w/2, barY = y - CELL_SIZE*2 - h

            g.lineStyle(1, GREEN_HEX, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(GREEN_HEX, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    // HP bar below any building that's taken damage (a CRAM turret's cannon, a drone detonation) —
    // hidden entirely at full health so an undamaged base doesn't clutter the map with empty bars.
    // Also skips anything currently hidden by fog of war, same as drawProductionProgress.
    drawBuildingHealth = () => {
        const g = this.healthG
        g.clear()

        useAppStore.getState().buildings.forEach(f => {
            const maxHp = getBuildingMaxHp(f.kind)
            if(f.hp >= maxHp) return
            if(this.buildingSprites.get(f.id)?.visible === false) return

            const { x, y } = this.toWorld(f.x, f.y)
            const percent = PhaserMath.Clamp(f.hp / maxHp, 0, 1)
            const w = CELL_SIZE * 1.4, h = 4
            const barX = x - w/2, barY = y + getBuildingFootprintRadius(f.kind) + h

            g.lineStyle(1, GREEN_HEX, 1)
            g.strokeRect(barX, barY, w, h)
            g.fillStyle(GREEN_HEX, 0.9)
            g.fillRect(barX, barY, w*percent, h)
        })
    }

    drawAmmoGauges = (time:number) => {
        const g = this.ammoG
        g.clear()

        useAppStore.getState().vehicles.forEach(ship => {
            const maxAmmo = VehicleData[ship.type].ammo
            if(!maxAmmo || ship.ammoRemaining === undefined) return
            const sprite = this.shipSprites.get(ship.id)
            if(!sprite || sprite.visible === false) return
            this.drawAmmoGauge(g, sprite.x, sprite.y, sprite.width, sprite.height, ship.ammoRemaining/maxAmmo)
        })

        useAppStore.getState().buildings.forEach(f => {
            const sprite = this.buildingSprites.get(f.id)
            if(!sprite || sprite.visible === false) return

            const maxAmmo = BuildingData[f.kind].ammo
            if(maxAmmo && f.ammoRemaining !== undefined){
                this.drawAmmoGauge(g, sprite.x, sprite.y, sprite.width, sprite.height, f.ammoRemaining/maxAmmo)
                return
            }

            if(f.kind === BuildingType.Uplink && f.lastFiredAtMs){
                const cooldownMs = BuildingData[BuildingType.Uplink].cooldownMs
                const elapsed = time - f.lastFiredAtMs
                if(elapsed < cooldownMs) this.drawAmmoGauge(g, sprite.x, sprite.y, sprite.width, sprite.height, elapsed/cooldownMs)
            }
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
        const label = this.add.text(x, y, text, { fontFamily:'Body', fontSize:'20px', color:colors.lGreen }).setOrigin(0.5).setDepth(5)
        this.tweens.add({
            targets: label,
            y: y-20,
            duration: 2000,
            onComplete: () => label.destroy()
        })
    }

    // Completes any shipyard's front-of-queue item once its production time has elapsed. If the
    // faction's logistics budget has no room left for it (e.g. it filled up while this item was
    // building), the ready item just holds at the front of the queue — production stays complete,
    // it deploys the moment logistics frees up, without eating another full production cycle.
    tickProduction = () => {
        const { buildings: factories, completeQueueItem } = useAppStore.getState()
        const now = Date.now()

        factories.forEach(f => {
            const item = f.queue?.[0]
            if(!item?.startedAt || now - item.startedAt < VehicleData[item.type].productionTimeMs) return
            if(getLogisticsStatus(f.faction).logisticsRemaining - getVehicleLogisticsCost(item.type) < 0) return

            completeQueueItem(f.id)
            this.spawnShip(f, item.type)
        })
    }

    // Places a newly completed ship near its shipyard, trying to avoid overlapping other loitering ships or any building.
    spawnShip = (shipyard:BuildingData, type:VehicleType) => {
        const center = this.toWorld(shipyard.x, shipyard.y)
        const size = VehicleData[type].sizeHex * CELL_SIZE
        const existingShips = useAppStore.getState().vehicles
        let pos = center

        for(let attempt=0; attempt<40; attempt++){
            const radius = CELL_SIZE*1.5 + attempt*4
            const angle = Math.random()*Math.PI*2
            const candidate = { x: center.x+Math.cos(angle)*radius, y: center.y+Math.sin(angle)*radius }
            const overlapsShip = existingShips.some(s => {
                const minDist = (size + VehicleData[s.type].sizeHex*CELL_SIZE)/2 + 12
                return Phaser.Math.Distance.Between(candidate.x, candidate.y, s.x, s.y) < minDist
            })
            if(!overlapsShip && !this.buildingOverlapsPoint(candidate.x, candidate.y, size/2 + SHIP_BUILDING_CLEARANCE_PX)){ pos = candidate; break }
        }

        const ship:VehicleData = { id:v4(), faction:shipyard.faction, type, shipyardId:shipyard.id, x:pos.x, y:pos.y, waypoints:[...(shipyard.waypoints||[])], pathIndex:0, hp:VehicleData[type].hp, ammoRemaining:VehicleData[type].ammo }
        useAppStore.getState().addShip(ship)
        this.createShipSprite(ship)
    }

    // Each faction's starting headquarters (from map generation) is promoted into a real building —
    // added to the store as a BuildingData with its own hp, physics body and sprite — so it's a valid
    // drone-contact target (KK/ATD exploding on it) and CRAM-cannon/hp-bar target the same as any
    // other building, rather than the inert Graphics-only shape it used to be.
    spawnBases = () => {
        this.mapData.bases.forEach(base => {
            const factory:BuildingData = { id:v4(), x:base.x, y:base.y, kind:BuildingType.Base, faction:base.faction, hp:getBuildingMaxHp(BuildingType.Base) }
            useAppStore.getState().addFactory(factory)
            this.createBuildingSprite(factory)
        })
    }

    // The 2 Objectives' fixed position/sprite come from mapData.objectives (decided once, at map
    // generation — see MapGenerator); this just seeds their live (owner:null, i.e. uncaptured) half
    // into the store and creates each one's sprite. Never hidden by fog of war — a capturable landmark
    // both sides need to be able to see and path towards from the start, not something either side's
    // sight range should gate.
    spawnObjectives = () => {
        this.mapData.objectives.forEach(spawn => {
            const objective:ObjectiveData = { id: spawn.id, owner: null, capturingFaction: null, captureStartedAtMs: null }
            useAppStore.getState().addObjective(objective)
            this.createObjectiveSprite(spawn)
        })
    }

    // Neutral is a dim green, deliberately not GREY_DIM_HEX — that colour reads as "hostile" everywhere
    // else in this game (ship_hostile_*, factory-preview-invalid, ...), and an unclaimed Objective
    // shouldn't look like it's already the enemy's.
    getObjectiveOwnerColor = (owner:Faction | null) => owner === Faction.Player ? GREEN_HEX : owner === Faction.Enemy ? GREY_DIM_HEX : GREEN_DIM_HEX

    createObjectiveSprite = (spawn:ObjectiveSpawn) => {
        const { x, y } = this.toWorld(spawn.x, spawn.y)
        const sprite = this.add.image(x, y, 'objective_'+spawn.sprite).setDepth(2)
        sprite.setTint(this.getObjectiveOwnerColor(null))
        this.objectiveSprites.set(spawn.id, sprite)

        const label = this.add.text(x, y + OBJECTIVE_ICON_SIZE*0.5 + 4, spawn.sprite, { fontFamily:'Body', fontSize:'11px', color:colors.lGreen }).setOrigin(0.5, 0).setDepth(2)
        this.objectiveLabels.set(spawn.id, label)
    }

    // Every frame: for each Objective, does either faction currently have ARMOR within
    // OBJECTIVE_CAPTURE_RADIUS_PX of it, AND does the *other* faction have no ship or building also
    // within that same radius? That faction is "contesting" it — checked for both, so contest can be
    // held by either side. The instant contest starts (or switches sides), capturingFaction/
    // captureStartedAtMs are (re)set to track that hold; the instant it breaks (no one contesting, or
    // ARMOR simply leaving/dying resolves the same way — hasArmor just goes false), they reset to null,
    // discarding whatever progress had built up. Only once a single faction has held it uncontested for
    // a full OBJECTIVE_CAPTURE_TIME_MS does owner actually flip — see ObjectiveData for the full model.
    // Also checks the win condition every pass: one faction holding every Objective on the map at once
    // ends the match immediately (handleAllObjectivesCaptured).
    updateObjectives = (time:number) => {
        const { objectives, vehicles: ships, buildings: factories, setObjectives } = useAppStore.getState()
        if(objectives.length === 0) return

        let changed = false
        const updated = objectives.map(objective => {
            const spawn = this.mapData.objectives.find(o => o.id === objective.id)
            if(!spawn) return objective
            const { x, y } = this.toWorld(spawn.x, spawn.y)

            const contestingFaction = [Faction.Player, Faction.Enemy].find(faction => {
                const hasArmor = ships.some(s => s.faction === faction && s.type === VehicleType.ARMOR
                    && Phaser.Math.Distance.Between(x, y, s.x, s.y) <= OBJECTIVE_CAPTURE_RADIUS_PX)
                if(!hasArmor) return false

                const enemyShipPresent = ships.some(s => s.faction !== faction
                    && Phaser.Math.Distance.Between(x, y, s.x, s.y) <= OBJECTIVE_CAPTURE_RADIUS_PX)
                const enemyBuildingPresent = factories.some(f => {
                    if(f.faction === faction) return false
                    const p = this.toWorld(f.x, f.y)
                    return Phaser.Math.Distance.Between(x, y, p.x, p.y) <= OBJECTIVE_CAPTURE_RADIUS_PX
                })
                return !enemyShipPresent && !enemyBuildingPresent
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

    // The match ends the moment either faction's Base building is destroyed — called from the onDeath
    // callback wherever a building can die (detonateDrone, onMissileBuildingContact). Guarded so a
    // simultaneous double-kill (both bases in one frame) can't show two modals or double-pause.
    handleBaseDestroyed = (faction:Faction) => {
        if(this.gameOver) return
        this.gameOver = true
        this.scene.pause()
        onShowModal(faction === Faction.Player ? Modal.Defeat : Modal.Victory)
    }

    // The placement->combat handoff: called once, the instant the player's 3rd LogisticsCenter goes
    // down (see handleLogisticsPlacementClick). Whatever the enemy quietly built during placement (its
    // own 3 LogisticsCenters, so far) stays hidden until updateFogOfWar (run every frame from here on)
    // finds it inside the player's sight range — there's no one-time "reveal everything" step anymore.
    // spawnEnemyRaid queues the enemy's opening raid, which checkEnemyRaid sends at the player's
    // nearest LogisticsCenter the moment it's massed.
    startCombatPhase = () => {
        useAppStore.getState().setPhase('combat')
        spawnEnemyRaid(this)
    }

    // Fog of war: the player's territory border (the same placement-radius circles drawn by
    // drawPlacementRanges) plus every player unit's own sight radius together make up their sight
    // range. Every enemy building/ship is only ever visible while it's standing inside that combined
    // area — during the placement phase nothing enemy is visible at all, no matter what (the player
    // has no border or units yet to begin with), and once combat starts visibility is re-evaluated
    // fresh every frame as both sides' units move around.
    updateFogOfWar = () => {
        const { phase, buildings, vehicles } = useAppStore.getState()

        // While Uplink's reveal is active, isWithinFactionSightRange itself returns true everywhere for
        // Faction.Player — this isn't just fog rendering, every one of the player's own weapon-targeting
        // queries (findNearestHostile*) sees the same expanded sight range.
        buildings.filter(f => f.faction === Faction.Enemy).forEach(f => {
            const { x, y } = this.toWorld(f.x, f.y)
            const visible = phase === 'combat' && this.isWithinFactionSightRange(x, y, Faction.Player)
            this.buildingSprites.get(f.id)?.setVisible(visible)
        })

        vehicles.filter(s => s.faction === Faction.Enemy).forEach(s => {
            const visible = phase === 'combat' && this.isWithinFactionSightRange(s.x, s.y, Faction.Player)
            this.shipSprites.get(s.id)?.setVisible(visible)
            this.shipLabels.get(s.id)?.setVisible(visible)
        })
    }

    // Uplink's ability, triggered by clicking the building directly (see enablePlacementControls'
    // pointerdown) rather than firing automatically like CRAM/BLM/THADD do — a one-time click gated by
    // the same lastFiredAtMs/cooldownMs pair every other building's weapon cooldown uses. Sets
    // mapRevealedUntil, which is all isWithinFactionSightRange actually checks to expand the player's
    // sight range early — both fog-of-war rendering and every weapon-targeting query read off it.
    activateUplink = (building:BuildingData) => {
        const now = this.time.now
        if(building.lastFiredAtMs && now - building.lastFiredAtMs < BuildingData[BuildingType.Uplink].cooldownMs) return

        const { buildings, setFactories } = useAppStore.getState()
        setFactories(buildings.map(f => f.id === building.id ? { ...f, lastFiredAtMs:now } : f))
        this.mapRevealedUntil = now + UPLINK_REVEAL_DURATION_MS
    }

    // A vertical scan-beam that sweeps right to left across the whole map over the exact span of a
    // reveal (mapRevealedUntil - UPLINK_REVEAL_DURATION_MS through mapRevealedUntil), so it visually
    // reads as *what's actually doing the revealing* rather than a decoration bolted on separately.
    // Phaser Graphics has no real gradient fill this codebase can rely on across renderers, so the
    // "gradient" is approximated by hand: a stack of thin vertical strips, each faded by how far it
    // sits from the beam's own center, brightest in the middle and fully transparent at both edges.
    drawUplinkSweep = (time:number) => {
        const g = this.uplinkSweepG
        g.clear()
        if(time >= this.mapRevealedUntil) return

        const startedAt = this.mapRevealedUntil - UPLINK_REVEAL_DURATION_MS
        const progress = PhaserMath.Clamp((time-startedAt) / UPLINK_REVEAL_DURATION_MS, 0, 1)
        const mapHeight = this.mapData.height * CELL_SIZE
        const sweepX = (1-progress) * (this.mapData.width * CELL_SIZE)

        const beamWidth = CELL_SIZE * 6
        const strips = 16
        for(let i=0; i<strips; i++){
            const t = i / (strips-1) // 0 at the beam's left edge, 1 at its right edge
            const falloff = 1 - Math.abs(t-0.5)*2 // 0 at both edges, 1 dead center
            const stripW = beamWidth/strips + 1
            g.fillStyle(GREEN_HEX, falloff * 0.35)
            g.fillRect(sweepX + (t-0.5)*beamWidth - stripW/2, 0, stripW, mapHeight)
        }
    }

    // --- Physics sprite lifecycle -------------------------------------------------------------------
    // Every sprite is created exactly once, at the moment its entity is actually added to the store
    // (spawnShip; spawnEnemyLogisticsCenters/enablePlacementControls for buildings), and destroyed exactly once,
    // at the moment damage actually drops that entity's HP to 0 (the onDeath callbacks passed to
    // applyDamage in detonateDrone/onMissileShipContact/updateCramTurrets). None of this is
    // polled or diffed against the store in the per-frame update loop.

    createShipSprite = (ship:VehicleData) => {
        const isFriend = ship.faction === Faction.Player
        const textureKey = (isFriend ? 'ship_friend_' : 'ship_hostile_') + ship.type
        const sprite = this.physics.add.sprite(ship.x, ship.y, textureKey)
        this.centerCircleBody(sprite)
        sprite.setData('kind', 'ship' as BodyKind)
        sprite.setData('id', ship.id)
        this.shipsGroup.add(sprite)
        this.shipSprites.set(ship.id, sprite)

        const label = this.add.text(ship.x, ship.y-SHIP_LABEL_OFFSET_PX, ship.type.toUpperCase(), { fontFamily:'Body', fontSize:'12px', color: colors.lGreen }).setOrigin(0.5).setDepth(4)
        this.shipLabels.set(ship.id, label)

        // Fog of war: an enemy ship starts hidden regardless of phase — updateFogOfWar (run every
        // frame) is what actually decides visibility from here, based on the player's sight range.
        // Starting hidden just avoids a one-frame flash of visibility before that first check runs.
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

    createBuildingSprite = (factory:BuildingData) => {
        const { x, y } = this.toWorld(factory.x, factory.y)
        const sprite = this.physics.add.staticSprite(x, y, 'factory_'+factory.kind)
        this.centerCircleBody(sprite)
        sprite.setData('kind', 'building' as BodyKind)
        sprite.setData('id', factory.id)
        sprite.setData('factoryKind', factory.kind)
        this.buildingsGroup.add(sprite)
        this.buildingSprites.set(factory.id, sprite)

        // Fog of war: an enemy building starts hidden regardless of phase — updateFogOfWar (run every
        // frame) is what actually decides visibility from here, based on the player's sight range.
        if(factory.faction === Faction.Enemy) sprite.setVisible(false)

        // The static map layer (drawMap) includes each structure's placement-range bubble — a new
        // building means the player's (or enemy's) territory border changed shape, so it needs a redraw.
        this.drawMap()
    }

    destroyBuildingSprite = (id:string) => {
        this.buildingSprites.get(id)?.destroy()
        this.buildingSprites.delete(id)
        this.drawMap()
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

    // Advances every ship one step towards its own route (waypoints — a copy taken from its shipyard at
    // spawn time, see spawnShip, independently editable afterwards either through that shipyard
    // (addWaypoint) or by drag-selecting the ship directly (addShipWaypoints) — both write straight onto
    // the ship's own waypoints, so there's nothing left to read live off the shipyard here). Once a ship
    // has worked through every waypoint it loiters in a slow orbit around the last one; a ship whose
    // orders were cleared instead orbits wherever it was when that happened. The actual stepping — and
    // the collision detection that comes from it — is Arcade Physics' job now (physics.moveTo sets
    // velocity towards the target, the physics step integrates position); this just decides *where*
    // that target is and detects arrival to advance the route.
    moveShips = (time:number, deltaMs:number) => {
        const { vehicles: ships, setShips } = useAppStore.getState()
        // ATDs that reach the end of their route detonate — but not mid-map (that would clobber this
        // very setShips call below with a store snapshot that still has them in it), so they're
        // collected here and only actually detonated once this pass's positions have been committed.
        const arrivedAtds:Array<{ ship:VehicleData, sprite:Physics.Arcade.Sprite }> = []

        const updated = ships.map(ship => {
            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return ship

            const ownWaypoints = ship.waypoints || []
            // An ATD is a guided munition, not a patrol ship — it only ever follows its route to the
            // first waypoint (its detonation target), never any further ones.
            const waypoints = ship.type === VehicleType.ATD ? ownWaypoints.slice(0, 1) : ownWaypoints
            const pathIndex = ship.pathIndex ?? 0
            const speed = VehicleData[ship.type].speed
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
            // detonates it right here, same as a contact hit does in onDroneShipContact/onDroneBuildingContact.
            if(ship.type === VehicleType.ATD && arrivedAtRouteEnd && dist <= step) arrivedAtds.push({ ship, sprite })

            return { ...ship, x:sprite.x, y:sprite.y, pathIndex: dist <= step ? nextPathIndex : pathIndex, orbitAnchor }
        })

        setShips(updated)
        arrivedAtds.forEach(({ ship, sprite }) => this.detonateDrone(ship, sprite, null))
    }

    getShipEntry = (sprite:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const id = (sprite as any).getData('id')
        return useAppStore.getState().vehicles.find(s => s.id === id)
    }

    getBuildingEntry = (sprite:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const id = (sprite as any).getData('id')
        return useAppStore.getState().buildings.find(f => f.id === id)
    }

    isHostileDroneShipPair = (a:Phaser.Types.Physics.Arcade.GameObjectWithBody, b:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        if(a === b) return false
        const shipA = this.getShipEntry(a)
        const shipB = this.getShipEntry(b)
        if(!shipA || !shipB || shipA.faction === shipB.faction) return false
        return vehicleTargets(shipA.type, TargetType.AirUnit) || vehicleTargets(shipB.type, TargetType.AirUnit)
    }

    isHostileDroneBuildingPair = (shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, buildingObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const ship = this.getShipEntry(shipObj)
        const building = this.getBuildingEntry(buildingObj)
        if(!ship || !building || ship.faction === building.faction) return false
        return vehicleTargets(ship.type, TargetType.Building)
    }

    isHostileMissileShipPair = (missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, shipObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missile = missileObj as Physics.Arcade.Sprite
        const ship = this.getShipEntry(shipObj)
        return !!ship && ship.faction !== missile.getData('faction')
    }

    isHostileMissileBuildingPair = (missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, buildingObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missile = missileObj as Physics.Arcade.Sprite
        const building = this.getBuildingEntry(buildingObj)
        return !!building && building.faction !== missile.getData('faction')
    }

    // Only an interceptor (a THADD's own projectile, targetKind 'missile') ever engages another missile
    // on contact — that's its entire purpose (see THADD_SALVO_SIZE). A plain offensive missile (MLRS/BLM,
    // targeting a ship/building) has no business "fighting" a missile it happens to cross paths with in
    // flight; it should just pass straight through, hostile or not.
    isHostileMissilePair = (a:Phaser.Types.Physics.Arcade.GameObjectWithBody, b:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        if(a === b) return false
        const missileA = a as Physics.Arcade.Sprite
        const missileB = b as Physics.Arcade.Sprite
        
        return (missileA.getData('targetKind') === 'missile' && missileA.getData('targetId') === missileB.getData('id'))
            || (missileB.getData('targetKind') === 'missile' && missileB.getData('targetId') === missileA.getData('id'))
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

        if(vehicleTargets(shipA.type, TargetType.AirUnit)) this.detonateDrone(shipA, spriteA, { kind:'ship', id:shipB.id })

        const survivingShipB = this.shipSprites.has(shipB.id) ? this.getShipEntry(b) : null
        if(survivingShipB && vehicleTargets(survivingShipB.type, TargetType.AirUnit)) this.detonateDrone(survivingShipB, spriteB, { kind:'ship', id:shipA.id })
    }

    // A drone touching a hostile building detonates immediately, right here — no queueing.
    onDroneBuildingContact = (shipObj:Physics.Arcade.Sprite, buildingObj:Physics.Arcade.Sprite) => {
        const ship = this.getShipEntry(shipObj)
        const building = this.getBuildingEntry(buildingObj)
        if(!ship || !building) return
        this.detonateDrone(ship, shipObj as Physics.Arcade.Sprite, { kind:'building', id:building.id })
    }

    // A drone (KK/ATD) detonates: it always self-destructs, plus damages whatever it hit — a single
    // primary target for KK, or an area blast (physics.overlapCirc — the same "who's nearby" query the
    // CRAM turret's range check uses) for ATD, which ignores `primary` and just blasts everything hostile
    // nearby. Called exactly once per detonation, directly from whatever triggered it (a contact overlap
    // callback above, or — for an ATD reaching its route's end — moveShips).
    detonateDrone = (drone:VehicleData, sprite:Physics.Arcade.Sprite, primary:{ kind:'ship'|'building', id:string } | null) => {
        const time = this.time.now
        const shipDamage = new Map<string, number>([[drone.id, drone.hp]])
        const factoryDamage = new Map<string, number>()

        this.shatters.push({ x:sprite.x, y:sprite.y, createdAt:time, seed:drone.id })

        if(drone.type === VehicleType.KK && primary){
            const damage = VehicleData[VehicleType.KK].damage
            if(primary.kind === 'ship') shipDamage.set(primary.id, (shipDamage.get(primary.id) || 0) + damage)
            else factoryDamage.set(primary.id, (factoryDamage.get(primary.id) || 0) + damage)
        }
        else if(drone.type === VehicleType.ATD){
            const damage = VehicleData[VehicleType.ATD].damage
            const hits = this.physics.overlapCirc(sprite.x, sprite.y, ATD_BLAST_RADIUS_PX, true, true)
            hits.forEach(body => {
                const obj = (body as Physics.Arcade.Body).gameObject
                const kind:BodyKind = obj.getData('kind')
                if(kind === 'ship'){
                    const hitShip = this.getShipEntry(obj as Phaser.Types.Physics.Arcade.GameObjectWithBody)
                    if(hitShip && hitShip.faction !== drone.faction) shipDamage.set(hitShip.id, (shipDamage.get(hitShip.id) || 0) + damage)
                }
                else if(kind === 'building'){
                    const hitBuilding = this.getBuildingEntry(obj as Phaser.Types.Physics.Arcade.GameObjectWithBody)
                    if(hitBuilding && hitBuilding.faction !== drone.faction) factoryDamage.set(hitBuilding.id, (factoryDamage.get(hitBuilding.id) || 0) + damage)
                }
            })
        }

        const { vehicles: ships, buildings: factories, setShips, setFactories } = useAppStore.getState()
        setShips(applyDamage(ships, shipDamage, dead => {
            this.destroyShipSprite(dead.id)
            if(dead.id !== drone.id) this.shatters.push({ x:dead.x, y:dead.y, createdAt:time, seed:dead.id })
        }))
        if(factoryDamage.size > 0){
            setFactories(applyDamage(factories, factoryDamage, dead => {
                this.destroyBuildingSprite(dead.id)
                const p = this.toWorld(dead.x, dead.y)
                this.shatters.push({ x:p.x, y:p.y, createdAt:time, seed:dead.id })
                if(dead.kind === BuildingType.Base) this.handleBaseDestroyed(dead.faction)
            }))
        }
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

        const { vehicles: ships, setShips } = useAppStore.getState()
        setShips(applyDamage(ships, new Map([[ship.id, damage]]), dead => {
            this.destroyShipSprite(dead.id)
            this.shatters.push({ x:dead.x, y:dead.y, createdAt:time, seed:dead.id })
        }))
    }

    // A missile touching a hostile building detonates immediately, right here — no queueing. Same shape
    // as onMissileShipContact, just landing damage on the buildings store slice instead.
    onMissileBuildingContact = (missileObj:Phaser.Types.Physics.Arcade.GameObjectWithBody, buildingObj:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missile = missileObj as Physics.Arcade.Sprite
        if(!missile.active) return
        const building = this.getBuildingEntry(buildingObj)
        if(!building) return

        const time = this.time.now
        const x = missile.x, y = missile.y, seed = missile.getData('id'), damage = missile.getData('damage')
        missile.destroy()
        this.shatters.push({ x, y, createdAt:time, seed })

        const { buildings: factories, setFactories } = useAppStore.getState()
        setFactories(applyDamage(factories, new Map([[building.id, damage]]), dead => {
            this.destroyBuildingSprite(dead.id)
            const p = this.toWorld(dead.x, dead.y)
            this.shatters.push({ x:p.x, y:p.y, createdAt:time, seed:dead.id })
            if(dead.kind === BuildingType.Base) this.handleBaseDestroyed(dead.faction)
        }))
    }

    // A THADD interceptor touching a hostile missile destroys both, immediately, right here — no
    // queueing (and no damage/hp bookkeeping needed, missiles just detonate outright).
    onMissileMissileContact = (a:Phaser.Types.Physics.Arcade.GameObjectWithBody, b:Phaser.Types.Physics.Arcade.GameObjectWithBody) => {
        const missileA = a as Physics.Arcade.Sprite
        const missileB = b as Physics.Arcade.Sprite
        if(!missileA.active || !missileB.active) return

        const time = this.time.now
        this.shatters.push({ x:missileA.x, y:missileA.y, createdAt:time, seed:missileA.getData('id') })
        this.shatters.push({ x:missileB.x, y:missileB.y, createdAt:time, seed:missileB.getData('id') })
        missileA.destroy()
        missileB.destroy()
    }

    // Each CRAM turret, on cooldown, fires at whichever hostile ship is nearest within its (doubled,
    // relative to the old mobile CRV's) range — from a fixed building position instead of a mobile
    // ship. CRAM only ever targets ships; incoming missiles are THADD's job (see updateThadd), not
    // CRAM's. Range acquisition is a physics.overlapCirc query, not a full ship sweep.
    updateCramTurrets = (time:number) => {
        const { buildings: factories, setShips, setFactories } = useAppStore.getState()
        const turrets = factories.filter(f => f.kind === BuildingType.CRAM)
        if(turrets.length === 0) return

        const shooterIds = new Set<string>()
        const damageByTarget = new Map<string, number>()

        turrets.forEach(turret => {
            if(turret.lastFiredAtMs && time - turret.lastFiredAtMs < BuildingData[BuildingType.CRAM].cooldownMs) return

            const { x, y } = this.toWorld(turret.x, turret.y)
            const targetShip = this.findNearestHostileShip(turret.faction, x, y, BuildingData[BuildingType.CRAM].rangePx)
            if(!targetShip) return

            shooterIds.add(turret.id)
            this.tracers.push({ x1:x, y1:y, x2:targetShip.x, y2:targetShip.y, createdAt:time })
            const targetShipId = targetShip.getData('id')
            damageByTarget.set(targetShipId, (damageByTarget.get(targetShipId) || 0) + BuildingData[BuildingType.CRAM].damage)
        })

        if(shooterIds.size === 0) return

        setFactories(factories.map(f => shooterIds.has(f.id) ? { ...f, lastFiredAtMs:time } : f))
        setShips(applyDamage(useAppStore.getState().vehicles, damageByTarget, ship => {
            this.destroyShipSprite(ship.id)
            this.shatters.push({ x:ship.x, y:ship.y, createdAt:time, seed:ship.id })
        }))
    }

    // Nearest hostile ship within radius of a point, found via a spatial physics query
    // (physics.overlapCirc) instead of sweeping every ship in the game. Used by the CRAM turret, which
    // only ever targets ships (never a missile — that's THADD's job, see findNearestHostileMissile).
    // Every candidate also has to fall within the *shooter's own faction's* sight range (see
    // updateFogOfWar) — weapon range alone isn't enough to fire on something that faction can't
    // actually see, whichever faction's turret/ship is doing the shooting. This is what stops the AI
    // sniping things it has no business knowing about; it never gets to peek at the player's own fog
    // of war (which is all "faction" meant here before — always Faction.Player, regardless of who was
    // actually shooting).
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

    // Same shape as findNearestHostileShip, but for buildings only (never a ship or a missile), so
    // the query only needs static bodies (buildingsGroup) — used by both BLM and MLRS, neither of which
    // ever targets a ship. Same shooter's-own-sight-range requirement as findNearestHostileShip.
    findNearestHostileBuilding = (fromFaction:Faction, x:number, y:number, range:number) => {
        const hits = this.physics.overlapCirc(x, y, range, false, true)
        let targetBuilding:Physics.Arcade.Sprite = null
        let nearestBuildingDist = Infinity

        hits.forEach(body => {
            const obj = (body as Physics.Arcade.Body).gameObject as Physics.Arcade.Sprite
            if(!obj.active) return
            if(!this.isWithinFactionSightRange(obj.x, obj.y, fromFaction)) return
            const building = this.getBuildingEntry(obj)
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y)
            if(building && building.faction !== fromFaction && d < nearestBuildingDist){ nearestBuildingDist = d; targetBuilding = obj }
        })

        return targetBuilding
    }

    // Same shape again, but for THADD: it only ever targets a hostile missile (never a ship or
    // building), so the query only needs dynamic bodies and just checks kind === 'missile'. Same
    // shooter's-own-sight-range requirement as findNearestHostileShip.
    findNearestHostileMissile = (fromFaction:Faction, x:number, y:number, range:number) => {
        const hits = this.physics.overlapCirc(x, y, range, true, false)
        let target:Physics.Arcade.Sprite = null
        let nearestDist = Infinity

        hits.forEach(body => {
            const obj = (body as Physics.Arcade.Body).gameObject as Physics.Arcade.Sprite
            if(!obj.active || obj.getData('kind') !== 'missile' || obj.getData('faction') === fromFaction) return
            // Only an offensive missile (MLRS/BLM, always targetKind 'building') is a valid THADD
            // target — a hostile THADD's own interceptors (targetKind 'missile') don't threaten
            // anything of ours worth shooting down, so they shouldn't trigger (or draw) a launch here.
            if(obj.getData('targetKind') !== 'building') return
            if(!this.isWithinFactionSightRange(obj.x, obj.y, fromFaction)) return
            const d = Phaser.Math.Distance.Between(x, y, obj.x, obj.y)
            if(d < nearestDist){ nearestDist = d; target = obj }
        })

        return target
    }

    // Missiles aren't tracked in a lookup Map the way ship/building sprites are (there's no store data
    // behind them to key one), so finding one by its id — needed so an interceptor missile can home on
    // another missile — means a short scan of the (typically tiny) missilesGroup.
    findMissileSpriteById = (id:string) => {
        let found:Physics.Arcade.Sprite = null
        this.missilesGroup.children.each((child:Physics.Arcade.Sprite) => {
            if(child.active && child.getData('id') === id) found = child
            return true
        })
        return found
    }

    // Each MLRS, on cooldown, launches a whole salvo (MISSILE_SALVO_SIZE) of missiles, SALVO_STAGGER_MS
    // apart so they read as a salvo instead of one stacked blob, all homing on whichever hostile
    // building is nearest in range (found the same way BLM finds its targets). MLRS only ever targets
    // buildings, never a ship — the opposite targeting scope from CRAM (ships and missiles only). Only
    // the salvo's first shot needs a live target (to justify firing at all); every shot after that
    // fires regardless of whether that target is still around by the time its delay elapses — if it's
    // gone, the missile just retargets or fizzles onward (see updateMissiles), it isn't skipped. Each
    // MLRS starts with a fixed ammoRemaining (see VehicleData's ammo) that's spent 1-per-missile and
    // never refills — once it's at 0 it can no longer fire at all, cooldown or not; a salvo that would
    // otherwise fire more shots than remain just fires however many it can still afford instead.
    updateMlrs = (time:number) => {
        const { vehicles: ships, setShips } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const shotsFired = new Map<string, number>()

        ships.forEach(ship => {
            if(ship.type !== VehicleType.MLRS) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < VehicleData[VehicleType.MLRS].cooldownMs) return
            if(!ship.ammoRemaining) return

            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return

            const targetBuilding = this.findNearestHostileBuilding(ship.faction, sprite.x, sprite.y, VehicleData[VehicleType.MLRS].rangePx)
            if(!targetBuilding) return

            const shots = Math.min(MISSILE_SALVO_SIZE, ship.ammoRemaining)
            shooterIds.add(ship.id)
            shotsFired.set(ship.id, shots)
            const targetId = targetBuilding.getData('id')
            const aimX = targetBuilding.x, aimY = targetBuilding.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => {
                    if(!sprite.active) return
                    this.spawnMissile(ship.faction, sprite.x, sprite.y, 'building', targetId, VehicleData[VehicleType.MLRS].damage, aimX, aimY)
                })
            }
        })

        if(shooterIds.size > 0){
            setShips(ships.map(ship => shooterIds.has(ship.id)
                ? { ...ship, lastFiredAtMs:time, ammoRemaining:ship.ammoRemaining-shotsFired.get(ship.id) }
                : ship))
        }
    }

    // Each ARMOR unit, on cooldown, fires a single instant shot — like CRAM's cannon, not a homing
    // missile — at whichever hostile building is nearest in range.
    updateArmor = (time:number) => {
        const { vehicles: ships, setShips } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const damageByTarget = new Map<string, number>()

        ships.forEach(ship => {
            if(ship.type !== VehicleType.ARMOR) return
            if(ship.lastFiredAtMs && time - ship.lastFiredAtMs < VehicleData[VehicleType.ARMOR].cooldownMs) return

            const sprite = this.shipSprites.get(ship.id)
            if(!sprite) return

            const targetBuilding = this.findNearestHostileBuilding(ship.faction, sprite.x, sprite.y, VehicleData[VehicleType.ARMOR].rangePx)
            if(!targetBuilding) return

            shooterIds.add(ship.id)
            this.tracers.push({ x1:sprite.x, y1:sprite.y, x2:targetBuilding.x, y2:targetBuilding.y, createdAt:time })
            const targetId = targetBuilding.getData('id')
            damageByTarget.set(targetId, (damageByTarget.get(targetId) || 0) + VehicleData[VehicleType.ARMOR].damage)
        })

        if(shooterIds.size === 0) return

        setShips(ships.map(ship => shooterIds.has(ship.id) ? { ...ship, lastFiredAtMs:time } : ship))
        const { buildings: factories, setFactories } = useAppStore.getState()
        setFactories(applyDamage(factories, damageByTarget, dead => {
            this.destroyBuildingSprite(dead.id)
            const p = this.toWorld(dead.x, dead.y)
            this.shatters.push({ x:p.x, y:p.y, createdAt:time, seed:dead.id })
            if(dead.kind === BuildingType.Base) this.handleBaseDestroyed(dead.faction)
        }))
    }

    // Each BLM turret, on its long cooldown, fires a single missile at whichever hostile building (never
    // a vehicle) is nearest in range — a stationary building, so its own world position (not a sprite) is
    // the launch point, and only its cooldown lives in the store (see updateCramTurrets for the pattern).
    // Each BLM starts with a fixed ammoRemaining (see BuildingData's ammo) that's spent 1-per-missile and
    // never refills — once it's at 0 it can no longer fire at all, cooldown or not.
    updateBlm = (time:number) => {
        const { buildings: factories, setFactories } = useAppStore.getState()
        const shooterIds = new Set<string>()

        factories.forEach(turret => {
            if(turret.kind !== BuildingType.BLM) return
            if(turret.lastFiredAtMs && time - turret.lastFiredAtMs < BuildingData[BuildingType.BLM].cooldownMs) return
            if(!turret.ammoRemaining) return

            const { x, y } = this.toWorld(turret.x, turret.y)
            const targetBuilding = this.findNearestHostileBuilding(turret.faction, x, y, BuildingData[BuildingType.BLM].rangePx)
            if(!targetBuilding) return

            shooterIds.add(turret.id)
            this.spawnMissile(turret.faction, x, y, 'building', targetBuilding.getData('id'), BuildingData[BuildingType.BLM].damage, targetBuilding.x, targetBuilding.y)
        })

        if(shooterIds.size > 0){
            setFactories(factories.map(f => shooterIds.has(f.id) ? { ...f, lastFiredAtMs:time, ammoRemaining:f.ammoRemaining-1 } : f))
        }
    }

    // Each THADD turret, on cooldown, fires a THADD_SALVO_SIZE-missile interceptor salvo (SALVO_STAGGER_MS
    // apart, same as MLRS) at its nearest hostile missile in range — the actual kill happens on contact
    // (see onMissileMissileContact), this just launches interceptors that home towards it. Only the
    // salvo's first shot needs a live target (to justify firing at all); every shot after that fires
    // regardless of whether that same target is still around by the time its delay elapses — if it's
    // gone, the interceptor just fizzles onward (see updateMissiles), it isn't skipped. Each THADD
    // starts with a fixed ammoRemaining (see BuildingData's ammo) that's spent 1-per-interceptor and
    // never refills — once it's at 0 it can no longer fire at all, cooldown or not; a salvo that would
    // otherwise fire more shots than remain just fires however many it can still afford instead.
    updateThadd = (time:number) => {
        const { buildings: factories, setFactories } = useAppStore.getState()
        const shooterIds = new Set<string>()
        const shotsFired = new Map<string, number>()

        factories.forEach(turret => {
            if(turret.kind !== BuildingType.THADD) return
            if(turret.lastFiredAtMs && time - turret.lastFiredAtMs < BuildingData[BuildingType.THADD].cooldownMs) return
            if(!turret.ammoRemaining) return

            const { x, y } = this.toWorld(turret.x, turret.y)
            const targetMissile = this.findNearestHostileMissile(turret.faction, x, y, BuildingData[BuildingType.THADD].rangePx)
            if(!targetMissile) return

            const shots = Math.min(THADD_SALVO_SIZE, turret.ammoRemaining)
            shooterIds.add(turret.id)
            shotsFired.set(turret.id, shots)
            const targetId = targetMissile.getData('id')
            const aimX = targetMissile.x, aimY = targetMissile.y
            for(let i=0; i<shots; i++){
                this.time.delayedCall(i*SALVO_STAGGER_MS, () => this.spawnMissile(turret.faction, x, y, 'missile', targetId, 0, aimX, aimY))
            }
        })

        if(shooterIds.size > 0){
            setFactories(factories.map(f => shooterIds.has(f.id)
                ? { ...f, lastFiredAtMs:time, ammoRemaining:f.ammoRemaining-shotsFired.get(f.id) }
                : f))
        }
    }

    // Each AmmoDump checks every cooldownMs (2s — see BuildingData's cooldownMs) for anything of its own
    // faction within rangePx (50px, its resupply radius — same reuse of rangePx every other turret's
    // weapon range uses) that's completely out of ammo (ammoRemaining === 0, and actually has an ammo
    // stat to begin with — see VehicleData/BuildingData's ammo), and tops each one back up to its own
    // max, closest first, spending from the dump's own stockpile (BuildingData's ammo) until either
    // nothing nearby needs it or that stockpile runs out — a dump that's already empty itself just stops
    // helping, same as any other ammo-limited weapon here. Candidates include ships and other buildings,
    // but never another AmmoDump — its own ammoRemaining is what it has left to hand out, not something
    // it needs handed back, so dumps never resupply each other. Only reads factories/ships once at the
    // top so two dumps that both cover the same empty target in one pass can't double-refill it
    // (refilledIds catches that).
    updateAmmoDumps = (time:number) => {
        const { buildings: factories, vehicles: ships, setFactories, setShips } = useAppStore.getState()
        const dumps = factories.filter(f => f.kind === BuildingType.AmmoDump)
        if(dumps.length === 0) return

        const range = BuildingData[BuildingType.AmmoDump].rangePx
        const checkedIds = new Set<string>()
        const dumpAmmoLeft = new Map<string, number>()
        const buildingAmmoGiven = new Map<string, number>()
        const shipAmmoGiven = new Map<string, number>()
        const refilledIds = new Set<string>()

        dumps.forEach(dump => {
            if(dump.lastFiredAtMs && time - dump.lastFiredAtMs < BuildingData[BuildingType.AmmoDump].cooldownMs) return
            checkedIds.add(dump.id)
            if(!dump.ammoRemaining) return

            const { x, y } = this.toWorld(dump.x, dump.y)

            type Candidate = { kind:'ship'|'building', id:string, dist:number, maxAmmo:number }
            const candidates:Array<Candidate> = []

            ships.forEach(s => {
                if(s.faction !== dump.faction || s.ammoRemaining === undefined || s.ammoRemaining > 0 || refilledIds.has(s.id)) return
                const maxAmmo = VehicleData[s.type].ammo
                if(!maxAmmo) return
                const d = Phaser.Math.Distance.Between(x, y, s.x, s.y)
                if(d <= range) candidates.push({ kind:'ship', id:s.id, dist:d, maxAmmo })
            })
            factories.forEach(f => {
                if(f.kind === BuildingType.AmmoDump || f.faction !== dump.faction || f.ammoRemaining === undefined || f.ammoRemaining > 0 || refilledIds.has(f.id)) return
                const maxAmmo = BuildingData[f.kind].ammo
                if(!maxAmmo) return
                const p = this.toWorld(f.x, f.y)
                const d = Phaser.Math.Distance.Between(x, y, p.x, p.y)
                if(d <= range) candidates.push({ kind:'building', id:f.id, dist:d, maxAmmo })
            })

            candidates.sort((a, b) => a.dist - b.dist)

            let remaining = dump.ammoRemaining
            candidates.forEach(c => {
                if(remaining <= 0) return
                const give = Math.min(remaining, c.maxAmmo)
                remaining -= give
                refilledIds.add(c.id)
                if(c.kind === 'ship') shipAmmoGiven.set(c.id, give)
                else buildingAmmoGiven.set(c.id, give)
            })

            dumpAmmoLeft.set(dump.id, remaining)
        })

        if(checkedIds.size > 0 || buildingAmmoGiven.size > 0){
            setFactories(factories.map(f => {
                if(buildingAmmoGiven.has(f.id)) return { ...f, ammoRemaining:buildingAmmoGiven.get(f.id) }
                if(dumpAmmoLeft.has(f.id)) return { ...f, ammoRemaining:dumpAmmoLeft.get(f.id), lastFiredAtMs:time }
                if(checkedIds.has(f.id)) return { ...f, lastFiredAtMs:time }
                return f
            }))
        }
        if(shipAmmoGiven.size > 0){
            setShips(ships.map(s => shipAmmoGiven.has(s.id) ? { ...s, ammoRemaining:shipAmmoGiven.get(s.id) } : s))
        }
    }

    // Shared by spawnMissile (initial heading) and updateMissiles (live homing/retarget) so the two
    // never fall out of sync on how a targetKind maps to where its sprite actually lives.
    getMissileTargetSprite = (targetKind:'ship'|'building'|'missile', targetId:string) => {
        return targetKind === 'building' ? this.buildingSprites.get(targetId)
            : targetKind === 'missile' ? this.findMissileSpriteById(targetId)
            : this.shipSprites.get(targetId)
    }

    // `damage` is the firing vehicle/building's own damage stat (VehicleData/BuildingData) — carried on
    // the missile itself so onMissileShipContact/onMissileBuildingContact don't need to look the firer
    // back up (it may well be dead, or its type ambiguous, by the time the missile actually lands).
    // Irrelevant for a THADD interceptor (targetKind 'missile'), which destroys outright on contact
    // rather than dealing hp damage — callers just pass 0 for those. `aimX`/`aimY` is the target's
    // position at the moment the caller decided to fire — needed because a staggered salvo shot can
    // spawn well after that (see SALVO_STAGGER_MS): if the target has since died and nothing else was
    // there to retarget onto by spawn time, the live lookup below comes back empty and this is what it
    // aims at instead, so it still launches off in a sensible direction.
    spawnMissile = (faction:Faction, x:number, y:number, targetKind:'ship'|'building'|'missile', targetId:string, damage:number, aimX:number, aimY:number) => {
        const missile = this.physics.add.sprite(x, y, 'missile_dot')
        missile.setData('kind', 'missile' as BodyKind)
        missile.setData('id', v4())
        missile.setData('faction', faction)
        missile.setData('targetKind', targetKind)
        missile.setData('targetId', targetId)
        missile.setData('damage', damage)
        missile.setData('createdAt', this.time.now)
        this.missilesGroup.add(missile)

        const liveTarget = this.getMissileTargetSprite(targetKind, targetId)
        const aimPointX = liveTarget ? liveTarget.x : aimX, aimPointY = liveTarget ? liveTarget.y : aimY

        if(targetKind === 'missile'){
            // A THADD interceptor is a fast, straight anti-missile shot with no arc — plain Arcade
            // velocity homing (moveTo), same as before.
            this.physics.moveTo(missile, aimPointX, aimPointY, MISSILE_SPEED_PX_S)
        }
        else{
            // An offensive missile (MLRS/BLM) flies its arc as an explicit leg from launch to aim point —
            // see startMissileLeg — driven by directly moving the sprite each frame (updateMissiles),
            // never by velocity, so its rendered position and its physics/collision body are always the
            // exact same point. No separate "ground truth vs visual" tracking of any kind.
            this.startMissileLeg(missile, x, y, aimPointX, aimPointY)
        }
    }

    // (Re)starts an offensive missile's current straight-line "leg": legOrigin is where it departs from
    // right now, legTarget is the aim point it's heading for, and legDurationMs is how long that leg
    // should take at MISSILE_SPEED_PX_S — together these are the one shared basis both updateMissiles'
    // position interpolation and its cosmetic sin-bump arc height read progress from. Called once at
    // spawn, and again on every retarget (see updateMissiles), so a new leg always starts fresh from
    // wherever the missile actually is at that moment.
    startMissileLeg = (missile:Physics.Arcade.Sprite, originX:number, originY:number, targetX:number, targetY:number) => {
        missile.setData('legOriginX', originX)
        missile.setData('legOriginY', originY)
        missile.setData('legTargetX', targetX)
        missile.setData('legTargetY', targetY)
        missile.setData('legStartAt', this.time.now)
        const legDistance = Phaser.Math.Distance.Between(originX, originY, targetX, targetY)
        missile.setData('legDurationMs', (legDistance / MISSILE_SPEED_PX_S) * 1000)
    }

    // A THADD interceptor (targetKind 'missile') is unchanged from before: plain Arcade velocity homing
    // towards its target's *live* position every frame, no retargeting (see spawnMissile/isHostileMissilePair
    // for why), no arc. impact is handled immediately by the overlap callback
    // (onMissileShipContact/onMissileBuildingContact/onMissileMissileContact) once it actually touches
    // something hostile — this just steers it and lets it fizzle in a straight line (whatever heading
    // its last moveTo call gave it — Arcade bodies hold velocity until told otherwise) if its target
    // died and there's nothing to retarget onto.
    //
    // An offensive missile (MLRS/BLM) is driven entirely differently: every frame its position is
    // computed directly from its current leg (see startMissileLeg) — straight-line progress from
    // legOrigin to legTarget, plus a sin-bump height for the cosmetic arc — and written into the sprite
    // via body.reset(), which moves the physics body and the rendered sprite together as one single
    // update. There is deliberately no "ground truth vs visual" split of any kind: whatever position is
    // used for collision is exactly the position drawn on screen, always. If the original target died,
    // it retargets by starting a brand new leg from its current (already-arced) position to whatever
    // hostile target of the same kind is now nearest (searched over the whole map — a missile mid-flight
    // has no "range" of its own the way a stationary turret does), and keeps trying every frame right up
    // until its leg completes in case something comes into range before then. If nothing's ever found,
    // it's destroyed (with a shatter effect, same as an actual impact) the instant its leg's arc
    // finishes, rather than flying on forever with nothing to hit.
    updateMissiles = (time:number, deltaMs:number) => {
        this.missilesGroup.children.each((child:Physics.Arcade.Sprite) => {
            if(!child.active) return true

            const targetId = child.getData('targetId')
            const targetKind:'ship'|'building'|'missile' = child.getData('targetKind')
            const createdAt = child.getData('createdAt')
            if(time - createdAt > MISSILE_MAX_LIFETIME_MS){
                child.destroy()
                return true
            }

            if(targetKind === 'missile'){
                const targetSprite = this.getMissileTargetSprite(targetKind, targetId)
                if(targetSprite) this.physics.moveTo(child, targetSprite.x, targetSprite.y, MISSILE_SPEED_PX_S)
                return true
            }

            // Offensive missile: retarget (a fresh leg) if the current target's gone and something else
            // hostile is in range; otherwise this leg's origin/target stay exactly as they were. Always
            // findNearestHostileBuilding — every offensive missile (MLRS/BLM) is spawned with targetKind
            // 'building' (a THADD interceptor is 'missile' and returns above, before this code even
            // runs), so a building is the only kind of target this ever legitimately retargets onto.
            if(!this.getMissileTargetSprite(targetKind, targetId)){
                const faction:Faction = child.getData('faction')
                const searchRadius = this.mapData.width * CELL_SIZE
                const retargeted = this.findNearestHostileBuilding(faction, child.x, child.y, searchRadius)

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

    // Every offensive missile renders itself now (its sprite's real position *is* its physics/collision
    // position — see updateMissiles) — this only draws the decaying vapor trail left behind it, as a
    // single polyline per missile (each segment's alpha fading with its own age) rather than a cloud of
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

    // True if a point (with the given clearance around it) would overlap a building's footprint —
    // bases included, since they're just another (tougher, bigger-footprint) building now.
    buildingOverlapsPoint = (worldX:number, worldY:number, clearance:number) => {
        return useAppStore.getState().buildings.some(f => {
            const p = this.toWorld(f.x, f.y)
            return Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y) < getBuildingFootprintRadius(f.kind) + clearance
        })
    }

    // Half the shorter side of a kind's baked icon texture — same measure centerCircleBody uses for
    // the physics body (see AppSix.ts/renderAppSixIcon: milsymbol bakes each canvas to exactly its
    // symbol's bounding box), so this is that kind's real rendered footprint, not a guessed constant.
    getBuildingIconRadius = (kind:BuildingType) => {
        const img = this.textures.get('factory_'+kind).getSourceImage() as HTMLCanvasElement
        return Math.min(img.width, img.height) / 2
    }

    // Minimum spacing between any two buildings — own or hostile, any kind — is just their two icons'
    // real radii plus a flat clearance, so frames never touch or overlap regardless of which kinds are
    // involved. Both the player and the AI place buildings through isValidPlacement, so this applies
    // to both alike.
    isTooCloseToAnyBuilding = (kind:BuildingType, worldX:number, worldY:number) => {
        const radius = this.getBuildingIconRadius(kind)
        return useAppStore.getState().buildings.some(f => {
            const p = this.toWorld(f.x, f.y)
            const minDist = radius + this.getBuildingIconRadius(f.kind) + BUILDING_MIN_CLEARANCE_PX
            return Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y) < minDist
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

        // dividing line through each base, marking the boundary of that faction's territory
        g.lineStyle(1, GREEN_HEX, 0.35)
        this.mapData.bases.forEach(base => {
            const lineX = base.x * CELL_SIZE + CELL_SIZE/2
            g.lineBetween(lineX, 0, lineX, worldSize)
        })

        this.drawTerrain()
        // Territory/sight-range bubbles are drawn every frame from update() instead (see rangeG) —
        // not here, since a building add/remove is far from the only thing that should refresh them.
    }

    // Terrain is no longer procedurally generated — it's drawn from an externally-authored Tiled
    // (mapeditor.org) JSON export instead (see MapGenerator's parseTiledMap). mapData.terrain is null by
    // default (an empty map, until a real file's been authored and passed to generateMap), in which
    // case this draws nothing at all. Once one's loaded, every occupied cell (any layer, any non-zero
    // GID — which specific tile it is doesn't matter here) gets a plain wireframe outline scaled from
    // the Tiled file's own tile size onto this game's CELL_SIZE grid — there's no tileset image asset
    // to draw real artwork from, only vector Graphics, same as everything else in this game.
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

    // Draws the route (line + numbered waypoint markers) for whichever shipyard is currently selected,
    // or — for a drag-selected group of ships — each of their own routes. Rebuilt only when the
    // selected shipyard or its waypoint count changes, not every frame; a ship selection always redraws
    // (ships move, so nothing about that case can be cached the same way).
    drawOrders = () => {
        const { selectedFactoryId, selectedShipIds, buildings: factories, vehicles } = useAppStore.getState()

        if(selectedShipIds.length > 0){
            this.lastOrdersKey = ''
            const g = this.ordersG
            g.clear()
            this.orderLabels.forEach(label => label.destroy())
            this.orderLabels = []
            selectedShipIds.forEach(id => {
                const ship = vehicles.find(s => s.id === id)
                if(!ship || !ship.waypoints || ship.waypoints.length === 0) return
                this.drawRouteAndMarkers(g, { x:ship.x, y:ship.y }, ship.waypoints)
            })
            return
        }

        const factory = factories.find(f => f.id === selectedFactoryId)
        const waypoints = (factory && factory.kind === BuildingType.LogisticsCenter) ? (factory.waypoints || []) : []

        const key = factory ? factory.id+':'+waypoints.length : ''
        if(key === this.lastOrdersKey) return
        this.lastOrdersKey = key

        const g = this.ordersG
        g.clear()
        this.orderLabels.forEach(label => label.destroy())
        this.orderLabels = []
        if(!factory || waypoints.length === 0) return

        this.drawRouteAndMarkers(g, this.toWorld(factory.x, factory.y), waypoints)
    }

    // Shared by drawOrders' two cases (a selected shipyard's route, or each selected ship's own route):
    // a line from originWorld through every waypoint (grid coordinates, converted here), each waypoint
    // marked with the same numbered circle so a ship's own orders read identically to a shipyard's —
    // including being individually cancellable by clicking the marker (see the drag-selected-ships click
    // handler and removeShipWaypoints/removeWaypoint).
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
            const label = this.add.text(x, y-16, String(i+1), { fontFamily:'Body', fontSize:'11px', color:colors.lGreen }).setOrigin(0.5).setDepth(5)
            this.orderLabels.push(label)
        })
    }

    // Placement circles behave like bubbles: each circle's own arc is only drawn where it isn't touching
    // another bubble, and wherever two bubbles touch they form a flat side (the shared chord) instead of a
    // curved overlap — trimmed by any other bubble covering part of that edge so nothing draws jagged.
    // Every building AND every unit (its own VehicleStats.sightRadius) contributes a bubble — units move,
    // so this runs every frame from update() rather than only whenever drawMap's static art changes.
    drawPlacementRanges = () => {
        const g = this.rangeG
        g.clear()

        const { buildings, vehicles } = useAppStore.getState()
        const structureCircles = buildings.map(s => ({ ...this.toWorld(s.x, s.y), r: getStructureRadius(s), faction: s.faction }))
        const unitCircles = vehicles.map(s => ({ x: s.x, y: s.y, r: VehicleData[s.type].sightRadius, faction: s.faction }))
        const circles = [...structureCircles, ...unitCircles]

        // Rounded portions: each circle's boundary where it doesn't touch any other bubble.
        g.lineStyle(1, GREEN_HEX, 0.25)
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

                g.lineStyle(4, GREEN_HEX, 0.9)
                segVisible.forEach(([t0, t1]) => {
                    if(t1-t0 < 0.001) return
                    g.lineBetween(ax+segDX*t0, ay+segDY*t0, ax+segDX*t1, ay+segDY*t1)
                })
            })
        })
    }

    // The placement ghost that follows the cursor is the exact same real APP-6 icon texture the built
    // building will actually use (baked once by generateTextures — see 'factory_'+kind there), not a
    // hand-drawn approximation — just tinted/faded to distinguish a valid spot from an invalid one.
    showPreviewIcon = (kind:BuildingType, gridX:number, gridY:number, valid:boolean) => {
        const { x, y } = this.toWorld(gridX, gridY)
        this.previewIcon.setTexture('factory_'+kind)
        this.previewIcon.setPosition(x, y)
        this.previewIcon.setTint(valid ? GREEN_HEX : GREY_DIM_HEX)
        this.previewIcon.setAlpha(valid ? 0.9 : 0.5)
        this.previewIcon.setVisible(true)
    }

    findFactoryAt = (gridX:number, gridY:number) => useAppStore.getState().buildings.find(f => f.x === gridX && f.y === gridY)

    // Whether a world-space point falls within the placement radius of any of a faction's own
    // structures — this is specifically the "territory border" used for placement (isNearOwnStructure)
    // and doesn't include unit sight range; see isWithinFactionSightRange for the version that does.
    // Takes world coordinates rather than grid ones since callers include continuously-moving ships.
    isWithinFactionStructureRadius = (worldX:number, worldY:number, faction:Faction) => {
        const ownFactories = useAppStore.getState().buildings.filter(f => f.faction === faction)
        return ownFactories.some(s => {
            const p = this.toWorld(s.x, s.y)
            return Phaser.Math.Distance.Between(worldX, worldY, p.x, p.y) <= getStructureRadius(s)
        })
    }

    // Full sight range: everywhere isWithinFactionStructureRadius already covers, plus every one of
    // that faction's own vehicles projecting its own VehicleStats.sightRadius around itself — a unit
    // adds to the player's sight the same way a building does, it just moves. Used by updateFogOfWar
    // and every findNearestHostile* weapon-targeting query; deliberately not used by isNearOwnStructure
    // (placement territory stays building-only — parking a ship somewhere shouldn't open up new
    // building placement there).
    isWithinFactionSightRange = (worldX:number, worldY:number, faction:Faction) => {
        // Uplink's ability is a genuine (temporary) sight-radius expansion for the player specifically —
        // every one of the player's own weapons (findNearestHostile*), not just fog-of-war rendering,
        // sees the whole map through this same check while it's active. Deliberately keyed to
        // Faction.Player, not `faction` — this never extends the *enemy's* own sight range, even if the
        // enemy somehow built an Uplink of its own (it has no way to click one anyway).
        if(faction === Faction.Player && this.time.now < this.mapRevealedUntil) return true
        if(this.isWithinFactionStructureRadius(worldX, worldY, faction)) return true
        const ownVehicles = useAppStore.getState().vehicles.filter(s => s.faction === faction)
        return ownVehicles.some(s => Phaser.Math.Distance.Between(worldX, worldY, s.x, s.y) <= VehicleData[s.type].sightRadius)
    }

    // Placement is allowed anywhere within the placement radius of one of a faction's own structures —
    // bases included, now that they're regular (if non-placeable) factories. Defaults to the player so
    // existing call sites are unaffected; the AI reuses this with Faction.Enemy to evaluate its own
    // territory the same way the player's is evaluated.
    isNearOwnStructure = (gridX:number, gridY:number, faction:Faction = Faction.Player) => {
        const { x, y } = this.toWorld(gridX, gridY)
        return this.isWithinFactionStructureRadius(x, y, faction)
    }

    isValidPlacement = (kind:BuildingType, gridX:number, gridY:number, faction:Faction = Faction.Player) => {
        if(gridX < 0 || gridY < 0 || gridX >= this.mapData.width || gridY >= this.mapData.height) return false
        // A base occupies a factory slot too now, so this alone also blocks placing on top of one.
        if(this.findFactoryAt(gridX, gridY)) return false
        if(getLogisticsStatus(faction).logisticsRemaining < 0) return false

        const worldPos = this.toWorld(gridX, gridY)
        const overlapsShip = useAppStore.getState().vehicles.some(s => {
            const minDist = FACTORY_FOOTPRINT_RADIUS + VehicleData[s.type].sizeHex*CELL_SIZE/2 + SHIP_BUILDING_CLEARANCE_PX
            return Phaser.Math.Distance.Between(worldPos.x, worldPos.y, s.x, s.y) < minDist
        })
        if(overlapsShip) return false
        if(this.isTooCloseToAnyBuilding(kind, worldPos.x, worldPos.y)) return false

        return this.isNearOwnStructure(gridX, gridY, faction)
    }

    // Governs each faction's 3 starting LogisticsCenters specifically — deliberately not routed
    // through isValidPlacement, since that requires being near an already-owned structure (impossible
    // for a faction's very first one) and checks the logistics budget (these 3 are a free, mandatory
    // starting commitment, not a normal build either side could get priced out of). Just: on the map,
    // on that faction's own side of it (player: left half, enemy: right half — matching where their
    // Base sits), not on top of anything else, and far enough from every LogisticsCenter that faction
    // has already placed this phase. The AI uses this exact same rule via Faction.Enemy — same
    // separation, just mirrored to the other half of the map.
    isValidLogisticsPlacement = (gridX:number, gridY:number, faction:Faction = Faction.Player) => {
        if(gridX < 0 || gridY < 0 || gridX >= this.mapData.width || gridY >= this.mapData.height) return false
        const onOwnHalf = faction === Faction.Player ? gridX < this.mapData.width/2 : gridX >= this.mapData.width/2
        if(!onOwnHalf) return false
        if(this.findFactoryAt(gridX, gridY)) return false

        const worldPos = this.toWorld(gridX, gridY)
        // Icon-overlap guard first (catches the faction's own Base, which the LogisticsCenter-only
        // spacing rule below never checked against), then the much larger deliberate spread rule that
        // governs LogisticsCenters specifically.
        if(this.isTooCloseToAnyBuilding(BuildingType.LogisticsCenter, worldPos.x, worldPos.y)) return false

        const tooClose = useAppStore.getState().buildings.some(f => {
            if(f.faction !== faction || f.kind !== BuildingType.LogisticsCenter) return false
            const p = this.toWorld(f.x, f.y)
            return Phaser.Math.Distance.Between(worldPos.x, worldPos.y, p.x, p.y) < LOGISTICS_CENTER_MIN_SPACING_PX
        })
        return !tooClose
    }

    // Placement phase's first-stage click handler: places a LogisticsCenter directly on click (no
    // toolbar selection step — FactoryToolbar just shows a placement counter during this phase), and
    // hands off to the second stage (see handleBonusBuildingPlacementClick) the instant the 3rd one
    // goes down.
    handleLogisticsPlacementClick = () => {
        const { x, y } = this.hoveredCell
        if(!this.isValidLogisticsPlacement(x, y)) return

        const factory:BuildingData = { id:v4(), x, y, kind:BuildingType.LogisticsCenter, faction:Faction.Player, hp:getBuildingMaxHp(BuildingType.LogisticsCenter) }
        useAppStore.getState().addFactory(factory)
        this.createBuildingSprite(factory)
        this.previewG.clear()
        this.previewIcon.setVisible(false)

        const placedCount = useAppStore.getState().buildings.filter(f => f.faction === Faction.Player && f.kind === BuildingType.LogisticsCenter).length
        if(placedCount >= LOGISTICS_CENTER_COUNT) useAppStore.getState().setPhase('building')
    }

    // Placement phase's second-stage click handler: every other building kind is placeable now (via
    // the toolbar's normal placingFactory toggle — see FactoryToolbar), spent against the player's
    // buildingPoints budget instead of the free-form economy the same click drives during actual
    // combat. The match goes live the instant that budget hits zero.
    handleBonusBuildingPlacementClick = () => {
        const { placingFactory, setPlacingBuilding: setPlacingFactory, addFactory, buildingPoints, spendBuildingPoints } = useAppStore.getState()
        if(!placingFactory) return
        if(!this.isValidPlacement(placingFactory, this.hoveredCell.x, this.hoveredCell.y)) return

        const cost = BuildingData[placingFactory].buildingPoints
        if(buildingPoints[Faction.Player] < cost) return

        const factory:BuildingData = {
            id: v4(),
            x: this.hoveredCell.x,
            y: this.hoveredCell.y,
            kind: placingFactory,
            faction: Faction.Player,
            hp: getBuildingMaxHp(placingFactory),
            ammoRemaining: BuildingData[placingFactory].ammo,
        }
        addFactory(factory)
        this.createBuildingSprite(factory)
        setPlacingFactory(null)
        this.previewG.clear()
        this.previewIcon.setVisible(false)

        spendBuildingPoints(Faction.Player, cost)
        if(useAppStore.getState().buildingPoints[Faction.Player] <= 0) this.startCombatPhase()
    }

    updatePreview = () => {
        this.previewG.clear()
        if(!this.hoveredCell){ this.previewIcon.setVisible(false); return }

        if(useAppStore.getState().phase === 'placement'){
            const valid = this.isValidLogisticsPlacement(this.hoveredCell.x, this.hoveredCell.y)
            this.showPreviewIcon(BuildingType.LogisticsCenter, this.hoveredCell.x, this.hoveredCell.y, valid)
            return
        }

        const { placingFactory } = useAppStore.getState()
        if(!placingFactory){ this.previewIcon.setVisible(false); return }

        const valid = this.isValidPlacement(placingFactory, this.hoveredCell.x, this.hoveredCell.y)
        this.showPreviewIcon(placingFactory, this.hoveredCell.x, this.hoveredCell.y, valid)
        this.drawAmmoDumpPreviewLines(placingFactory, this.hoveredCell.x, this.hoveredCell.y)
    }

    // Resupply-range preview lines for the placement ghost — two directions, both drawn from whichever
    // point is actually being placed right now:
    //  - Placing an AmmoDump itself: a line out to every one of the player's own buildings — never
    //    another AmmoDump, they don't resupply each other (see updateAmmoDumps) — that would fall within
    //    ITS resupply radius (rangePx) from this spot, i.e. what it would go on to cover.
    //  - Placing anything else that actually carries an ammo stat (BLM/THADD — no point showing this for
    //    a kind that never runs out to begin with): a line back to every existing AmmoDump whose range
    //    already reaches this spot, i.e. what would already be covering it the moment it's built.
    // Either way this is purely informational — drawn regardless of whether the placement itself is
    // currently valid, same as the placement ghost shape it's layered alongside.
    drawAmmoDumpPreviewLines = (placingFactory:BuildingType, gridX:number, gridY:number) => {
        const { x, y } = this.toWorld(gridX, gridY)
        const ownBuildings = useAppStore.getState().buildings.filter(f => f.faction === Faction.Player)
        this.previewG.lineStyle(1, GREEN_HEX, 0.6)

        if(placingFactory === BuildingType.AmmoDump){
            const range = BuildingData[BuildingType.AmmoDump].rangePx
            ownBuildings.forEach(f => {
                if(f.kind === BuildingType.AmmoDump) return
                const p = this.toWorld(f.x, f.y)
                if(Phaser.Math.Distance.Between(x, y, p.x, p.y) <= range) this.previewG.lineBetween(x, y, p.x, p.y)
            })
            return
        }

        if(!BuildingData[placingFactory].ammo) return
        ownBuildings.forEach(f => {
            if(f.kind !== BuildingType.AmmoDump) return
            const p = this.toWorld(f.x, f.y)
            if(Phaser.Math.Distance.Between(x, y, p.x, p.y) <= BuildingData[BuildingType.AmmoDump].rangePx) this.previewG.lineBetween(x, y, p.x, p.y)
        })
    }

    enablePlacementControls = () => {
        this.input.on('pointerdown', () => {
            if(!this.hoveredCell) return

            // Shift+left-drag starts a unit-selection box instead of any of the click handling below —
            // resolved into selectedShipIds on pointerup (see enableCameraControls). Plain left-drag is
            // still reserved for panning the camera.
            if(this.shiftDown && useAppStore.getState().phase === 'combat'){
                const worldPoint = this.cameras.main.getWorldPoint(this.input.activePointer.x, this.input.activePointer.y)
                this.dragSelectStart = { x:worldPoint.x, y:worldPoint.y }
                this.dragSelectCurrent = this.dragSelectStart
                return
            }

            if(useAppStore.getState().phase === 'placement'){
                this.handleLogisticsPlacementClick()
                return
            }
            if(useAppStore.getState().phase === 'building'){
                this.handleBonusBuildingPlacementClick()
                return
            }

            const { placingFactory, setPlacingBuilding: setPlacingFactory, setSelectedBuildingId: setSelectedFactoryId, addFactory, buildings: factories, vehicles, selectedFactoryId, selectedShipIds, addWaypoint, removeWaypoint, addShipWaypoints, removeShipWaypoints } = useAppStore.getState()

            // A drag-selected group of ships takes orders the same way a selected shipyard's route does
            // below — every click adds one more waypoint onto each selected ship's own route. Clicking a
            // cell that's already a waypoint for any of the selected ships removes it from every selected
            // ship that has one there instead (removeShipWaypoints), same click-to-remove gesture as a
            // selected shipyard's route, just applied across the whole selection at once.
            if(selectedShipIds.length > 0){
                const { x, y } = this.hoveredCell
                if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return
                const selectedShips = vehicles.filter(s => selectedShipIds.includes(s.id))
                const clickedExisting = selectedShips.some(s => s.waypoints?.some(w => w.x === x && w.y === y))
                if(clickedExisting) removeShipWaypoints(selectedShipIds, x, y)
                else addShipWaypoints(selectedShipIds, x, y)
                return
            }

            // Selecting one of the player's own shipyards puts the map straight into orders-editing mode —
            // the Orders button in FactoryToolbar is just a label now, not a prerequisite for this.
            const selectedShipyard = factories.find(f => f.id === selectedFactoryId && f.kind === BuildingType.LogisticsCenter && f.faction === Faction.Player)
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
                // Uplink isn't selected for orders like a shipyard — clicking it directly fires its
                // ability (subject to its own cooldown) instead.
                if(clicked && clicked.faction === Faction.Player && clicked.kind === BuildingType.Uplink){
                    this.activateUplink(clicked)
                    return
                }
                setSelectedFactoryId(clicked && clicked.faction === Faction.Player && clicked.kind === BuildingType.LogisticsCenter ? clicked.id : null)
                return
            }

            if(!this.isValidPlacement(placingFactory, this.hoveredCell.x, this.hoveredCell.y)) return

            const factory:BuildingData = {
                id: v4(),
                x: this.hoveredCell.x,
                y: this.hoveredCell.y,
                kind: placingFactory,
                faction: Faction.Player,
                hp: getBuildingMaxHp(placingFactory),
                ammoRemaining: BuildingData[placingFactory].ammo,
            }
            addFactory(factory)
            this.createBuildingSprite(factory)
            setPlacingFactory(null)
            this.previewG.clear()
        })

        this.input.keyboard.on('keydown-ESC', () => {
            const { setPlacingBuilding: setPlacingFactory, setSelectedBuildingId: setSelectedFactoryId, setSelectedShipIds } = useAppStore.getState()
            setPlacingFactory(null)
            setSelectedFactoryId(null)
            setSelectedShipIds([])
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

            // A shift-drag box-select in progress (see enablePlacementControls' pointerdown) owns the
            // drag entirely — no camera panning and no placement-ghost preview while it's live.
            if(this.dragSelectStart){
                this.dragSelectCurrent = { x:worldPoint.x, y:worldPoint.y }
                this.drawDragSelectBox()
                return
            }

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

        this.input.on('pointerup', () => {
            if(!this.dragSelectStart) return
            const start = this.dragSelectStart
            const end = this.dragSelectCurrent || start
            this.dragSelectStart = null
            this.dragSelectCurrent = null
            this.dragSelectG.clear()

            const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x)
            const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)

            const { vehicles, setSelectedShipIds } = useAppStore.getState()
            const hitIds = vehicles
                .filter(s => s.faction === Faction.Player && s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY)
                .map(s => s.id)
            setSelectedShipIds(hitIds)
        })

        this.input.on('wheel', (_pointer, _objs, _dx, dy:number) => {
            const zoom = PhaserMath.Clamp(this.cameras.main.zoom - dy*0.001, 0.25, 3)
            this.cameras.main.setZoom(zoom)
        })
    }

    // Draws the live shift-drag selection rectangle in world space (see dragSelectStart/Current).
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
