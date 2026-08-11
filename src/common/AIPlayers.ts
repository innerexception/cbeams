import { v4 } from "uuid"
import type MapScene from "../components/scenes/MapScene"
import { useAppStore, AppState } from "./store"
import { Faction, BuildingType, VehicleType, BuildingData } from "../../enum"
import { ENEMY_RAID_SIZE } from "./Constants"

// All of the enemy faction's autonomous behavior lives here, kept out of MapScene's rendering/input
// code. Each function takes the scene as its first argument and reaches back into it only for the
// handful of things a decision actually needs — placement validation, coordinate conversion, sprite
// creation, and the small bit of AI state that lives on the scene itself (enemyShipyardId,
// enemyRaidLaunched, reactedBlmIds) — the same primitives the player's own actions go through, so the
// AI can never place/build anything the player couldn't.

// One-time opening move: the enemy base plants its shipyard on whichever valid, empty cell sits
// closest to its own base — the same "closest valid cell to home" heuristic buildEnemyThadd uses for
// its reactive placement, just run once at the very start of the match.
export const spawnEnemyShipyard = (scene:MapScene) => {
    const enemyBase = scene.mapData.bases.find(b => b.faction === Faction.Enemy)
    if(!enemyBase) return

    let best:{x:number, y:number} = null
    let bestDistSq = Infinity

    for(let x=0; x<scene.mapData.width; x++){
        for(let y=0; y<scene.mapData.height; y++){
            if(!scene.isValidPlacement(BuildingType.LogisticsCenter, x, y, Faction.Enemy)) continue
            const distSq = (x-enemyBase.x)**2 + (y-enemyBase.y)**2
            if(distSq < bestDistSq){ bestDistSq = distSq; best = { x, y } }
        }
    }

    if(!best) return
    const factory:BuildingData = { id:v4(), x:best.x, y:best.y, kind:BuildingType.LogisticsCenter, faction:Faction.Enemy, hp:BuildingData[BuildingType.LogisticsCenter].maxHp }
    useAppStore.getState().addFactory(factory)
    scene.createBuildingSprite(factory)
    scene.enemyShipyardId = factory.id
}

// One-time opening move: the enemy shipyard queues up a handful of kamikaze drones — going through
// the same build queue/production timer as any player-built ship, rather than spawning them for
// free — and then just sits on them once built. checkEnemyRaid is what actually sends them at the player.
export const spawnEnemyRaid = (scene:MapScene) => {
    const { queueShip } = useAppStore.getState()
    if(!scene.enemyShipyardId) return
    for(let i=0; i<ENEMY_RAID_SIZE; i++) queueShip(scene.enemyShipyardId, VehicleType.KK)
}

// Watches the enemy shipyard's own production output and, the moment it has massed a full raid's
// worth of ships loitering by it, gives it standing orders at the player's base — the same
// shipyard-orders mechanism the player uses, just driven by the AI instead of a click on the map.
// Runs once (checked every frame, but a no-op after firing) since it can't hook a "ship completed" event.
export const checkEnemyRaid = (scene:MapScene) => {
    if(scene.enemyRaidLaunched || !scene.enemyShipyardId) return

    const { vehicles: ships, addWaypoint } = useAppStore.getState()
    const massed = ships.filter(s => s.shipyardId === scene.enemyShipyardId).length
    if(massed < ENEMY_RAID_SIZE) return

    const playerBase = scene.mapData.bases.find(b => b.faction === Faction.Player)
    if(!playerBase) return

    addWaypoint(scene.enemyShipyardId, playerBase.x, playerBase.y)
    scene.enemyRaidLaunched = true
}

// Reactive defense: fires off the store subscription in MapScene's create(), so it's checked on every
// state change rather than polled per frame. The moment a player BLM the enemy hasn't seen before
// shows up in the store — built, not just queued — the enemy responds by building a THADD of its own
// (see buildEnemyThadd). Tracking reacted-to ids rather than a count means a BLM that's destroyed and
// later rebuilt still draws a fresh response.
export const checkEnemyBlmDefense = (scene:MapScene, state:AppState) => {
    const newPlayerBlms = state.buildings.filter(b => b.faction === Faction.Player && b.kind === BuildingType.BLM && !scene.reactedBlmIds.has(b.id))
    newPlayerBlms.forEach(b => {
        scene.reactedBlmIds.add(b.id)
        buildEnemyThadd(scene)
    })
}

// Places a THADD as close to the enemy's own base as any currently-valid cell allows — the same
// isValidPlacement gate everything else builds through (territory, logistics budget, no overlap),
// and the same "closest valid cell to home" heuristic spawnEnemyShipyard uses. A no-op if nowhere
// valid is found (map fully claimed, or the logistics budget has no room left).
export const buildEnemyThadd = (scene:MapScene) => {
    const enemyBase = scene.mapData.bases.find(b => b.faction === Faction.Enemy)
    if(!enemyBase) return

    let best:{x:number, y:number} = null
    let bestDistSq = Infinity

    for(let x=0; x<scene.mapData.width; x++){
        for(let y=0; y<scene.mapData.height; y++){
            if(!scene.isValidPlacement(BuildingType.THADD, x, y, Faction.Enemy)) continue
            const distSq = (x-enemyBase.x)**2 + (y-enemyBase.y)**2
            if(distSq < bestDistSq){ bestDistSq = distSq; best = { x, y } }
        }
    }

    if(!best) return
    const factory:BuildingData = { id:v4(), x:best.x, y:best.y, kind:BuildingType.THADD, faction:Faction.Enemy, hp:BuildingData[BuildingType.THADD].maxHp }
    useAppStore.getState().addFactory(factory)
    scene.createBuildingSprite(factory)
}
