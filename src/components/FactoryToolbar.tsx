import * as React from 'react'
import { useAppStore } from '../common/store'
import { onSelectShips } from '../common/Thunks'
import { Faction, ShipType, ShipData } from '../../enum'
import { MAX_QUEUE } from '../common/Constants'
import { getShipRelicCost } from '../common/Utils'
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles'
import { defaultCursor } from '../assets/Assets'

export default () => {
    const { selectedShipIds, ships, queueShip, machineRelics } = useAppStore((state) => ({
        selectedShipIds: state.selectedShipIds,
        ships: state.ships,
        queueShip: state.queueShip,
        machineRelics: state.machineRelics,
    }))

    // Re-render periodically so queue progress bars stay live.
    const [, forceTick] = React.useState(0)
    React.useEffect(() => {
        const interval = setInterval(() => forceTick(t => t+1), 200)
        return () => clearInterval(interval)
    }, [])

    // Collapses the build panel down to just its toggle bar so it can be tucked away when the player
    // isn't actively queuing ships.
    const [buildMenuMinimized, setBuildMenuMinimized] = React.useState(true)

    // The Base is unselectable (see MapScene's findOwnShipAt/box-select) — its build panel is always up
    // instead of only appearing once it's been clicked, so it's found directly here rather than derived
    // from selectedShipIds the way it used to be.
    const playerBase = ships.find(s => s.faction === Faction.Player && s.type === ShipType.CATH)
    const selectedShips = ships.filter(s => selectedShipIds.includes(s.id))

    return (
        <>
        <div style={{ position:'absolute', top:75, left:75, zIndex:2, display:'flex', flexDirection:'column', gap:12 }}>
            {playerBase && (() => {
                const queue = playerBase.queue || []
                const queueFull = queue.length >= MAX_QUEUE

                // Recomputed every render (this component already re-renders on its 200ms tick) so a
                // button disables the instant the faction's Machine Relics can no longer cover that ship's cost.
                const relicsAvailable = machineRelics[playerBase.faction] ?? 0

                return (
                    <div style={{display:'flex', flexDirection:'column'}}>
                        <div>
                            <div style={{ display:'flex', alignItems:'center', gap:8, position:'relative' }}>
                                    {relicsAvailable > 0 && <ToolButton onClick={() => setBuildMenuMinimized(m => !m)}>Relics Available</ToolButton>}
                                    {buildMenuMinimized && relicsAvailable > 0 && (
                                        // Hint badge so the player still knows there's unspent Machine Relics
                                        // without having to reopen the panel.
                                        <div style={{
                                            width:20, height:20, borderRadius:'50%', background:colors.yellow,
                                            color:'#000', fontFamily:'Body', fontWeight:'bold',
                                            display:'flex', alignItems:'center', justifyContent:'center',
                                        }}>{relicsAvailable}</div>
                                    )}
                            </div>
                            {!buildMenuMinimized && (
                                <>
                                    <div style={{ display:'flex', flexDirection:'column', marginTop:8 }}>
                                        {Object.values(ShipType).filter(type => ShipData[type].relicCost).map(type => (
                                            <ToolButton key={type} disabled={queueFull || relicsAvailable < getShipRelicCost(type)} onClick={()=>queueShip(playerBase.id, type)}>{ShipData[type].name} ({ShipData[type].relicCost})</ToolButton>
                                        ))}
                                    </div>
                                    <div style={{ marginTop:8, display:'flex', gap:8 }}>
                                        {Array.from({ length: MAX_QUEUE }).map((_, i) => {
                                            const item = queue[i]
                                            const percent = item?.startedAt ? Math.min(100, ((Date.now()-item.startedAt)/ShipData[item.type].productionTimeMs)*100) : 0
                                            return (
                                                <div key={i} style={{ width:150, border:'2px solid '+colors.green, padding:4, fontFamily:'Body', color:colors.green }}>
                                                    <div>{item ? ShipData[item.type].name : '—'}</div>
                                                    <div style={{ width:'100%', height:6, border:'1px solid '+colors.green, marginTop:4 }}>
                                                        {item?.startedAt && <div style={{ width:percent+'%', height:'100%', background:colors.green }}/>}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )
            })()}
        </div>
            <div style={{ position:'absolute', top:230, right:60, zIndex:13, width:200 }}>
                {selectedShipIds.length > 0 && (
                        <div style={{display:'flex', flexWrap:'wrap'}}>
                            {selectedShips.map(s =>
                                <div key={s.id} style={{ cursor:`url(${defaultCursor}), pointer`, margin:'5px', padding:'3px', border:'2px solid' }} onClick={()=>onSelectShips(selectedShips.filter(o=>o.type===s.type).map(o=>o.id))}>{s.type}{s.rank > 0 ? ' (V)' : ''}</div>
                            )}
                        </div>
                )}
            </div>
        </>
    )
}
