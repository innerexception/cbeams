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

// A capturable map feature — see MapScene's spawnEntitiesFromMap (fixed position/sprite, read straight
// off the loaded map file's entities layer) and updateObjectives (live capture logic). Purely an
// economic/strategic point of interest, not a ship, so it's kept entirely out of ShipType — it renders
// via its own frame in the 'tiles' spritesheet instead (see ObjectiveSpriteIndex, MapScene's
// createObjectiveSprite).
export enum ObjectiveSprite {
    Crypt='Crypt', Shrine='Shrine', NuclearReactor='NuclearReactor'
}

// A gatherable map feature — see MapScene's spawnResourceNodes (procedurally scattered at match start,
// there's no reserved tile for these on the map file) and updateHarvesters for the live gather logic.
// Holds a finite, depleting metal stockpile (see ResourceNodeData in types.d.ts).
export const AsteroidSpriteIndexesLarge = [41,46,48]
export const AsteroidSpriteIndexesMed = [40,42,47]
export const AsteroidSpriteIndexesSmall = [39,43,44,45,49,50,51]
export enum ObjectiveSpriteIndex {
    Crypt=86,Shrine=87,NuclearReactor=88
}

export enum ShipType {
    KK='kk', BOM='BOM', SPR='SPR', EYE='EYE', ZEL='ZEL', CATH='CATH', GAIN='GAIN'
}

export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.KK]: { name:'Kindler', speed:90, sightRadius:50, armor:0, hp:5, damage:5, cooldownMs:0, rangePx:0, sizeHex:0.4, productionTimeMs:5000, logisticsCost:1 },
    [ShipType.BOM]: { name:'Area Denial Drone', speed:50, sightRadius:50, armor:0, hp:8, damage:10, cooldownMs:0, rangePx:0, sizeHex:0.6, productionTimeMs:10000, logisticsCost:1 },
    [ShipType.SPR]: { name:'Javelin', speed:20, sightRadius:200, armor:0, hp:15, damage:5, cooldownMs:1500, rangePx:350, sizeHex:1, productionTimeMs:12000, logisticsCost:2, ammo:10 },
    [ShipType.EYE]: { name:'Occulus', speed:20, sightRadius:600, armor:0, hp:5, damage:0, cooldownMs:0, rangePx:0, sizeHex:1, productionTimeMs:12000, logisticsCost:3 },
    [ShipType.ZEL]: { name:'Zealot', speed:12, sightRadius:50, armor:2, hp:25, damage:10, cooldownMs:5000, rangePx:200, sizeHex:1, productionTimeMs:10000, logisticsCost:2 },
    [ShipType.CATH]: { name:'Cathedral', speed:0, sightRadius:300, armor:0, hp:80, damage:0, cooldownMs:0, rangePx:0, sizeHex:2, productionTimeMs:0, logisticsCost:0 },
    [ShipType.GAIN]: { name:'Harvester', speed:12, sightRadius:80, armor:0, hp:10, damage:0, cooldownMs:0, rangePx:0, sizeHex:0.7, productionTimeMs:8000, logisticsCost:1 },
}
