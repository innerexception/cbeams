import { Faction } from '../../enum'

const BASE_MARGIN = 4

const randomInRange = (min:number, max:number) => min + Math.random()*(max-min)
const clamp01 = (n:number) => Math.max(0, Math.min(1, n))

// --- Terrain ---
// Modelled per FM 3-25.26's terrain features (see MapScene's drawTerrain for the contour rendering).
// Every feature below is just a signed elevation contribution summed into one shared lattice — the
// same marching-squares contour pass renders all of them, with no feature-specific drawing code:
//   Hill:   "slopes down in all directions" — a radial bump, positive strength.
//   Valley: "elongated depression, high ground on three sides", closed end toward high ground — a
//           trough along a line, sunk, whose magnitude tapers from full at its closed end to ~0 at
//           its open end (that asymmetric taper is what makes the nested rings close off on one side).
//   Spur:   "high ground... U/V pointing away from high ground" — the same tapered trough as a Valley,
//           just raised instead of sunk.
//   Cliff:  "contour lines very close together... touching" — an almost-discontinuous elevation step
//           across a line; cramming many 0.15-spaced contour levels into a tiny span is what produces
//           the tightly-packed/touching look, with no special "cliff" drawing of its own.
const gaussianBump = (dx:number, dy:number, radius:number) => Math.exp(-(dx*dx + dy*dy) / (2*radius*radius))

interface FeatureBounds { minX:number, minY:number, maxX:number, maxY:number }
type ElevationSampler = (x:number, y:number) => number
interface TerrainFeatureInstance { sample:ElevationSampler, bounds:FeatureBounds }

// A point somewhere in the shared terrain cluster around the map's center — kept well inside the map
// and away from either base, so every feature reads as one coherent piece of terrain.
const randomClusterPoint = (size:number, center:number) => ({
    x: center + randomInRange(-size*0.16, size*0.16),
    y: center + randomInRange(-size*0.16, size*0.16),
})

const makeHillFeature = (size:number, center:number):TerrainFeatureInstance => {
    const p = randomClusterPoint(size, center)
    const radius = size * randomInRange(0.08, 0.12)
    const strength = randomInRange(0.85, 1)
    // 3 standard deviations out, a Gaussian bump has faded to ~1% of its peak — negligible, so that's
    // as far as this feature can actually reach.
    const reach = radius * 3

    return {
        sample: (x, y) => strength * gaussianBump(x-p.x, y-p.y, radius),
        bounds: { minX: p.x-reach, minY: p.y-reach, maxX: p.x+reach, maxY: p.y+reach },
    }
}

// Shared by Valley (strength < 0) and Spur (strength > 0): a capsule-shaped trough/ridge along a line
// segment a->b, cross-section a Gaussian bump, tapering lengthwise from full strength at a (the
// "closed"/high-ground end) down toward b (the "open" end) — the taper is what makes the nested
// contour rings close off toward a and open out toward b.
const makeTaperFeature = (size:number, center:number, strength:number):TerrainFeatureInstance => {
    const a = randomClusterPoint(size, center)
    const angle = randomInRange(0, Math.PI*2)
    const length = size * randomInRange(0.14, 0.22)
    const width = size * randomInRange(0.045, 0.07)
    const dx = Math.cos(angle)*length, dy = Math.sin(angle)*length
    const b = { x: a.x+dx, y: a.y+dy }
    const lenSq = dx*dx + dy*dy || 1
    const reach = width * 3

    const sample:ElevationSampler = (x, y) => {
        const t = clamp01(((x-a.x)*dx + (y-a.y)*dy) / lenSq)
        const closestX = a.x + dx*t, closestY = a.y + dy*t
        const perpDist = Math.hypot(x-closestX, y-closestY)
        const alongFade = 1 - t*0.9
        return strength * gaussianBump(perpDist, 0, width) * alongFade
    }
    return {
        sample,
        bounds: {
            minX: Math.min(a.x, b.x)-reach, minY: Math.min(a.y, b.y)-reach,
            maxX: Math.max(a.x, b.x)+reach, maxY: Math.max(a.y, b.y)+reach,
        },
    }
}
const makeValleyFeature = (size:number, center:number) => makeTaperFeature(size, center, -randomInRange(0.85, 1))
const makeSpurFeature = (size:number, center:number) => makeTaperFeature(size, center, randomInRange(0.7, 0.95))

