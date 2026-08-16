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
// economic/strategic point of interest, not a ship, so it's kept entirely out of ShipType and doesn't
// go through the SIDC/milsymbol pipeline (see AppSix.ts) — it renders via its own simple hand-drawn
// icon set instead (see MapScene's generateTextures).
export enum ObjectiveSprite {
    Crypt='Crypt', Shrine='Shrine', NuclearReactor='NuclearReactor'
}

// A gatherable map feature — see MapScene's spawnResourceNodes (procedurally scattered at match start,
// there's no reserved tile for these on the map file) and updateHarvesters for the live gather logic.
// An Asteroid holds a finite, depleting metal stockpile (see ResourceNodeData in types.d.ts); a
// GasCloud never depletes — it just raises whichever faction keeps a Harvester near it's logistics cap
// (see Utils' getLogisticsStatus).
export enum ResourceNodeType {
    Asteroid='Asteroid', GasCloud='GasCloud'
}

export const AsteroidSpriteIndexesLarge = [41,46,48]
export const AsteroidSpriteIndexesMed = [40,42,47]
export const AsteroidSpriteIndexesSmall = [39,43,44,45,49,50,51]
export const CloudIndexes = [78,79,80,81]
export enum ObjectiveSpriteIndex {
    Crypt=86,Shrine=87,NuclearReactor=88
}

export enum ShipType {
    KK='kk', ATD='atd', MLRS='mlrs', AWACS='AWACS', ARMOR='ARMOR', Base='Base', Harvester='Harvester'
}

// metalCost is 1 for every ship for now (see store's queueShip, which refuses to queue one a faction
// can't afford and deducts it from that faction's metal stockpile up front).
export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.KK]: { name:'Kindler', speed:90, sightRadius:50, armor:0, hp:5, damage:5, cooldownMs:0, rangePx:0, sizeHex:0.4, productionTimeMs:5000, logisticsCost:1, metalCost:1 },
    [ShipType.ATD]: { name:'Area Denial Drone', speed:50, sightRadius:50, armor:0, hp:8, damage:10, cooldownMs:0, rangePx:0, sizeHex:0.6, productionTimeMs:10000, logisticsCost:1, metalCost:1 },
    [ShipType.MLRS]: { name:'Javelin', speed:20, sightRadius:200, armor:0, hp:15, damage:5, cooldownMs:1500, rangePx:350, sizeHex:1, productionTimeMs:12000, logisticsCost:2, ammo:10, metalCost:1 },
    [ShipType.AWACS]: { name:'Occulus', speed:20, sightRadius:600, armor:0, hp:15, damage:0, cooldownMs:0, rangePx:0, sizeHex:1, productionTimeMs:12000, logisticsCost:3, metalCost:1 },
    [ShipType.ARMOR]: { name:'Zealot', speed:10, sightRadius:50, armor:2, hp:25, damage:10, cooldownMs:5000, rangePx:200, sizeHex:1, productionTimeMs:10000, logisticsCost:2, metalCost:1 },
    [ShipType.Base]: { name:'Base', speed:0, sightRadius:300, armor:0, hp:80, damage:0, cooldownMs:0, rangePx:0, sizeHex:2, productionTimeMs:0, logisticsCost:0, metalCost:1 },
    [ShipType.Harvester]: { name:'Harvester', speed:12, sightRadius:80, armor:0, hp:10, damage:0, cooldownMs:0, rangePx:0, sizeHex:0.7, productionTimeMs:8000, logisticsCost:1, metalCost:1 },
}
