export const CELL_SIZE = 32

export const gridToWorld = (x:number, y:number) => ({ x: x*CELL_SIZE + CELL_SIZE/2, y: y*CELL_SIZE + CELL_SIZE/2 })
export const worldToGrid = (worldX:number, worldY:number) => ({ x: Math.floor(worldX/CELL_SIZE), y: Math.floor(worldY/CELL_SIZE) })

export const SHIP_SEPARATION_PX = 1

// A ship heading for a plain route waypoint (not a mining orbit or a latched Objective, both of which
// already have their own always-approaching convergence) counts as "arrived" once within this radius
// of it, not just once within a single frame's step of the exact pixel. Without it, a clump of ships
// routed to the same point can end up permanently fighting applyShipSeparation over the last few
// pixels — none can ever sit exactly on the target once separation is nudging it aside, so it keeps
// re-triggering a full-speed moveTo back toward that exact point every frame, forever. This dead zone
// is comfortably wider than a single separation nudge, so once a ship settles anywhere in the clump
// near the destination, it actually stops.
export const WAYPOINT_ARRIVAL_RADIUS_PX = 8

export const SAVE_NAME = 'xeno3_save'

export const MAX_QUEUE = 1
export const MAX_WAYPOINTS = 5

export const DOUBLE_CLICK_MS = 350

// Delay of the TimerEvent driving MapScene's own slow tick (see its runSlowTick, created in create()) —
// everything that decides something (AI orders, Objective/ship-capture bookkeeping, win/lose checks)
// rather than moving or drawing a sprite lives there instead of the 60Hz update(), since none of it
// needs to be fresher than this to look or play right, and re-running it every single frame was pure
// wasted work.
export const SLOW_TICK_INTERVAL_MS = 1000

export const ATD_BLAST_RADIUS_PX = 20

export const MISSILE_SPEED_PX_S = 110
// Must comfortably exceed the flight time of the longest-range missile shot any ship can actually take —
// currently STL's own rangePx (1000px, see enum.ts's ShipData), which at MISSILE_SPEED_PX_S takes ~9.1s
// to cross. This used to be tuned only against SPR's much shorter 250px range (~2.3s) and left as-is when
// STL was added; a max-range STL shot was getting force-destroyed by this exact timeout mid-flight,
// nowhere near its target, well before impact.
export const MISSILE_MAX_LIFETIME_MS = 10000
export const SALVO_STAGGER_MS = 500
export const MISSILE_ARC_HEIGHT_PX = 180
export const CONTRAIL_INTERVAL_MS = 60
export const CONTRAIL_LIFETIME_MS = 5000

export const BULLET_SPEED_PX_S = 400
export const BULLET_MAX_LIFETIME_MS = 1000

export const BEAM_LIFETIME_MS = 150
export const BEAM_WIDTH_PX = 2

export const SHIP_FRAGMENT_LIFETIME_MS = 5000
export const SHIP_FRAGMENT_MIN_DISTANCE_PX = 32
export const SHIP_FRAGMENT_MAX_DISTANCE_PX = 56

export const MISSILE_IMPACT_LIFETIME_MS = 2000
export const MISSILE_IMPACT_MIN_RADIUS_PX = 6
export const MISSILE_IMPACT_RADIUS_PER_DAMAGE_PX = 2

export const OBJECTIVE_CAPTURE_RADIUS_PX = 200
export const OBJECTIVE_ICON_SIZE = 40
export const OBJECTIVE_CAPTURE_TIME_MS = 30000

// A ZEL has to get right alongside a hostile ship before it can board it.  Ship captures deliberately
// use the same sustained hold duration as Objectives, rather than converting a ship on first contact.
export const ZEL_SHIP_CAPTURE_RADIUS_PX = 32
export const ZEL_SHIP_CAPTURE_TIME_MS = OBJECTIVE_CAPTURE_TIME_MS
// Enemy ZELs board targets only when no nearby allied escort can protect them.
export const ZEL_CAPTURE_ISOLATION_RADIUS_PX = 150
export const ZEL_CLAIM_RADIUS_PX = OBJECTIVE_CAPTURE_RADIUS_PX

export const ENEMY_RAID_SIZE = 3

