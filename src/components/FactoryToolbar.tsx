import * as React from 'react'
import { useAppStore } from '../common/store'
import { onSelectShips } from '../common/Thunks'
import { Faction, ShipType, ShipData } from '../../enum'
import { MAX_QUEUE, MINIMAP_SIZE_PX, MINIMAP_MARGIN_PX } from '../common/Constants'
import { getShipRelicCost } from '../common/Utils'
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles'
import { defaultCursor } from '../assets/Assets'

export default () => {
    const { selectedShipIds, ships, queueShip, machineRelics, buildableTypes } = useAppStore((state) => ({
        selectedShipIds: state.selectedShipIds,
        ships: state.ships,
        queueShip: state.queueShip,
        machineRelics: state.machineRelics,
        buildableTypes: state.mySave?.buildableTypes ?? [],
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
        <div style={{ position:'absolute', top:233, right:72, zIndex:2, display:'flex', flexDirection:'column', gap:12 }}>
            {playerBase && (() => {
                const queue = playerBase.queue || []
                const queueActive = queue.length > 0

                // Recomputed every render (this component already re-renders on its 200ms tick) so a
                // button disables the instant the faction's Machine Relics can no longer cover that ship's cost.
                const relicsAvailable = machineRelics[playerBase.faction] ?? 0

                return (
                    <div style={{display:'flex', flexDirection:'column'}}>
                        <div>
                            <div style={{ display:'flex', alignItems:'center', gap:8, position:'relative' }}>
                                {queueActive ? (
                                    <div style={{ display:'flex', gap:8 }}>
                                        {queue.map((item, i) => {
                                            const percent = item?.startedAt ? Math.min(100, ((Date.now()-item.startedAt)/ShipData[item.type].productionTimeMs)*100) : 0
                                            return (
                                                <div key={i} style={{ width:150, border:'2px solid '+colors.green, padding:4, fontFamily:'Body', color:colors.green }}>
                                                    <div>{ShipData[item.type].name}</div>
                                                    <div style={{ width:'100%', height:6, border:'1px solid '+colors.green, marginTop:4 }}>
                                                        {item?.startedAt && <div style={{ width:percent+'%', height:'100%', background:colors.green }}/>}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    relicsAvailable > 0 && <ToolButton onClick={() => setBuildMenuMinimized(m => !m)}>Relic Insertion ({relicsAvailable})</ToolButton>
                                )}
                            </div>
                            {!buildMenuMinimized && !queueActive && (
                                <div style={{ display:'flex', flexDirection:'column', marginTop:8 }}>
                                    {Object.values(ShipType).filter(type => ShipData[type].relicCost && buildableTypes.includes(type)).map(type => (
                                        <ToolButton key={type} disabled={queueActive || relicsAvailable < getShipRelicCost(type)} onClick={()=>{queueShip(playerBase.id, type);setBuildMenuMinimized(true)}}>{ShipData[type].name} ({ShipData[type].relicCost})</ToolButton>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )
            })()}
        </div>
            <div style={{ position:'absolute', top:70, right:232, zIndex:13, width:500, display:'flex', justifyContent:'flex-end', alignItems:'flex-start' }}>
                {selectedShipIds.length > 0 && (
                        <div style={{display:'flex', flexWrap:'wrap', justifyContent:'flex-end'}}>
                            {selectedShips.map(s =>
                                <div key={s.id} style={{ cursor:`url(${defaultCursor}), pointer`, background:'black', margin:'5px', padding:'3px', border:'2px solid' }} onClick={()=>onSelectShips(selectedShips.filter(o=>o.type===s.type).map(o=>o.id))}>{s.type}{s.rank > 0 ? ' (V)' : ''}</div>
                            )}
                        </div>
                )}
                {selectedShips.length === 1 && <div style={{background:'black', marginLeft:'1em'}}>{ShipData[selectedShips[0].type].description}</div>}
            </div>
        </>
    )
}
