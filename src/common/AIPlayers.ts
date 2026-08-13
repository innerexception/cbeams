import { v4 } from "uuid"
import type MapScene from "../components/scenes/MapScene"
import { useAppStore, AppState } from "./store"
import { Faction, BuildingType, VehicleType, BuildingData } from "../../enum"
import { ENEMY_RAID_SIZE, LOGISTICS_CENTER_COUNT } from "./Constants"

// Every kind the placement phase's second stage unlocks — mirrors FactoryToolbar's own bonus-building
// button row (LogisticsCenter/Base stay out of it: LogisticsCenter has its own dedicated opening-move
// placement above, Base isn't placeable by either side).
const BONUS_BUILDING_KINDS:Array<BuildingType> = [BuildingType.CRAM, BuildingType.BLM, BuildingType.THADD, BuildingType.AmmoDump]

// All of the enemy faction's autonomous behavior lives here, kept out of MapScene's rendering/input
// code. Each function takes the scene as its first argument and reaches back into it only for the
// handful of things a decision actually needs — placement validation, coordinate conversion, sprite
// creation, and the small bit of AI state that lives on the scene itself (enemyShipyardId,
// enemyRaidLaunched, reactedBlmIds) — the same primitives the player's own actions go through, so the
// AI can never place/build anything the player couldn't.

// Finds whichever cell passing `isValid` sits closest to `origin` — shared by every AI placement
// decision that just wants "as close to home as possible" (this file's own opening LogisticsCenter
// placement, and buildEnemyThadd's reactive one).
const findClosestValidCell = (scene:MapScene, origin:{x:number, y:number}, isValid:(x:number, y:number) => boolean) => {
    let best:{x:number, y:number} = null
    let bestDistSq = Infinity

    for(let x=0; x<scene.mapData.width; x++){
        for(let y=0; y<scene.mapData.height; y++){
            if(!isValid(x, y)) continue
            const distSq = (x-origin.x)**2 + (y-origin.y)**2
            if(distSq < bestDistSq){ bestDistSq = distSq; best = { x, y } }
        }
    }
    return best
}

// One-time opening move, mirroring the player's own placement phase: the enemy plants its
// LOGISTICS_CENTER_COUNT starting LogisticsCenters, each on whichever valid, empty cell sits closest
// to its base — placed one at a time so each later one already sees the earlier ones in
// isValidLogisticsPlacement's spacing check, the same rule (and minimum separation) the player's own
// placements go through, just mirrored onto the enemy's own half of the map. The first one placed
// becomes "the" shipyard: the one spawnEnemyRaid queues drones at and checkEnemyRaid launches from.
export const spawnEnemyLogisticsCenters = (scene:MapScene) => {
    const enemyBase = scene.mapData.bases.find(b => b.faction === Faction.Enemy)
    if(!enemyBase) return

    for(let i=0; i<LOGISTICS_CENTER_COUNT; i++){
        const best = findClosestValidCell(scene, enemyBase, (x, y) => scene.isValidLogisticsPlacement(x, y, Faction.Enemy))
        if(!best) return

        const factory:BuildingData = { id:v4(), x:best.x, y:best.y, kind:BuildingType.LogisticsCenter, faction:Faction.Enemy, hp:BuildingData[BuildingType.LogisticsCenter].maxHp }
        useAppStore.getState().addFactory(factory)
        scene.createBuildingSprite(factory)
        if(i === 0) scene.enemyShipyardId = factory.id
    }
}