const makeCliffFeature = (size:number, center:number):TerrainFeatureInstance => {
    const a = randomClusterPoint(size, center)
    const angle = randomInRange(0, Math.PI*2)
    const length = size * randomInRange(0.12, 0.20)
    const reach = size * randomInRange(0.05, 0.08)
    const sharpness = size * 0.006 // tiny — this is what makes the step read as almost discontinuous
    const dx = Math.cos(angle)*length, dy = Math.sin(angle)*length
    const b = { x: a.x+dx, y: a.y+dy }
    const lenSq = dx*dx + dy*dy || 1
    const segLen = Math.sqrt(lenSq)
    const nx = -dy/segLen, ny = dx/segLen
    const boundsReach = reach * 3

    const sample:ElevationSampler = (x, y) => {
        const t = clamp01(((x-a.x)*dx + (y-a.y)*dy) / lenSq)
        const closestX = a.x + dx*t, closestY = a.y + dy*t
        const alongDist = Math.hypot(x-closestX, y-closestY)
        const envelope = gaussianBump(alongDist, 0, reach)
        const signedPerp = (x-a.x)*nx + (y-a.y)*ny
        return envelope * Math.tanh(signedPerp/sharpness)
    }
    return {
        sample,
        bounds: {
            minX: Math.min(a.x, b.x)-boundsReach, minY: Math.min(a.y, b.y)-boundsReach,
            maxX: Math.max(a.x, b.x)+boundsReach, maxY: Math.max(a.y, b.y)+boundsReach,
        },
    }
}

type FeatureKind = 'hill' | 'valley' | 'spur' | 'cliff'
const FEATURE_KINDS:Array<FeatureKind> = ['hill', 'valley', 'spur', 'cliff']

const makeFeature = (kind:FeatureKind, size:number, center:number):TerrainFeatureInstance => {
    if(kind === 'hill') return makeHillFeature(size, center)
    if(kind === 'valley') return makeValleyFeature(size, center)
    if(kind === 'spur') return makeSpurFeature(size, center)
    return makeCliffFeature(size, center)
}

// At least 2 distinct kinds every match (the terrain feature mix itself varies match to match, not
// just each feature's own placement) — up to all 4, shuffled so there's no fixed ordering bias.
const pickFeatureKinds = ():Array<FeatureKind> => {
    const shuffled = [...FEATURE_KINDS].sort(() => Math.random()-0.5)
    const count = 2 + Math.floor(Math.random()*(FEATURE_KINDS.length-1))
    return shuffled.slice(0, count)
}

const buildTerrain = (size:number):TerrainData => {
    const center = size/2
    const features = pickFeatureKinds().map(kind => makeFeature(kind, size, center))

    // The lattice's bounding box is the union of every feature's own reported bounds, not a fixed
    // guessed size — a Valley/Cliff's line segment can point in any random direction from its anchor
    // point, so a fixed box sized only for a "typical" feature can end up smaller than an actual
    // feature's real extent, silently clipping its contour lines right at the box edge.
    const originX = Math.max(0, Math.floor(Math.min(...features.map(f => f.bounds.minX))))
    const originY = Math.max(0, Math.floor(Math.min(...features.map(f => f.bounds.minY))))
    const endX = Math.min(size-1, Math.ceil(Math.max(...features.map(f => f.bounds.maxX))))
    const endY = Math.min(size-1, Math.ceil(Math.max(...features.map(f => f.bounds.maxY))))
    const cols = endX - originX + 1
    const rows = endY - originY + 1

    const elevations:Array<Array<number>> = []
    for(let i=0; i<cols; i++){
        const x = originX + i
        const column:Array<number> = []
        for(let j=0; j<rows; j++){
            const y = originY + j
            const elevation = features.reduce((sum, f) => sum + f.sample(x, y), 0)
            column.push(Math.max(-1, Math.min(1, elevation)))
        }
        elevations.push(column)
    }

    return { originX, originY, cols, rows, elevations }
}

export const generateMap = (size:number = 50):MapData => {
    const midY = Math.floor(size/2)
    const bases:Array<BaseData> = [
        { faction: Faction.Player, x: BASE_MARGIN, y: midY },
        { faction: Faction.Enemy, x: size-1-BASE_MARGIN, y: midY },
    ]

    const terrain = buildTerrain(size)

    return { width: size, height: size, bases, terrain }
}
