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
    Intro='Intro',Main='Main',Click='Click'
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

export const MAP_SIZE = 50
export const CELL_SIZE = 20

export const BASE_MAX_ENERGY = 10
export const ENERGY_PER_MINING_STATION = 2
export const ENERGY_PER_SOLAR_MILL = 0
export const ENERGY_PER_SHIPYARD = 3
export const SOLAR_MILL_MAX_ENERGY_BONUS = 10
export const METAL_PER_MINING_STATION = 1
export const METAL_TICK_MS = 3000
export const MAX_WAYPOINTS = 5

export const SAVE_NAME='xeno3_save'