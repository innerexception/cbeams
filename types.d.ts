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
// duplicated here). owner is null until some faction actually captures it, which takes a full
// OBJECTIVE_CAPTURE_TIME_MS of that faction holding it uncontested (ARMOR of that faction within
// OBJECTIVE_CAPTURE_RADIUS_PX of it, and no hostile ship or building also within that radius) — see
// MapScene's updateObjectives for the live tracking of that hold via capturingFaction/
// captureStartedAtMs. owner never reverts to null on its own once captured — only the other faction
// completing that same hold changes it. capturingFaction/captureStartedAtMs reset to null the instant
// the hold breaks (ARMOR leaves/dies, or an enemy shows up), even mid-count — no partial credit carries
// over to a later attempt.
interface ObjectiveData {
    id: string
    owner: import('./enum').Faction | null
    capturingFaction: import('./enum').Faction | null
    captureStartedAtMs: number | null
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
    // A vehicle's own route, followed in order (see MapScene's moveShips) then orbited at the last
    // point — copied from its shipyard's route at spawn time (see spawnShip) and independently
    // editable afterwards, either by editing that shipyard's route (addWaypoint, which also pushes the
    // update onto every ship already spawned from it) or by drag-selecting the ship directly and giving
    // it orders (addShipWaypoints).
    waypoints?: Array<{ x:number, y:number }>
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