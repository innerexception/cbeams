import { ShipType } from '../../enum'

export interface ShipStats {
    name: string
    speed: number
    sightRadius: number
    weaponRange: number
    weaponType: 'gun' | 'missile'
    armor: number
    sizeHex: number
    productionTimeMs: number
}

// CRV (Corvette): fast scout with short-range guns and a wide sight radius.
// DDG (Destroyer): medium speed, very long range missiles.
// CC (Cruiser): slow, heavily armored, medium range guns.
export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.CRV]: { name:'Corvette', speed:120, sightRadius:300, weaponRange:80, weaponType:'gun', armor:20, sizeHex:0.5, productionTimeMs:6000 },
    [ShipType.DDG]: { name:'Destroyer', speed:70, sightRadius:180, weaponRange:350, weaponType:'missile', armor:50, sizeHex:1, productionTimeMs:12000 },
    [ShipType.CC]: { name:'Cruiser', speed:40, sightRadius:150, weaponRange:150, weaponType:'gun', armor:120, sizeHex:1.5, productionTimeMs:20000 },
}
