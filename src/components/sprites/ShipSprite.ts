import { Physics } from "phaser"
import { Faction, ShipType, ShipData } from "../../../enum"

export default class ShipSprite extends Physics.Arcade.Sprite {
    id: string
    faction: Faction
    type: ShipType

    hp: number
    killCount: number = 0
    rank: number = 0
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
    // AI only — timestamp of the last retreat order. See AIPlayers' fleeFrom.
    lastFleeOrderAtMs?: number
    // Where (and when) this ship was last actually hit for damage, set by MapScene wherever takeDamage is
    // called — not just "who hit it", since drones/beams/missiles/bullets have all fully resolved (or
    // even destroyed themselves) by the time an escort would react. AI only — see AIPlayers' escortZel,
    // which sends an escort here instead of just standing by, e.g. when the attacker is out of the
    // escort's own sight but the ship it's protecting still saw it coming.
    lastAttackedFrom?: { x:number, y:number }
    lastAttackedAtMs?: number
    // GAIN only — when it last spent metal supporting another ship (ammo or repair), gating that to one
    // action per HARVESTER_RESUPPLY_INTERVAL_MS instead of a continuous per-frame fractional rate.
    lastResupplyAtMs?: number

    // ZEL only — the Objective (ObjectiveData.id) it's currently latched onto, having come within
    // OBJECTIVE_CAPTURE_RADIUS_PX of it. Overrides its normal route entirely while set. objectiveAttached
    // is true only once it's actually reached that Objective's edge, not merely en route there — that,
    // not latchedObjectiveId alone, is what a capture requires before its hold timer even starts.
    latchedObjectiveId?: string
    objectiveAttached?: boolean

    // ZEL ship capture mirrors its Objective latch: the ZEL holds the target id and timer, while the
    // target points back to its captor.  The latter makes the movement/weapon lock cheap and unambiguous.
    latchedShipId?: string
    shipCaptureAttached?: boolean
    shipCaptureStartedAtMs?: number
    latchedByZelId?: string

    // AI only — set true the instant this ship completes a ship capture while under a CAPTURE_ESCAPE
    // enemyOrder (see MapScene's updateShipCaptures, which sets it, and AIPlayers' updateEnemyCaptureEscape,
    // which reads it to switch from hunting a ship to running for the nearest Portal). Never set — and
    // never checked — for a ship without that order, so it has no effect on a player-controlled ZEL's
    // ability to capture more than once.
    captureEscapeDone?: boolean

    // however close by it still is, so "disengage and move towards the order" actually sticks instead of
    // snapping straight back the moment it goes idle again. Cleared the instant it latches onto anything
    // else, so it's a one-shot "don't immediately backtrack", not a standing ban.
    avoidLatchId?: string

    // EYE only — set the instant it finishes its very first route and comes to a stop. From then on it's
    // permanently immobile and can't be given new orders — see moveShips/MapScene's handleClick.
    movementLocked?: boolean

    // GAIN only — how much metal it's currently carrying, up to HARVESTER_METAL_CAPACITY. There's no
    // faction-wide stockpile; this carried amount is the only metal that exists.
    metalCarried?: number

    // Only ever populated on a Base (ShipType.CATH) — filled by store's queueShip, emptied by
    // completeQueueItem/MapScene's tickProduction.
    queue: Array<ProductionQueueItem> = []

    // See PrimeDirective's own doc comment (types.d.ts) — overrides every default AI behavior in
    // AIPlayers.ts while set.
    primeDirective?: PrimeDirective

    constructor(scene:Phaser.Scene, x:number, y:number, texture:string, id:string, faction:Faction, type:ShipType, veteran?:VeteranShip){
        super(scene, x, y, texture)
        this.id = id
        this.faction = faction
        this.type = type
        this.hp = ShipData[type].hp
        this.ammoRemaining = ShipData[type].ammo
        this.killCount = veteran?.killCount ?? 0
        this.rank = veteran?.rank ?? 0
    }

    // A low-frequency snapshot of whatever the store/React actually needs to know about this ship —
    // nothing that changes every frame. See this class's own doc comment for why the split exists.
    toSummary = ():ShipSummary => ({ id:this.id, faction:this.faction, type:this.type, killCount:this.killCount, rank:this.rank, queue:this.queue })

    toVeteran = ():VeteranShip => ({ type:this.type, killCount:this.killCount, rank:this.rank })

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
