// Every plain constant value used by the game lives here — enum.ts stays enums-only, everything else
// (grid/world sizing, economy tuning, combat balance, UI theme) is centralized in one place so there's
// a single source of truth instead of the same magic number/color redefined per file.

// --- World / grid ---
export const MAP_SIZE = 100
export const CELL_SIZE = 20

// Grid<->world conversions — the one place this math is defined, so MapScene's rendering and the
// store's own ship/waypoint distance math are guaranteed to agree on where a grid cell sits in world space.
export const gridToWorld = (x:number, y:number) => ({ x: x*CELL_SIZE + CELL_SIZE/2, y: y*CELL_SIZE + CELL_SIZE/2 })
export const worldToGrid = (worldX:number, worldY:number) => ({ x: Math.floor(worldX/CELL_SIZE), y: Math.floor(worldY/CELL_SIZE) })

// --- Save data ---
export const SAVE_NAME = 'xeno3_save'

// --- Shipyard production/orders ---
export const MAX_QUEUE = 3
export const MAX_WAYPOINTS = 5

// --- Territory placement ---
// Mining stations and solar mills project a smaller placement radius than bases/shipyards.
export const PLACEMENT_RADIUS_PX = 200
export const EXTRACTOR_RADIUS_PX = PLACEMENT_RADIUS_PX / 2

// --- Placement phase ---
// Before a match goes live, the player plants exactly this many LogisticsCenters on their own side of
// the map, each at least LOGISTICS_CENTER_MIN_SPACING_PX from every other one they've already placed —
// see MapScene's isValidLogisticsPlacement/handleLogisticsPlacementClick.
export const LOGISTICS_CENTER_COUNT = 3
export const LOGISTICS_CENTER_MIN_SPACING_PX = 500

// --- Ship movement ---
// Once a ship finishes its route (or its orders are cleared) it loiters in a circle around the
// final waypoint / wherever it was.
export const ORBIT_RADIUS_PX = CELL_SIZE * 1.5
export const ORBIT_ANGULAR_SPEED = 0.0005 // radians per ms

// --- Physical footprints, so ships/buildings/icons don't overlap ---
export const NATO_ICON_SIZE = 40
export const BASE_FOOTPRINT_RADIUS = CELL_SIZE * 1.5
export const FACTORY_FOOTPRINT_RADIUS = CELL_SIZE * 0.75
export const SHIP_BUILDING_CLEARANCE_PX = 20
// Minimum gap enforced between any two buildings' icon frames (see MapScene's
// getBuildingIconRadius/isValidPlacement) — actual footprint is each building's real rendered icon
// size, this is just the flat clearance added on top so frames never touch edge-to-edge.
export const BUILDING_MIN_CLEARANCE_PX = 30

// --- CRAM turret (a placeable building, not a ship) ---
// Its cooldown, damage and range now live on its BuildingMetaData entry in enum.ts. It can also
// target an incoming MLRS missile instead of a ship, with a chance to shoot it down; how long a
// burst's tracer dots stay on screen is still a plain constant.
export const TRACER_LIFETIME_MS = 220
export const MISSILE_INTERCEPT_CHANCE = 0.4

// --- Kamikaze drones (KK, ATD) ---
// How close a drone has to get to a hostile unit/building to count as "contact". Their own damage now
// lives on their VehicleStats entry in enum.ts, alongside every other vehicle's.
export const DRONE_CONTACT_RADIUS_PX = 14
export const ATD_BLAST_RADIUS_PX = 10

// --- MLRS rocket ship ---
// On cooldown, it launches a whole salvo of missiles at once, all homing on the same nearest target
// in range — each missile is a scene-local projectile (not stored in the app state), tracked only
// while in flight, that steers towards its target's live position every frame. Its own cooldown and
// range now live on its VehicleStats entry in enum.ts, alongside every other vehicle's.
export const MISSILE_SALVO_SIZE = 3
export const MISSILE_SPEED_PX_S = 220
export const MISSILE_MAX_LIFETIME_MS = 8000

// --- ARMOR ground vehicle ---
// On cooldown, fires a single instant shot (like CRAM's cannon, not a homing missile) at whichever
// hostile building is nearest in range. Its damage, cooldown and range all live on its VehicleStats
// entry in enum.ts, alongside every other vehicle's.

// --- THADD (a placeable building, not a ship) ---
// An anti-missile battery: on cooldown, fires a 2-missile salvo at its nearest *hostile missile* in
// range — never a vehicle or building. An interceptor missile destroys (and is destroyed by) whatever
// hostile missile it touches, regardless of which one it was actually launched at. Its cooldown and
// range now live on its BuildingMetaData entry in enum.ts.
export const THADD_SALVO_SIZE = 2

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
