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

// A gatherable map feature — see MapScene's spawnEntitiesFromMap (an AsteroidSpriteIndexesLarge tile on
// the map's entities layer marks where one spawns, the same way BASE_SPRITE_INDEX/ObjectiveSpriteIndex
// tiles mark a Base/Objective) and updateHarvesters for the live gather logic. Holds a finite, depleting
// metal stockpile (see ResourceNodeData in types.d.ts); its own rendered sprite frame is picked live off
// however much of that stockpile is left (see MapScene's asteroidTier), not fixed to whichever of these
// three tiers happened to mark its spawn point.
export const AsteroidSpriteIndexesLarge = [41,46,48]
export const AsteroidSpriteIndexesMed = [40,42,47]
export const AsteroidSpriteIndexesSmall = [39,43,44,45,49,50,51]
export enum ObjectiveSpriteIndex {
    Crypt=86,Shrine=87,NuclearReactor=88
}

export enum ShipType {
    KKZ='KKZ', BOM='BOM', SPR='SPR', EYE='EYE', ZEL='ZEL', CATH='CATH', GAIN='GAIN'
}

// A ship-type spawn marker on the map's entities layer (see MapScene's spawnEntitiesFromMap) — a tile
// with one of these values spawns one of that ShipType at that grid cell for the Player faction when the
// match starts, the same tile-lookup role BASE_SPRITE_INDEX/ObjectiveSpriteIndex play for a
// Base/Objective. Each is its own 3-letter frame in the 'tiles' spritesheet (KK/BOM/SPR/EYE/ZEL/CAT/GAI),
// in the game's green accent color. ShipTypeSpriteIndexEnemy is the same row duplicated in red one tile
// row down, for spawning the Enemy faction's ships instead.
export enum ShipTypeSpriteIndex {
    KKZ=91, BOM=92, SPR=93, EYE=94, ZEL=95, CATH=96, GAIN=97
}
export enum ShipTypeSpriteIndexEnemy {
    KKZ=104, BOM=105, SPR=106, EYE=107, ZEL=108, CATH=109, GAIN=110
}

export const ShipData:Record<ShipType, ShipStats> = {
    [ShipType.KKZ]: { name:'Kindler', speed:90, sightRadius:50, armor:0, hp:5, damage:5, cooldownMs:0, rangePx:0, sizeHex:0.4, productionTimeMs:5000, logisticsCost:1 },
    [ShipType.BOM]: { name:'Area Denial Drone', speed:50, sightRadius:50, armor:0, hp:8, damage:10, cooldownMs:0, rangePx:0, sizeHex:0.6, productionTimeMs:10000, logisticsCost:1 },
    [ShipType.SPR]: { name:'Javelin', speed:20, sightRadius:200, armor:0, hp:15, damage:5, cooldownMs:1500, rangePx:350, sizeHex:1, productionTimeMs:12000, logisticsCost:2, ammo:10 },
    [ShipType.EYE]: { name:'Occulus', speed:20, sightRadius:600, armor:0, hp:5, damage:0, cooldownMs:0, rangePx:0, sizeHex:1, productionTimeMs:12000, logisticsCost:3 },
    [ShipType.ZEL]: { name:'Zealot', speed:12, sightRadius:50, armor:2, hp:25, damage:10, cooldownMs:5000, rangePx:200, sizeHex:1, productionTimeMs:10000, logisticsCost:2 },
    [ShipType.CATH]: { name:'Cathedral', speed:0, sightRadius:300, armor:0, hp:80, damage:0, cooldownMs:0, rangePx:0, sizeHex:2, productionTimeMs:0, logisticsCost:0 },
    [ShipType.GAIN]: { name:'Harvester', speed:12, sightRadius:80, armor:0, hp:10, damage:0, cooldownMs:0, rangePx:0, sizeHex:0.7, productionTimeMs:8000, logisticsCost:1 },
}
