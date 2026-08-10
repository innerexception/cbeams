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
    kind: import('./enum').NodeKind
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
    type: import('./enum').ShipType
    startedAt: number | null
}

interface FactoryData {
    id: string
    x: number
    y: number
    kind: import('./enum').FactoryKind
    faction: import('./enum').Faction
    resource?: import('./enum').ResourceType
    nodeId?: string
    queue?: Array<ProductionQueueItem>
    waypoints?: Array<{ x:number, y:number }>
}

interface ShipInstanceData {
    id: string
    faction: import('./enum').Faction
    type: import('./enum').ShipType
    shipyardId: string
    x: number
    y: number
    pathIndex?: number
    orbitAnchor?: { x:number, y:number }
    lastFiredAt?: number
    hp: number
}

interface RState {
    activeModal: import('./enum').Modal
    isLoaded:boolean
    scene: import('./src/components/scenes/MapScene').default
    mySave: SaveFile
}