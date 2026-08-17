import * as THREE from 'three'

// Routes, sight-radius arcs, mining beams and the like are all rebuilt from scratch every frame (the
// same clear-and-redraw model MapScene's Graphics layers used). Doing that as individual Line objects
// would mean allocating and disposing hundreds of BufferGeometries per second and paying a draw call for
// each; instead every segment of a given color/opacity is packed into one reused buffer and drawn in a
// single call. The buffer is allocated once at capacity and only its draw range moves.
export default class LineBatch {
    readonly object: THREE.LineSegments
    private positions: Float32Array
    private geometry: THREE.BufferGeometry
    private count = 0
    private capacity: number

    constructor(color:number, opacity:number, capacity = 8192){
        this.capacity = capacity
        this.positions = new Float32Array(capacity * 3)
        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
        this.object = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({ color, transparent:true, opacity, depthTest:false }))
        this.object.frustumCulled = false
        this.object.renderOrder = 1
    }

    begin = () => { this.count = 0 }

    addSegment = (x1:number, y1:number, z1:number, x2:number, y2:number, z2:number) => {
        if(this.count + 2 > this.capacity) return
        const i = this.count * 3
        this.positions[i] = x1;   this.positions[i+1] = y1;   this.positions[i+2] = z1
        this.positions[i+3] = x2; this.positions[i+4] = y2;   this.positions[i+5] = z2
        this.count += 2
    }

    // A polyline through the given points, as the consecutive segments between them.
    addStrip = (points:Array<{x:number,y:number,z:number}>) => {
        for(let i=1; i<points.length; i++){
            const a = points[i-1], b = points[i]
            this.addSegment(a.x, a.y, a.z, b.x, b.y, b.z)
        }
    }

    // A circular arc on the horizontal plane at height y, sampled finely enough that it reads as a curve
    // rather than a polygon at the radii involved.
    addArc = (cx:number, cz:number, radius:number, from:number, to:number, y = 0, segments?:number) => {
        const span = to - from
        const steps = segments ?? Math.max(8, Math.min(128, Math.ceil(Math.abs(span) * radius / 8)))
        let prevX = cx + Math.cos(from)*radius, prevZ = cz + Math.sin(from)*radius
        for(let i=1; i<=steps; i++){
            const a = from + span*(i/steps)
            const x = cx + Math.cos(a)*radius, z = cz + Math.sin(a)*radius
            this.addSegment(prevX, y, prevZ, x, y, z)
            prevX = x; prevZ = z
        }
    }

    addCircle = (cx:number, cz:number, radius:number, y = 0) => this.addArc(cx, cz, radius, 0, Math.PI*2, y)

    end = () => {
        this.geometry.setDrawRange(0, this.count)
        ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
        this.geometry.computeBoundingSphere()
        this.object.visible = this.count > 0
    }

    dispose = () => {
        this.geometry.dispose()
        ;(this.object.material as THREE.Material).dispose()
    }
}
