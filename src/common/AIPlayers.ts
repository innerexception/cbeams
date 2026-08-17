import type MapScene from "../components/scenes/MapScene"
import { Faction, ShipType } from "../../enum"
import { ENEMY_RAID_SIZE } from "./Constants"

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
