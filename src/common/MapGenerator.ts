import { v4 } from 'uuid'
import { Faction, ResourceNode } from '../../enum'

const BASE_MARGIN = 4
const MIN_NODE_DISTANCE = 4
const MIN_BASE_DISTANCE = 8

const dist = (ax:number, ay:number, bx:number, by:number) => Math.hypot(ax-bx, ay-by)

const randomInt = (min:number, max:number) => Math.floor(min + Math.random()*(max-min+1))

// Generates the left half of the node layout, then mirrors it across the vertical
// center line so both bases (left/right) start with an equivalent, fair spread of resources.
export const generateMap = (size:number = 50, nodeCount:number = 24):MapData => {
    const midY = Math.floor(size/2)
    const bases:Array<BaseData> = [
        { faction: Faction.Player, x: BASE_MARGIN, y: midY },
        { faction: Faction.Enemy, x: size-1-BASE_MARGIN, y: midY },
    ]

    const nodes:Array<ResourceNodeData> = []
    const half = Math.ceil(nodeCount/2)
    let attempts = 0
    const halfWidth = Math.floor(size/2)

    while(nodes.length < half && attempts < half*200){
        attempts++
        const x = randomInt(1, halfWidth-2)
        const y = randomInt(1, size-2)
        const mx = size-1-x
        const my = y

        const tooCloseToBase = bases.some(b => dist(x,y,b.x,b.y) < MIN_BASE_DISTANCE || dist(mx,my,b.x,b.y) < MIN_BASE_DISTANCE)
        if(tooCloseToBase) continue

        const tooCloseToNode = nodes.some(n => dist(x,y,n.x,n.y) < MIN_NODE_DISTANCE || dist(mx,my,n.x,n.y) < MIN_NODE_DISTANCE)
        if(tooCloseToNode) continue

        const kind = Math.random() < 0.5 ? ResourceNode.Asteroid : ResourceNode.Star

        nodes.push({ id: v4(), x, y, kind })
        if(nodes.length < nodeCount){
            nodes.push({ id: v4(), x: mx, y: my, kind })
        }
    }

    return { width: size, height: size, bases, nodes }
}
