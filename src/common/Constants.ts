export const MAP_SIZE = 100
export const CELL_SIZE = 32

export const gridToWorld = (x:number, y:number) => ({ x: x*CELL_SIZE + CELL_SIZE/2, y: y*CELL_SIZE + CELL_SIZE/2 })
export const worldToGrid = (worldX:number, worldY:number) => ({ x: Math.floor(worldX/CELL_SIZE), y: Math.floor(worldY/CELL_SIZE) })

export const SHIP_SEPARATION_PX = 1

export const SAVE_NAME = 'xeno3_save'

export const SHIPS_SYNC_INTERVAL_MS = 150

export const MAX_QUEUE = 1
export const MAX_WAYPOINTS = 5

export const DOUBLE_CLICK_MS = 350

export const ATD_BLAST_RADIUS_PX = 10

export const MISSILE_SPEED_PX_S = 110
export const MISSILE_MAX_LIFETIME_MS = 8000
export const SALVO_STAGGER_MS = 500
export const MISSILE_ARC_HEIGHT_PX = 180
export const CONTRAIL_INTERVAL_MS = 60
export const CONTRAIL_LIFETIME_MS = 5000

export const BULLET_SPEED_PX_S = 600
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

export const ENEMY_RAID_SIZE = 3

// A ship sitting inside a nebula has its own sight cut down to this, and is only detectable by an enemy
// ship that's also inside a nebula (see MapScene's isWithinFactionSightRange). "Inside a nebula" is a
// convex-hull containment test against each nebula's precomputed boundary — see assets/NebulaHulls.ts.
export const NEBULA_SIGHT_RADIUS_PX = 40

export const HARVESTER_ORBIT_RADIUS_PX = 40
export const HARVESTER_RANGE_PX = HARVESTER_ORBIT_RADIUS_PX + 30
export const HARVESTER_ORBIT_ANGULAR_SPEED = 0.0001 // radians per ms
export const HARVESTER_COLLECTION_RATE_PER_S = 1
export const HARVESTER_METAL_CAPACITY = 50
export const HARVESTER_RESUPPLY_RANGE_PX = 100
export const HARVESTER_RESUPPLY_INTERVAL_MS = 1000
export const HARVESTER_REPAIR_METAL_COST = 2
export const ASTEROID_AVG_METAL = 50
export const ASTEROID_METAL_VARIANCE = 15

export const GREEN_HEX = 0x55FF55
export const GREEN_DIM_HEX = 0x006500
export const YELLOW_HEX = 0xFFFF55
export const RED_HEX=0xff5555
export const CYAN_HEX = 0x55FFFF

export const HARVESTER_BEAM_FLICKER_MIN_MS = 250
export const HARVESTER_BEAM_FLICKER_MAX_MS = 1000
