import * as THREE from 'three'
import { useAppStore } from '../common/store'
import type MapScene from '../components/scenes/MapScene'
import type ShipSprite from '../components/sprites/ShipSprite'
import { Faction, ShipType, ShipData, ObjectiveSpriteIndex } from '../../enum'
import CameraRig from './CameraRig'
import LineBatch from './LineBatch'
import { getShipTexture, getTileTexture, makeQuad, makeTextSprite, TextSprite } from './Assets3D'
import { computeSightGeometry } from '../common/SightRadius'
import {
    CELL_SIZE, MAP_SIZE, worldToGrid,
    GREEN_HEX, GREEN_DIM_HEX, YELLOW_HEX, RED_HEX,
    OBJECTIVE_ICON_SIZE, OBJECTIVE_CAPTURE_TIME_MS,
    HARVESTER_METAL_CAPACITY,
    MISSILE_IMPACT_LIFETIME_MS, MISSILE_IMPACT_MIN_RADIUS_PX, MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX,
    CONTRAIL_LIFETIME_MS,
    SHIP_FRAGMENT_LIFETIME_MS, SHIP_FRAGMENT_MIN_DISTANCE_PX, SHIP_FRAGMENT_MAX_DISTANCE_PX,
} from '../common/Constants'

// The game's renderer. Phaser still runs the whole simulation (headless — see Viewport.tsx), and this
// reads whatever it computed each frame and draws it in 3D. Nothing here decides anything about the
// game: no movement, no combat, no capture logic. Anything that looks like a rule living in this file is
// a bug — the split is deliberately "Phaser owns the sim, this owns the pixels".
//
// Coordinate mapping: the sim is a flat 2D world in pixels, origin at the map's top-left corner. Here
// that plane is the XZ plane with the map centered on the origin (so the camera orbits the middle of the
// map rather than its corner), and +Y is up out of it.

const BAR_WIDTH = 26
const BAR_HEIGHT = 3
const BAR_STEP = 7
const GROUND_Y = 0.5

interface ShipVisual {
    group: THREE.Group
    billboard: THREE.Sprite
    hpBg: THREE.Sprite; hpFg: THREE.Sprite
    metalBg: THREE.Sprite; metalFg: THREE.Sprite
    queueBg: THREE.Sprite; queueFg: THREE.Sprite
    ammo: TextSprite
    name: TextSprite
    type: ShipType
    faction: Faction
}

interface Fragment {
    sprite: THREE.Sprite
    from: THREE.Vector3
    to: THREE.Vector3
    spin: number
    bornAt: number
}

// Reuses a pool of identical objects across frames rather than creating/destroying them — used for the
// transient labels (waypoint numbers) whose count changes constantly with the selection.
class SpritePool<T> {
    private items:Array<T> = []
    private used = 0
    constructor(private make:() => T, private setVisible:(item:T, visible:boolean) => void){}
    begin = () => { this.used = 0 }
    take = () => {
        if(this.used === this.items.length) this.items.push(this.make())
        const item = this.items[this.used++]
        this.setVisible(item, true)
        return item
    }
    end = () => { for(let i=this.used; i<this.items.length; i++) this.setVisible(this.items[i], false) }
    all = () => this.items
}

export default class Scene3D {
    private renderer: THREE.WebGLRenderer
    private scene = new THREE.Scene()
    private rig: CameraRig
    private container: HTMLElement

    private worldSize = MAP_SIZE * CELL_SIZE
    private gridObject: THREE.LineSegments | null = null

    private shipVisuals = new Map<string, ShipVisual>()
    private nodeSprites = new Map<string, THREE.Sprite>()
    private objectiveVisuals = new Map<string, { icon:THREE.Sprite, bg:THREE.Sprite, fg:THREE.Sprite }>()
    private missileSprites = new Map<string, THREE.Sprite>()
    private bulletSprites = new Map<string, THREE.Sprite>()
    private impactSprites: Array<THREE.Sprite> = []
    private fragments: Array<Fragment> = []

    private routeLines = new LineBatch(GREEN_HEX, 0.5)
    private selectionLines = new LineBatch(GREEN_HEX, 0.9)
    private sightLines = new LineBatch(GREEN_HEX, 0.25, 32768)
    private beamLines = new LineBatch(YELLOW_HEX, 0.8)
    private trailLines = new LineBatch(GREEN_HEX, 0.45, 16384)
    private overlapMesh: THREE.Mesh
    private overlapPositions = new Float32Array(24576)

    private waypointLabels = new SpritePool<TextSprite>(
        () => { const t = makeTextSprite(); this.scene.add(t.sprite); return t },
        (t, v) => { t.sprite.visible = v },
    )

    private raycaster = new THREE.Raycaster()
    private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    private pointerNdc = new THREE.Vector2()

