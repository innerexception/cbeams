export enum Modal {
    NewGame='ng', GameSetup='GameSetup', Victory='victory', Defeat='defeat'
}

export enum SceneNames {
    Loading='loading', Main='main', Intro='intro'
}

export enum SoundEffects {
    Click='Click'
}

export enum Maps {
    Sandbox='Sandbox'
}

export enum IconIndexes {
    Cancel=1
}

export enum Faction {
    Player='player', Enemy='enemy'
}

export enum ObjectiveSprite {
    Crypt='Crypt', Shrine='Shrine', NuclearReactor='NuclearReactor'
}

export const AsteroidSpriteIndexesLarge = [41,46,48]
export const AsteroidSpriteIndexesMed = [40,42,47]
export const AsteroidSpriteIndexesSmall = [39,43,44,45,49,50,51]
export enum ObjectiveSpriteIndex {
    Crypt=86,Shrine=87,NuclearReactor=88
}

export enum ShipType {
    KKZ='KKZ', BOM='BOM', SPR='SPR', EYE='EYE', ZEL='ZEL', CATH='CATH', GAIN='GAIN',
    DRN='DRN', PDF='PDF', HUSK='HUSK'
}

export enum ShipTypeSpriteIndex {
    KKZ=91, BOM=92, SPR=93, EYE=94, ZEL=95, CATH=96, GAIN=97, PDF=98, DRN=99
}
export enum ShipTypeSpriteIndexEnemy {
    KKZ=104, BOM=105, SPR=106, EYE=107, ZEL=108, CATH=109, GAIN=110, PDF=111, DRN=112
}

export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.KKZ]: { name:'Kindler', speed:90, sightRadius:50, armor:0, hp:5, damage:5, cooldownMs:0, rangePx:0, sizeHex:0.3, productionTimeMs:5000, relicCost:0,
        description: 'Single use blessings built by DRN. Contact fuse.'
     },
    [ShipType.BOM]: { name:'Torch', speed:50, sightRadius:50, armor:0, hp:8, damage:10, cooldownMs:0, rangePx:0, sizeHex:0.6, productionTimeMs:10000, relicCost:1,
        description: 'Fusion warhead strapped to whatever space junk can be salvaged. Explodes when movement ends.'
     },
    [ShipType.SPR]: { name:'Javelin', speed:20, sightRadius:200, armor:0, hp:15, damage:5, cooldownMs:3000, rangePx:250, sizeHex:1, productionTimeMs:12000, relicCost:2, ammo:10,
        weaponType:'missile', burstSize:3,
        description: 'Missile carrier, needs replenishment.'
     },
    [ShipType.EYE]: { name:'Occulus', speed:20, sightRadius:600, armor:0, hp:5, damage:0, cooldownMs:0, rangePx:0, sizeHex:1, productionTimeMs:12000, relicCost:3,
        description: 'A great eye.'
     },
    [ShipType.ZEL]: { name:'Zealot', speed:12, sightRadius:50, armor:2, hp:25, damage:0, cooldownMs:0, rangePx:0, sizeHex:1, productionTimeMs:10000, relicCost:2,
        description: 'Carries one mad cypher-preist, opener of doors and master of machine speak.'
     },
    [ShipType.CATH]: { name:'Cathedral', speed:0, sightRadius:300, armor:0, hp:80, damage:0, cooldownMs:0, rangePx:0, sizeHex:2, productionTimeMs:0, relicCost:0,
        description: 'Home'
     },
    [ShipType.GAIN]: { name:'Mater', speed:12, sightRadius:80, armor:0, hp:10, damage:0, cooldownMs:0, rangePx:0, sizeHex:0.7, productionTimeMs:8000, relicCost:1,
        description: 'Replenishment of the fleet, digests debris into fuel and parts.'
     },
     [ShipType.PDF]: { name:'Targe', speed:14, sightRadius:200, armor:0, hp:10, damage:1, cooldownMs:500, rangePx:100, sizeHex:0.7, productionTimeMs:8000, relicCost:2,
        weaponType:'bullet', burstSize:1, ammo:20,
        description: 'A thousand needles rise up in defense.'
     },
     [ShipType.DRN]: { name:'Center', speed:8, sightRadius:200, armor:0, hp:20, damage:0, cooldownMs:2500, rangePx:0, sizeHex:1, productionTimeMs:18000, relicCost:5, ammo:4,
        description: "Manufactors KKZ from Mater's metals"
     },
     [ShipType.HUSK]: {
        name:'Husk', speed:8, sightRadius:100, armor:0, hp:30, damage:1, cooldownMs:500, rangePx:40, sizeHex:1, productionTimeMs:8000, relicCost:1,
        weaponType:'beam', burstSize:1,
        description: "Deranged machine made from random scraps"
     }
}
