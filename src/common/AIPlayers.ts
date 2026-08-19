import type MapScene from "../components/scenes/MapScene"
import type ShipSprite from "../components/sprites/ShipSprite"
import { DRONE_TYPES } from "../components/scenes/MapScene"
import { Faction, ShipType, ShipData } from "../../enum"
import { ENEMY_RAID_SIZE, NEBULA_SIGHT_RADIUS_PX, AI_ALLIED_SPOTTING_RANGE_PX, CELL_SIZE, OBJECTIVE_CAPTURE_RADIUS_PX } from "./Constants"
import { useAppStore } from "./store"

// See PrimeDirective's own doc comment (types.d.ts) — every default behavior below bails out entirely
// for a ship that has one set, since it overrides all of them.
const hasNoDirective = (s:ShipSprite) => !s.primeDirective

// How far a ship's own AI target search reaches — its own sight radius (accounting for the same nebula
// reduction MapScene's own isWithinFactionSightRange/drawSightRadii use), floored at
// AI_ALLIED_SPOTTING_RANGE_PX so a short-sighted ship still searches out to wherever the fleet's shared
// vision could plausibly have spotted something for it (the actual sighting is still checked per-target
// by isWithinFactionSightRange, which already looks at every friendly ship's own sight radius, not just
// this one's — this only widens how far out that check even gets attempted from).
const effectiveSightRadiusPx = (scene:MapScene, ship:ShipSprite) =>
    Math.max(
        scene.isPointUnderNebula(ship.x, ship.y) ? NEBULA_SIGHT_RADIUS_PX : ShipData[ship.type].sightRadius,
        AI_ALLIED_SPOTTING_RANGE_PX
    )

const clampToMapWorld = (scene:MapScene, x:number, y:number) => ({
    x: Math.max(0, Math.min(scene.mapData.width*CELL_SIZE - 1, x)),
    y: Math.max(0, Math.min(scene.mapData.height*CELL_SIZE - 1, y)),
})

// All of the enemy faction's autonomous behavior lives here, kept out of MapScene's rendering/input
// code. Each function takes the scene as its first argument and reads scene.ships directly (the real,
// authoritative ship data — see ShipSprite's own doc comment) rather than the store's own low-frequency
// summary, since position (needed here) doesn't exist on that summary at all. Ship-mutating decisions
// still go through the exact same MapScene methods (queueShip/addShipWaypoints) the player's own clicks
// and store.ts's delegated actions go through — the AI can never do anything the player couldn't.

// Each faction's actual headquarters ship — wherever the map file's entities layer actually placed it —
// used by checkEnemyRaid as its defensive fallback destination.
const findBase = (scene:MapScene, faction:Faction) => scene.ships.find(s => s.faction === faction && s.type === ShipType.CATH)

// One-time opening move: the enemy Base queues up a handful of kamikaze drones — going through the
// same build queue/production timer as any player-built ship, rather than spawning them for free — and
// then just sits on them once built. checkEnemyRaid is what actually sends them at the player. A no-op
// if the map didn't actually place an enemy Base (enemyBaseId, set by spawnEntitiesFromMap onto it,
// stays unset).
export const spawnEnemyRaid = (scene:MapScene) => {
    if(!scene.enemyBaseId) return
    for(let i=0; i<ENEMY_RAID_SIZE; i++) scene.queueShip(scene.enemyBaseId, ShipType.KKZ)
}

