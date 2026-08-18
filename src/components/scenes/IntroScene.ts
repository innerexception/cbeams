import { Scene } from "phaser";

export default class IntroScene extends Scene {

    create = () =>
    {
        this.input.mouse.disableContextMenu()
        this.cameras.main.setZoom(1)
    }
}