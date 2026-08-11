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

interface ResourceNodeData {
    id: string
    x: number
    y: number
    kind: import('./enum').ResourceNode
    resource: import('./enum').ResourceType
    amount: number
}

interface MapData {
    width: number
    height: number
    bases: Array<BaseData>
    nodes: Array<ResourceNodeData>
}

interface ProductionQueueItem {
    id: string
    type: import('./enum').VehicleType
    startedAt: number | null
}

interface BuildingData {
    id: string
    x: number
    y: number
    kind: import('./enum').BuildingType
    faction: import('./enum').Faction
    resource?: import('./enum').ResourceType
    nodeId?: string
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
    sizeHex: number
    productionTimeMs: number
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