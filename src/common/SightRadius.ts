import { Faction, ShipType, ShipData } from "../../enum"

const TWO_PI = Math.PI*2

const clamp = (v:number, min:number, max:number) => v < min ? min : v > max ? max : v

// Every ship's sight bubble, reduced to plain geometry: which arcs of each circle's boundary should
// actually be stroked, plus the lens-shaped regions where opposing factions' bubbles overlap. This is
// pure math with no renderer in it — MapScene used to hand a Phaser Graphics straight in, but the
// renderer is Three.js now (see render3d/Scene3D), and the interval arithmetic below is the part worth
// keeping either way.
//
// Two rules shape the output:
//  - Same-faction circles merge into one seamless shape: each one's boundary is trimmed wherever another
//    same-faction circle covers it, so no interior line runs through the overlap.
//  - An enemy circle starts fully *hidden* rather than full — the player has no business seeing how far
//    an enemy can see, so only the arcs of it falling inside the player's own sight get revealed. Where
//    they do overlap, that region is additionally shaded (see overlaps).

const normalizeAngle = (a:number) => {
    a = a % TWO_PI
    return a < 0 ? a + TWO_PI : a
}

// Removes [hideStart,hideEnd] (within [0,TWO_PI], hideStart<=hideEnd) from a set of non-wrapping visible intervals.
const subtractArc = (intervals:Array<[number,number]>, hideStart:number, hideEnd:number):Array<[number,number]> => {
    const result:Array<[number,number]> = []
    intervals.forEach(([s,e]) => {
        const hs = Math.max(s, hideStart)
        const he = Math.min(e, hideEnd)
        if(hs >= he){
            result.push([s,e])
            return
        }
        if(hs > s) result.push([s, hs])
        if(he < e) result.push([he, e])
    })
    return result
}

// Same as subtractArc but accepts a raw (possibly negative or >TWO_PI) angle range and handles wraparound.
const subtractCircularRange = (intervals:Array<[number,number]>, rawStart:number, rawEnd:number):Array<[number,number]> => {
    if(rawEnd - rawStart >= TWO_PI) return []
    const start = normalizeAngle(rawStart)
    const end = normalizeAngle(rawEnd)
    if(start <= end) return subtractArc(intervals, start, end)
    return subtractArc(subtractArc(intervals, start, TWO_PI), 0, end)
}

// The union counterpart to subtractArc — used to build up an enemy circle's revealed arcs (unrevealed
// by default) as the union of wherever it overlaps a player sight circle. Doesn't bother re-merging
// touching/overlapping intervals across separate calls into one contiguous span — a few adjacent
// stroked arcs draw identically to one, so it's not worth the extra bookkeeping.
const addArc = (intervals:Array<[number,number]>, addStart:number, addEnd:number):Array<[number,number]> => {
    let s = addStart, e = addEnd
    const untouched:Array<[number,number]> = []
    intervals.forEach(([is, ie]) => {
        if(ie < s || is > e) untouched.push([is, ie])
        else { s = Math.min(s, is); e = Math.max(e, ie) }
    })
    untouched.push([s, e])
    return untouched
}

// Same as addArc but accepts a raw (possibly negative or >TWO_PI) angle range and handles wraparound.
const addCircularRange = (intervals:Array<[number,number]>, rawStart:number, rawEnd:number):Array<[number,number]> => {
    if(rawEnd - rawStart >= TWO_PI) return [[0, TWO_PI]]
    const start = normalizeAngle(rawStart)
    const end = normalizeAngle(rawEnd)
    if(start <= end) return addArc(intervals, start, end)
    return addArc(addArc(intervals, start, TWO_PI), 0, end)
}

export interface SightCircle { x:number, y:number, r:number, faction:Faction }
export interface SightArcs { circle:SightCircle, arcs:Array<[number,number]> }
// Where two opposing-faction bubbles overlap. Either a lens bounded by the two circles' intersection
// points, or — when one sits entirely inside the other — that whole smaller circle.
export type SightOverlap =
    | { kind:'circle', x:number, y:number, r:number }
    | { kind:'lens', a:{ x:number, y:number, r:number, from:number, to:number }, b:{ x:number, y:number, r:number, from:number, to:number } }

export const computeSightGeometry = (ships:Array<{ x:number, y:number, type:ShipType, faction:Faction }>) => {
    const circles:Array<SightCircle> = ships.map(s => ({ x:s.x, y:s.y, r:ShipData[s.type].sightRadius, faction:s.faction }))

    const boundaries:Array<SightArcs> = circles.map((circle, i) => {
        let visible:Array<[number,number]> = circle.faction === Faction.Player ? [[0, TWO_PI]] : []

        if(circle.faction !== Faction.Player) circles.forEach(player => {
            if(player.faction !== Faction.Player) return
            const dx = player.x - circle.x
            const dy = player.y - circle.y
            const d = Math.hypot(dx, dy)
            if(d < 0.001 || d >= circle.r + player.r) return
            if(d + circle.r <= player.r){ visible = [[0, TWO_PI]]; return } // whole enemy bubble sits inside player's own
            if(d + player.r <= circle.r) return // player bubble fully inside this one — doesn't touch the boundary

            const cosTheta = clamp((d*d + circle.r*circle.r - player.r*player.r) / (2*d*circle.r), -1, 1)
            const theta = Math.acos(cosTheta)
            const alpha = Math.atan2(dy, dx)
            visible = addCircularRange(visible, alpha-theta, alpha+theta)
        })

        circles.forEach((other, j) => {
            if(i === j || other.faction !== circle.faction) return
            const dx = other.x - circle.x
            const dy = other.y - circle.y
            const d = Math.hypot(dx, dy)
            if(d < 0.001 || d >= circle.r + other.r) return
            if(d + circle.r <= other.r){ visible = []; return } // swallowed whole by the other bubble
            if(d + other.r <= circle.r) return // other bubble fully inside this one, doesn't hide anything

            const cosTheta = clamp((d*d + circle.r*circle.r - other.r*other.r) / (2*d*circle.r), -1, 1)
            const theta = Math.acos(cosTheta)
            const alpha = Math.atan2(dy, dx)
            visible = subtractCircularRange(visible, alpha-theta, alpha+theta)
        })

        return { circle, arcs: visible.filter(([s,e]) => e-s >= 0.001) }
    })

    const overlaps:Array<SightOverlap> = []
    circles.forEach((circle, i) => {
        circles.forEach((other, j) => {
            if(j <= i || other.faction === circle.faction) return
            const dx = other.x - circle.x
            const dy = other.y - circle.y
            const d = Math.hypot(dx, dy)
            if(d >= circle.r + other.r) return

            if(d < 0.001 || d <= Math.abs(circle.r - other.r)){
                const inner = circle.r <= other.r ? circle : other
                overlaps.push({ kind:'circle', x:inner.x, y:inner.y, r:inner.r })
                return
            }

            const alpha = Math.atan2(dy, dx)
            const thetaA = Math.acos(clamp((d*d + circle.r*circle.r - other.r*other.r) / (2*d*circle.r), -1, 1))
            const alphaB = alpha + Math.PI
            const thetaB = Math.acos(clamp((d*d + other.r*other.r - circle.r*circle.r) / (2*d*other.r), -1, 1))
            overlaps.push({
                kind: 'lens',
                a: { x:circle.x, y:circle.y, r:circle.r, from:alpha-thetaA, to:alpha+thetaA },
                b: { x:other.x, y:other.y, r:other.r, from:alphaB-thetaB, to:alphaB+thetaB },
            })
        })
    })

    return { boundaries, overlaps }
}
