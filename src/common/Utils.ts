import { ShipType, ShipData } from "../../enum"
import { SAVE_NAME } from "./Constants"

export const tryLoadFile = async () => {
    console.log('using local save: ')
    return JSON.parse(localStorage.getItem(SAVE_NAME)) as SaveFile
}

// Each ship kind's own build cost, spent from the builder's faction's Machine Relics (see store's
// machineRelics/addMachineRelics, awarded by MapScene's updateObjectives and spent by its tickProduction).
export const getShipRelicCost = (type:ShipType) => ShipData[type].relicCost