// Watches the enemy Base's own production output and, the moment it has massed a full raid's worth of
// ships loitering by it, gives it standing orders straight at the player's Base — there's no
// LogisticsCenter to aim at instead anymore, the Base is the only thing worth raiding. Standing orders
// here use the same ship-orders mechanism the player uses, just driven by the AI instead of a click on
// the map. Runs once (checked every frame, but a no-op after firing) since it can't hook a "ship
// completed" event.
export const checkEnemyRaid = (scene:MapScene) => {
    if(scene.enemyRaidLaunched || !scene.enemyBaseId) return

    const raidShips = scene.ships.filter(s => s.type === ShipType.KKZ && s.faction === Faction.Enemy)
    if(raidShips.length < ENEMY_RAID_SIZE) return

    const playerBase = findBase(scene, Faction.Player)
    if(!playerBase) return

    // Direct orders straight onto the already-massed drones themselves — a Base never has orders of its
    // own to give (see spawnShip/ShipSprite's waypoints), so this is the only way to actually move them.
    const dest = scene.toGrid(playerBase.x, playerBase.y)
    scene.addShipWaypoints(raidShips.map(s => s.id), dest.x, dest.y)
    scene.enemyRaidLaunched = true
}

// Re-points a ship at a fresh single-waypoint route towards a world position — a thin wrapper over
// MapScene's own setShipWaypoints that only actually issues the order when the destination's grid cell
// has actually changed, so re-evaluating a still-valid target every frame (as every function below does)
// doesn't spam a fresh route onto a ship already correctly headed there — critical for ZEL in particular,
// since a fresh order would cancel an in-progress Objective latch (see updateEnemyZel).
const routeTowards = (scene:MapScene, ship:ShipSprite, worldX:number, worldY:number) => {
    const dest = scene.toGrid(worldX, worldY)
    const current = ship.waypoints[0]
    if(current && current.x === dest.x && current.y === dest.y) return
    scene.setShipWaypoints([ship.id], dest.x, dest.y)
}

// Shared "closest eligible item" scan, used by the three nearest-X searches below.
const findNearest = <T>(items:Iterable<T>, worldX:number, worldY:number, pos:(item:T) => {x:number,y:number}, eligible:(item:T) => boolean) => {
    let nearest:T = null
    let nearestDist = Infinity
    for(const item of items){
        if(!eligible(item)) continue
        const p = pos(item)
        const d = Math.hypot(p.x-worldX, p.y-worldY)
        if(d < nearestDist){ nearestDist = d; nearest = item }
    }
    return nearest
}

// Nearest Objective spawn this faction doesn't already own.
const findNearestCapturableObjectiveSpawn = (scene:MapScene, faction:Faction, x:number, y:number) => {
    const { objectives } = useAppStore.getState()
    return findNearest(scene.mapData.objectives, x, y,
        spawn => scene.toWorld(spawn.x, spawn.y),
        spawn => objectives.find(o => o.id === spawn.id)?.owner !== faction)
}

// A per-ship stable angle (not re-rolled every frame), same deterministic-hash idea as BLADE's own
// stableFlankOffset below, just spread across the full circle instead of a rear half-arc — this is what
// keeps a handful of ZEL routed at the same Objective from all approaching its exact center point and
// getting wedged against each other/applyShipSeparation on the way in.
const stableApproachAngle = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return ((h >>> 0) % 1000) / 1000 * Math.PI * 2
}

// A point exactly `distance` from `target`, along the direction target->from — approaching moves
// straight at the target, retreating (a `distance` larger than the current gap) backs straight away.
const pointAtDistance = (from:{x:number,y:number}, target:{x:number,y:number}, distance:number) => {
    const dx = from.x-target.x, dy = from.y-target.y
    const dist = Math.hypot(dx, dy)
    const ux = dist > 0.001 ? dx/dist : 1, uy = dist > 0.001 ? dy/dist : 0
    return { x: target.x+ux*distance, y: target.y+uy*distance }
}

// Retreats `ship` straight away from `threat`, by roughly its own sight radius, clamped to the map so it
// never routes itself off the edge.
const fleeFrom = (scene:MapScene, ship:ShipSprite, threat:{x:number,y:number}) => {
    const dist = Math.hypot(ship.x-threat.x, ship.y-threat.y)
    const fleePoint = pointAtDistance(ship, threat, dist + ShipData[ship.type].sightRadius)
    const clamped = clampToMapWorld(scene, fleePoint.x, fleePoint.y)
    routeTowards(scene, ship, clamped.x, clamped.y)
}

