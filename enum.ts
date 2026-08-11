export enum Modal {
    NewGame='ng', GameSetup='GameSetup'
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

export enum NodeKind {
    Asteroid='asteroid', Star='star'
}

export enum FactoryKind {
    MiningStation='mining_station', SolarMill='solar_mill', Shipyard='shipyard', CRAM='cram'
}

// KK: a kamikaze drone that self-destructs on contact with the first hostile unit or building it
// reaches, dealing single-target damage. ATD: a guided drone restricted to one waypoint, detonating
// in an area-of-effect blast either on contact or on reaching that waypoint. MLRS: a mobile ship that
// launches a salvo of homing missiles at its nearest target in range (see updateMissiles in MapScene).
export enum ShipType {
    KK='kk', ATD='atd', MLRS='mlrs'
}

// Plain constant values (grid sizing, economy/combat tuning, theme colors, ...) live in
// src/common/Constants.ts, not here — this file is enums only.