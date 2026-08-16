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

// Minimum gap MapScene's applyShipSeparation keeps enforcing between any two ship bodies, every frame,
// on top of whatever movement decision each one already made that frame — this is what makes a pile of
// ships arriving at the same waypoint spread out instead of stacking exactly on top of each other,
// rather than a one-off placement check.
export const SHIP_SEPARATION_PX = 1

// --- Save data ---
export const SAVE_NAME = 'xeno3_save'

// --- Economy ---
// Every ship now costs metal to queue (see ShipData's metalCost in enum.ts, store's queueShip) and
// neither faction starts with a Harvester already placed (see MapScene's spawnEntitiesFromMap — only a
// Base comes off the map file) — without some starting stockpile, nobody could ever afford the very
// first Harvester needed to start earning any. Applies to both factions, the enemy's own opening raid
// (AIPlayers' spawnEnemyRaid) included.
export const STARTING_METAL = 10

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

// --- Ship destruction ---
// A destroyed ship's own sprite splits into two pieces along a jagged cut (see MapScene's
// spawnDeathFragments) — each piece flies outward from the split, spinning slowly, driven entirely by a
// Phaser tween computed once at the moment of death rather than redrawn by hand every frame. No
// fade-out — a piece (and its mask) is just destroyed outright the instant that tween finishes.
export const SHIP_FRAGMENT_LIFETIME_MS = 5000
export const SHIP_FRAGMENT_MIN_DISTANCE_PX = 32
export const SHIP_FRAGMENT_MAX_DISTANCE_PX = 56

// --- Missile impacts ---
// A missile actually landing on its target (see MapScene's onMissileShipContact), a drone self-
// detonating (see detonateDrone), or a missile fizzling out mid-flight with nothing left to retarget
// onto (see updateMissiles) all flash a plain yellow circle at the point — sized off the damage
// involved (radius = MISSILE_IMPACT_MIN_RADIUS_PX + damage*MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX), fully
// opaque at the moment it appears, fading out over MISSILE_IMPACT_LIFETIME_MS. Independent of the
// target actually dying — that still gets its own splitting-in-two death effect (see destroyShipSprite/
// spawnDeathFragments) on top, same as before.
export const MISSILE_IMPACT_LIFETIME_MS = 2000
export const MISSILE_IMPACT_MIN_RADIUS_PX = 6
export const MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX = 2

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
export const HARVESTER_ORBIT_RADIUS_PX = 40
// Must clear the orbit radius with room to spare — once mining, a Harvester circles its Asteroid at
// exactly HARVESTER_ORBIT_RADIUS_PX (see MapScene's moveShips), so the engagement range has to stay
// comfortably wider than that or it would immediately count as "out of range" the instant it started
// orbiting.
export const HARVESTER_RANGE_PX = HARVESTER_ORBIT_RADIUS_PX + 30
// The tangential speed this implies (HARVESTER_ORBIT_RADIUS_PX * this, in px/ms) has to stay under the
// Harvester's own ShipStats.speed (see enum.ts) or it could never actually keep up with its own orbit
// target and would just trail behind it in a straight line instead of curving.
export const HARVESTER_ORBIT_ANGULAR_SPEED = 0.0001 // radians per ms
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
export const YELLOW_HEX = 0xFFFF55
export const RED_HEX=0xff5555

// How often the (purely cosmetic) mining beam line flickers on/off while a Harvester is actively
// drawing from an Asteroid — see MapScene's drawHarvesterBeams. A random interval within this range is
// rolled fresh after every toggle, not a fixed blink rate. Independent of
// HARVESTER_COLLECTION_RATE_PER_S, which still accrues continuously every frame regardless of how
// often the beam itself is actually drawn.
export const HARVESTER_BEAM_FLICKER_MIN_MS = 250
export const HARVESTER_BEAM_FLICKER_MAX_MS = 1000