// Combat types that actually have their own per-frame AI update function below (updateEnemyBeh/
// Husk/Blade) — the only ones that can meaningfully be assigned escort duty, since nothing else ever
// reads scene.escortAssignments to act on it.
const ESCORT_ELIGIBLE_TYPES = new Set([ShipType.BEH, ShipType.HUSK, ShipType.BLADE])

// Keeps scene.escortAssignments (escort ship id -> the ZEL it's protecting) current: drops any pairing
// whose escort or ZEL has died, then assigns the nearest unassigned eligible combat ship to every enemy
// ZEL that doesn't already have a living one — "at least 1" escort per ZEL, never more (an already-
// escorted ZEL is skipped entirely). Called once per frame from updateEnemyZel, ahead of
// updateEnemyBeh/Husk/Blade (see MapScene's update()), so their own escortZel fallback always sees this
// frame's assignments rather than last frame's.
const assignZelEscorts = (scene:MapScene) => {
    const shipsById = new Map(scene.ships.map(s => [s.id, s] as const))
    const zelIds = new Set(scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.ZEL).map(s => s.id))

    scene.escortAssignments.forEach((zelId, escortId) => {
        if(!shipsById.has(escortId) || !zelIds.has(zelId)) scene.escortAssignments.delete(escortId)
    })

    const escortedZelIds = new Set(scene.escortAssignments.values())
    const assignedEscortIds = new Set(scene.escortAssignments.keys())

    zelIds.forEach(zelId => {
        if(escortedZelIds.has(zelId)) return
        const zel = shipsById.get(zelId)
        const candidate = findNearest(scene.ships, zel.x, zel.y, s => s,
            s => s.faction === Faction.Enemy && ESCORT_ELIGIBLE_TYPES.has(s.type) && hasNoDirective(s) && !assignedEscortIds.has(s.id))
        if(!candidate) return
        scene.escortAssignments.set(candidate.id, zelId)
        assignedEscortIds.add(candidate.id)
    })
}

// Falls back to standing near whichever ZEL `ship` is currently assigned to escort (see
// assignZelEscorts) — every combat type below only calls this once it's already confirmed it has no
// hostile target of its own to deal with first, so escort duty never pulls a ship out of a fight it's
// already in. Offset off dead-center by a per-ship stable angle (same idea as ZEL's own
// stableApproachAngle) so escorts of different ZELs — or, once there's ever more than one per ZEL —
// don't all converge on the same point either.
const escortZel = (scene:MapScene, ship:ShipSprite) => {
    const zelId = scene.escortAssignments.get(ship.id)
    if(!zelId) return
    const zel = scene.ships.find(s => s.id === zelId)
    if(!zel) return
    const angle = stableApproachAngle(ship.id)
    const ESCORT_STANDOFF_PX = 40
    const point = { x: zel.x + Math.cos(angle)*ESCORT_STANDOFF_PX, y: zel.y + Math.sin(angle)*ESCORT_STANDOFF_PX }
    const clamped = clampToMapWorld(scene, point.x, point.y)
    routeTowards(scene, ship, clamped.x, clamped.y)
}

// ZEL: unarmed, so a nearby hostile ship (see effectiveSightRadiusPx) is something to flee straight away
// from, ahead of anything else it would otherwise be doing. Failing that, it heads for and captures the
// nearest Objective it doesn't already own — the actual latch-on/capture logic all lives on MapScene's
// own moveShips/updateObjectives, exactly what a player-ordered ZEL goes through too — this only ever
// supplies the travel order needed to get one in range of it. Once latched (moveShips has taken over),
// this leaves it alone entirely rather than re-issuing a route that would immediately cancel that latch
// (see ShipSprite's latchedObjectiveId, cleared by any new order).
export const updateEnemyZel = (scene:MapScene) => {
    assignZelEscorts(scene)

    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.ZEL && hasNoDirective(s)).forEach(zel => {
        const threat = scene.findNearestHostileShip(zel.faction, zel.x, zel.y, effectiveSightRadiusPx(scene, zel))
        if(threat){ fleeFrom(scene, zel, threat); return }

        if(zel.latchedObjectiveId) return
        const spawn = findNearestCapturableObjectiveSpawn(scene, zel.faction, zel.x, zel.y)
        if(!spawn) return
        const { x, y } = scene.toWorld(spawn.x, spawn.y)
        // Routed at a per-ship point on a ring around the Objective, not its exact center — still
        // comfortably inside OBJECTIVE_CAPTURE_RADIUS_PX, so it counts as latched just the same, but
        // several ZEL converging on the same Objective spread out around it instead of all fighting to
        // stand on the one same pixel.
        const angle = stableApproachAngle(zel.id)
        const approachRadius = OBJECTIVE_CAPTURE_RADIUS_PX * 0.4
        const clamped = clampToMapWorld(scene, x + Math.cos(angle)*approachRadius, y + Math.sin(angle)*approachRadius)
        routeTowards(scene, zel, clamped.x, clamped.y)
    })
}

