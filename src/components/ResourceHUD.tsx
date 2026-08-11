import * as React from 'react'
import { useAppStore } from '../common/store'
import { getEnergyStatus } from '../common/Utils'
import { colors } from '../styles/AppStyles'

export default () => {
    const { factories, metal } = useAppStore((state) => ({
        factories: state.buildings,
        metal: state.metal,
    }))

    const { maxEnergy, energyUsed, energyRemaining } = getEnergyStatus()
    const energyPercent = Math.min(100, (Math.max(0, energyRemaining)/maxEnergy)*100)
    const overBudget = energyUsed > maxEnergy

    return (
        <div style={{ position:'absolute', top:10, right:10, zIndex:2, color:colors.lGreen, fontFamily:'Body', fontSize:14, textAlign:'right' }}>
            <div>Metal: {metal}</div>
            <div style={{ marginTop:6 }}>
                <div>Energy: {energyRemaining} / {maxEnergy}</div>
                <div style={{ width:150, height:12, border:'2px solid '+colors.lGreen, marginTop:2, marginLeft:'auto' }}>
                    <div style={{ width:energyPercent+'%', height:'100%', background: overBudget ? colors.grey1 : colors.lGreen }}/>
                </div>
            </div>
        </div>
    )
}
