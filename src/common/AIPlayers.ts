import type MapScene from "../components/scenes/MapScene"
import type ShipSprite from "../components/sprites/ShipSprite"
import { Faction, ShipType, ShipData } from "../../enum"
import { ENEMY_RAID_SIZE } from "./Constants"
import { useAppStore } from "./store"

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

// The nearest Objective spawn this faction doesn't already own — the same eligibility moveShips' own
// auto-latch uses (anything not owned by `faction`, including one the *other* faction currently holds, is
// fair game to flip), just without the proximity requirement latching itself needs.
const findNearestCapturableObjectiveSpawn = (scene:MapScene, faction:Faction, x:number, y:number) => {
    const { objectives } = useAppStore.getState()
    let nearest:ObjectiveSpawn = null
    let nearestDist = Infinity
    scene.mapData.objectives.forEach(spawn => {
        const data = objectives.find(o => o.id === spawn.id)
        if(data?.owner === faction) return
        const { x:wx, y:wy } = scene.toWorld(spawn.x, spawn.y)
        const d = Math.hypot(wx-x, wy-y)
        if(d < nearestDist){ nearestDist = d; nearest = spawn }
    })
    return nearest
}

// ZEL: heads for and captures the nearest Objective it doesn't already own. The actual latch-on/capture
// logic all lives on MapScene's own moveShips/updateObjectives — exactly what a player-ordered ZEL goes
// through too — this only ever supplies the travel order needed to get one in range of it. Once latched
// (moveShips has taken over), this leaves it alone entirely rather than re-issuing a route that would
// immediately cancel that latch (see ShipSprite's latchedObjectiveId, cleared by any new order).
export const updateEnemyZel = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.ZEL).forEach(zel => {
        if(zel.latchedObjectiveId) return
        const spawn = findNearestCapturableObjectiveSpawn(scene, zel.faction, zel.x, zel.y)
        if(!spawn) return
        const { x, y } = scene.toWorld(spawn.x, spawn.y)
        routeTowards(scene, zel, x, y)
    })
}

// A ship worth a GAIN's attention: it's actually missing something GAIN can give it (see
// updateHarvesterSupport, which this mirrors exactly), not just "not at max" in some way GAIN has nothing
// to do with.
const needsSupport = (ship:ShipSprite) => ship.hp < ShipData[ship.type].hp
    || (!!ShipData[ship.type].ammo && (ship.ammoRemaining ?? 0) < ShipData[ship.type].ammo)

const findNearestNeedyShip = (scene:MapScene, gain:ShipSprite) => {
    let nearest:ShipSprite = null
    let nearestDist = Infinity
    scene.ships.forEach(s => {
        if(s.id === gain.id || s.faction !== gain.faction || !needsSupport(s)) return
        const d = Math.hypot(s.x-gain.x, s.y-gain.y)
        if(d < nearestDist){ nearestDist = d; nearest = s }
    })
    return nearest
}

const findNearestAsteroid = (x:number, y:number) => {
    const { resourceNodes } = useAppStore.getState()
    let nearest:ResourceNodeData = null
    let nearestDist = Infinity
    resourceNodes.forEach(node => {
        if((node.metal ?? 0) <= 0) return
        const d = Math.hypot(node.x-x, node.y-y)
        if(d < nearestDist){ nearestDist = d; nearest = node }
    })
    return nearest
}

// GAIN: prefers heading for whichever friendly ship nearest it actually needs ammo or repairs — it has to
// be carrying at least some metal to help at all, same requirement updateHarvesterSupport itself has —
// over anything else. Failing that, an empty GAIN heads for the nearest Asteroid still carrying metal and
// mines it there until full (updateHarvesterMiningTargets/updateHarvesters take over automatically once
// it's in range, the same "just supply the travel" split updateEnemyZel above uses for latching). A GAIN
// that's neither empty nor needed anywhere right now is left wherever it already is.
export const updateEnemyGain = (scene:MapScene) => {
    scene.ships.filter(s => s.faction === Faction.Enemy && s.type === ShipType.GAIN).forEach(gain => {
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
