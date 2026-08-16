import { Maps, ShipType, SoundEffects } from "../../enum"

export const FONT_DEFAULT = {
    fontFamily: 'Body', 
    fontSize: '8px',
    color:'#55FF55',
}

export const defaultCursor = require('./img/default.png')
export const pointerCursor = require('./img/pointer.png')
export const invalidCursor = require('./img/invalid.png')
export const atkCursor = require('./img/atk.png')
export const iconSheet = require('./img/tiles.png')

export const resources:Array<PhaserResource> = [
    { key: 'logo', resource: require('./logo.png'), type: 'image' },
    { key: 'tiles', resource: iconSheet, type: 'spritesheet', data: { frameWidth: 32, frameHeight: 32 } },
    { key: 'starfield', resource: require('./img/starfield.png'), type: 'image' },
    { key: SoundEffects.Click, resource: require('./audio/click.mp3'), type:'audio'},
    { key: Maps.Sandbox, resource: require('./maps/sandbox.json'), type: 'tilemapTiledJSON'},
    { key: ShipType.GAIN, resource: require('./img/ships/Harvester.png'), type: 'image' },
    { key: ShipType.KK, resource: require('./img/ships/K.png'), type: 'image' },
    { key: ShipType.ZEL, resource: require('./img/ships/KE.png'), type: 'image' },
    { key: ShipType.EYE, resource: require('./img/ships/DRONE.png'), type: 'image' },
    { key: ShipType.CATH, resource: require('./img/ships/baseA.png'), type: 'image' },
    { key: ShipType.SPR, resource: require('./img/ships/DD.png'), type: 'image' },
    { key: ShipType.BOM, resource: require('./img/ships/SSG-icon.png'), type: 'image' },
    { key: 'base_enemy', resource: require('./img/ships/baseB.png'), type: 'image' },
]