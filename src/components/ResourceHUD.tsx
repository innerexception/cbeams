import * as React from 'react'
import { useAppStore } from '../common/store'
import { Faction } from '../../enum'
import { colors } from '../styles/AppStyles'

export default () => {
    const objectives = useAppStore((state) => state.objectives)
    // A simple running count, straight off the store — no cap/remaining split to compute, unlike the
    // logistics system this replaced.
    const machineRelics = useAppStore((state) => state.machineRelics[Faction.Player] ?? 0)

    const objectivesHeld = objectives.filter((o) => o.owner === Faction.Player).length

    return (
        <div style={{ position:'absolute', top:10, right:10, zIndex:2, color:colors.green, fontFamily:'Body', fontSize:14, display:'flex', alignItems:'flex-start', gap:24 }}>
            <div>Objectives: {objectivesHeld} / {objectives.length}</div>
            <div>Machine Relics: {machineRelics}</div>
        </div>
    )
}
