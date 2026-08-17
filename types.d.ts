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
    logisticsCost: number
    // Missiles an MLRS can ever launch, total, over its whole lifetime — undefined for every other
    // ship (none of them fire missiles). See ShipData's ammoRemaining for the live count.
    ammo?:number
}

interface ShipData {
    id: string
    faction: import('./enum').Faction
    type: import('./enum').ShipType
    x: number
    y: number
    // A ship's own route, followed in order (see MapScene's moveShips) then sat idle at the last point.
    // A newly produced ship always starts with none — it just sits by its Base until given one (see
    // spawnShip) — and a Base itself never has any of its own; it never actually moves (speed:0) and
    // MapScene's handleClick won't let one be selected for order-giving in the first place.
    waypoints?: Array<{ x:number, y:number }>
    pathIndex?: number
    // ARMOR only — the Objective (ObjectiveData.id) it's currently latched onto, having come within
    // OBJECTIVE_CAPTURE_RADIUS_PX of it (see MapScene's moveShips). Overrides its normal route entirely
    // while set: it moves straight to that Objective's own edge and sits there instead of continuing on
    // to its next waypoint. Set the instant it starts approaching — NOT the same instant as actually
    // arriving there, see objectiveAttached for that. Cleared the instant that Objective is captured by
    // its own faction, or the instant it's given any new order (see store's addShipWaypoints/
    // removeShipWaypoints/clearShipWaypoints, all of which clear this same as they always have
    // waypoints/pathIndex).
    latchedObjectiveId?: string
    // ARMOR only — true once it's actually reached the edge point latchedObjectiveId sends it to, not
    // merely en route there. This, not latchedObjectiveId alone, is what updateObjectives requires before
    // a capture even starts counting down — otherwise the timer would start the instant an ARMOR merely
    // entered range, before it had actually attached to anything.
    objectiveAttached?: boolean
    // EYE only — set the instant it finishes its very first route and comes to a stop (see MapScene's
    // moveShips). From then on it's permanently immobile: moveShips forces it idle regardless of any
    // waypoints it might have, and MapScene's handleClick won't let it be given new orders at all — it
    // just sits wherever it stopped until destroyed.
    movementLocked?: boolean
    lastFiredAtMs?: number
    hp: number
    // Only present for a ship whose ShipStats sets `ammo` (SPR) — set to that value when the ship's
    // spawned, decremented per missile actually launched, or refilled by a nearby GAIN (see MapScene's
    // updateHarvesterSupport). Once it hits 0 it can't fire again.
    ammoRemaining?: number
    // GAIN only — how much metal it's currently carrying, up to HARVESTER_METAL_CAPACITY. Gained by
    // mining an Asteroid (see MapScene's updateHarvesters/drawHarvesterMetalGauge) and spent refilling
    // ammo or repairing hp on any friendly ship within HARVESTER_RESUPPLY_RANGE_PX (see
    // updateHarvesterSupport) — there's no faction-wide stockpile anymore, this carried amount is the
    // only metal that exists.
    metalCarried?: number
    // GAIN only — when it last spent metal supporting another ship (ammo or repair) via
    // updateHarvesterSupport, so that support stays gated to one action per HARVESTER_RESUPPLY_INTERVAL_MS
    // instead of a continuous per-frame fractional rate (the same cooldown-timestamp pattern
    // lastFiredAtMs uses for weapon cooldowns).
    lastResupplyAtMs?: number
    // Only ever set on a Base (see ShipType.CATH) — every other ship's own production queue, filled by
    // queueShip/emptied by completeQueueItem/tickProduction, the same role the old shipyard building's
    // own queue field used to play.
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
