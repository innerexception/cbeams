import * as React from 'react'
import { useAppStore } from '../common/store'
import { BuildingType, VehicleType, VehicleData, Faction, BuildingData } from '../../enum'
import { MAX_QUEUE, MAX_WAYPOINTS, LOGISTICS_CENTER_COUNT, BUILDING_POINTS_BUDGET } from '../common/Constants'
import { getLogisticsStatus, getVehicleLogisticsCost } from '../common/Utils'
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles'

const hints = {
    [BuildingType.CRAM]: 'Click empty ground near your base to build a CRAM Turret',
    [BuildingType.BLM]: 'Click empty ground near your base to build a BLM',
    [BuildingType.THADD]: 'Click empty ground near your base to build a THADD',
    [BuildingType.AmmoDump]: 'Click empty ground near your base to build an AmmoDump — lines show which buildings would be in resupply range',
}

export default () => {
    const { phase, placingFactory, setPlacingFactory, selectedFactoryId, setSelectedFactoryId, factories, queueShip, clearWaypoints, buildingPoints } = useAppStore((state) => ({
        phase: state.phase,
        placingFactory: state.placingFactory,
        setPlacingFactory: state.setPlacingBuilding,
        selectedFactoryId: state.selectedFactoryId,
        setSelectedFactoryId: state.setSelectedBuildingId,
        factories: state.buildings,
        queueShip: state.queueShip,
        clearWaypoints: state.clearWaypoints,
        buildingPoints: state.buildingPoints,
    }))

    // Re-render periodically so queue progress bars (and, during placement, the LogisticsCenter
    // counter) stay live.
    const [, forceTick] = React.useState(0)
    React.useEffect(() => {
        const interval = setInterval(() => forceTick(t => t+1), 200)
        return () => clearInterval(interval)
    }, [])

    const toggle = (kind:BuildingType) => setPlacingFactory(placingFactory === kind ? null : kind)

    if(phase === 'placement'){
        const placed = factories.filter(f => f.faction === Faction.Player && f.kind === BuildingType.LogisticsCenter).length
        return (
            <div style={{ position:'absolute', top:10, left:10, zIndex:2, color:colors.lGreen, fontFamily:'Body', fontSize:14 }}>
                <div>Place your LogisticsCenters: {placed} / {LOGISTICS_CENTER_COUNT}</div>
                <div style={{ marginTop:6, fontSize:12 }}>
                    Click anywhere on your side of the map. Each one must be at least 500px from any other.
                </div>
            </div>
        )
    }
    if(phase === 'building'){
        return (
            <div style={{ position:'absolute', top:10, left:10, zIndex:2 }}>
                {phase === 'building' && (
                    <div style={{ color:colors.lGreen, marginBottom:6, fontFamily:'Body', fontSize:14 }}>
                        Building points remaining: {buildingPoints[Faction.Player]} / {BUILDING_POINTS_BUDGET}
                    </div>
                )}
                <div style={{ display:'flex' }}>
                    {Object.keys(BuildingType).filter((t:BuildingType)=>BuildingData[t].buildingPoints).map((b:BuildingType)=>
                        <ToolButton active={placingFactory === b} onClick={()=>toggle(b)}>{b} ({BuildingData[b].buildingPoints})</ToolButton>
                    )}
                </div>
                {placingFactory && <div style={{ color: colors.lGreen, marginTop: 6, fontSize: 12, fontFamily: 'Body' }}>{hints[placingFactory]}</div>}
            </div>
        )
    }

    const selectedFactory = factories.find(f => f.id === selectedFactoryId)

    if(selectedFactory && selectedFactory.kind === BuildingType.LogisticsCenter){
        const queue = selectedFactory.queue || []
        const queueFull = queue.length >= MAX_QUEUE
        const waypoints = selectedFactory.waypoints || []
        // Orders editing is always live while a shipyard is selected (see MapScene's click handler) —
        // this button no longer gates that, it's kept purely as a labeled indicator of the mode.

        // Recomputed every render (this component already re-renders on its 200ms tick) so a button
        // disables the instant the shared logistics budget can no longer fit that vehicle's cost.
        const { logisticsRemaining } = getLogisticsStatus(selectedFactory.faction)

        return (
            <div style={{ position:'absolute', top:10, left:10, zIndex:2 }}>
                <div style={{ display:'flex' }}>
                    {Object.values(VehicleType).map(type => (
                        <ToolButton key={type} disabled={queueFull || logisticsRemaining < getVehicleLogisticsCost(type)} onClick={()=>queueShip(selectedFactory.id, type)}>{VehicleData[type].name}</ToolButton>
                    ))}
                    <ToolButton onClick={()=>setSelectedFactoryId(null)}>Cancel</ToolButton>
                </div>
                <div style={{ marginTop:8, display:'flex' }}>
                    <ToolButton active>
                        Orders{waypoints.length > 0 ? ` (${waypoints.length}/${MAX_WAYPOINTS})` : ''}
                    </ToolButton>
                    {waypoints.length > 0 && <ToolButton onClick={()=>clearWaypoints(selectedFactory.id)}>Clear Orders</ToolButton>}
                </div>
                <div style={{ color:colors.lGreen, marginTop:6, fontSize:12, fontFamily:'Body' }}>
                    {waypoints.length >= MAX_WAYPOINTS
                        ? `Waypoint limit reached (${MAX_WAYPOINTS}/${MAX_WAYPOINTS}). Click a waypoint to remove it.`
                        : `Click the map to add a waypoint (${waypoints.length}/${MAX_WAYPOINTS}), or click an existing one to remove it. Ships built here will follow this route.`}
                </div>
                <div style={{ marginTop:8, display:'flex', gap:8 }}>
                    {Array.from({ length: MAX_QUEUE }).map((_, i) => {
                        const item = queue[i]
                        const percent = item?.startedAt ? Math.min(100, ((Date.now()-item.startedAt)/VehicleData[item.type].productionTimeMs)*100) : 0
                        return (
                            <div key={i} style={{ width:100, border:'2px solid '+colors.lGreen, padding:4, fontFamily:'Body', fontSize:11, color:colors.lGreen }}>
                                <div>{item ? VehicleData[item.type].name : '—'}</div>
                                <div style={{ width:'100%', height:6, border:'1px solid '+colors.lGreen, marginTop:4 }}>
                                    {item?.startedAt && <div style={{ width:percent+'%', height:'100%', background:colors.lGreen }}/>}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return <div>Select a logistics center to deploy units</div>

}
