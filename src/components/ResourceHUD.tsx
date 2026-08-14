import * as React from 'react'
import { useAppStore } from '../common/store'
import { getLogisticsStatus } from '../common/Utils'
import { Faction } from '../../enum'
import { colors } from '../styles/AppStyles'

export default () => {
    // Subscribed purely so this re-renders whenever a building or vehicle is added/removed/destroyed —
    // the actual numbers come from getLogisticsStatus, which reads the store itself.
    useAppStore((state) => state.buildings)
    useAppStore((state) => state.vehicles)
    const objectives = useAppStore((state) => state.objectives)

    const { maxLogistics, logisticsUsed, logisticsRemaining } = getLogisticsStatus()
    const logisticsPercent = Math.min(100, (Math.max(0, logisticsRemaining)/maxLogistics)*100)
    const overBudget = logisticsUsed > maxLogistics

    const objectivesHeld = objectives.filter((o) => o.owner === Faction.Player).length

    return (
        <div style={{ position:'absolute', top:10, right:10, zIndex:2, color:colors.lGreen, fontFamily:'Body', fontSize:14, display:'flex', alignItems:'flex-start', gap:24 }}>
            <div>Objectives: {objectivesHeld} / {objectives.length}</div>
            <div style={{ textAlign:'right' }}>
                <div>Logistics: {logisticsRemaining} / {maxLogistics}</div>
                <div style={{ width:150, height:12, border:'2px solid '+colors.lGreen, marginTop:2, marginLeft:'auto' }}>
                    <div style={{ width:logisticsPercent+'%', height:'100%', background: overBudget ? colors.grey1 : colors.lGreen }}/>
                </div>
            </div>
        </div>
    )
}