// A ship worth a GAIN's attention: it's actually missing something GAIN can give it (see
// updateHarvesterSupport, which this mirrors exactly), not just "not at max" in some way GAIN has nothing
// to do with.
const needsSupport = (ship:ShipSprite) => ship.hp < ShipData[ship.type].hp
    || (!!ShipData[ship.type].ammo && (ship.ammoRemaining ?? 0) < ShipData[ship.type].ammo)

const findNearestNeedyShip = (scene:MapScene, gain:ShipSprite) =>
    findNearest(scene.ships, gain.x, gain.y, s => s,
        s => s.id !== gain.id && s.faction === gain.faction && needsSupport(s))

const findNearestAsteroid = (x:number, y:number) => {
    const { resourceNodes } = useAppStore.getState()
    return findNearest(resourceNodes, x, y, n => n, n => (n.metal ?? 0) > 0)
}

// GAIN: unarmed like ZEL, so a nearby hostile ship comes first here too (see updateEnemyZel). Otherwise
// it prefers heading for whichever friendly ship nearest it actually needs ammo or repairs — it has to
// be carrying at least some metal to help at all, same requirement updateHarvesterSupport itself has —
// over anything else. Failing that, an empty GAIN heads for the nearest Asteroid still carrying metal and
// mines it there until full (updateHarvesterMiningTargets/updateHarvesters take over automatically once
// it's in range, the same "just supply the travel" split updateEnemyZel above uses for latching). A GAIN
// that's neither empty nor needed anywhere right now is left wherever it already is.
export const updateEnemyGain = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.GAIN && hasNoDirective(s)).forEach(gain => {
        const threat = scene.findNearestHostileShip(gain.faction, gain.x, gain.y, effectiveSightRadiusPx(scene, gain))
        if(threat){ fleeFrom(scene, gain, threat); return }

        if((gain.metalCarried ?? 0) >= 1){
            const needy = findNearestNeedyShip(scene, gain)
            if(needy){
                routeTowards(scene, gain, needy.x, needy.y)
                return
            }
        }

        if((gain.metalCarried ?? 0) > 0) return

        const asteroid = findNearestAsteroid(gain.x, gain.y)
        if(!asteroid) return
        routeTowards(scene, gain, asteroid.x, asteroid.y)
    })
}

// KKZ/BOM: kamikaze drones — the nearest hostile ship within sight is routed straight onto (see
// routeTowards, re-issued fresh every frame as the target moves), so it walks itself into the actual
// physics contact that detonates it (see MapScene's onDroneShipContact/detonateDrone, and BOM's own
// route-end detonation in moveShips) rather than needing any special-cased "collide" logic of its own
// here at all.
export const updateEnemyDrones = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && DRONE_TYPES.has(s.type) && hasNoDirective(s)).forEach(drone => {
        const target = scene.findNearestHostileShip(drone.faction, drone.x, drone.y, effectiveSightRadiusPx(scene, drone))
        if(!target) return
        routeTowards(scene, drone, target.x, target.y)
    })
}

