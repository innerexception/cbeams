export enum Modal {
    NewGame='ng', GameSetup='GameSetup', Victory='victory', Defeat='defeat'
}

export enum SceneNames {
    Loading='loading', Main='main', Intro='intro'
}

export enum Layers {
    Land='land'
}

export enum SoundEffects {
    Click='Click'
}

export enum BuildingSpriteIndex {

}

export enum IconIndexes {
    Cancel=1
}

export enum Faction {
    Player='player', Enemy='enemy'
}

export enum TargetType {
    Building='Building',AirUnit='AirUnit',Any='Any',GroundUnit='GroundUnit'
}

// A capturable map feature — see MapGenerator's generateMap (fixed position/sprite, picked once at
// match start) and MapScene's updateObjectives (live capture logic). Purely a economic/strategic point
// of interest, not a military unit or building, so it's kept entirely out of BuildingType/VehicleType
// and doesn't go through the SIDC/milsymbol pipeline (see AppSix.ts) — it renders via its own simple
// hand-drawn icon set instead (see MapScene's generateTextures).
export enum ObjectiveSprite {
    OilField='OilField', City='City', NuclearReactor='NuclearReactor'
}

export enum BuildingType {
    LogisticsCenter='LogisticsCenter', CRAM='CRAM', Base='Base', BLM='BLM', THADD='THADD', AmmoDump='AmmoDump'
}

export const BuildingData:Record<BuildingType,BuildingMetaData> = {
    [BuildingType.LogisticsCenter]: { maxHp:40, cooldownMs:0, damage:0, rangePx:0,  buildingPoints:0 },
    [BuildingType.CRAM]: { maxHp:40, cooldownMs:350, damage:1, rangePx:220, buildingPoints:1 },
    [BuildingType.Base]: { maxHp:20, cooldownMs:0, damage:0, rangePx:0, buildingPoints:0 },
    [BuildingType.BLM]: { maxHp:40, cooldownMs:10000, damage:5, rangePx:4000, buildingPoints:3, ammo:10 },
    [BuildingType.THADD]: { maxHp:40, cooldownMs:10000, damage:0, rangePx:600, buildingPoints:4, ammo:10 },
    // rangePx doubles as its replenishment radius (same convention as CRAM/BLM/THADD's weapon range) and
    // cooldownMs as how often it checks nearby for anything empty (see updateAmmoDumps) — it doesn't
    // attack, so damage stays 0. Its own `ammo` is the total stockpile it has to hand out, over its
    // whole lifetime, before it's just a hull with nothing left to give.
    [BuildingType.AmmoDump]: { maxHp:40, cooldownMs:2000, damage:0, rangePx:100, buildingPoints:2, ammo:20 },
}

export enum VehicleType {
    KK='kk', ATD='atd', MLRS='mlrs', AWACS='AWACS', ARMOR='ARMOR'
}

export const VehicleData:Record<VehicleType, VehicleStats> = {
    [VehicleType.KK]: { name:'Kamikaze Drone', speed:90, sightRadius:50, armor:0, hp:5, damage:5, cooldownMs:0, rangePx:0, sizeHex:0.4, productionTimeMs:5000, targetType: TargetType.Any, logisticsCost:1 },
    [VehicleType.ATD]: { name:'Area Denial Drone', speed:50, sightRadius:50, armor:0, hp:8, damage:10, cooldownMs:0, rangePx:0, sizeHex:0.6, productionTimeMs:10000, targetType: TargetType.Building, logisticsCost:1 },
    [VehicleType.MLRS]: { name:'MLRS', speed:20, sightRadius:200, armor:0, hp:15, damage:5, cooldownMs:1500, rangePx:350, sizeHex:1, productionTimeMs:12000, targetType:TargetType.Building, logisticsCost:2, ammo:10 },
    [VehicleType.AWACS]: { name:'AWACS', speed:20, sightRadius:600, armor:0, hp:15, damage:0, cooldownMs:0, rangePx:0, sizeHex:1, productionTimeMs:12000, targetType:TargetType.Any, logisticsCost:3 },
    [VehicleType.ARMOR]: { name:'ARMOR', speed:10, sightRadius:50, armor:2, hp:25, damage:10, cooldownMs:5000, rangePx:200, sizeHex:1, productionTimeMs:10000, targetType:TargetType.GroundUnit, logisticsCost:2 },
}