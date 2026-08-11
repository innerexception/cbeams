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

export enum ResourceType {
    Metal='metal', Energy='energy'
}

export enum TargetType {
    Building='Building',Unit='Unit',Any='Any'
}

export enum ResourceNode {
    Asteroid='asteroid', Star='star'
}

// Base isn't player-placeable — it's the pre-existing headquarters each faction starts the match with,
// promoted into a real building (physics body, hp, drone-contact target) at map load — see
// MapScene's spawnBases. It's otherwise just another FactoryKind: hp loss/destruction works the same way.
export enum BuildingType {
    MiningStation='mining_station', SolarMill='solar_mill', Shipyard='shipyard', CRAM='cram', Base='base', BLM='blm', THADD='thadd'
}

export const BuildingData:Record<BuildingType,BuildingMetaData> = {
    [BuildingType.MiningStation]: { maxHp:40, cooldownMs:0, damage:0, energyCost:2, rangePx:0 },
    [BuildingType.SolarMill]: { maxHp:40, cooldownMs:0, damage:0, energyCost:0, rangePx:0 },
    [BuildingType.Shipyard]: { maxHp:40, cooldownMs:0, damage:0, energyCost:3, rangePx:0 },
    [BuildingType.CRAM]: { maxHp:40, cooldownMs:350, damage:1, energyCost:2, rangePx:320 },
    [BuildingType.Base]: { maxHp:20, cooldownMs:0, damage:0, energyCost:0, rangePx:0 },
    [BuildingType.BLM]: { maxHp:40, cooldownMs:10000, damage:0, energyCost:3, rangePx:4000 },
    [BuildingType.THADD]: { maxHp:40, cooldownMs:10000, damage:0, energyCost:3, rangePx:400 },
}

// KK: a kamikaze drone that self-destructs on contact with the first hostile unit or building it
// reaches, dealing single-target damage. ATD: a guided drone restricted to one waypoint, detonating
// in an area-of-effect blast either on contact or on reaching that waypoint. MLRS: a mobile ship that
// launches a salvo of homing missiles at its nearest target in range (see updateMissiles in MapScene).
export enum VehicleType {
    KK='kk', ATD='atd', MLRS='mlrs'
}

// KK and ATD are unarmed drones — they don't fire a ranged weapon, they detonate on contact instead
// (see MapScene's updateDrones). MLRS is a proper warship: its salvo-fire behavior (range, cooldown,
// missile stats) lives in Constants.ts, not here.
// KK: small, fast, fragile kamikaze drone — single-target contact damage, then it's spent.
// ATD: medium drone restricted to a single waypoint — a wide-blast detonation on contact or arrival.
// MLRS: slow, lightly armored rocket ship — launches a 3-missile salvo at its nearest target in range.
export const VehicleData:Record<VehicleType, VehicleStats> = {
    [VehicleType.KK]: { name:'Kamikaze Drone', speed:90, sightRadius:150, armor:5, hp:5, sizeHex:0.4, productionTimeMs:5000, targetType: TargetType.Any },
    [VehicleType.ATD]: { name:'Area Denial Drone', speed:50, sightRadius:150, armor:10, hp:8, sizeHex:0.6, productionTimeMs:10000, targetType: TargetType.Building },
    [VehicleType.MLRS]: { name:'MLRS', speed:20, sightRadius:200, armor:30, hp:15, sizeHex:1, productionTimeMs:12000, targetType:TargetType.Building },
}

// Plain constant values (grid sizing, economy/combat tuning, theme colors, ...) live in
// src/common/Constants.ts, not here — this file is enums only.