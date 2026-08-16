// Every plain constant value used by the game lives here — enum.ts stays enums-only, everything else
// (grid/world sizing, economy tuning, combat balance, UI theme) is centralized in one place so there's
// a single source of truth instead of the same magic number/color redefined per file.

// --- World / grid ---
export const MAP_SIZE = 100
// Matches the Tiled map's own tile size (src/assets/maps/sandbox.json, 32x32) so a grid cell here lines
// up exactly with a tile there — a ship spawned at the entities layer's tile (x,y) (see MapScene's
// spawnEntitiesFromMap) sits at that same (x,y) in this game's own grid, no rescaling needed.
export const CELL_SIZE = 32

// Grid<->world conversions — the one place this math is defined, so MapScene's rendering and the
// store's own ship/waypoint distance math are guaranteed to agree on where a grid cell sits in world space.
export const gridToWorld = (x:number, y:number) => ({ x: x*CELL_SIZE + CELL_SIZE/2, y: y*CELL_SIZE + CELL_SIZE/2 })
export const worldToGrid = (worldX:number, worldY:number) => ({ x: Math.floor(worldX/CELL_SIZE), y: Math.floor(worldY/CELL_SIZE) })

// --- Save data ---
export const SAVE_NAME = 'xeno3_save'

// --- Base production/orders ---
// There are no buildings in this game — every ship (including a faction's own Base) queues and orders
// through the same fields (see ShipData in types.d.ts). MAX_QUEUE/MAX_WAYPOINTS bound a Base's own queue
// and any ship's own route respectively.
export const MAX_QUEUE = 3
export const MAX_WAYPOINTS = 5
// A faction's logistics cap (see Utils' getLogisticsStatus) — the ceiling on how large a fleet it can
// field at once — starts at this floor and rises LOGISTICS_PER_GAS_CLOUD for every GasCloud that
// faction keeps at least one Harvester near (see MapScene's updateHarvesters/HARVESTER_RANGE_PX).
export const BASE_LOGISTICS_FLOOR = 10
export const LOGISTICS_PER_GAS_CLOUD = 10

// --- Ship movement ---
// Once a ship finishes its route (or its orders are cleared) it loiters in a circle around the
// final waypoint / wherever it was.
export const ORBIT_RADIUS_PX = CELL_SIZE * 1.5
export const ORBIT_ANGULAR_SPEED = 0.0005 // radians per ms

// --- Physical footprints ---
export const NATO_ICON_SIZE = 32

// --- Kamikaze drones (KK, ATD) ---
// Both now detonate against any hostile ship they touch (there's nothing else left to touch — see
// MapScene's DRONE_TYPES). KK hits only whatever it actually touches; ATD blasts everything hostile
// within this radius of where it detonates. Their own damage lives on their ShipStats entry in enum.ts,
// alongside every other ship's.
export const ATD_BLAST_RADIUS_PX = 10

// --- MLRS rocket ship ---
// On cooldown, it launches a whole salvo of missiles at once, all homing on the same nearest hostile
// ship in range — each missile is a scene-local projectile (not stored in the app state), tracked only
// while in flight, that steers towards its target's live position every frame. Its own cooldown and
// range now live on its ShipStats entry in enum.ts, alongside every other ship's.
export const MISSILE_SALVO_SIZE = 3
export const MISSILE_SPEED_PX_S = 220
export const MISSILE_MAX_LIFETIME_MS = 8000
// Missiles within a salvo launch one at a time this far apart instead of all at once, so a salvo
// actually reads as a salvo on screen rather than one stacked blob of missiles flying in perfect lockstep.
export const SALVO_STAGGER_MS = 500
// A missile's *collision* body still flies a straight line to its target (see updateMissiles) — this is
// purely a visual lob layered on top, a sine bump peaking at MISSILE_ARC_HEIGHT_PX partway through the
// flight and easing back to 0 at both ends, so it reads as a lobbed shot instead of a laser. It leaves a
// trail of fading dots behind it (CONTRAIL_*) tracing that same visual arc.
export const MISSILE_ARC_HEIGHT_PX = 180
export const CONTRAIL_INTERVAL_MS = 60
export const CONTRAIL_LIFETIME_MS = 5000

// --- ARMOR ground vehicle ---
// On cooldown, fires a single instant shot (not a homing missile) at whichever hostile ship is nearest
// in range. Its damage, cooldown and range all live on its ShipStats entry in enum.ts, alongside every
// other ship's.
export const TRACER_LIFETIME_MS = 220

// --- Wreckage ---
// Left behind by a destroyed ship (or a drone detonating), lingers for 10 seconds while fading out.
export const SHATTER_LIFETIME_MS = 10000

// --- Objectives ---
// A capturable map feature (see MapScene's spawnEntitiesFromMap for where they're placed, and
// updateObjectives for the live capture check): a faction captures one the instant it has ARMOR within
// this radius of it AND the other faction has no ship also within that same radius.
export const OBJECTIVE_CAPTURE_RADIUS_PX = 200
export const OBJECTIVE_ICON_SIZE = 40
// How long a faction's ARMOR has to hold an Objective uncontested (see updateObjectives) before
// ownership actually flips — a momentary drive-through doesn't capture anything, and stepping out (or
// dying, or an enemy showing up) before this elapses resets the clock to 0, not just pauses it.
export const OBJECTIVE_CAPTURE_TIME_MS = 30000

// --- Enemy AI ---
// How many drones the enemy Base masses before launching them at the player, once, at the start of the match.
export const ENEMY_RAID_SIZE = 3

// --- Resource nodes (Asteroids, GasClouds) ---
// Scattered procedurally across the map at match start (see MapScene's spawnResourceNodes) — there's no
// tile reserved for these on the map file the way a Base or Objective has. A Harvester within this
// range of an Asteroid draws HARVESTER_COLLECTION_RATE_PER_S metal/second from it (see
// MapScene's updateHarvesters); the same range is what makes a GasCloud count as "covered" for that
// faction's logistics cap (see Utils' getLogisticsStatus).
export const HARVESTER_RANGE_PX = 50
export const HARVESTER_COLLECTION_RATE_PER_S = 1
export const RESOURCE_ASTEROID_COUNT = 14
export const RESOURCE_GAS_CLOUD_COUNT = 4
// An Asteroid's starting metal stockpile is ASTEROID_AVG_METAL +/- a random amount up to
// ASTEROID_METAL_VARIANCE, so nodes vary in size without ever straying too far from the stated average.
export const ASTEROID_AVG_METAL = 50
export const ASTEROID_METAL_VARIANCE = 15
// Minimum gap kept between any two resource nodes, and between a node and any ship (a faction's Base
// included) at scatter time — purely so nodes don't spawn stacked on top of each other or a Base.
export const RESOURCE_NODE_MIN_SPACING_PX = 150

// --- Theme colors ---
// GREEN is the game's one wireframe accent color, everywhere: Phaser draws want the 0xRRGGBB number,
// React/DOM styling and Phaser text colors want the '#rrggbb' string — both are derived from one value.
export const GREEN_HEX = 0x55FF55
export const GREEN_DIM_HEX = 0x006500
export const GREY_DIM_HEX = 0x666666
