import { Maps } from '../../enum'

// One MapMetadata entry per Maps key — see its own doc comment (types.d.ts) for what each field is for.
// Briefing (once wired up) reads this off whichever map NewGame's startNewGame set as activeMapKey.
export const MAP_METADATA: Record<Maps, MapMetadata> = {
    [Maps.Sandbox]: {
        briefingText: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
        imageKeyframes: [
            { x: 50, y: 50 },
            { x: 30, y: 40 },
            { x: 70, y: 60 },
        ],
    },
    [Maps.Ambush]: {
        briefingText: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
        imageKeyframes: [
            { x: 900, y: 0 },
            { x: 1400, y: -200 },
        ],
    },
}
