import { Physics } from "phaser"
import { Faction, ShipType, ShipData } from "../../../enum"

export default class ShipSprite extends Physics.Arcade.Sprite {
    id: string
    faction: Faction
    type: ShipType

    hp: number
    // Only meaningful for a ship whose ShipStats sets `ammo` (SPR/DRN/PDF's cooldown-gated weapons/
    // production) — undefined for everything else, same as it always was.
    ammoRemaining?: number

    // A ship's own route, followed in order (see MapScene's moveShips) then sat idle at the last point.
    waypoints: Array<{ x:number, y:number }> = []
    pathIndex: number = 0
    // Set whenever an order is given to this ship as part of a group (see store's setShipWaypoints/
    // addShipWaypoints) — the slowest member's own speed at that moment, so the whole group arrives
    // together instead of faster ships pulling ahead. moveShips uses this instead of ShipData[type].speed
    // whenever it's set.
    orderSpeedPxS?: number

    lastFiredAtMs?: number
    // GAIN only — when it last spent metal supporting another ship (ammo or repair), gating that to one
    // action per HARVESTER_RESUPPLY_INTERVAL_MS instead of a continuous per-frame fractional rate.
    lastResupplyAtMs?: number

    // ZEL only — the Objective (ObjectiveData.id) it's currently latched onto, having come within
    // OBJECTIVE_CAPTURE_RADIUS_PX of it. Overrides its normal route entirely while set. objectiveAttached
    // is true only once it's actually reached that Objective's edge, not merely en route there — that,
    // not latchedObjectiveId alone, is what a capture requires before its hold timer even starts.
    latchedObjectiveId?: string
    objectiveAttached?: boolean

    // EYE only — set the instant it finishes its very first route and comes to a stop. From then on it's
    // permanently immobile and can't be given new orders — see moveShips/MapScene's handleClick.
    movementLocked?: boolean

    // GAIN only — how much metal it's currently carrying, up to HARVESTER_METAL_CAPACITY. There's no
    // faction-wide stockpile; this carried amount is the only metal that exists.
    metalCarried?: number

    // Only ever populated on a Base (ShipType.CATH) — filled by store's queueShip, emptied by
    // completeQueueItem/MapScene's tickProduction.
    queue: Array<ProductionQueueItem> = []

    constructor(scene:Phaser.Scene, x:number, y:number, texture:string, id:string, faction:Faction, type:ShipType){
        super(scene, x, y, texture)
        this.id = id
        this.faction = faction
        this.type = type
        this.hp = ShipData[type].hp
        this.ammoRemaining = ShipData[type].ammo
    }

    // A low-frequency snapshot of whatever the store/React actually needs to know about this ship —
    // nothing that changes every frame. See this class's own doc comment for why the split exists.
    toSummary = ():ShipSummary => ({ id:this.id, faction:this.faction, type:this.type, queue:this.queue })

    isAlive = () => this.hp > 0

    // Returns true the instant this damage actually kills it — callers are responsible for the shared
    // "a ship just died" side effects (death fragments, sprite/label cleanup, ending the match if it was
    // a Base) since those live on the scene, not the ship itself.
    takeDamage = (amount:number) => {
        this.hp -= amount
        return this.hp <= 0
    }

    gainAmmo = (amount:number) => {
        const max = ShipData[this.type].ammo
        if(max === undefined) return
        this.ammoRemaining = Math.min(max, (this.ammoRemaining ?? 0) + amount)
    }

    heal = (amount:number) => {
        this.hp = Math.min(ShipData[this.type].hp, this.hp + amount)
    }
}
