import { GameObjects, Math as PhaserMath } from "phaser"
import { useAppStore } from "./store"
import { Faction, ShipData } from "../../enum"
import { GREEN_HEX } from "./Constants"

const TWO_PI = Math.PI*2

// Used by drawSightRadii to trim a circle's stroked boundary wherever a SAME-faction circle covers it,
// so same-faction sight bubbles merge into one seamless shape with no interior line (opposing-faction
// circles are left full — see fillCircleOverlap for how their overlap is shown instead).
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

// The shaded region where two opposing-faction sight circles overlap: either the lens bounded by
// their two intersection points (the common "two arcs meeting at both crossing points" construction),
// or, if one circle sits entirely inside the other, that whole smaller circle.
const fillCircleOverlap = (g:GameObjects.Graphics, circle:{x:number,y:number,r:number}, other:{x:number,y:number,r:number}) => {
    const dx = other.x - circle.x
    const dy = other.y - circle.y
    const d = Math.hypot(dx, dy)
    if(d >= circle.r + other.r) return // no overlap at all

    if(d < 0.001 || d <= Math.abs(circle.r - other.r)){
        const inner = circle.r <= other.r ? circle : other
        g.fillCircle(inner.x, inner.y, inner.r)
        return
    }

    const alpha = Math.atan2(dy, dx)
    const thetaA = Math.acos(PhaserMath.Clamp((d*d + circle.r*circle.r - other.r*other.r) / (2*d*circle.r), -1, 1))
    const alphaB = alpha + Math.PI
    const thetaB = Math.acos(PhaserMath.Clamp((d*d + other.r*other.r - circle.r*circle.r) / (2*d*other.r), -1, 1))

    g.beginPath()
    g.arc(circle.x, circle.y, circle.r, alpha-thetaA, alpha+thetaA, false)
    g.arc(other.x, other.y, other.r, alphaB-thetaB, alphaB+thetaB, false)
    g.closePath()
    g.fillPath()
}

// Every ship's own sight-radius circle — units move, so this is meant to be called every frame from
// MapScene's update() rather than only whenever drawMap's static art changes. Same-faction circles
// merge into one seamless shape (each one's boundary is trimmed wherever a same-faction circle covers
// it, so there's no interior line through the overlap). A non-player (enemy) circle starts fully
// hidden instead of full — the player has no business seeing the full extent of an enemy's sight
// radius, only the arcs of it that actually fall within the player's own sight radius get revealed.
// The overlap itself is additionally communicated with a light fill over the lens-shaped intersection.
export const drawSightRadii = (g:GameObjects.Graphics) => {
    g.clear()

    const circles = useAppStore.getState().ships.map(s => ({ x: s.x, y: s.y, r: ShipData[s.type].sightRadius, faction: s.faction }))

    g.lineStyle(1, GREEN_HEX, 0.25)
    circles.forEach((circle, i) => {
        let visible:Array<[number,number]> = circle.faction === Faction.Player ? [[0, TWO_PI]] : []

        // Reveal only the arcs of an enemy circle that overlap a player sight circle — everywhere
        // else, the player has no way of knowing how far that enemy can actually see.
        if(circle.faction !== Faction.Player) circles.forEach(player => {
            if(player.faction !== Faction.Player) return
            const dx = player.x - circle.x
            const dy = player.y - circle.y
            const d = Math.hypot(dx, dy)
            if(d < 0.001 || d >= circle.r + player.r) return
            if(d + circle.r <= player.r){ visible = [[0, TWO_PI]]; return } // whole enemy bubble sits inside player's own
            if(d + player.r <= circle.r) return // player bubble fully inside this one — doesn't touch the boundary

            const cosTheta = PhaserMath.Clamp((d*d + circle.r*circle.r - player.r*player.r) / (2*d*circle.r), -1, 1)
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

            const cosTheta = PhaserMath.Clamp((d*d + circle.r*circle.r - other.r*other.r) / (2*d*circle.r), -1, 1)
            const theta = Math.acos(cosTheta)
            const alpha = Math.atan2(dy, dx)
            visible = subtractCircularRange(visible, alpha-theta, alpha+theta)
        })

        visible.forEach(([start, end]) => {
            if(end-start < 0.001) return
            g.beginPath()
            g.arc(circle.x, circle.y, circle.r, start, end, false)
            g.strokePath()
        })
    })

    g.fillStyle(GREEN_HEX, 0.12)
    circles.forEach((circle, i) => {
        circles.forEach((other, j) => {
            if(j <= i || other.faction === circle.faction) return
            fillCircleOverlap(g, circle, other)
        })
    })
}