// Comfortably inside a ship's own weapon range, not right on the boundary — floating-point/grid
// quantization could otherwise leave it just outside and never actually firing.
const WEAPON_RANGE_MARGIN = 0.9

// Moves `ship` to within its own weapon range of `target` — retreating too, to hold at exactly max
// range, when `holdAtMaxRange` is set (BEH's own stand-off style); otherwise only ever closes distance,
// never backing off again once already close enough (HUSK's "just get there" style). Firing itself is
// entirely MapScene's own job (updateBeamWeapons) once this has actually gotten a ship into range.
const positionForWeaponRange = (scene:MapScene, ship:ShipSprite, target:{x:number,y:number}, holdAtMaxRange:boolean) => {
    const rangePx = ShipData[ship.type].rangePx * WEAPON_RANGE_MARGIN
    const dist = Math.hypot(ship.x-target.x, ship.y-target.y)
    if(!holdAtMaxRange && dist <= rangePx) return
    const standoff = pointAtDistance(ship, target, rangePx)
    const clamped = clampToMapWorld(scene, standoff.x, standoff.y)
    routeTowards(scene, ship, clamped.x, clamped.y)
}

// BEH: engages at its own max weapon range — approaching if too far, backing off if already closer than
// that, so it never has to eat return fire it doesn't have to. No hostile in sight and it falls back to
// escort duty (see escortZel) if it's been assigned a ZEL to babysit.
export const updateEnemyBeh = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.BEH && hasNoDirective(s)).forEach(ship => {
        const target = scene.findNearestHostileShip(ship.faction, ship.x, ship.y, effectiveSightRadiusPx(scene, ship))
        if(!target){ escortZel(scene, ship); return }
        positionForWeaponRange(scene, ship, target, true)
    })
}

// HUSK: just closes the distance until it's within its own (short) weapon range, then holds — no reason
// to back off once it's already close enough to hit something. Same escort fallback as BEH once there's
// no hostile to deal with.
export const updateEnemyHusk = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.HUSK && hasNoDirective(s)).forEach(ship => {
        const target = scene.findNearestHostileShip(ship.faction, ship.x, ship.y, effectiveSightRadiusPx(scene, ship))
        if(!target){ escortZel(scene, ship); return }
        positionForWeaponRange(scene, ship, target, false)
    })
}

// A per-ship stable angle (not re-rolled every frame) so a given BLADE always works the same side of its
// target's rear arc instead of jittering between them frame to frame — same deterministic-hash idea
// MapScene's own stableAngularPhase uses, just kept local here since it's the only thing that needs it.
const stableFlankOffset = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return (((h >>> 0) % 1000) / 1000 - 0.5) * Math.PI // -90°..+90° off dead-rear
}

// BLADE: continuously maneuvers to a point at its own weapon range, somewhere in the target's rear
// half — never straight in front of it — recomputed every frame off the target's live position and
// facing (a ship's own `rotation` already tracks its current facing, set by moveShips), so it's still
// actively working around to the flank even as the target turns or moves, not just charging once and
// holding. Once it's actually within range, MapScene's own updateBulletWeapons takes it from there. Same
// escort fallback as BEH/HUSK once there's no hostile to deal with.
export const updateEnemyBlade = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.BLADE && hasNoDirective(s)).forEach(ship => {
        const target = scene.findNearestHostileShip(ship.faction, ship.x, ship.y, effectiveSightRadiusPx(scene, ship))
        if(!target){ escortZel(scene, ship); return }

        const targetRearAngle = (target.rotation - Math.PI/2) + Math.PI
        const flankAngle = targetRearAngle + stableFlankOffset(ship.id)
        const rangePx = ShipData[ship.type].rangePx * WEAPON_RANGE_MARGIN
        const flankPoint = { x: target.x + Math.cos(flankAngle)*rangePx, y: target.y + Math.sin(flankAngle)*rangePx }
        const clamped = clampToMapWorld(scene, flankPoint.x, flankPoint.y)
        routeTowards(scene, ship, clamped.x, clamped.y)
    })
}
