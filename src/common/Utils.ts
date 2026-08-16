import { GameObjects, Geom, Scene, Tilemaps } from "phaser"
import { useAppStore } from './store';
import { Faction, ShipType, ShipData, ResourceNodeType } from "../../enum"
import { SAVE_NAME, BASE_LOGISTICS_FLOOR, LOGISTICS_PER_GAS_CLOUD, HARVESTER_RANGE_PX } from "./Constants"

// Simple deterministic PRNG so a shape derived from a stable id (a resource node, a piece of ship
// wreckage, ...) redraws identically frame to frame instead of jittering with fresh randomness.
// Tolerates a missing/non-string seed (falls back to '', still fully deterministic) rather than
// throwing — every caller here derives its seed from a ship/entity id that should always be a real
// string, but this stays defensive against whatever stale/malformed data slips through regardless.
export const seededRandom = (seed:string) => {
    let h = 0
    const s = seed ?? ''
    for(let i=0; i<s.length; i++) h = (h*31 + s.charCodeAt(i)) | 0
    return () => {
        h = (h*1664525 + 1013904223) | 0
        return ((h >>> 0) / 0xffffffff)
    }
}

export const tryLoadFile = async () => {
    //try{
        // const payload = await ipcRenderer.invoke('load')
        // return JSON.parse(payload) as SaveFile
    //}
    //catch(e){
        console.log('using local save: ')
        return JSON.parse(localStorage.getItem(SAVE_NAME)) as SaveFile
    //}
}

// Each ship kind's own logistics upkeep.
export const getShipLogisticsCost = (type:ShipType) => ShipData[type].logisticsCost

// Each ship kind's own up-front metal price (see store's queueShip, which deducts it from the building
// faction's stockpile the instant it's queued, and refuses to queue anything that faction can't afford).
export const getShipMetalCost = (type:ShipType) => ShipData[type].metalCost

// Shared by the HUD and ship production so both agree on remaining logistics capacity — every deployed
// ship (a faction's Base included, though its own logisticsCost is 0) draws against the same budget.
// That budget itself is no longer a flat number: it's BASE_LOGISTICS_FLOOR plus LOGISTICS_PER_GAS_CLOUD
// for every GasCloud this faction currently has at least one Harvester within HARVESTER_RANGE_PX of —
// stacking more than one Harvester on the same cloud doesn't count it twice.
export const getLogisticsStatus = (faction:Faction = Faction.Player) => {
    const { ships, resourceNodes } = useAppStore.getState()
    const ownShips = ships.filter(s => s.faction === faction)
    const ownHarvesters = ownShips.filter(s => s.type === ShipType.Harvester)

    const gasCloudsCovered = resourceNodes.filter(n => n.kind === ResourceNodeType.GasCloud
        && ownHarvesters.some(h => Math.hypot(h.x-n.x, h.y-n.y) <= HARVESTER_RANGE_PX)).length

    const maxLogistics = BASE_LOGISTICS_FLOOR + LOGISTICS_PER_GAS_CLOUD * gasCloudsCovered
    const logisticsUsed = ownShips.reduce((sum, s) => sum + getShipLogisticsCost(s.type), 0)
    const logisticsRemaining = maxLogistics - logisticsUsed
    return { maxLogistics, logisticsUsed, logisticsRemaining }
}

export const drawCirclePercent = (x:number, y:number, g:GameObjects.Graphics, percent:number) => {
    let points = new Geom.Ellipse(x, y, 6, 4).getPoints(25)
    g.clear()
    g.lineStyle(4, 0xffffff)
    g.strokePoints(points.slice(0, Math.round(25*percent)))
    g.lineStyle(1, 0x000000)
    g.strokeEllipse(x, y, 10, 8)
    g.strokeEllipse(x, y, 4, 2)
}

const rect_dim = 32

export const transitionOut = (scene:Scene, nextScene:string, cb:Function) => {
    let rects = []
    let rows = scene.cameras.default.width/rect_dim
    let cols = scene.cameras.default.height/rect_dim
    for(var i=0; i<=rows*2; i++){
        for(var j=0; j<=cols*2; j++){
            let rect = scene.add.image(i*rect_dim, j*rect_dim, 'black')
            rect.setDisplaySize(rect_dim,rect_dim).setDepth(5).setVisible(false)
            rects.push(rect)
        } 
    }
    rects.forEach(r=>{
        scene.time.addEvent({
            delay: Phaser.Math.Between(250,750),
            callback: ()=>{
                r.setVisible(true)
            }
        })
    })
    scene.time.addEvent({
        delay: 800,
        callback:()=>{
            scene.scene.sendToBack(scene.scene.key)
            scene.scene.sleep(scene.scene.key)
            scene.scene.start(nextScene)
            scene.scene.bringToTop(nextScene)
            cb()
            scene.time.addEvent({
                delay:200,
                callback:()=>{
                    rects.forEach(r=>r.destroy())
                }
            })
        }
    })
}

export const transitionIn = (scene:Scene) => {
    let rects = []
    let rows = scene.cameras.default.width/rect_dim
    let cols = scene.cameras.default.height/rect_dim
    for(var i=0; i<=rows; i++){
        for(var j=0; j<=cols; j++){
            let rect = scene.add.image(i*rect_dim, j*rect_dim, 'black')
            rect.setDisplaySize(rect_dim,rect_dim).setDepth(5)
            rects.push(rect)
        } 
    }
    rects.forEach(r=>{
        scene.time.addEvent({
            delay: Phaser.Math.Between(250,750),
            callback: ()=>{
                r.destroy()
            }
        })
    });
    (scene as any).onTransitionIn()
}

export const DIRS = {
	4: [[0, -1], [-1, 0], [1, 0], [0, 1]],
	8: [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]],
	6: [[-1, -1], [1, -1], [2, 0], [1, 1], [-1, 1], [-2, 0]]
};

export const Pollution = [174, 280, 175, 138, 173, 136, 174, 280, 208, 244, 66, 102, 64, 173, 65, 174]

// export const updatePollution = (tileX:number, tileY:number, map:Tilemaps.Tilemap, shouldDelete:boolean) => {
//     if(shouldDelete) map.removeTileAt(tileX, tileY, true, true, Layers.Pollution)
//     else updatePollutionTileIndex(tileX, tileY, map)
//     DIRS[4].forEach(tuple=>{
//         const neighbor = map.getTileAt(tileX+tuple[0], tileY+tuple[1], false, Layers.Pollution)
//         if(neighbor) updatePollutionTileIndex(neighbor.x, neighbor.y, map)
//     })
// }

// const updatePollutionTileIndex = (tileX:number, tileY:number, map:Tilemaps.Tilemap) => {
//     let index = 0
//     DIRS[4].forEach((tuple,i)=>{
//         const neighbor = map.getTileAt(tileX+tuple[0], tileY+tuple[1], false, Layers.Pollution)
//         if(neighbor){
//             index += Math.pow(2, i)
//         }
//     })
//     map.putTileAt(Pollution[index]+1, tileX, tileY, true, Layers.Pollution)
// }
