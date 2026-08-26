import { Maps, ObjectiveType, OrderType, ShipType } from '../../enum'

// One MapMetadata entry per Maps key — see its own doc comment (types.d.ts) for what each field is for.
// Briefing (once wired up) reads this off whichever map NewGame's startNewGame set as activeMapKey.
export const MAP_METADATA: Record<Maps, MapMetadata> = {
    [Maps.Ambush]: {
        briefingText: `And he made himself into a god, each one his own, and took to the stars for Man wanted to be alone.

        That great wanting made each one a singularity from which not even light could escape.`,
        imageKeyframes: [
            { x: 900, y: 0 },
            { x: 1400, y: -200 },
        ],
        victory: {
            targetMap: Maps.Infiltration,
            conditions: [{type: ObjectiveType.CAPTURE_OBJECTIVES}]
        },
        defeat: {
            targetMap: null,
            conditions: [{type: ObjectiveType.LOSE_OBJECTIVES}, {type: ObjectiveType.LOSE_UNITS, units: [ShipType.ZEL]}]
        },
        tip: `Prevent the heretics from capturing the places of power to spread their message. Your ZEL must survive. 
        Use your GAIN class to repurpose nearby hulks for replenishment of the fleet.`
    },
    [Maps.Infiltration]: {
        briefingText: `In a quiet corner of orthodox space, a group of local seekers have developed strange thoughts after network traffic from a Morning Star unit.
                    Objective: Neutralize infected ZELs before they can escape.`,
        imageKeyframes: [
            { x: 900, y: 0 },
            { x: 1400, y: -200 },
        ],
        victory: {
            targetMap: Maps.AtTheGates,
            conditions: [{type: ObjectiveType.DESTROY_SHIPS, units: [ShipType.ZEL]}]
        },
        defeat: {
            targetMap: null,
            conditions: [{type: ObjectiveType.ENEMY_SHIPS_ESCAPED, units: [ShipType.ZEL]}]
        },
        enemyOrders: [
            { type: ShipType.ZEL, order: OrderType.CAPTURE_ESCAPE }
        ],
        tip: `Prevent the heretic ZELs from escaping. Use your ZEL to cleanse corrupted ships.`
    },
    [Maps.AtTheGates]: {
        briefingText: `Destroy all EYEs in the area. Then escape the way you came in.`,
        imageKeyframes: [
            { x: 900, y: 0 },
            { x: 1400, y: -200 },
        ],
        victory: {
            targetMap: Maps.AtTheGates,
            conditions: [{type: ObjectiveType.DESTROY_SHIPS, units:[ShipType.EYE]}, {type: ObjectiveType.ALL_SHIPS_ESCAPED}]
        },
        defeat: {
            targetMap: null,
            conditions: [{type: ObjectiveType.LOSE_ALL_UNITS}]
        },
        tip: `Prevent the heretics from capturing the places of power to spread their message. 
        Use your GAIN class to repurpose nearby hulks for replenishment of the fleet.`
    },
}