// How long an escort keeps heading for wherever an attack on its escorted ship last came from (see
// AIPlayers' escortZel) before that alert goes stale and it falls back to standing near the ship again —
// covers the common case where the attacker is out of the escort's own sight (see effectiveSightRadiusPx)
// entirely, so the escort would otherwise never react to it at all.
export const ESCORT_ATTACK_ALERT_MS = 8000

// AI retreat destinations are intentionally refreshed sparingly. Reissuing a new escape route every
// frame near the edge of an enemy's sight range makes ships visibly jitter back and forth.
export const AI_FLEE_ORDER_INTERVAL_MS = 5000

// How long the mission holds on a pan-and-ping reveal before actually ending — whether that's an enemy
// ZEL executing CAPTURE_ESCAPE reaching a Portal (camera panned to it, visible regardless of fog-of-war
// — see MapScene's updatePortals/resolvePendingCaptureEscape) or any other victory/defeat condition
// being met (see updateMissionObjectives/startMissionEndReveal/resolvePendingMissionEnd) — so the player
// always gets a moment to actually see what just decided the match before the results screen cuts in.
export const MISSION_END_REVEAL_MS = 5000

// One expand cycle of the minimap ping drawn over a ship actively being captured (see MapScene's own
// drawMinimap) — repeats for as long as that capture is still ongoing, not a fixed number of times.
export const MINIMAP_PING_PULSE_MS = 1200

// A ship sitting inside a nebula has its own sight cut down to this, and is only detectable by an enemy
// ship that's also inside a nebula (see MapScene's isWithinFactionSightRange). "Inside a nebula" is a
// convex-hull containment test against each nebula's precomputed boundary — see assets/NebulaHulls.ts.
export const NEBULA_SIGHT_RADIUS_PX = 40

// Floor on how far an AI ship's target search reaches — see AIPlayers' effectiveSightRadiusPx. A target
// still has to actually fall within some friendly ship's own sight radius (isWithinFactionSightRange
// already checks the whole fleet, not just the searching ship) to count as spotted; this just makes sure
// a short-sighted ship (e.g. a 50px-sightRadius KKZ) doesn't ignore a target the fleet can already see
// together just because it's further than that one ship could ever spot alone.
export const AI_ALLIED_SPOTTING_RANGE_PX = 350

export const HARVESTER_ORBIT_RADIUS_PX = 40
export const HARVESTER_RANGE_PX = HARVESTER_ORBIT_RADIUS_PX + 30
export const HARVESTER_ORBIT_ANGULAR_SPEED = 0.0001 // radians per ms
export const HARVESTER_COLLECTION_RATE_PER_S = 1
export const HARVESTER_METAL_CAPACITY = 50
export const HARVESTER_RESUPPLY_RANGE_PX = 100
export const HARVESTER_RESUPPLY_INTERVAL_MS = 1000
export const HARVESTER_REPAIR_METAL_COST = 2
// Every other ammo-limited ship (SPR, PDF) resupplies at the flat 1-metal-per-1-ammo rate
// updateHarvesterSupport otherwise uses — a DRN costs more per unit since what it's actually rearming is
// its own KKZ-manufacturing capacity, not a single shot.
export const DRN_AMMO_METAL_COST = 5
export const ASTEROID_AVG_METAL = 50
export const ASTEROID_METAL_VARIANCE = 15

export const GREEN_HEX = 0x55FF55
export const YELLOW_HEX = 0xFFFF55
export const RED_HEX=0xff5555

// Shared by MapScene/SightRadius (angle-wrapping math, drawing full circles) instead of each defining
// its own copy.
export const TWO_PI = Math.PI*2

export const HARVESTER_BEAM_FLICKER_MIN_MS = 250
export const HARVESTER_BEAM_FLICKER_MAX_MS = 1000

// The in-canvas minimap's own screen rect (see MapScene's getMinimapRect, which composes these into
// {originX, originY, size}) — also read directly by FactoryToolbar (a plain DOM/React overlay, not
// Phaser) so its own top-right panel can sit flush against the minimap without the two drifting apart.
export const MINIMAP_SIZE_PX = 150
export const MINIMAP_MARGIN_PX = 72
