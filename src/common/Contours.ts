// Marching squares: turns a rectangular lattice of scalar samples into topographic contour line
// segments at a given threshold — the standard algorithm for drawing isolines (the same technique
// real topo-map software uses to trace where an elevation field crosses each contour interval).

export interface GridPoint { x:number, y:number }
export interface ContourSegment { a:GridPoint, b:GridPoint }

// Linear interpolation of where an edge between two corner values crosses the threshold, expressed
// as a 0..1 fraction along that edge.
const edgeT = (v0:number, v1:number, threshold:number) => (threshold - v0) / (v1 - v0)

// Extracts every contour segment where `heights` crosses `threshold`, in fractional grid-index space
// (e.g. a crossing partway between column 3 and 4 comes back as x:3.4) — callers convert those back
// to world coordinates however they see fit (see MapScene's toWorld).
export const marchingSquaresSegments = (heights:Array<Array<number>>, cols:number, rows:number, threshold:number):Array<ContourSegment> => {
    const segments:Array<ContourSegment> = []

    for(let i=0; i<cols-1; i++){
        for(let j=0; j<rows-1; j++){
            const tl = heights[i][j], tr = heights[i+1][j], bl = heights[i][j+1], br = heights[i+1][j+1]

            const index = (tl >= threshold ? 8 : 0) | (tr >= threshold ? 4 : 0) | (br >= threshold ? 2 : 0) | (bl >= threshold ? 1 : 0)
            if(index === 0 || index === 15) continue

            const top:GridPoint = { x: i + edgeT(tl, tr, threshold), y: j }
            const right:GridPoint = { x: i+1, y: j + edgeT(tr, br, threshold) }
            const bottom:GridPoint = { x: i + edgeT(bl, br, threshold), y: j+1 }
            const left:GridPoint = { x: i, y: j + edgeT(tl, bl, threshold) }

            // The two 4-corners-alternating cases (5 and 10) are ambiguous — both diagonal corners
            // agree, so either pair of edges could be connected. Resolved by the cell's own center
            // estimate, same as any standard marching-squares implementation.
            const center = (tl+tr+bl+br)/4
            const centerInside = center >= threshold

            switch(index){
                case 1: segments.push({ a:left, b:bottom }); break
                case 2: segments.push({ a:bottom, b:right }); break
                case 3: segments.push({ a:left, b:right }); break
                case 4: segments.push({ a:top, b:right }); break
                case 5:
                    if(centerInside){ segments.push({ a:top, b:right }); segments.push({ a:left, b:bottom }) }
                    else { segments.push({ a:top, b:left }); segments.push({ a:right, b:bottom }) }
                    break
                case 6: segments.push({ a:top, b:bottom }); break
                case 7: segments.push({ a:top, b:left }); break
                case 8: segments.push({ a:top, b:left }); break
                case 9: segments.push({ a:top, b:bottom }); break
                case 10:
                    if(centerInside){ segments.push({ a:top, b:left }); segments.push({ a:right, b:bottom }) }
                    else { segments.push({ a:top, b:right }); segments.push({ a:left, b:bottom }) }
                    break
                case 11: segments.push({ a:top, b:right }); break
                case 12: segments.push({ a:left, b:right }); break
                case 13: segments.push({ a:right, b:bottom }); break
                case 14: segments.push({ a:left, b:bottom }); break
            }
        }
    }

    return segments
}
