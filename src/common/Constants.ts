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
export const SOLAR_MILL_MAX_ENERGY_BONUS = 10
export const METAL_PER_MINING_STATION = 1
export const METAL_TICK_MS = 3000

// --- Shipyard production/orders ---
export const MAX_QUEUE = 3
export const MAX_WAYPOINTS = 5

// --- Territory placement ---
// Mining stations and solar mills project a smaller placement radius than bases/shipyards.
export const PLACEMENT_RADIUS_PX = 200
export const EXTRACTOR_RADIUS_PX = PLACEMENT_RADIUS_PX / 2

// --- Ship movement ---
// Ships following shipyard orders travel at half their listed ShipData speed.
export const WAYPOINT_SPEED_MULTIPLIER = 0.5
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

// --- CRV 23mm cannon ---
// How often it can fire, how much damage a hit does, and how long a burst's tracer dots stay on
// screen. Its cannon can also target an incoming missile instead of a ship, with a chance to shoot it down.
export const CRV_FIRE_COOLDOWN_MS = 350
export const CRV_DAMAGE = 1
export const TRACER_LIFETIME_MS = 220
export const MISSILE_INTERCEPT_CHANCE = 0.4

// --- DDG missiles ---
// A DDG fires a homing missile at its nearest target in range once a second. It always eventually
// catches a non-evasive target (its speed comfortably outruns any ship), unless intercepted first.
export const DDG_FIRE_COOLDOWN_MS = 1000
export const MISSILE_DAMAGE = 5
export const MISSILE_SPEED_PX_S = 220
export const MISSILE_MAX_LIFETIME_MS = 8000

// --- Wreckage ---
// Left behind by a destroyed ship (or a missile detonating), lingers for 10 seconds while fading out.
export const SHATTER_LIFETIME_MS = 10000

// --- Enemy AI ---
// How many CRVs the enemy shipyard masses before launching them at the player, once, at the start of the match.
export const ENEMY_RAID_SIZE = 3

// --- Theme colors ---
// GREEN is the game's one wireframe accent color, everywhere: Phaser draws want the 0xRRGGBB number,
// React/DOM styling and Phaser text colors want the '#rrggbb' string — both are derived from one value.
export const GREEN_HEX = 0x33ff55
export const GREEN = hexToCss(GREEN_HEX)
export const GREEN_DIM_HEX = 0x114422
export const GREY_DIM_HEX = 0x666666

export const RED_HEX = 0xff3333
export const RED = hexToCss(RED_HEX)
