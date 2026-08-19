import { Scene } from "phaser";
import { Modal, SceneNames, SoundEffects } from "../../../enum";
import { resources } from "../../assets/Assets";
import { RED_HEX } from "../../common/Constants";
import { onShowModal } from "../../common/Thunks";

export default class LoadingScene extends Scene {

    preload = () =>
    {
        resources.forEach(asset=>{
            (this.load[asset.type] as any)(asset.key, asset.resource, asset.data)
        })
        const loadbar = this.add.graphics()
        loadbar.fillStyle(RED_HEX)
        this.load.on('progress', (value) => {
            loadbar.fillRect(this.cameras.main.centerX-50, this.cameras.main.centerY, value*100, 25)
        });
        this.load.on('complete', () => {
            this.time.addEvent({
                delay:1000,
                callback: () => {
                    this.scene.transition({
                        target: SceneNames.Intro,
                        duration: 0,
                        sleep: true,
                        remove: true,
                        allowInput: false,
                        moveAbove: true,
                        data: null
                    })
                    onShowModal(Modal.NewGame)
                }
            })
        });
    }

    create = () =>
    {
        this.add.image(this.cameras.main.centerX, this.cameras.main.centerY, 'logo').setScale(2)
        this.input.mouse.disableContextMenu()
        Object.keys(SoundEffects).forEach(s=>{
            this.sound.add(s)
        })
    }
}