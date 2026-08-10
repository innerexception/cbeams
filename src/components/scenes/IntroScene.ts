import { Scene } from "phaser";
import { SoundEffects } from "../../../enum";

export default class IntroScene extends Scene {

    create = () =>
    {
        this.input.mouse.disableContextMenu()
        const t = this.add.tileSprite(0,0,this.cameras.main.displayWidth*2,this.cameras.main.displayHeight*2, 'parallax').setOrigin(0,0).setScale(1).setScrollFactor(0.8)
        this.tweens.add({
            targets: t,
            tilePositionX: 800,
            tilePositionY: 800,
            duration: 70000,
            repeat:-1
        })
        
        this.cameras.main.setZoom(1)
        //this.sound.get(SoundEffects.Intro).play({loop: true})
    }
    onTransitionIn = () => {
    }
}