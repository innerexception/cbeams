import * as React from 'react'
import { useAppStore } from '../common/store'
import { ShipType, ShipData } from '../../enum'
import { MAX_QUEUE } from '../common/Constants'
import { getLogisticsStatus, getShipLogisticsCost, getShipMetalCost } from '../common/Utils'
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles'

export default () => {
    const { selectedShipIds, setSelectedShipIds, ships, queueShip, clearShipWaypoints, metal } = useAppStore((state) => ({
        selectedShipIds: state.selectedShipIds,
        setSelectedShipIds: state.setSelectedShipIds,
        ships: state.ships,
        queueShip: state.queueShip,
        clearShipWaypoints: state.clearShipWaypoints,
        metal: state.metal,
    }))

    // Re-render periodically so queue progress bars stay live.
    const [, forceTick] = React.useState(0)
    React.useEffect(() => {
        const interval = setInterval(() => forceTick(t => t+1), 200)
        return () => clearInterval(interval)
    }, [])

    // A single selected Base opens its production panel — the same role the old shipyard building's
    // panel used to play, just keyed off "exactly one ship selected, and it's a Base" instead of a
    // separate selected-building concept (see MapScene's click handler / store's selectedShipIds).
    const selectedBase = selectedShipIds.length === 1 ? ships.find(s => s.id === selectedShipIds[0] && s.type === ShipType.CATH) : undefined

    if(selectedBase){
        const queue = selectedBase.queue || []
        const queueFull = queue.length >= MAX_QUEUE

        // Recomputed every render (this component already re-renders on its 200ms tick) so a button
        // disables the instant the shared logistics budget can no longer fit that ship's cost.
        const { logisticsRemaining } = getLogisticsStatus(selectedBase.faction)

        return (
            <div style={{ position:'absolute', top:10, left:10, zIndex:2 }}>
                <div style={{ display:'flex' }}>
                    {Object.values(ShipType).filter(type => type !== ShipType.CATH).map(type => (
                        <ToolButton key={type} disabled={queueFull || logisticsRemaining < getShipLogisticsCost(type) || metal[selectedBase.faction] < getShipMetalCost(type)} onClick={()=>queueShip(selectedBase.id, type)}>{ShipData[type].name}</ToolButton>
                    ))}
                    <ToolButton onClick={()=>setSelectedShipIds([])}>Cancel</ToolButton>
                </div>
                <div style={{ color:colors.green, marginTop:6, fontSize:12, fontFamily:'Body' }}>
                    New ships wait by the Base until given their own orders.
                </div>
                <div style={{ marginTop:8, display:'flex', gap:8 }}>
                    {Array.from({ length: MAX_QUEUE }).map((_, i) => {
                        const item = queue[i]
                        const percent = item?.startedAt ? Math.min(100, ((Date.now()-item.startedAt)/ShipData[item.type].productionTimeMs)*100) : 0
                        return (
                            <div key={i} style={{ width:100, border:'2px solid '+colors.green, padding:4, fontFamily:'Body', fontSize:11, color:colors.green }}>
                                <div>{item ? ShipData[item.type].name : '—'}</div>
                                <div style={{ width:'100%', height:6, border:'1px solid '+colors.green, marginTop:4 }}>
                                    {item?.startedAt && <div style={{ width:percent+'%', height:'100%', background:colors.green }}/>}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    // A drag-selected group of ships takes orders via the map itself — every click sets/adds a waypoint
    // onto each one's own route (see MapScene's handleClick) — this panel is just the selection readout
    // + bulk Clear Orders/Cancel.
    if(selectedShipIds.length > 0){
        const selectedShips = ships.filter(s => selectedShipIds.includes(s.id))
        return (
            <div style={{ position:'absolute', top:10, left:10, zIndex:2 }}>
                <div style={{ color:colors.green, fontFamily:'Body', fontSize:14 }}>
                    {selectedShips.length} unit{selectedShips.length === 1 ? '' : 's'} selected — click the map to give orders
                </div>
                <div style={{ marginTop:8, display:'flex' }}>
                    <ToolButton onClick={()=>clearShipWaypoints(selectedShipIds)}>Clear Orders</ToolButton>
                    <ToolButton onClick={()=>setSelectedShipIds([])}>Cancel</ToolButton>
                </div>
            </div>
        )
    }

    return <div style={{ position:'absolute', top:10, left:10, zIndex:2, color:colors.green, fontFamily:'Body', fontSize:14 }}>Click your Base to build ships, or drag to select units</div>
}
