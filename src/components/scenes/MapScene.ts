import { Scene, GameObjects, Math as PhaserMath } from "phaser";
import { v4 } from "uuid";
import { useAppStore } from "../../common/store";
import { onSetScene } from "../../common/Thunks";
import { getEnergyStatus, getFactoryEnergyCost } from "../../common/Utils";
import { generateMap } from "../../common/MapGenerator";
import { ShipData } from "../../common/ShipData";
import { Faction, NodeKind, FactoryKind, ShipType, MAP_SIZE, CELL_SIZE, METAL_TICK_MS, METAL_PER_MINING_STATION } from "../../../enum";

const PLACEMENT_RADIUS_PX = 200
const EXTRACTOR_RADIUS_PX = PLACEMENT_RADIUS_PX/2
const TWO_PI = Math.PI*2

// Ships following shipyard orders travel at half their listed ShipData speed.
const WAYPOINT_SPEED_MULTIPLIER = 0.5

// Once a ship finishes its route it loiters in a circle around the final waypoint.
const ORBIT_RADIUS_PX = CELL_SIZE * 3
const ORBIT_ANGULAR_SPEED = 0.0005 // radians per ms

// Stable per-ship angular offset so multiple ships orbiting the same point spread out instead of stacking.
const shipOrbitPhase = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return ((h >>> 0) % 1000) / 1000 * TWO_PI
}

// Mining stations and solar mills project a smaller placement radius than bases/shipyards.
const getStructureRadius = (structure:BaseData|FactoryData) =>
    'kind' in structure && structure.kind !== FactoryKind.Shipyard ? EXTRACTOR_RADIUS_PX : PLACEMENT_RADIUS_PX

const GREEN = 0x33ff55
const GREEN_DIM = 0x114422
const GREY_DIM = 0x666666

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
    shipLabels: Map<string, GameObjects.Text> = new Map()
    orderLabels: Array<GameObjects.Text> = []
    lastOrdersKey: string = ''
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

        this.mapData = useAppStore.getState().activeMap || generateMap(MAP_SIZE)

        const worldSize = this.mapData.width * CELL_SIZE
        this.cameras.main.setBounds(0, 0, worldSize, worldSize)
        this.cameras.main.centerOn(worldSize/2, worldSize/2)
        this.cameras.main.setZoom(1)

        this.drawMap()
        this.enableCameraControls()
        this.enablePlacementControls()

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
        this.drawProductionProgress()
        this.drawShips()
        this.drawOrders()

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
            alpha: 0.5,
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

        useAppStore.getState().addShip({ id:v4(), faction:shipyard.faction, type, shipyardId:shipyard.id, x:pos.x, y:pos.y, pathIndex:0 })
    }

    // Advances every ship one step towards its shipyard's current route, read live off the shipyard each
    // frame (rather than a copy taken at spawn) so edited orders steer ships that are already underway.
    // Once a ship has worked through every waypoint it loiters in a slow orbit around the last one.
    moveShips = (time:number, deltaMs:number) => {
        const { ships, factories, setShips } = useAppStore.getState()
        let changed = false

        const updated = ships.map(ship => {
            const shipyard = factories.find(f => f.id === ship.shipyardId)
            const waypoints = shipyard?.waypoints || []
            if(waypoints.length === 0) return ship

            const pathIndex = ship.pathIndex ?? 0
            const step = ShipData[ship.type].speed * WAYPOINT_SPEED_MULTIPLIER * (deltaMs/1000)
            changed = true

            let target:{x:number,y:number}
            if(pathIndex < waypoints.length){
                target = this.toWorld(waypoints[pathIndex].x, waypoints[pathIndex].y)
            }
            else {
                const last = this.toWorld(waypoints[waypoints.length-1].x, waypoints[waypoints.length-1].y)
                const angle = time*ORBIT_ANGULAR_SPEED + shipOrbitPhase(ship.id)
                target = { x: last.x+Math.cos(angle)*ORBIT_RADIUS_PX, y: last.y+Math.sin(angle)*ORBIT_RADIUS_PX }
            }

            const dist = Phaser.Math.Distance.Between(ship.x, ship.y, target.x, target.y)
            if(dist <= step) return { ...ship, x:target.x, y:target.y, pathIndex: pathIndex < waypoints.length ? pathIndex+1 : pathIndex }

            const angle = Math.atan2(target.y-ship.y, target.x-ship.x)
            return { ...ship, x: ship.x+Math.cos(angle)*step, y: ship.y+Math.sin(angle)*step }
        })

        if(changed) setShips(updated)
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
        useAppStore.getState().factories.forEach(this.drawFactory)
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

    // Shared shape renderer so the placement preview matches the built factory exactly.
    drawFactoryShape = (g:GameObjects.Graphics, kind:FactoryKind, gridX:number, gridY:number, color:number, alpha:number) => {
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
                const angle = (i/8) * Math.PI*2
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

    // Placement is allowed anywhere within the placement radius of one of the player's own structures (base or factory).
    isNearOwnStructure = (gridX:number, gridY:number) => {
        const { x, y } = this.toWorld(gridX, gridY)
        const ownBases = this.mapData.bases.filter(b => b.faction === Faction.Player)
        const ownFactories = useAppStore.getState().factories.filter(f => f.faction === Faction.Player)
        return [...ownBases, ...ownFactories].some(s => {
            const p = this.toWorld(s.x, s.y)
            return Phaser.Math.Distance.Between(x, y, p.x, p.y) <= getStructureRadius(s)
        })
    }

    isValidPlacement = (kind:FactoryKind, gridX:number, gridY:number) => {
        if(gridX < 0 || gridY < 0 || gridX >= this.mapData.width || gridY >= this.mapData.height) return false
        if(this.findFactoryAt(gridX, gridY)) return false
        if(this.mapData.bases.some(b => b.x === gridX && b.y === gridY)) return false
        if(getEnergyStatus().energyRemaining - getFactoryEnergyCost(kind) < 0) return false

        const worldPos = this.toWorld(gridX, gridY)
        const overlapsShip = useAppStore.getState().ships.some(s => {
            const minDist = FACTORY_FOOTPRINT_RADIUS + ShipData[s.type].sizeHex*CELL_SIZE/2 + SHIP_BUILDING_CLEARANCE_PX
            return Phaser.Math.Distance.Between(worldPos.x, worldPos.y, s.x, s.y) < minDist
        })
        if(overlapsShip) return false

        const node = this.findNodeAt(gridX, gridY)

        if(kind === FactoryKind.MiningStation) return node?.kind === NodeKind.Asteroid && this.isNearOwnStructure(gridX, gridY)
        if(kind === FactoryKind.SolarMill) return node?.kind === NodeKind.Star && this.isNearOwnStructure(gridX, gridY)
        if(node) return false

        return this.isNearOwnStructure(gridX, gridY)
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
            const { placingFactory, setPlacingFactory, setSelectedFactoryId, addFactory, settingWaypointsFactoryId, addWaypoint } = useAppStore.getState()
            if(!this.hoveredCell) return

            if(settingWaypointsFactoryId){
                const { x, y } = this.hoveredCell
                if(x < 0 || y < 0 || x >= this.mapData.width || y >= this.mapData.height) return
                addWaypoint(settingWaypointsFactoryId, x, y)
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
            const { setPlacingFactory, setSelectedFactoryId, setSettingWaypointsFactoryId } = useAppStore.getState()
            setPlacingFactory(null)
            setSelectedFactoryId(null)
            setSettingWaypointsFactoryId(null)
            this.previewG.clear()
        })
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

