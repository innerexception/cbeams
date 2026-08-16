import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { Modal } from '../../enum';
import ToolButton from './ToolButton'
import { colors } from '../styles/AppStyles';

// Shown once either faction's base is destroyed (see MapScene's handleBaseDestroyed) — the match is
// paused underneath this the moment it appears. Quit is the only way out: back to the NewGame menu.
export default (props:{ won:boolean }) => {
    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ color:colors.green, fontFamily:'Body', fontSize:28, marginBottom:16, letterSpacing:2 }}>
                {props.won ? 'VICTORY' : 'DEFEAT'}
            </div>
            <ToolButton onClick={()=>onShowModal(Modal.NewGame)}>Quit</ToolButton>
        </div>
    )
}
