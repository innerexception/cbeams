interface PhaserResource {
    key:string
    resource: any
    type: string
    data?: any
}

interface SaveFile {

}

// A minimal subset of a Tiled (mapeditor.org) JSON map export — just enough to read tile GIDs back out
// of a hand-authored, annotated map file. Only the plain array/CSV `data` layer format is supported
// (not Tiled's base64/compressed export options). See MapScene's drawTerrain for how it's actually
// drawn — a plain wireframe outline per occupied tile, not real tileset artwork, since this game has no
// tile image assets, only vector Graphics.
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

interface MapData {
    width: number
    height: number
    objectives: Array<ObjectiveSpawn>
    // No procedurally-generated terrain anymore — this is either null (the default: an empty map,
    // until a real Tiled file exists and is passed to generateMap) or a parsed Tiled JSON export.
    terrain: TiledMap | null
}

// The live half of a capturable Objective — see ObjectiveSpawn for its fixed id/position/sprite (never
// duplicated here). owner is null until some faction actually captures it, which takes a full
// OBJECTIVE_CAPTURE_TIME_MS of that faction holding it uncontested (ARMOR of that faction within
// OBJECTIVE_CAPTURE_RADIUS_PX of it, and no hostile ship also within that radius) — see MapScene's
// updateObjectives for the live tracking of that hold via capturingFaction/captureStartedAtMs. owner
// never reverts to null on its own once captured — only the other faction completing that same hold
// changes it. capturingFaction/captureStartedAtMs reset to null the instant the hold breaks (ARMOR
// leaves/dies, or an enemy shows up), even mid-count — no partial credit carries over to a later attempt.
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

interface ShipStats {
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
    relicCost: number
    description:string
    ammo?:number
}

// A ship's own real, high-frequency simulation state (hp, position, cooldowns, route, ...) lives on
// ShipSprite (src/components/sprites/ShipSprite.ts) now, mutated directly every frame — never in the
// Zustand store. This is the low-frequency summary MapScene pushes into the store instead, purely for
// React (ResourceHUD, FactoryToolbar) to render from: just enough to show a ship's type/description, tell
// factions apart, and drive a Base's production panel. Pushed on the rare discrete events that actually
// change one of these fields — a ship spawns, dies, or its queue changes — never on a physics tick.
interface ShipSummary {
    id: string
    faction: import('./enum').Faction
    type: import('./enum').ShipType
    // Only ever populated on a Base (see ShipType.CATH) — see ShipSprite's own queue field.
    queue?: Array<ProductionQueueItem>
}

// A gatherable Asteroid — spawned at world coordinates converted once from an AsteroidSpriteIndexesLarge
// tile's grid cell on the map's entities layer (see MapScene's spawnEntitiesFromMap), same as a ship;
// there's no live link back to that tile afterward, unlike ObjectiveSpawn which keeps its grid (x,y)
// around. metal is the live remaining stockpile a nearby Harvester draws down (see MapScene's
// updateHarvesters); maxMetal is what it started with, kept around purely so its sprite can be scaled
// down proportionally as it depletes.
interface ResourceNodeData {
    id: string
    x: number
    y: number
    metal?: number
    maxMetal?: number
}

interface RState {
    activeModal: import('./enum').Modal
    isLoaded:boolean
    scene: import('./src/components/scenes/MapScene').default
    mySave: SaveFile
}
