import * as React from 'react'
import { useAppStore } from '../common/store'
import { FactoryKind, ShipType, MAX_WAYPOINTS } from '../../enum'
import { ShipData } from '../common/ShipData'

const GREEN = '#33ff55'
const MAX_QUEUE = 3

const toolButtonStyle = (active:boolean, disabled?:boolean):React.CSSProperties => ({
    padding: '8px 14px',
    marginRight: '8px',
    background: active ? GREEN : 'black',
    color: active ? '#000' : GREEN,
    border: '2px solid '+GREEN,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontFamily: 'Body',
    fontSize: '14px',
    userSelect: 'none',
})

const hints = {
    [FactoryKind.MiningStation]: 'Click an asteroid to build a Mining Station',
    [FactoryKind.SolarMill]: 'Click a star to build a Solar Mill',
    [FactoryKind.Shipyard]: 'Click empty ground near your base to build a Shipyard',
}

export default () => {
    const { placingFactory, setPlacingFactory, selectedFactoryId, setSelectedFactoryId, factories, queueShip, clearWaypoints } = useAppStore((state) => ({
        placingFactory: state.placingFactory,
        setPlacingFactory: state.setPlacingFactory,
        selectedFactoryId: state.selectedFactoryId,
        setSelectedFactoryId: state.setSelectedFactoryId,
        factories: state.factories,
        queueShip: state.queueShip,
        clearWaypoints: state.clearWaypoints,
    }))

    // Re-render periodically so queue progress bars stay live.
    const [, forceTick] = React.useState(0)
    React.useEffect(() => {
        const interval = setInterval(() => forceTick(t => t+1), 200)
        return () => clearInterval(interval)
    }, [])

    const toggle = (kind:FactoryKind) => setPlacingFactory(placingFactory === kind ? null : kind)

    const selectedFactory = factories.find(f => f.id === selectedFactoryId)

    if(selectedFactory && selectedFactory.kind === FactoryKind.Shipyard){
        const queue = selectedFactory.queue || []
        const queueFull = queue.length >= MAX_QUEUE
        const waypoints = selectedFactory.waypoints || []
        // Orders editing is always live while a shipyard is selected (see MapScene's click handler) —
        // this button no longer gates that, it's kept purely as a labeled indicator of the mode.

        return (
            <div style={{ position:'absolute', top:10, left:10, zIndex:2 }}>
                <div style={{ display:'flex' }}>
                    {Object.values(ShipType).map(type => (
                        <div key={type} style={toolButtonStyle(false, queueFull)} onClick={()=>!queueFull && queueShip(selectedFactory.id, type)}>{ShipData[type].name}</div>
                    ))}
                    <div style={toolButtonStyle(false)} onClick={()=>setSelectedFactoryId(null)}>Cancel</div>
                </div>
                <div style={{ marginTop:8, display:'flex' }}>
                    <div style={toolButtonStyle(true)}>
                        Orders{waypoints.length > 0 ? ` (${waypoints.length}/${MAX_WAYPOINTS})` : ''}
                    </div>
                    {waypoints.length > 0 && <div style={toolButtonStyle(false)} onClick={()=>clearWaypoints(selectedFactory.id)}>Clear Orders</div>}
                </div>
                <div style={{ color:GREEN, marginTop:6, fontSize:12, fontFamily:'Body' }}>
                    {waypoints.length >= MAX_WAYPOINTS
                        ? `Waypoint limit reached (${MAX_WAYPOINTS}/${MAX_WAYPOINTS}). Click a waypoint to remove it.`
                        : `Click the map to add a waypoint (${waypoints.length}/${MAX_WAYPOINTS}), or click an existing one to remove it. Ships built here will follow this route.`}
                </div>
                <div style={{ marginTop:8, display:'flex', gap:8 }}>
                    {Array.from({ length: MAX_QUEUE }).map((_, i) => {
                        const item = queue[i]
                        const percent = item?.startedAt ? Math.min(100, ((Date.now()-item.startedAt)/ShipData[item.type].productionTimeMs)*100) : 0
                        return (
                            <div key={i} style={{ width:100, border:'2px solid '+GREEN, padding:4, fontFamily:'Body', fontSize:11, color:GREEN }}>
                                <div>{item ? ShipData[item.type].name : '—'}</div>
                                <div style={{ width:'100%', height:6, border:'1px solid '+GREEN, marginTop:4 }}>
                                    {item?.startedAt && <div style={{ width:percent+'%', height:'100%', background:GREEN }}/>}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div style={{ position:'absolute', top:10, left:10, zIndex:2 }}>
            <div style={{ display:'flex' }}>
                <div style={toolButtonStyle(placingFactory === FactoryKind.MiningStation)} onClick={()=>toggle(FactoryKind.MiningStation)}>Mining Station</div>
                <div style={toolButtonStyle(placingFactory === FactoryKind.SolarMill)} onClick={()=>toggle(FactoryKind.SolarMill)}>Solar Mill</div>
                <div style={toolButtonStyle(placingFactory === FactoryKind.Shipyard)} onClick={()=>toggle(FactoryKind.Shipyard)}>Shipyard</div>
            </div>
            {placingFactory && <div style={{ color: GREEN, marginTop: 6, fontSize: 12, fontFamily: 'Body' }}>{hints[placingFactory]}</div>}
        </div>
    )
}

