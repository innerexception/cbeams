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
}

interface RState {
    activeModal: import('./enum').Modal
    isLoaded:boolean
    scene: import('./src/components/scenes/MapScene').default
    mySave: SaveFile
}