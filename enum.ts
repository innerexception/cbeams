export enum Modal {
    NewGame='ng', GameSetup='GameSetup', Briefing='briefing', Victory='victory', Defeat='defeat'
}

export enum SceneNames {
    Loading='loading', Main='main', Intro='intro'
}

export enum SoundEffects {
    Click='Click', Briefing='Briefing', Main='Main',
    Ack1='Ack1', Ack2='Ack2', Ack3='Ack3', Ack4='Ack4', Ack5='Ack5', Ack6='Ack6'
}

// Picked from at random whenever the player selects ship(s) — see Thunks' onSelectShips.
export const ShipAckSounds = [SoundEffects.Ack1, SoundEffects.Ack2, SoundEffects.Ack3, SoundEffects.Ack4, SoundEffects.Ack5, SoundEffects.Ack6]

export enum Maps {
    Ambush='Ambush', Infiltration='Infiltration', AtTheGates='AtTheGates'
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

export const PortalSpriteIndex = 90

export const NebulaResource = {
    117:'nebula1',
    118:'nebula2',
    119:'nebula3'
}

export enum ShipType {
    KKZ='KKZ', BOM='BOM', SPR='SPR', EYE='EYE', ZEL='ZEL', CATH='CATH', GAIN='GAIN',
    DRN='DRN', PDF='PDF', HUSK='HUSK', BEH='BEH', BLADE='BLADE', STL='STL'
}

export const DEFAULT_BUILDABLE = [ShipType.DRN, ShipType.GAIN, ShipType.PDF, ShipType.SPR, ShipType.ZEL]

export enum ObjectiveType {
    DESTROY_SHIPS, CAPTURE_OBJECTIVES, PROTECT_SHIPS, CAPTURE_SHIPS, PROTECT_OBJECTIVES, LOSE_OBJECTIVES, LOSE_UNITS,
    SHIPS_ESCAPED, LOSE_ALL_UNITS, ALL_SHIPS_ESCAPED, ENEMY_SHIPS_ESCAPED
}

export enum OrderType {
    CAPTURE_ESCAPE
}

export enum ShipTypeSpriteIndex {
    KKZ=91, BOM=92, SPR=93, EYE=94, ZEL=95, CATH=96, GAIN=97, PDF=98, DRN=99, BEH=100, STL=101
}
export enum ShipTypeSpriteIndexEnemy {
    KKZ=104, BOM=105, SPR=106, EYE=107, ZEL=108, CATH=109, GAIN=110, PDF=111, DRN=112, BEH=113, STL=114, HUSK=115
}

export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.STL]: { name:'MIRV', speed:10, sightRadius:200, armor:0, hp:10, damage:20, cooldownMs:5000, rangePx:1000, productionTimeMs:5000, relicCost:3, weaponType:'missile',
        burstSize: 1, ammo: 3,
        description: 'Fires missile with extreme range. Manually targeted.',
        portraitIndex: 10
     },
    [ShipType.BLADE]: { name:'Blade', speed:40, sightRadius:150, armor:0, hp:10, damage:1, cooldownMs:500, rangePx:100, productionTimeMs:5000, relicCost:2, weaponType:'bullet',
        burstSize: 1, ammo: 20,
        description: 'Vicious flanker armed with a single nuke',
        portraitIndex: 10
     },
    [ShipType.BEH]: { name:'Beholder', speed:20, sightRadius:250, armor:0, hp:15, damage:1, cooldownMs:2000, rangePx:250, productionTimeMs:5000, relicCost:2, weaponType:'beam',
        burstSize: 1,
        description: 'Beams in the dark require no ammo.',
        portraitIndex: 8
     },
    [ShipType.KKZ]: { name:'Kindler', speed:80, sightRadius:50, armor:0, hp:3, damage:5, cooldownMs:0, rangePx:0, productionTimeMs:5000, relicCost:0,
        description: 'Single use blessings built by DRN. Contact fuse.',
        portraitIndex: 4
     },
    [ShipType.BOM]: { name:'Torch', speed:50, sightRadius:50, armor:0, hp:8, damage:20, cooldownMs:0, rangePx:0, productionTimeMs:10000, relicCost:1,
        description: 'Fusion warhead strapped to whatever space junk can be salvaged. Explodes when movement ends.',
        portraitIndex: 5
     },
    [ShipType.SPR]: { name:'Javelin', speed:20, sightRadius:200, armor:0, hp:15, damage:5, cooldownMs:3000, rangePx:250, productionTimeMs:12000, relicCost:2, ammo:10,
        weaponType:'missile', burstSize:2,
        description: 'Missile carrier, needs replenishment.',
        portraitIndex: 6
     },
    [ShipType.EYE]: { name:'Occulus', speed:20, sightRadius:500, armor:0, hp:5, damage:0, cooldownMs:0, rangePx:0, productionTimeMs:12000, relicCost:3,
        description: 'A great eye.',
        portraitIndex: 7
     },
    [ShipType.ZEL]: { name:'Zealot', speed:12, sightRadius:50, armor:2, hp:25, damage:0, cooldownMs:0, rangePx:0, productionTimeMs:10000, relicCost:2,
        description: 'Carries one mad cypher-preist, opener of doors and master of machine speak.',
        portraitIndex: 8
     },
    [ShipType.CATH]: { name:'Cathedral', speed:0, sightRadius:300, armor:0, hp:80, damage:0, cooldownMs:0, rangePx:0, productionTimeMs:0, relicCost:0,
        description: 'Home',
        portraitIndex: 9
     },
    [ShipType.GAIN]: { name:'Mater', speed:12, sightRadius:80, armor:0, hp:10, damage:0, cooldownMs:0, rangePx:0, productionTimeMs:8000, relicCost:1,
        description: 'Replenishment of the fleet, digests debris into fuel and parts.',
        portraitIndex: 10
     },
     [ShipType.PDF]: { name:'Targe', speed:14, sightRadius:200, armor:0, hp:10, damage:1, cooldownMs:400, rangePx:100, productionTimeMs:8000, relicCost:2,
        weaponType:'bullet', burstSize:1,
        description: 'A thousand needles rise up in defense.',
        portraitIndex: 11
     },
     [ShipType.DRN]: { name:'Stitcher', speed:8, sightRadius:200, armor:0, hp:20, damage:0, cooldownMs:2500, rangePx:0, productionTimeMs:18000, relicCost:5, ammo:4,
        description: "Manufactors KKZ or HUSK from Mater's metals",
        portraitIndex: 12
     },
     [ShipType.HUSK]: {
        name:'Husk', speed:10, sightRadius:100, armor:0, hp:30, damage:1, cooldownMs:500, rangePx:45, productionTimeMs:8000, relicCost:1,
        weaponType:'beam', burstSize:1,
        description: "Deranged machine made from random scraps",
        portraitIndex: 13
     }
}
