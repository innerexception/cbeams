import { Maps, ShipType, ShipData } from "../../enum"
import { SAVE_NAME, TWO_PI } from "./Constants"

// A deterministic per-id value in [0, 1) — the same id always hashes to the same value (unlike
// Math.random()), so a per-ship visual variation (a stand-off angle, an approach point on a ring
// around an Objective, ...) stays stable frame to frame instead of re-rolling randomly, while still
// spreading different ships/pairs out from each other. Just a simple string hash, not real randomness —
// see MapScene's applyShipSeparation and AIPlayers' escortZel/updateEnemyZel/updateEnemyBlade for the
// actual per-ship spreads built on top of it.
export const stableHash01 = (id:string) => {
    let h = 0
    for(let i=0; i<id.length; i++) h = (h*31 + id.charCodeAt(i)) | 0
    return ((h >>> 0) % 1000) / 1000
}

// A full-circle stable angle for `id` (see stableHash01) — spreads ships sharing a single destination
// (an Objective, an escorted ZEL, a mining Asteroid, ...) around it instead of all converging on the
// exact same point.
export const stableAngularPhase = (id:string) => stableHash01(id) * TWO_PI

const isSaveFile = (value:unknown):value is SaveFile => {
    if(!value || typeof value !== 'object') return false
    const save = value as Partial<SaveFile>
    return Object.values(Maps).includes(save.currentMap as Maps)
        && Array.isArray(save.completedMaps)
        && save.completedMaps.every(map => Object.values(Maps).includes(map))
        && Array.isArray(save.veteranShips)
        && save.veteranShips.every(ship => typeof ship?.type === 'string'
            && typeof ship.killCount === 'number' && typeof ship.rank === 'number')
}

export const tryLoadFile = ():SaveFile | null => {
    const serialized = localStorage.getItem(SAVE_NAME)
    if(!serialized) return null
    try {
        const save = JSON.parse(serialized)
        return isSaveFile(save) ? save : null
    } catch {
        return null
    }
}

export const saveFile = (save:SaveFile) => localStorage.setItem(SAVE_NAME, JSON.stringify(save))

// Each ship kind's own build cost, spent from the builder's faction's Machine Relics (see store's
// machineRelics/addMachineRelics, awarded by MapScene's updateObjectives and spent by its tickProduction).
export const getShipRelicCost = (type:ShipType) => ShipData[type].relicCost
