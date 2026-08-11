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
    MiningStation='mining_station', SolarMill='solar_mill', Shipyard='shipyard'
}

export enum ShipType {
    CRV='crv', DDG='ddg', CC='cc'
}

// Plain constant values (grid sizing, economy/combat tuning, theme colors, ...) live in
// src/common/Constants.ts, not here — this file is enums only.