import { SoundEffects } from "../../enum"

export const FONT_DEFAULT = {
    fontFamily: 'Body', 
    fontSize: '8px',
    color:'#55FF55',
}

export const defaultCursor = require('./img/default.png')
export const pointerCursor = require('./img/pointer.png')
export const invalidCursor = require('./img/invalid.png')
export const atkCursor = require('./img/atk.png')
export const iconSheet = require('./img/icons.png')

export const resources:Array<PhaserResource> = [
    // { key: 'tiles', resource: require('./images/Tileset_ext.png'), type: 'image' },
    // { key: 'items', resource: iconSheet, type: 'spritesheet', data: { frameWidth: 16, frameHeight: 16 } },
    { key: SoundEffects.Click, resource: require('./audio/click.mp3'), type:'audio'},
    // { key: Maps.intro, resource: require('./maps/intro.json'), type: 'tilemapTiledJSON'},
]

export const UIElements = {
    decalEngine: require('./img/ui/decalEngine.png'),
    decalWires: require('./img/ui/decalWires.png'),
    decalSphere: require('./img/ui/decalSphere.png'),
    equipBtn: require("./img/ui/skillBtn.png"),
    equipBtnDrk: require("./img/ui/skillBtnDark.png"),
    dlgBottom:require('./img/ui/dlgBottom.png'),
    dlgBottomP:require('./img/ui/dlgBottomP.png'),
    dlgBottomPR:require('./img/ui/dlgBottomPR.png'),
    dlgBottomLeft: require('./img/ui/dlgBottomLeft.png'),
    dlgBottomLeftP: require('./img/ui/dlgBottomLeftP.png'),
    dlgBottomLeftPR: require('./img/ui/dlgBottomLeftPR.png'),
    dlgBottomRight:require('./img/ui/dlgBottomRight.png'),
    dlgBottomRightP:require('./img/ui/dlgBottomRightP.png'),
    dlgBottomRightPR:require('./img/ui/dlgBottomRightPR.png'),
    dlgBottomLeftS:require('./img/ui/dlgBottomLeftS.png'),
    dlgBottomRightS:require('./img/ui/dlgBottomRightS.png'),
    dlgLeft:require('./img/ui/dlgLeft.png'),
    dlgLeftP:require('./img/ui/dlgLeftP.png'),
    dlgLeftPR:require('./img/ui/dlgLeftPR.png'),
    dlgRight:require('./img/ui/dlgRight.png'),
    dlgRightP:require('./img/ui/dlgRightP.png'),
    dlgRightPR:require('./img/ui/dlgRightPR.png'),
    dlgTop:require('./img/ui/dlgTop.png'),
    dlgTopP:require('./img/ui/dlgTopP.png'),
    dlgTopPR:require('./img/ui/dlgTopPR.png'),
    dlgTopLeft:require('./img/ui/dlgTopLeft.png'),
    dlgTopLeftP:require('./img/ui/dlgTopLeftP.png'),
    dlgTopLeftPR:require('./img/ui/dlgTopLeftPR.png'),
    dlgTopRight:require('./img/ui/dlgTopRight.png'),
    dlgTopRightP:require('./img/ui/dlgTopRightP.png'),
    dlgTopRightPR:require('./img/ui/dlgTopRightPR.png'),
    dlgTopLeftS:require('./img/ui/dlgTopLeftS.png'),
    dlgTopRightS:require('./img/ui/dlgTopRightS.png'),
    dlgLeftS:require('./img/ui/dlgLeftS.png'),
    dlgRightS:require('./img/ui/dlgRightS.png'),
    dlgBottomS:require('./img/ui/dlgBottomS.png'),
    dlgTopS:require('./img/ui/dlgTopS.png'),
    dlgBg:require('./img/ui/Base2.png'),
    btnBg:require('./img/ui/btnBg.png'),
    btnBgL:require('./img/ui/btnBgLeft.png'),
    btnBgR:require('./img/ui/btnBgRight.png'),
    decalSmolDark: require('./img/ui/decalSmolDark.png'),
    decalSmolDarkLeft: require('./img/ui/decalSmolDarkLeft.png'),
    decalMed: require('./img/ui/decalMed.png'),
    decalMedUp: require('./img/ui/decalMedUp.png'),
    decalSmolLeft: require('./img/ui/decalSmolLeft.png'),
    decalSmol: require('./img/ui/decalSmol.png'),
    decalL: require('./img/ui/decalL.png'),
    decalMedLeft: require('./img/ui/decalMedLeft.png'),
    decalR: require('./img/ui/decalR.png'),
    decalSmolRight: require('./img/ui/decalSmolRight.png'),
    decalwhale:require('./img/ui/decalOS.png'),
    decalShinyTopLeft:require('./img/ui/decalShinyTopLeft.png'),
    decalBottomRight: require('./img/ui/decalShinyBottomRight.png'),
    decalShiny:require('./img/ui/equipBtn.png'),
    decalLargeTopLeft:require('./img/ui/decalLargeTopLeft.png'),
    screen:require('./img/ui/screen.png')
}