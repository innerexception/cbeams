import type MilsymbolDefault from "milsymbol" with { "resolution-mode": "import" }
import { BuildingType, VehicleType, Faction } from "../../enum"

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

export const BUILDING_SIDC_FUNCTION:Record<BuildingType, SidcFunction> = {
    [BuildingType.Base]: { dimension:'G', functionId:'UH1---' },
    [BuildingType.LogisticsCenter]: { dimension:'G', functionId:'USS---' },
    [BuildingType.CRAM]: { dimension:'G', functionId:'UCD---' },
    [BuildingType.BLM]: { dimension:'G', functionId:'UCFRM-' },
    [BuildingType.THADD]: { dimension:'G', functionId:'UCDM--' },
    // Supply unit function with the Class V (Ammunition) modifier — same base icon as LogisticsCenter's
    // generic Supply ('USS---'), just specialized to ammunition specifically.
    [BuildingType.AmmoDump]: { dimension:'G', functionId:'USS5--' },
    // Sensor installation — a Radar's real APP-6 function.
    [BuildingType.Radar]: { dimension:'G', functionId:'USX---' },
    // Signal/communications installation — Uplink's real APP-6 function.
    [BuildingType.Uplink]: { dimension:'G', functionId:'UUS---' },
}

export const VEHICLE_SIDC_FUNCTION:Record<VehicleType, SidcFunction> = {
    [VehicleType.KK]: { dimension:'A', functionId:'MFQ---' },
    [VehicleType.ATD]: { dimension:'A', functionId:'MFQ---' },
    [VehicleType.AWACS]: { dimension:'A', functionId:'MFQ---' },
    [VehicleType.MLRS]: { dimension:'G', functionId:'UCFRM-' },
    [VehicleType.ARMOR]: { dimension:'G', functionId:'UCA---' },
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
        strokeWidth: 1.5,
    })
    return symbol.asCanvas()
}
