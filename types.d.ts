interface PhaserResource {
    key:string
    resource: any
    type: string
    data?: any
}

interface SaveFile {
    currentMap: import('./enum').Maps
    completedMaps: Array<import('./enum').Maps>
    veteranShips: Array<VeteranShip>
    buildableTypes: Array<import('./enum').ShipType>
}

interface TiledLayer {
    name: string
    width: number
    height: number
    data: Array<number>
}

interface TiledMap {
    width: number
    height: number
    tilewidth: number
    tileheight: number
    layers: Array<TiledLayer>
}

// A capturable map feature's fixed identity — where it sits and which of the 3 possible sprites it
// renders as, decided once (read off the loaded map file's entities layer — see MapScene's
// spawnEntitiesFromMap) and never changed after. Its live, mutable half (who currently owns it) lives
// on ObjectiveData instead, in the store.
interface ObjectiveSpawn {
    id: string
    x: number
    y: number
    sprite: import('./enum').ObjectiveSprite
}

interface PortalSpawn {
    id: string
    x: number
    y: number
}

interface MapData {
    width: number
    height: number
    objectives: Array<ObjectiveSpawn>
    portals: Array<PortalSpawn>
    terrain: TiledMap | null
}

interface ObjectiveData {
    id: string
    owner: import('./enum').Faction | null
    capturingFaction: import('./enum').Faction | null
    captureStartedAtMs: number | null
}

interface ProductionQueueItem {
    id: string
    type: import('./enum').ShipType
    startedAt: number | null
}

// A per-ship AI override, sourced from the map file on a per-map basis (not wired up yet — nothing
// currently sets this). When present it overrides every default autonomous behavior in AIPlayers.ts
// entirely; its own exact shape isn't decided yet beyond an id.
interface PrimeDirective {
    id: string
}

interface ShipStats {
    name: string
    speed: number
    sightRadius: number
    armor: number
    hp: number
    damage: number
    cooldownMs: number
    rangePx: number
    productionTimeMs: number
    relicCost: number
    description:string
    ammo?:number
    // Determines how this ship's attack is actually rendered — a real physics projectile (missile: the
    // arced, retargeting kind SPR fires; bullet: PDF's straight-line, non-homing shot) or an instant-hit
    // laser with no travel time at all (beam). Undefined for anything with no ranged weapon at all.
    weaponType?: 'beam' | 'missile' | 'bullet'
    // How many shots weaponType fires per single cooldownMs — a staggered burst rather than one shot,
    // same idea as SPR's old fixed missile salvo. Undefined/1 means a single shot per cooldown.
    burstSize?: number
    portraitIndex: number
}

interface ShipSummary {
    id: string
    faction: import('./enum').Faction
    type: import('./enum').ShipType
    killCount: number
    rank: number
    // Only ever populated on a Base or DRN (see ShipType.CATH) — see ShipSprite's own queue field. A
    // DRN's own currently-building type (if any) is queue[0].type, same as a Base's — FactoryToolbar
    // reads that directly rather than needing its own separate field.
    queue?: Array<ProductionQueueItem>
}

// Campaign state carried by a surviving player ship from one victorious map to the next. Its map
// position is intentionally not retained: the next map supplies the appropriate spawn location.
interface VeteranShip {
    type: import('./enum').ShipType
    killCount: number
    rank: number
}

interface ResourceNodeData {
    id: string
    x: number
    y: number
    metal?: number
    maxMetal?: number
}

// One waypoint in a map's own briefing-image pan — see MapMetadata's own doc comment. Pixel coordinates
// against the image's own native size (can run negative/past its edges — the pan is free to carry the
// image beyond its own frame, not clamped to stay within it).
interface MapImageKeyframe {
    x: number
    y: number
}

interface MapCondition {
    type: import('./enum').ObjectiveType
    units?: import('./enum').ShipType[]
}

interface MapMetadata {
    briefingText: string
    // The map image pans/animates through these points in order over the course of the briefing — not
    // wired up to any actual animation yet, just the data it'll eventually drive.
    imageKeyframes: Array<MapImageKeyframe>
    victory: {conditions: MapCondition[], targetMap: import('./enum').Maps}
    defeat: {conditions: MapCondition[], targetMap: import('./enum').Maps}
    enemyOrders?: { type: import('./enum').ShipType, order: import('./enum').OrderType }[]
    tip:string
}

interface RState {
    activeModal: import('./enum').Modal
    isLoaded:boolean
    scene: import('./src/components/scenes/MapScene').default
    mySave: SaveFile
}
