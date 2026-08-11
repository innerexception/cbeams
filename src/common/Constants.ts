// Every plain constant value used by the game lives here — enum.ts stays enums-only, everything else
// (grid/world sizing, economy tuning, combat balance, UI theme) is centralized in one place so there's
// a single source of truth instead of the same magic number/color redefined per file.

// Converts a 0xRRGGBB Phaser color number into the equivalent CSS hex string, so a color only ever
// has to be tuned in one spot (the numeric form) even though React/DOM styling needs a CSS string.
const hexToCss = (hex:number) => '#' + hex.toString(16).padStart(6, '0')

// --- World / grid ---
export const MAP_SIZE = 100
export const CELL_SIZE = 20

// Grid<->world conversions — the one place this math is defined, so MapScene's rendering and the
// store's own ship/waypoint distance math are guaranteed to agree on where a grid cell sits in world space.
export const gridToWorld = (x:number, y:number) => ({ x: x*CELL_SIZE + CELL_SIZE/2, y: y*CELL_SIZE + CELL_SIZE/2 })
export const worldToGrid = (worldX:number, worldY:number) => ({ x: Math.floor(worldX/CELL_SIZE), y: Math.floor(worldY/CELL_SIZE) })

// --- Save data ---
export const SAVE_NAME = 'xeno3_save'

// --- Economy ---
export const BASE_MAX_ENERGY = 10
export const ENERGY_PER_MINING_STATION = 2
export const ENERGY_PER_SOLAR_MILL = 0
export const ENERGY_PER_SHIPYARD = 3
export const ENERGY_PER_CRAM = 2
export const SOLAR_MILL_MAX_ENERGY_BONUS = 10
export const METAL_PER_MINING_STATION = 1
export const METAL_TICK_MS = 3000

// Baseline hit points for every building (Shipyard, Mining Station, Solar Mill, CRAM turret) —
// what a drone's contact/blast damage is actually chipping away at.
export const BUILDING_HP = 40
// A faction's starting headquarters is a building too, just a tougher, non-placeable one.
export const BASE_HP = 20

// --- Shipyard production/orders ---
export const MAX_QUEUE = 3
export const MAX_WAYPOINTS = 5

// --- Territory placement ---
// Mining stations and solar mills project a smaller placement radius than bases/shipyards.
export const PLACEMENT_RADIUS_PX = 200
export const EXTRACTOR_RADIUS_PX = PLACEMENT_RADIUS_PX / 2

// --- Ship movement ---
// Once a ship finishes its route (or its orders are cleared) it loiters in a circle around the
// final waypoint / wherever it was.
export const ORBIT_RADIUS_PX = CELL_SIZE * 1.5
export const ORBIT_ANGULAR_SPEED = 0.0005 // radians per ms

// --- Physical footprints, so ships/buildings/icons don't overlap ---
export const NATO_ICON_SIZE = CELL_SIZE * 1.5
export const BASE_FOOTPRINT_RADIUS = CELL_SIZE * 1.5
export const FACTORY_FOOTPRINT_RADIUS = CELL_SIZE * 0.75
export const SHIP_BUILDING_CLEARANCE_PX = 20

// --- Solar Mill animation ---
// One full rotation roughly every 40 seconds.
export const SOLAR_MILL_ROTATION_SPEED = 0.00016 // radians per ms

// --- CRAM turret (a placeable building, not a ship) ---
// Its 23mm cannon: how often it can fire, how much damage a hit does, its range (double the old
// mobile CRV's), and how long a burst's tracer dots stay on screen. It can also target an incoming
// MLRS missile instead of a ship, with a chance to shoot it down.
export const CRAM_FIRE_COOLDOWN_MS = 350
export const CRAM_DAMAGE = 1
export const CRAM_RANGE_PX = 320
export const TRACER_LIFETIME_MS = 220
export const MISSILE_INTERCEPT_CHANCE = 0.4

// --- Kamikaze drones (KK, ATD) ---
// How close a drone has to get to a hostile unit/building to count as "contact".
export const DRONE_CONTACT_RADIUS_PX = 14
export const KK_DAMAGE = 5
export const ATD_DAMAGE = 10
export const ATD_BLAST_RADIUS_PX = 10

// --- MLRS rocket ship ---
// On cooldown, it launches a whole salvo of missiles at once, all homing on the same nearest target
// in range — each missile is a scene-local projectile (not stored in the app state), tracked only
// while in flight, that steers towards its target's live position every frame.
export const MLRS_FIRE_COOLDOWN_MS = 1500
export const MLRS_RANGE_PX = 350
export const MISSILE_SALVO_SIZE = 3
export const MISSILE_DAMAGE = 5
export const MISSILE_SPEED_PX_S = 220
export const MISSILE_MAX_LIFETIME_MS = 8000

// --- BLM (a placeable building, not a ship) ---
// A slow, long-range single-missile launcher: on a long cooldown, fires one missile at its nearest
// hostile *building*, never a vehicle — the opposite targeting scope from MLRS (vehicles only).
export const BLM_FIRE_COOLDOWN_MS = 10000
export const BLM_RANGE_PX = 4000
export const ENERGY_PER_BLM = 3

// --- THADD (a placeable building, not a ship) ---
// An anti-missile battery: on cooldown, fires a 2-missile salvo at its nearest *hostile missile* in
// range — never a vehicle or building. An interceptor missile destroys (and is destroyed by) whatever
// hostile missile it touches, regardless of which one it was actually launched at.
export const THADD_FIRE_COOLDOWN_MS = 10000
export const THADD_RANGE_PX = 400
export const THADD_SALVO_SIZE = 2
export const ENERGY_PER_THADD = 3

// --- Wreckage ---
// Left behind by a destroyed ship/building (or a drone detonating), lingers for 10 seconds while fading out.
export const SHATTER_LIFETIME_MS = 10000

// --- Enemy AI ---
// How many drones the enemy shipyard masses before launching them at the player, once, at the start of the match.
export const ENEMY_RAID_SIZE = 3

// --- Theme colors ---
// GREEN is the game's one wireframe accent color, everywhere: Phaser draws want the 0xRRGGBB number,
// React/DOM styling and Phaser text colors want the '#rrggbb' string — both are derived from one value.
export const GREEN_HEX = 0x55FF55
export const GREEN_DIM_HEX = 0x006500
export const GREY_DIM_HEX = 0x666666
