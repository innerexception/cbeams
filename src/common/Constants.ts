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

// --- Base production/orders ---
// There are no buildings in this game — every ship (including a faction's own Base) queues and orders
// through the same fields (see ShipData in types.d.ts). MAX_QUEUE/MAX_WAYPOINTS bound a Base's own queue
// and any ship's own route respectively.
export const MAX_QUEUE = 1
export const MAX_WAYPOINTS = 5
// A faction's logistics cap (see Utils' getLogisticsStatus) — the flat ceiling on how large a fleet it
// can field at once, before any Objectives it holds raise it further.
export const BASE_LOGISTICS_FLOOR = 10
// Each Objective a faction currently owns (see updateObjectives) raises its logistics cap by this much,
// live off however many it holds right now rather than an accumulated one-off bonus — so losing one back
// to the other faction lowers the cap again immediately, the same as gaining one raises it.
export const LOGISTICS_PER_OBJECTIVE = 1

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

// --- Resource nodes (Asteroids) ---
// Spawned wherever the map's entities layer has an AsteroidSpriteIndexesLarge tile (see MapScene's
// spawnEntitiesFromMap and enum.ts) — the same tile-driven placement a Base or Objective already gets,
// rather than scattered at random. A Harvester within this range of an Asteroid draws
// HARVESTER_COLLECTION_RATE_PER_S metal/second from it (see MapScene's updateHarvesters).
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
// A Harvester no longer deposits what it mines into a shared faction stockpile — there is no faction
// stockpile anymore — it just carries the metal itself, up to this cap (see MapScene's updateHarvesters/
// drawHarvesterMetalGauge for the gather side, updateHarvesterSupport for what it's actually spent on).
export const HARVESTER_METAL_CAPACITY = 50
// Any ship within this range of a Harvester (any type, not just ones that fire — see MapScene's
// updateHarvesterSupport) has its own ammoRemaining topped up from that Harvester's carried metal, one
// whole unit (1 metal for 1 ammo) at a time every HARVESTER_RESUPPLY_INTERVAL_MS — a discrete tick
// rather than a continuous per-second rate, since ammoRemaining is a whole-number "shots left" stat and
// transferring in fractional amounts would leave it (and metalCarried) drifting off whole numbers.
export const HARVESTER_RESUPPLY_RANGE_PX = 100
export const HARVESTER_RESUPPLY_INTERVAL_MS = 1000
// A Harvester within range of a damaged friendly ship (hp below its ShipStats max) repairs it instead,
// 1 whole hp at a time on the same per-tick cadence/cooldown as ammo resupply, but at this steeper metal
// cost per hp — see MapScene's updateHarvesterSupport, which tries an ammo-short target first and only
// falls back to a repair target if none was found (or there wasn't enough metal left for one).
export const HARVESTER_REPAIR_METAL_COST = 2
// An Asteroid's starting metal stockpile is ASTEROID_AVG_METAL +/- a random amount up to
// ASTEROID_METAL_VARIANCE, so nodes vary in size without ever straying too far from the stated average,
// even though how many of them exist and where is now entirely up to the map file rather than rolled here.
export const ASTEROID_AVG_METAL = 50
export const ASTEROID_METAL_VARIANCE = 15

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
