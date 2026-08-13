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

// A capturable map feature's fixed identity — where it sits and which of the 3 possible sprites it
// renders as, decided once at map generation (see MapGenerator) and never changed after. Its live,
// mutable half (who currently owns it) lives on ObjectiveData instead, in the store, the same split
// BaseData/BuildingData use for a faction's Base.
interface ObjectiveSpawn {
    id: string
    x: number
    y: number
    sprite: import('./enum').ObjectiveSprite
}

interface MapData {
    width: number
    height: number
    bases: Array<BaseData>
    objectives: Array<ObjectiveSpawn>
    terrain: TerrainData
}

// The live half of a capturable Objective — see ObjectiveSpawn for its fixed id/position/sprite (never
// duplicated here). owner is null until some faction actually captures it (see MapScene's
// updateObjectives): ARMOR of that faction within OBJECTIVE_CAPTURE_RADIUS_PX of it, and no hostile
// ship or building also within that radius. It never reverts to null on its own once captured — only a
// contesting capture by the other faction (same conditions, satisfied for them instead) changes it.
interface ObjectiveData {
    id: string
    owner: import('./enum').Faction | null
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