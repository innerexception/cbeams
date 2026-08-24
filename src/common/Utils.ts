import { Maps, ShipType, ShipData } from "../../enum"
import { SAVE_NAME } from "./Constants"

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