    private dragMode: 'none' | 'orbit' | 'pan' | 'select' = 'none'
    private dragStartScreen = { x:0, y:0 }
    private lastPointer = { x:0, y:0 }
    private dragMoved = false
    private shiftDown = false
    private selectBoxEl: HTMLDivElement
    private lastClickShipId: string | null = null
    private lastClickAt = 0

    private prevShipIds = new Set<string>()
    private lastFrameAt = performance.now()
    private raf = 0
    private disposed = false

    constructor(container:HTMLElement){
        this.container = container
        const width = container.clientWidth || window.innerWidth
        const height = container.clientHeight || window.innerHeight

        this.renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' })
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.setSize(width, height)
        this.renderer.setClearColor(0x000000, 1)
        container.appendChild(this.renderer.domElement)

        this.rig = new CameraRig(width/height, { minDistance: 80, maxDistance: this.worldSize*1.6 })
        this.rig.jumpTo(0, 0, this.worldSize*0.55)

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x202030, 1.4))
        this.scene.add(this.buildStarfield())
        ;[this.routeLines, this.selectionLines, this.sightLines, this.beamLines, this.trailLines].forEach(b => this.scene.add(b.object))

        const overlapGeometry = new THREE.BufferGeometry()
        overlapGeometry.setAttribute('position', new THREE.BufferAttribute(this.overlapPositions, 3))
        this.overlapMesh = new THREE.Mesh(overlapGeometry, new THREE.MeshBasicMaterial({ color:GREEN_HEX, transparent:true, opacity:0.12, side:THREE.DoubleSide, depthTest:false }))
        this.overlapMesh.frustumCulled = false
        this.scene.add(this.overlapMesh)

        this.selectBoxEl = document.createElement('div')
        this.selectBoxEl.style.cssText = 'position:absolute;border:1px solid #55ff55;background:rgba(85,255,85,0.08);pointer-events:none;display:none;z-index:1;'
        container.appendChild(this.selectBoxEl)

        this.bindInput()
        this.resizeObserver.observe(container)
        this.frame()
    }

    // --- Coordinate mapping ------------------------------------------------------------------------
    private toSceneX = (gameX:number) => gameX - this.worldSize/2
    private toSceneZ = (gameY:number) => gameY - this.worldSize/2
    private toGameX = (sceneX:number) => sceneX + this.worldSize/2
    private toGameY = (sceneZ:number) => sceneZ + this.worldSize/2

    private buildStarfield = () => {
        // A real point cloud rather than a flat backdrop image: with an orbiting camera the parallax as
        // you swing around is most of what sells the sense of actually being in a 3D space.
        const count = 2200
        const positions = new Float32Array(count*3)
        const radius = this.worldSize*6
        for(let i=0; i<count; i++){
            const theta = Math.random()*Math.PI*2
            const phi = Math.acos(2*Math.random() - 1)
            const r = radius * (0.6 + Math.random()*0.4)
            positions[i*3] = r*Math.sin(phi)*Math.cos(theta)
            positions[i*3+1] = r*Math.cos(phi)
            positions[i*3+2] = r*Math.sin(phi)*Math.sin(theta)
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color:0x99bb99, size:this.worldSize*0.006, sizeAttenuation:true, transparent:true, opacity:0.7 }))
        points.frustumCulled = false
        return points
    }

    // The map floor. Static, so it's built once per map size rather than rebuilt per frame like the
    // overlay batches — same major-every-5-cells emphasis MapScene's drawMap used.
    private buildGrid = (cells:number) => {
        if(this.gridObject){
            this.scene.remove(this.gridObject)
            this.gridObject.geometry.dispose()
        }
        const size = cells*CELL_SIZE
        const half = size/2
        const positions:Array<number> = []
        for(let i=0; i<=cells; i++){
            const p = i*CELL_SIZE - half
            positions.push(p, 0, -half, p, 0, half)
            positions.push(-half, 0, p, half, 0, p)
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        this.gridObject = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color:GREEN_DIM_HEX, transparent:true, opacity:0.35 }))
        this.gridObject.frustumCulled = false
        this.scene.add(this.gridObject)
    }

    // --- Input -------------------------------------------------------------------------------------
    // Button assignment follows Homeworld: the right button flies the camera, the left button is purely
    // for commanding (select / box-select / order). That's the opposite of most RTSs but it's what makes
    // a freely orbiting camera workable — the camera needs a dedicated button, and left-click has to
    // stay on commands.
    private bindInput = () => {
        const el = this.renderer.domElement
        el.addEventListener('pointerdown', this.onPointerDown)
        el.addEventListener('wheel', this.onWheel, { passive:false })
        el.addEventListener('contextmenu', this.onContextMenu)
        window.addEventListener('pointermove', this.onPointerMove)
        window.addEventListener('pointerup', this.onPointerUp)
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
    }

    private unbindInput = () => {
        const el = this.renderer.domElement
        el.removeEventListener('pointerdown', this.onPointerDown)
        el.removeEventListener('wheel', this.onWheel)
        el.removeEventListener('contextmenu', this.onContextMenu)
        window.removeEventListener('pointermove', this.onPointerMove)
        window.removeEventListener('pointerup', this.onPointerUp)
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
    }

    private onContextMenu = (e:Event) => e.preventDefault()
    private onKeyUp = (e:KeyboardEvent) => { if(e.key === 'Shift') this.shiftDown = false }
    private onKeyDown = (e:KeyboardEvent) => {
        if(e.key === 'Shift') this.shiftDown = true
        // Homeworld's focus-on-selection: snap the orbit point onto whatever's selected and pull in far
        // enough to frame the whole group.
        if(e.key === 'f' || e.key === 'F') this.focusSelection()
        if(e.key === 'Escape') useAppStore.getState().setSelectedShipIds([])
    }

    private focusSelection = () => {
        const mapScene = this.mapScene()
        if(!mapScene) return
        const { selectedShipIds } = useAppStore.getState()
        const ships = mapScene.ships.filter(s => selectedShipIds.includes(s.id))
        if(ships.length === 0){ this.rig.focusOn(0, 0, this.worldSize*0.4); return }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        ships.forEach(s => {
            minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x)
            minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y)
        })
        const cx = (minX+maxX)/2, cy = (minY+maxY)/2
        const radius = Math.max(CELL_SIZE*4, Math.hypot(maxX-minX, maxY-minY)/2 + CELL_SIZE*3)
        this.rig.focusOn(this.toSceneX(cx), this.toSceneZ(cy), radius)
    }

    private setNdc = (e:PointerEvent) => {
        const rect = this.renderer.domElement.getBoundingClientRect()
        this.pointerNdc.set(((e.clientX-rect.left)/rect.width)*2 - 1, -((e.clientY-rect.top)/rect.height)*2 + 1)
    }

    // Where the pointer's ray meets the map floor, in game coordinates. Null when the ray points at the
    // sky (above the horizon), where there simply is no ground point to speak of.
    private groundPointFromEvent = (e:PointerEvent) => {
        this.setNdc(e)
        this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera)
        const hit = new THREE.Vector3()
        if(!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null
        return { x: this.toGameX(hit.x), y: this.toGameY(hit.z) }
    }

    private shipAtEvent = (e:PointerEvent):ShipSprite | null => {
        const mapScene = this.mapScene()
        if(!mapScene) return null
        this.setNdc(e)
        this.raycaster.setFromCamera(this.pointerNdc, this.rig.camera)
        // Picks against the billboards actually on screen rather than against a ground-plane position:
        // in perspective a ship's art stands well above the point it occupies on the floor, so hit-testing
        // the floor would mean clicking a ship's own sprite frequently missed it.
        const billboards = Array.from(this.shipVisuals.values()).filter(v => v.group.visible).map(v => v.billboard)
        const hits = this.raycaster.intersectObjects(billboards, false)
        for(const hit of hits){
            const id = hit.object.userData.shipId as string
            const ship = mapScene.shipSprites.get(id)
            if(ship && ship.faction === Faction.Player) return ship
        }
        return null
    }

    private onPointerDown = (e:PointerEvent) => {
        this.dragStartScreen = { x:e.clientX, y:e.clientY }
        this.lastPointer = { x:e.clientX, y:e.clientY }
        this.dragMoved = false
        if(e.button === 2){ this.dragMode = this.shiftDown ? 'pan' : 'orbit'; return }
        if(e.button === 1){ this.dragMode = 'pan'; return }
        if(e.button === 0) this.dragMode = 'select'
    }

    private onPointerMove = (e:PointerEvent) => {
        const dx = e.clientX - this.lastPointer.x
        const dy = e.clientY - this.lastPointer.y
        this.lastPointer = { x:e.clientX, y:e.clientY }
        if(Math.hypot(e.clientX-this.dragStartScreen.x, e.clientY-this.dragStartScreen.y) > 4) this.dragMoved = true

        if(this.dragMode === 'orbit'){ this.rig.orbit(dx, dy); return }
        if(this.dragMode === 'pan'){ this.rig.pan(dx, dy); return }
        if(this.dragMode === 'select' && this.dragMoved){
            const rect = this.container.getBoundingClientRect()
            const x = Math.min(this.dragStartScreen.x, e.clientX) - rect.left
            const y = Math.min(this.dragStartScreen.y, e.clientY) - rect.top
            this.selectBoxEl.style.display = 'block'
            this.selectBoxEl.style.left = `${x}px`
            this.selectBoxEl.style.top = `${y}px`
            this.selectBoxEl.style.width = `${Math.abs(e.clientX-this.dragStartScreen.x)}px`
            this.selectBoxEl.style.height = `${Math.abs(e.clientY-this.dragStartScreen.y)}px`
        }
    }

    private onPointerUp = (e:PointerEvent) => {
        const mode = this.dragMode
        this.dragMode = 'none'
        this.selectBoxEl.style.display = 'none'
        if(mode !== 'select') return

        const mapScene = this.mapScene()
        if(!mapScene) return

        if(this.dragMoved){ this.boxSelect(e); return }

        const clicked = this.shipAtEvent(e)
        if(clicked){
            const now = performance.now()
            const isDoubleClick = this.lastClickShipId === clicked.id && now - this.lastClickAt <= 350
            this.lastClickShipId = clicked.id
            this.lastClickAt = now
            if(isDoubleClick){
                const sameType = mapScene.ships.filter(s => s.faction === Faction.Player && s.type === clicked.type).map(s => s.id)
                useAppStore.getState().setSelectedShipIds(sameType)
                this.lastClickShipId = null
                return
            }
            useAppStore.getState().setSelectedShipIds([clicked.id])
            return
        }

        const ground = this.groundPointFromEvent(e)
        if(!ground){ return }
        const cell = worldToGrid(ground.x, ground.y)
        if(useAppStore.getState().selectedShipIds.length === 0) return
        mapScene.orderSelectedTo(cell.x, cell.y, this.shiftDown)
    }

    // Box-select tests each ship's *projected* screen position rather than a world-space rectangle —
    // with a perspective camera the on-screen box maps to a frustum, not a box, so projecting each
    // candidate is both simpler and exactly what the player sees themselves selecting.
    private boxSelect = (e:PointerEvent) => {
        const mapScene = this.mapScene()
        if(!mapScene) return
        const rect = this.renderer.domElement.getBoundingClientRect()
        const x1 = Math.min(this.dragStartScreen.x, e.clientX) - rect.left
        const x2 = Math.max(this.dragStartScreen.x, e.clientX) - rect.left
        const y1 = Math.min(this.dragStartScreen.y, e.clientY) - rect.top
        const y2 = Math.max(this.dragStartScreen.y, e.clientY) - rect.top

        const projected = new THREE.Vector3()
        const hitIds = mapScene.ships.filter(s => {
            if(s.faction !== Faction.Player || s.type === ShipType.CATH) return false
            projected.set(this.toSceneX(s.x), 0, this.toSceneZ(s.y)).project(this.rig.camera)
            if(projected.z > 1) return false // behind the camera
            const sx = (projected.x+1)/2 * rect.width
            const sy = (-projected.y+1)/2 * rect.height
            return sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2
        }).map(s => s.id)

        useAppStore.getState().setSelectedShipIds(hitIds)
    }

    private onWheel = (e:WheelEvent) => {
        e.preventDefault()
        this.rig.zoom(e.deltaY)
    }

    private resizeObserver = new ResizeObserver(() => {
        const w = this.container.clientWidth, h = this.container.clientHeight
        if(!w || !h) return
        this.rig.setAspect(w/h)
        this.renderer.setSize(w, h)
    })

    private mapScene = ():MapScene | null => {
        const scene = useAppStore.getState().scene as MapScene | null
        // `scene` is set in MapScene's constructor, well before Phaser has run create() — mapData is
        // assigned partway through create(), after every group and map this renderer reads, so gating on
        // it guarantees the rest is there too.
        return scene?.mapData ? scene : null
    }

    // --- Frame -------------------------------------------------------------------------------------
    private frame = () => {
        if(this.disposed) return
        const now = performance.now()
        const deltaMs = Math.min(100, now - this.lastFrameAt)
        this.lastFrameAt = now

        this.rig.update(deltaMs)

        const mapScene = this.mapScene()
        if(mapScene){
            const cells = mapScene.mapData.width
            if(cells*CELL_SIZE !== this.worldSize || !this.gridObject){
                this.worldSize = cells*CELL_SIZE
                this.buildGrid(cells)
            }
            this.syncShips(mapScene, now)
            this.syncResourceNodes(mapScene)
            this.syncObjectives(mapScene)
            this.syncProjectiles(mapScene)
            this.drawOverlays(mapScene)
        }
        this.updateFragments(now)

        this.renderer.render(this.scene, this.rig.camera)
        this.raf = requestAnimationFrame(this.frame)
    }

    private makeShipVisual = (ship:ShipSprite):ShipVisual => {
        const group = new THREE.Group()
        const size = Math.max(8, ShipData[ship.type].sizeHex * CELL_SIZE)
        const isEnemy = ship.faction === Faction.Enemy

        const billboard = new THREE.Sprite(new THREE.SpriteMaterial({ map:getShipTexture(ship.type, isEnemy), transparent:true, depthTest:true }))
        billboard.scale.set(size, size, 1)
        billboard.position.y = size*0.5
        billboard.userData.shipId = ship.id
        billboard.renderOrder = 5
        group.add(billboard)

        const hpBg = makeQuad(0x101010, 0.85), hpFg = makeQuad(GREEN_HEX, 0.95)
        const metalBg = makeQuad(0x101010, 0.85), metalFg = makeQuad(YELLOW_HEX, 0.95)
        const queueBg = makeQuad(0x101010, 0.85), queueFg = makeQuad(GREEN_HEX, 0.95)
        const ammo = makeTextSprite()
        const name = makeTextSprite()
        ;[hpBg, hpFg, metalBg, metalFg, queueBg, queueFg, ammo.sprite, name.sprite].forEach(o => group.add(o))

        this.scene.add(group)
        return { group, billboard, hpBg, hpFg, metalBg, metalFg, queueBg, queueFg, ammo, name, type:ship.type, faction:ship.faction }
    }

    private layoutBar = (bg:THREE.Sprite, fg:THREE.Sprite, y:number, percent:number, width = BAR_WIDTH) => {
        const clamped = Math.max(0, Math.min(1, percent))
        bg.position.set(0, y, 0)
        bg.scale.set(width, BAR_HEIGHT, 1)
        fg.position.set(-(width - width*clamped)/2, y, 0.05)
        fg.scale.set(Math.max(0.01, width*clamped), BAR_HEIGHT, 1)
    }

    private syncShips = (mapScene:MapScene, now:number) => {
        const { selectedShipIds } = useAppStore.getState()
        const azimuth = this.rig.getAzimuth()
        const seen = new Set<string>()

        mapScene.ships.forEach(ship => {
            seen.add(ship.id)
            let visual = this.shipVisuals.get(ship.id)
            if(!visual){ visual = this.makeShipVisual(ship); this.shipVisuals.set(ship.id, visual) }

            // Fog of war is the sim's call (MapScene's updateFogOfWar sets it) — this only obeys it.
            visual.group.visible = ship.visible
            if(!ship.visible) return

            visual.group.position.set(this.toSceneX(ship.x), 0, this.toSceneZ(ship.y))

            // A camera-facing billboard can't bank into a turn the way a real mesh would, but it can still
            // convey heading by spinning about the view axis. Compensating by the camera's own azimuth
            // keeps that reading as a true compass heading instead of a screen-relative one that would
            // visibly swim as you orbit.
            visual.billboard.material.rotation = -ship.rotation + azimuth - Math.PI/2

            const size = Math.max(8, ShipData[ship.type].sizeHex * CELL_SIZE)
            let y = size + 8

            const maxHp = ShipData[ship.type].hp
            const damaged = ship.hp < maxHp
            visual.hpBg.visible = visual.hpFg.visible = damaged
            if(damaged){ this.layoutBar(visual.hpBg, visual.hpFg, y, ship.hp/maxHp); y += BAR_STEP }

            const isHarvester = ship.type === ShipType.GAIN
            visual.metalBg.visible = visual.metalFg.visible = isHarvester
            if(isHarvester){ this.layoutBar(visual.metalBg, visual.metalFg, y, (ship.metalCarried ?? 0)/HARVESTER_METAL_CAPACITY); y += BAR_STEP }

            const item = ship.queue[0]
            const producing = !!item?.startedAt
            visual.queueBg.visible = visual.queueFg.visible = producing
            if(producing){
                this.layoutBar(visual.queueBg, visual.queueFg, y, (Date.now()-item.startedAt) / ShipData[item.type].productionTimeMs)
                y += BAR_STEP
            }

            const hasAmmo = ShipData[ship.type].ammo !== undefined
            visual.ammo.sprite.visible = hasAmmo
            if(hasAmmo){
                visual.ammo.setText(String(ship.ammoRemaining ?? 0), '#55ff55', 9)
                visual.ammo.sprite.position.set(0, y, 0)
                y += BAR_STEP + 2
            }

            const selected = selectedShipIds.includes(ship.id)
            visual.name.sprite.visible = selected
            if(selected){
                visual.name.setText(ship.type.toUpperCase(), '#55ff55', 10)
                visual.name.sprite.position.set(0, y, 0)
            }
        })

        // A ship that was here last frame and isn't now died — the sim gives no death event, and diffing
        // the id set is both sufficient and keeps MapScene free of renderer concerns.
        this.prevShipIds.forEach(id => {
            if(seen.has(id)) return
            const visual = this.shipVisuals.get(id)
            if(visual) this.spawnFragments(visual, now)
        })
        this.prevShipIds = seen

        this.shipVisuals.forEach((visual, id) => {
            if(seen.has(id)) return
            this.scene.remove(visual.group)
            visual.ammo.dispose()
            visual.name.dispose()
            this.shipVisuals.delete(id)
        })
    }

    // The 2D renderer split a dying ship's own sprite along a jagged cut and threw the halves apart. A
    // clipped-sprite equivalent isn't available here without per-fragment shaders, so this throws two
    // copies of the whole sprite apart at half scale instead — same read (it came apart and the pieces
    // tumbled off), different construction.
    private spawnFragments = (visual:ShipVisual, now:number) => {
        const origin = visual.group.position.clone()
        const size = Math.max(8, ShipData[visual.type].sizeHex * CELL_SIZE)
        for(let i=0; i<2; i++){
            const material = new THREE.SpriteMaterial({ map:getShipTexture(visual.type, visual.faction === Faction.Enemy), transparent:true, depthTest:false })
            const sprite = new THREE.Sprite(material)
            sprite.scale.set(size*0.6, size*0.6, 1)
            sprite.position.copy(origin).setY(size*0.5)
            const angle = Math.random()*Math.PI*2
            const distance = SHIP_FRAGMENT_MIN_DISTANCE_PX + Math.random()*(SHIP_FRAGMENT_MAX_DISTANCE_PX-SHIP_FRAGMENT_MIN_DISTANCE_PX)
            this.scene.add(sprite)
            this.fragments.push({
                sprite,
                from: sprite.position.clone(),
                to: sprite.position.clone().add(new THREE.Vector3(Math.cos(angle)*distance, size*0.4, Math.sin(angle)*distance)),
                spin: (Math.random()-0.5)*2,
                bornAt: now,
            })
        }
    }

    private updateFragments = (now:number) => {
        this.fragments = this.fragments.filter(f => {
            const t = (now - f.bornAt) / SHIP_FRAGMENT_LIFETIME_MS
            if(t >= 1){
                this.scene.remove(f.sprite)
                ;(f.sprite.material as THREE.Material).dispose()
                return false
            }
            const eased = 1 - Math.pow(1-t, 3)
            f.sprite.position.lerpVectors(f.from, f.to, eased)
            f.sprite.material.rotation = f.spin * eased
            f.sprite.material.opacity = 1 - t
            return true
        })
    }

    private syncResourceNodes = (mapScene:MapScene) => {
        const { resourceNodes } = useAppStore.getState()
        const seen = new Set<string>()
        resourceNodes.forEach(node => {
            seen.add(node.id)
            // The sim still owns which asteroid tier/frame a node shows as it depletes; this reads the
            // frame it settled on rather than re-deriving the tier thresholds.
            const frame = mapScene.resourceNodeFrames.get(node.id) ?? 41
            let sprite = this.nodeSprites.get(node.id)
            if(!sprite){
                sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:getTileTexture(frame), transparent:true, depthTest:true }))
                sprite.scale.set(CELL_SIZE, CELL_SIZE, 1)
                sprite.userData.frame = frame
                this.scene.add(sprite)
                this.nodeSprites.set(node.id, sprite)
            }
            else if(sprite.userData.frame !== frame){
                sprite.userData.frame = frame
                sprite.material.map = getTileTexture(frame)
            }
            sprite.position.set(this.toSceneX(node.x), CELL_SIZE*0.5, this.toSceneZ(node.y))
        })
        this.nodeSprites.forEach((sprite, id) => {
            if(seen.has(id)) return
            this.scene.remove(sprite)
            ;(sprite.material as THREE.Material).dispose()
            this.nodeSprites.delete(id)
        })
    }

    private syncObjectives = (mapScene:MapScene) => {
        const { objectives } = useAppStore.getState()
        mapScene.mapData.objectives.forEach(spawn => {
            let visual = this.objectiveVisuals.get(spawn.id)
            if(!visual){
                const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map:getTileTexture(ObjectiveSpriteIndex[spawn.sprite]), transparent:true, depthTest:true }))
                icon.scale.set(OBJECTIVE_ICON_SIZE, OBJECTIVE_ICON_SIZE, 1)
                const bg = makeQuad(0x101010, 0.85), fg = makeQuad(YELLOW_HEX, 0.95)
                this.scene.add(icon, bg, fg)
                visual = { icon, bg, fg }
                this.objectiveVisuals.set(spawn.id, visual)
            }
            const x = this.toSceneX(spawn.x*CELL_SIZE + CELL_SIZE/2)
            const z = this.toSceneZ(spawn.y*CELL_SIZE + CELL_SIZE/2)
            visual.icon.position.set(x, OBJECTIVE_ICON_SIZE*0.6, z)

            const objective = objectives.find(o => o.id === spawn.id)
            const capturing = objective && objective.capturingFaction !== null && objective.captureStartedAtMs !== null
            visual.bg.visible = visual.fg.visible = !!capturing
            if(!capturing) return
            const color = objective.capturingFaction === Faction.Player ? GREEN_HEX : RED_HEX
            ;(visual.fg.material as THREE.SpriteMaterial).color.setHex(color)
            const percent = (mapScene.time.now - objective.captureStartedAtMs) / OBJECTIVE_CAPTURE_TIME_MS
            const y = OBJECTIVE_ICON_SIZE*1.35
            this.layoutBar(visual.bg, visual.fg, 0, percent, OBJECTIVE_ICON_SIZE)
            visual.bg.position.set(x, y, z)
            visual.fg.position.set(x - (OBJECTIVE_ICON_SIZE - OBJECTIVE_ICON_SIZE*Math.max(0, Math.min(1, percent)))/2, y, z)
        })
    }

    // Missiles and bullets are live Phaser physics bodies; their ids are stamped on at spawn so a dot can
    // be matched to the same projectile frame to frame.
    private syncProjectileGroup = (group:Phaser.GameObjects.Group, pool:Map<string, THREE.Sprite>, color:number, size:number, height:number) => {
        const seen = new Set<string>()
        group.children.each((child:any) => {
            if(!child.active) return true
            const id = child.getData('id') as string
            if(!id) return true
            seen.add(id)
            let dot = pool.get(id)
            if(!dot){ dot = makeQuad(color, 0.95); dot.scale.set(size, size, 1); this.scene.add(dot); pool.set(id, dot) }
            dot.position.set(this.toSceneX(child.x), height, this.toSceneZ(child.y))
            return true
        })
        pool.forEach((dot, id) => {
            if(seen.has(id)) return
            this.scene.remove(dot)
            ;(dot.material as THREE.Material).dispose()
            pool.delete(id)
        })
    }

    private syncProjectiles = (mapScene:MapScene) => {
        this.syncProjectileGroup(mapScene.missilesGroup, this.missileSprites, GREEN_HEX, 7, 10)
        this.syncProjectileGroup(mapScene.bulletsGroup, this.bulletSprites, YELLOW_HEX, 8, 10)
    }

    // Everything rebuilt from scratch each frame — selection rings, routes, sight bubbles, mining beams,
    // contrails, impact flashes. Mirrors the clear-then-redraw model the 2D Graphics layers used.
    private drawOverlays = (mapScene:MapScene) => {
        const { selectedShipIds, resourceNodes } = useAppStore.getState()
        const now = mapScene.time.now

        this.routeLines.begin()
        this.selectionLines.begin()
        this.sightLines.begin()
        this.beamLines.begin()
        this.trailLines.begin()
        this.waypointLabels.begin()

        selectedShipIds.forEach(id => {
            const ship = mapScene.shipSprites.get(id)
            if(!ship || !ship.visible) return
            const sx = this.toSceneX(ship.x), sz = this.toSceneZ(ship.y)
            this.selectionLines.addCircle(sx, sz, ShipData[ship.type].sizeHex * CELL_SIZE * 0.7, GROUND_Y)

            let prevX = sx, prevZ = sz
            ship.waypoints.forEach((w, i) => {
                const wx = this.toSceneX(w.x*CELL_SIZE + CELL_SIZE/2)
                const wz = this.toSceneZ(w.y*CELL_SIZE + CELL_SIZE/2)
                this.routeLines.addSegment(prevX, GROUND_Y, prevZ, wx, GROUND_Y, wz)
                this.routeLines.addCircle(wx, wz, 7, GROUND_Y)
                const label = this.waypointLabels.take()
                label.setText(String(i+1), '#55ff55', 10)
                label.sprite.position.set(wx, 14, wz)
                prevX = wx; prevZ = wz
            })
        })

        const { boundaries, overlaps } = computeSightGeometry(mapScene.ships)
        boundaries.forEach(({ circle, arcs }) => {
            const cx = this.toSceneX(circle.x), cz = this.toSceneZ(circle.y)
            arcs.forEach(([from, to]) => this.sightLines.addArc(cx, cz, circle.r, from, to, GROUND_Y))
        })
        this.buildOverlapMesh(overlaps)

        mapScene.harvesterMiningTarget.forEach((nodeId, harvesterId) => {
            if(!mapScene.harvesterBeamState.get(harvesterId)?.on) return
            const harvester = mapScene.shipSprites.get(harvesterId)
            const node = resourceNodes.find(n => n.id === nodeId)
            if(!harvester || !harvester.visible || !node) return
            const size = ShipData[harvester.type].sizeHex * CELL_SIZE
            this.beamLines.addSegment(
                this.toSceneX(harvester.x), size*0.5, this.toSceneZ(harvester.y),
                this.toSceneX(node.x), CELL_SIZE*0.5, this.toSceneZ(node.y),
            )
        })

        const byMissile = new Map<string, Array<{x:number,y:number,createdAt:number}>>()
        mapScene.contrails.forEach(c => {
            const points = byMissile.get(c.missileId) || []
            points.push(c)
            byMissile.set(c.missileId, points)
        })
        byMissile.forEach(points => {
            points.sort((a, b) => a.createdAt - b.createdAt)
            for(let i=1; i<points.length; i++){
                if(now - points[i].createdAt > CONTRAIL_LIFETIME_MS) continue
                this.trailLines.addSegment(
                    this.toSceneX(points[i-1].x), 10, this.toSceneZ(points[i-1].y),
                    this.toSceneX(points[i].x), 10, this.toSceneZ(points[i].y),
                )
            }
        })

        this.routeLines.end()
        this.selectionLines.end()
        this.sightLines.end()
        this.beamLines.end()
        this.trailLines.end()
        this.waypointLabels.end()

        this.syncImpacts(mapScene, now)
    }

    private syncImpacts = (mapScene:MapScene, now:number) => {
        const flashes = mapScene.impactFlashes
        while(this.impactSprites.length < flashes.length){
            const sprite = makeQuad(YELLOW_HEX, 1)
            this.scene.add(sprite)
            this.impactSprites.push(sprite)
        }
        this.impactSprites.forEach((sprite, i) => {
            const flash = flashes[i]
            sprite.visible = !!flash
            if(!flash) return
            const progress = (now - flash.createdAt) / MISSILE_IMPACT_LIFETIME_MS
            const radius = MISSILE_IMPACT_MIN_RADIUS_PX + flash.damage*MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX
            sprite.position.set(this.toSceneX(flash.x), 10, this.toSceneZ(flash.y))
            sprite.scale.set(radius*2, radius*2, 1)
            ;(sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1-progress)
        })
    }

    // The shaded lens where opposing sight bubbles overlap, triangulated as a fan between the two arcs
    // that bound it (or a plain disc when one bubble sits wholly inside the other).
    private buildOverlapMesh = (overlaps:Array<any>) => {
        let count = 0
        const push = (x1:number,z1:number,x2:number,z2:number,x3:number,z3:number) => {
            if((count+3)*3 > this.overlapPositions.length) return
            const i = count*3
            this.overlapPositions[i] = x1;   this.overlapPositions[i+1] = 0.2; this.overlapPositions[i+2] = z1
            this.overlapPositions[i+3] = x2; this.overlapPositions[i+4] = 0.2; this.overlapPositions[i+5] = z2
            this.overlapPositions[i+6] = x3; this.overlapPositions[i+7] = 0.2; this.overlapPositions[i+8] = z3
            count += 3
        }

        overlaps.forEach(overlap => {
            if(overlap.kind === 'circle'){
                const cx = this.toSceneX(overlap.x), cz = this.toSceneZ(overlap.y)
                const steps = 32
                for(let i=0; i<steps; i++){
                    const a1 = (i/steps)*Math.PI*2, a2 = ((i+1)/steps)*Math.PI*2
                    push(cx, cz, cx+Math.cos(a1)*overlap.r, cz+Math.sin(a1)*overlap.r, cx+Math.cos(a2)*overlap.r, cz+Math.sin(a2)*overlap.r)
                }
                return
            }
            // Sample both bounding arcs into one closed outline, then fan it from its own centroid.
            const points:Array<{x:number,z:number}> = []
            const sample = (arc:any) => {
                const steps = 24
                for(let i=0; i<=steps; i++){
                    const a = arc.from + (arc.to-arc.from)*(i/steps)
                    points.push({ x: this.toSceneX(arc.x + Math.cos(a)*arc.r), z: this.toSceneZ(arc.y + Math.sin(a)*arc.r) })
                }
            }
            sample(overlap.a)
            sample(overlap.b)
            let cx = 0, cz = 0
            points.forEach(p => { cx += p.x; cz += p.z })
            cx /= points.length; cz /= points.length
            for(let i=0; i<points.length; i++){
                const a = points[i], b = points[(i+1)%points.length]
                push(cx, cz, a.x, a.z, b.x, b.z)
            }
        })

        const geometry = this.overlapMesh.geometry as THREE.BufferGeometry
        geometry.setDrawRange(0, count)
        ;(geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
        this.overlapMesh.visible = count > 0
    }

    dispose = () => {
        this.disposed = true
        cancelAnimationFrame(this.raf)
        this.resizeObserver.disconnect()
        this.unbindInput()
        ;[this.routeLines, this.selectionLines, this.sightLines, this.beamLines, this.trailLines].forEach(b => b.dispose())
        this.shipVisuals.forEach(v => { v.ammo.dispose(); v.name.dispose() })
        this.waypointLabels.all().forEach(t => t.dispose())
        this.renderer.dispose()
        if(this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
        if(this.selectBoxEl.parentElement) this.selectBoxEl.parentElement.removeChild(this.selectBoxEl)
    }
}
