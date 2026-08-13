interface PhaserResource {
    key:string
    resource: any
    type: string
    data?: any
}

interface SaveFile {
    
}

interface BaseData {
    faction: import('./enum').Faction
    x: number
    y: number
}

// A rectangular lattice of signed elevation samples (one per grid cell) covering the terrain's
// bounding box — positive values are raised terrain (Hill, Spur), negative values are sunken terrain
// (Valley), magnitude in [-1,1]. origin+cols/rows locate the lattice back in map-grid space. Rendered
// as topographic contour lines (see MapScene's drawTerrain), not as shapes.
interface TerrainData {
    originX: number
    originY: number
    cols: number
    rows: number
    elevations: Array<Array<number>>
}

interface MapData {
    width: number
    height: number
    bases: Array<BaseData>
    terrain: TerrainData
}

interface ProductionQueueItem {
    id: string
    type: import('./enum').VehicleType
    startedAt: number | null
}

interface BuildingMetaData {
    maxHp:number
    cooldownMs:number
    damage:number
    rangePx:number
    logisticsCost:number
    buildingPoints:number
    // Missiles a BLM/THADD can ever launch, total, over its whole lifetime — undefined for kinds that
    // don't fire missiles at all (CRAM's cannon and ARMOR's cannon shot are instant-hit, not a missile).
    // See BuildingData's ammoRemaining for the live per-instance count this is the starting value for.
    ammo?:number
}

interface BuildingData {
    id: string
    x: number
    y: number
    kind: import('./enum').BuildingType
    faction: import('./enum').Faction
    queue?: Array<ProductionQueueItem>
    waypoints?: Array<{ x:number, y:number }>
    hp: number
    lastFiredAtMs?: number
    // Only present for a kind whose BuildingMetaData sets `ammo` (BLM/THADD) — set to that value when
    // the building's spawned, decremented per missile actually launched. Once it hits 0 the building
    // can't fire again, ever (missiles are a spendable stockpile, not a cooldown-gated resource).
    ammoRemaining?: number
}

interface VehicleStats {
    name: string
    speed: number
    sightRadius: number
    armor: number
    hp: number
    damage: number
    cooldownMs: number
    rangePx: number
    sizeHex: number
    productionTimeMs: number
    targetType: import('./enum').TargetType
    logisticsCost: number
    // Missiles an MLRS can ever launch, total, over its whole lifetime — undefined for every other
    // vehicle (none of them fire missiles). See VehicleData's ammoRemaining for the live count.
    ammo?:number
}

interface VehicleData {
    id: string
    faction: import('./enum').Faction
    type: import('./enum').VehicleType
    shipyardId: string
    x: number
    y: number
    pathIndex?: number
    orbitAnchor?: { x:number, y:number }
    lastFiredAtMs?: number
    hp: number
    // Only present for a vehicle whose VehicleStats sets `ammo` (MLRS) — set to that value when the
    // ship's spawned, decremented per missile actually launched. Once it hits 0 it can't fire again.
    ammoRemaining?: number
}

interface RState {
    activeModal: import('./enum').Modal
    isLoaded:boolean
    scene: import('./src/components/scenes/MapScene').default
    mySave: SaveFile
}