import { Maps, ShipType, SoundEffects } from "../../enum"

export const FONT_DEFAULT = {
    fontFamily: 'Body', 
    color:'#55FF55',
}

export const defaultCursor = require('./img/default.png')
export const pointerCursor = require('./img/pointer.png')
export const invalidCursor = require('./img/invalid.png')
export const iconSheet = require('./img/tiles.png')

// Background parallax dressing (see MapScene's spawnNebulaLayer) — picked two at random per match, so
// this is just the full pool of art they're drawn from, not anything tied to a specific ShipType/map key.
export const NEBULA_KEYS = ['nebula1', 'nebula2', 'nebula3', 'nebula4', 'nebula5']

export const resources:Array<PhaserResource> = [
    { key: 'logo', resource: require('./logo.png'), type: 'image' },
    { key: 'tiles', resource: iconSheet, type: 'spritesheet', data: { frameWidth: 32, frameHeight: 32 } },
    { key: 'starfield', resource: require('./img/bg.png'), type: 'image' },
    { key: 'nebula1', resource: require('./img/nebulas/nebula1.png'), type: 'image' },
    { key: 'nebula2', resource: require('./img/nebulas/nebula2.png'), type: 'image' },
    { key: 'nebula3', resource: require('./img/nebulas/nebula3.png'), type: 'image' },
    { key: 'nebula4', resource: require('./img/nebulas/nebula4.png'), type: 'image' },
    { key: 'nebula5', resource: require('./img/nebulas/nebula5.png'), type: 'image' },
    { key: SoundEffects.Click, resource: require('./audio/click.mp3'), type:'audio'},
    { key: SoundEffects.Briefing, resource: require('./audio/briefing2.mp3'), type:'audio'},
    { key: SoundEffects.Main, resource: require('./audio/main.mp3'), type:'audio'},
    { key: SoundEffects.Ack1, resource: require('./audio/ack/ack1.mp3'), type:'audio'},
    { key: SoundEffects.Ack2, resource: require('./audio/ack/ack2.mp3'), type:'audio'},
    { key: SoundEffects.Ack3, resource: require('./audio/ack/ack3.mp3'), type:'audio'},
    { key: SoundEffects.Ack4, resource: require('./audio/ack/ack4.mp3'), type:'audio'},
    { key: SoundEffects.Ack5, resource: require('./audio/ack/ack5.mp3'), type:'audio'},
    { key: SoundEffects.Ack6, resource: require('./audio/ack/ack6.mp3'), type:'audio'},
    { key: Maps.Ambush, resource: require('./maps/ambush.json'), type: 'tilemapTiledJSON'},
    { key: Maps.AtTheGates, resource: require('./maps/atthegates.json'), type: 'tilemapTiledJSON'},
    { key: Maps.Infiltration, resource: require('./maps/infiltration.json'), type: 'tilemapTiledJSON'},
    { key: ShipType.GAIN, resource: require('./img/ships/Harvester.png'), type: 'image' },
    { key: ShipType.KKZ, resource: require('./img/ships/K.png'), type: 'image' },
    { key: ShipType.ZEL, resource: require('./img/ships/KE.png'), type: 'image' },
    { key: ShipType.EYE, resource: require('./img/ships/DRONE.png'), type: 'image' },
    { key: ShipType.CATH, resource: require('./img/ships/baseA.png'), type: 'image' },
    { key: ShipType.SPR, resource: require('./img/ships/DD.png'), type: 'image' },
    { key: ShipType.BOM, resource: require('./img/ships/SSG-icon.png'), type: 'image' },
    { key: ShipType.DRN, resource: require('./img/ships/CV.png'), type: 'image' },
    { key: ShipType.PDF, resource: require('./img/ships/FL.png'), type: 'image' },
    { key: ShipType.HUSK, resource: require('./img/ships/husk.png'), type: 'image' },
    { key: ShipType.BEH, resource: require('./img/ships/BEH.png'), type: 'image' },
    { key: ShipType.BLADE, resource: require('./img/ships/BEH.png'), type: 'image' },
    { key: 'base_enemy', resource: require('./img/ships/baseB.png'), type: 'image' },
]
