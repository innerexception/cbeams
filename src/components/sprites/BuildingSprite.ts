import { GameObjects, Scene } from "phaser"
import { BuildingSpriteIndex } from "../../../enum"

export default class BuildingSprite extends GameObjects.Sprite {

    id:string
    icon:GameObjects.Sprite

    constructor(scene:Scene, x:number, y:number, texture:BuildingSpriteIndex, id:string){
        super(scene, x, y, texture.toString())
        scene.add.existing(this)
        this.setInteractive()
        this.setOrigin(0)
        this.setDepth(2)
        this.id = id
        if(this.anims.animationManager.exists(texture.toString())) {
            try{
                this.anims.play(texture.toString())
            }
            catch(e){
                
            }
        }
    }

    showPowered = (active:boolean) => {
        this.icon?.destroy()
        if(!active){
            this.icon = this.scene.add.sprite(this.getCenter().x, this.getCenter().y-15, 'nopower').setDepth(2)
            this.icon.play('nopower')
        } 
    }

    showEmpty = () => {
        this.icon?.destroy()
        this.icon = this.scene.add.sprite(this.getCenter().x, this.getCenter().y-15, 'empty').setDepth(2)
        this.icon.play('empty')
    }

    destroy(){
        super.destroy()
        this.icon?.destroy()
    }
}