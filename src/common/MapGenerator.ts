import { v4 } from 'uuid'
import { Faction, ObjectiveSprite } from '../../enum'

const BASE_MARGIN = 4
const OBJECTIVE_MARGIN = 4

// Terrain is no longer procedurally generated — it's drawn from an externally-authored Tiled
// (mapeditor.org) JSON export instead (see parseTiledMap below, and MapScene's drawTerrain for how a
// loaded one actually gets rendered). generateMap defaults `terrain` to null — an empty map — until a
// real file has been authored and passed in.
export const parseTiledMap = (json:any):TiledMap => ({
    width: json.width,
    height: json.height,
    tilewidth: json.tilewidth,
    tileheight: json.tileheight,
    layers: (json.layers || [])
        .filter((layer:any) => layer.type === 'tilelayer' && Array.isArray(layer.data))
        .map((layer:any) => ({ name: layer.name, width: layer.width, height: layer.height, data: layer.data })),
})

export const generateMap = (size:number = 50, terrain:TiledMap | null = null):MapData => {
    const midY = Math.floor(size/2)
    const bases:Array<BaseData> = [
        { faction: Faction.Player, x: BASE_MARGIN, y: midY },
        { faction: Faction.Enemy, x: size-1-BASE_MARGIN, y: midY },
    ]

    // One top-middle, one bottom-middle — each pass in a shuffled pair off the 3 possible sprites so
    // the 2 objectives read as distinct at a glance instead of risking a repeat.
    const midX = Math.floor(size/2)
    const [spriteA, spriteB] = [...Object.values(ObjectiveSprite)].sort(() => Math.random()-0.5)
    const objectives:Array<ObjectiveSpawn> = [
        { id: v4(), x: midX, y: OBJECTIVE_MARGIN, sprite: spriteA },
        { id: v4(), x: midX, y: size-1-OBJECTIVE_MARGIN, sprite: spriteB },
    ]

    return { width: size, height: size, bases, objectives, terrain }
}
