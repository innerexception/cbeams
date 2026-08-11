import { ShipType } from '../../enum'

export interface ShipStats {
    name: string
    speed: number
    sightRadius: number
    armor: number
    hp: number
    sizeHex: number
    productionTimeMs: number
}

// KK and ATD are unarmed drones — they don't fire a ranged weapon, they detonate on contact instead
// (see MapScene's updateDrones). MLRS is a proper warship: its salvo-fire behavior (range, cooldown,
// missile stats) lives in Constants.ts alongside CRAM's cannon stats, not here.
// KK: small, fast, fragile kamikaze drone — single-target contact damage, then it's spent.
// ATD: medium drone restricted to a single waypoint — a wide-blast detonation on contact or arrival.
// MLRS: slow, lightly armored rocket ship — launches a 3-missile salvo at its nearest target in range.
export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.KK]: { name:'Kamikaze Drone', speed:90, sightRadius:150, armor:5, hp:5, sizeHex:0.4, productionTimeMs:5000 },
    [ShipType.ATD]: { name:'Area Denial Drone', speed:50, sightRadius:150, armor:10, hp:8, sizeHex:0.6, productionTimeMs:10000 },
    [ShipType.MLRS]: { name:'MLRS', speed:30, sightRadius:200, armor:30, hp:15, sizeHex:1, productionTimeMs:12000 },
}
