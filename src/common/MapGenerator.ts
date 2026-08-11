import { Faction } from '../../enum'

const BASE_MARGIN = 4

export const generateMap = (size:number = 50):MapData => {
    const midY = Math.floor(size/2)
    const bases:Array<BaseData> = [
        { faction: Faction.Player, x: BASE_MARGIN, y: midY },
        { faction: Faction.Enemy, x: size-1-BASE_MARGIN, y: midY },
    ]

    return { width: size, height: size, bases }
}
