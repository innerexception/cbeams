import * as THREE from 'three'

// A Homeworld-style orbit camera. The defining traits of that series' camera, and what this reproduces:
//
//  - It orbits a *focus point* in the world rather than flying free. Every control moves the focus or the
//    camera's spherical offset from it; the camera is always looking at the focus.
//  - Roll is never expressed — the up vector stays world-up, so the horizon is always level no matter
//    where you've orbited to. (This is why it's a spherical rig rather than a free 6-DOF camera.)
//  - Pitch is clamped short of both poles, so you can never flip under the map or hit gimbal lock
//    looking straight down.
//  - Everything glides. Input sets a *target* azimuth/pitch/distance/focus and the rig eases toward it
//    every frame, which is what gives Homeworld's camera its characteristic weight instead of the
//    1:1 snap a naive orbit control has.
//  - Zoom is exponential (each wheel notch scales the distance rather than subtracting from it), so it
//    stays equally responsive whether you're inspecting one ship or looking at the whole map.
//
// Deliberately hand-rolled rather than three/examples' OrbitControls: that one owns the DOM event
// handling outright, which would fight the selection/order gestures sharing the same canvas (see
// Scene3D's pointer handling), and it has no notion of a focus point that game code can drive.

const EASE_PER_MS = 0.012

// Never quite 0 (straight down the pole) or PI/2 (through the ground plane).
const MIN_PITCH = 0.12
const MAX_PITCH = Math.PI/2 - 0.06

export interface CameraRigOptions {
    minDistance?: number
    maxDistance?: number
}

export default class CameraRig {
    camera: THREE.PerspectiveCamera

    // Where the camera currently is, in spherical coords around `focus`.
    private azimuth = Math.PI/4
    private pitch = 0.9
    private distance = 1200
    private focus = new THREE.Vector3()

    // Where the camera is easing *toward* — every control writes here, never to the live values above.
    private targetAzimuth = Math.PI/4
    private targetPitch = 0.9
    private targetDistance = 1200
    private targetFocus = new THREE.Vector3()

    private minDistance: number
    private maxDistance: number

    constructor(aspect:number, options:CameraRigOptions = {}){
        this.camera = new THREE.PerspectiveCamera(55, aspect, 1, 60000)
        this.minDistance = options.minDistance ?? 60
        this.maxDistance = options.maxDistance ?? 12000
        this.apply()
    }

    setAspect = (aspect:number) => {
        this.camera.aspect = aspect
        this.camera.updateProjectionMatrix()
    }

    // Horizontal drag swings around the focus; vertical drag raises/lowers the viewing angle. Inverted on
    // the vertical axis so dragging down tips the camera down towards the plane, matching Homeworld.
    orbit = (dx:number, dy:number) => {
        this.targetAzimuth -= dx * 0.005
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - dy*0.005, MIN_PITCH, MAX_PITCH)
    }

    // Slides the focus across the ground plane, in the camera's own screen-relative directions so a
    // rightward drag always moves the world rightward regardless of which way the camera is facing.
    // Scaled by distance so a drag covers the same amount of *screen* at any zoom level.
    pan = (dx:number, dy:number) => {
        const scale = this.distance * 0.0013
        const sin = Math.sin(this.targetAzimuth), cos = Math.cos(this.targetAzimuth)
        this.targetFocus.x += (-dx*cos + dy*sin) * scale
        this.targetFocus.z += (-dx*sin - dy*cos) * scale
    }

    // Exponential rather than linear: a notch always changes the distance by the same *proportion*, so
    // zooming stays usable across the whole range instead of crawling when far out and lurching when close.
    zoom = (wheelDelta:number) => {
        const factor = Math.exp(wheelDelta * 0.0012)
        this.targetDistance = THREE.MathUtils.clamp(this.targetDistance*factor, this.minDistance, this.maxDistance)
    }

    // Re-centers on a world point (Homeworld's focus-on-selection). Optionally pulls the camera in to
    // frame something of a given size, rather than only re-centering at the current distance.
    focusOn = (x:number, z:number, framingRadius?:number) => {
        this.targetFocus.set(x, 0, z)
        if(framingRadius === undefined) return
        const fitDistance = framingRadius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))
        this.targetDistance = THREE.MathUtils.clamp(Math.max(fitDistance, framingRadius*1.5), this.minDistance, this.maxDistance)
    }

    // Snaps with no easing — for the initial placement, where gliding in from an arbitrary starting
    // position would just look like a stray camera move nobody asked for.
    jumpTo = (x:number, z:number, distance:number) => {
        this.targetFocus.set(x, 0, z)
        this.focus.copy(this.targetFocus)
        this.targetDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance)
        this.distance = this.targetDistance
        this.apply()
    }

    getFocus = () => this.focus.clone()
    getAzimuth = () => this.azimuth
    getDistance = () => this.distance

    // Frame-rate independent exponential easing: the same fraction of the remaining gap is closed per
    // unit of *time* rather than per frame, so the camera glides identically at 30fps and 144fps.
    update = (deltaMs:number) => {
        const t = 1 - Math.exp(-EASE_PER_MS * deltaMs)
        this.azimuth += (this.targetAzimuth - this.azimuth) * t
        this.pitch += (this.targetPitch - this.pitch) * t
        this.distance += (this.targetDistance - this.distance) * t
        this.focus.lerp(this.targetFocus, t)
        this.apply()
    }

    private apply = () => {
        const horizontal = Math.cos(this.pitch) * this.distance
        this.camera.position.set(
            this.focus.x + Math.cos(this.azimuth) * horizontal,
            this.focus.y + Math.sin(this.pitch) * this.distance,
            this.focus.z + Math.sin(this.azimuth) * horizontal,
        )
        this.camera.up.set(0, 1, 0)
        this.camera.lookAt(this.focus)
    }
}
