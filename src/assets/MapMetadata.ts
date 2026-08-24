import { Maps } from '../../enum'

// One MapMetadata entry per Maps key — see its own doc comment (types.d.ts) for what each field is for.
// Briefing (once wired up) reads this off whichever map NewGame's startNewGame set as activeMapKey.
export const MAP_METADATA: Record<Maps, MapMetadata> = {
    [Maps.Sandbox]: {
        briefingText: ``,
        imageKeyframes: [
            { x: 50, y: 50 },
            { x: 30, y: 40 },
            { x: 70, y: 60 },
        ],
        victory: Maps.Ambush
    },
    [Maps.Ambush]: {
        briefingText: `And he made himself into a god, each one his own, and took to the stars for Man wanted to be alone.

        That great wanting made each one a singularity from which not even light could escape.`,
        imageKeyframes: [
            { x: 900, y: 0 },
            { x: 1400, y: -200 },
        ],
        victory: Maps.Sandbox
    },
}
