import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { Modal } from '../../enum';
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles';
import { useAppStore } from '../common/store';
import { MAP_METADATA } from '../assets/MapMetadata';

// Shown once either faction's base is destroyed (see MapScene's handleBaseDestroyed) — the match is
// paused underneath this the moment it appears. Quit is the only way out: back to the NewGame menu.
export default (props:{ won:boolean }) => {
    const { setActiveMapKey, activeMapKey } = useAppStore.getState()

    const loadNext = () => {
        const currentMap = MAP_METADATA[activeMapKey]
        const nextMap = props.won ? currentMap.victory : currentMap.defeat
        if(nextMap){
            setActiveMapKey(nextMap)
            onShowModal(Modal.Briefing)
        }
    }

    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ color:colors.green, fontFamily:'Body', marginBottom:16, letterSpacing:2 }}>
                {props.won ? 'VICTORY' : 'DEFEAT'}
            </div>
            <ToolButton onClick={()=>loadNext()}>Next</ToolButton>
        </div>
    )
}
