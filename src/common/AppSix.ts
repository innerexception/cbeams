import type MilsymbolDefault from "milsymbol" with { "resolution-mode": "import" }
import { ShipType, Faction } from "../../enum"

// milsymbol's package.json declares "type":"module" at its root, and its single "types" entry is
// shared by both the "require" and "import" export conditions — so TypeScript's Node16 resolution
// treats the type declarations as ESM-shaped and refuses a static `import ms from "milsymbol"` here
// (TS1479), even though the "require" condition genuinely resolves to a CommonJS bundle
// (dist/milsymbol.js) at runtime. A plain require() call sidesteps that check (it isn't a TS `import`
// declaration, so the ESM/CJS static-import rule doesn't apply to it), typed against milsymbol's own
// declared shape via a resolution-mode-tagged type-only import.
const ms:typeof MilsymbolDefault = require("milsymbol")

ms.setStandard("APP6")

interface SidcFunction { dimension:'G'|'A', functionId:string }

export const SHIP_SIDC_FUNCTION:Record<ShipType, SidcFunction> = {
    [ShipType.KK]: { dimension:'A', functionId:'MFQ---' },
    [ShipType.ATD]: { dimension:'A', functionId:'MFQ---' },
    [ShipType.AWACS]: { dimension:'A', functionId:'MFQ---' },
    [ShipType.MLRS]: { dimension:'G', functionId:'UCFRM-' },
    [ShipType.ARMOR]: { dimension:'G', functionId:'UCA---' },
    // A faction's headquarters — no longer a building, but keeps the same real APP-6 Headquarters
    // function it always rendered as.
    [ShipType.Base]: { dimension:'G', functionId:'UH1---' },
    // Engineer function — closest real APP-6 analog to an unarmed gathering/support ship.
    [ShipType.Harvester]: { dimension:'G', functionId:'UUE---' },
}

export const buildSidc = (faction:Faction, fn:SidcFunction) => {
    const affiliation = faction === Faction.Player ? 'F' : 'H'
    return `S${affiliation}${fn.dimension}P${fn.functionId}`
}

const hexToCss = (hex:number) => '#' + hex.toString(16).padStart(6, '0')

export const renderAppSixIcon = (sidc:string, size:number, colorHex:number):HTMLCanvasElement => {
    const symbol = new ms.Symbol(sidc, {
        size,
        monoColor: hexToCss(colorHex),
        fill: true,
        fillOpacity: 0.15,
        strokeWidth: 2,
    })
    const iconCanvas = symbol.asCanvas()

    // milsymbol's own canvas has a transparent background — paint a black rectangle first, then the
    // icon on top of that, so the placed sprite obscures whatever's behind it (grid lines, terrain,
    // another unit) instead of letting it show through the gaps in the icon's own linework.
    const canvas = document.createElement('canvas')
    canvas.width = iconCanvas.width
    canvas.height = iconCanvas.height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(iconCanvas, 0, 0)

    return canvas
}