// One-time opening move, mirroring the player's own placement-phase second stage: the enemy spends
// its entire buildingPoints budget on a random mix of the same kinds the player's toolbar unlocks
// there, each placed on whichever valid, empty cell sits closest to its base (findClosestValidCell,
// the same heuristic spawnEnemyLogisticsCenters uses). Runs all at once, right after
// spawnEnemyLogisticsCenters — the enemy has no interactive phase to spread this over. The guard just
// caps the loop so a map with no room left (or a run of unlucky picks it can't afford) can't spin
// forever; it isn't expected to matter in normal play.
export const spendEnemyBuildingPoints = (scene:MapScene) => {
    const enemyBase = scene.mapData.bases.find(b => b.faction === Faction.Enemy)
    if(!enemyBase) return

    let guard = 0
    while(useAppStore.getState().buildingPoints[Faction.Enemy] > 0 && guard < 100){
        guard++
        const kind = BONUS_BUILDING_KINDS[Math.floor(Math.random()*BONUS_BUILDING_KINDS.length)]
        const cost = BuildingData[kind].buildingPoints
        if(useAppStore.getState().buildingPoints[Faction.Enemy] < cost) continue

        const best = findClosestValidCell(scene, enemyBase, (x, y) => scene.isValidPlacement(kind, x, y, Faction.Enemy))
        if(!best) break

        const factory:BuildingData = { id:v4(), x:best.x, y:best.y, kind, faction:Faction.Enemy, hp:BuildingData[kind].maxHp, ammoRemaining:BuildingData[kind].ammo }
        useAppStore.getState().addFactory(factory)
        scene.createBuildingSprite(factory)
        useAppStore.getState().spendBuildingPoints(Faction.Enemy, cost)
    }
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
// worth of ships loitering by it, gives it standing orders at whichever of the player's
// LogisticsCenters is nearest — the raid's whole purpose is knocking out the player's economy, not
// the (much tougher) Base, and the player always has at least one LogisticsCenter by the time this can
// possibly fire (spawnEnemyRaid, which is what actually queues these ships, only runs once the
// placement phase hands off to combat — see MapScene's startCombatPhase). Standing orders here use the
// same shipyard-orders mechanism the player uses, just driven by the AI instead of a click on the map.
// Runs once (checked every frame, but a no-op after firing) since it can't hook a "ship completed" event.
export const checkEnemyRaid = (scene:MapScene) => {
    if(scene.enemyRaidLaunched || !scene.enemyShipyardId) return

    const { vehicles: ships, buildings, addWaypoint } = useAppStore.getState()
    const massed = ships.filter(s => s.shipyardId === scene.enemyShipyardId).length
    if(massed < ENEMY_RAID_SIZE) return

    const shipyard = buildings.find(f => f.id === scene.enemyShipyardId)
    if(!shipyard) return

    const nearestLogisticsCenter = buildings
        .filter(f => f.faction === Faction.Player && f.kind === BuildingType.LogisticsCenter)
        .reduce((nearest, f) => {
            const distSq = (f.x-shipyard.x)**2 + (f.y-shipyard.y)**2
            return (!nearest || distSq < nearest.distSq) ? { f, distSq } : nearest
        }, null as { f:BuildingData, distSq:number })

    // Falls back to the player's Base only if, somehow, none of their LogisticsCenters exist anymore —
    // not expected in normal play, just a defensive floor so the raid still has somewhere to go.
    const dest = nearestLogisticsCenter ? nearestLogisticsCenter.f : scene.mapData.bases.find(b => b.faction === Faction.Player)
    if(!dest) return

    addWaypoint(scene.enemyShipyardId, dest.x, dest.y)
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
// and the same "closest valid cell to home" heuristic spawnEnemyLogisticsCenters uses. A no-op if
// nowhere valid is found (map fully claimed, or the logistics budget has no room left).
export const buildEnemyThadd = (scene:MapScene) => {
    const enemyBase = scene.mapData.bases.find(b => b.faction === Faction.Enemy)
    if(!enemyBase) return

    const best = findClosestValidCell(scene, enemyBase, (x, y) => scene.isValidPlacement(BuildingType.THADD, x, y, Faction.Enemy))
    if(!best) return

    const factory:BuildingData = { id:v4(), x:best.x, y:best.y, kind:BuildingType.THADD, faction:Faction.Enemy, hp:BuildingData[BuildingType.THADD].maxHp, ammoRemaining:BuildingData[BuildingType.THADD].ammo }
    useAppStore.getState().addFactory(factory)
    scene.createBuildingSprite(factory)
}
