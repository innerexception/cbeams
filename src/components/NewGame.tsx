import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { Maps, Modal } from '../../enum';
import { tryLoadFile } from '../common/Utils';
import { useAppStore } from '../common/store';
import ToolButton from './ToolButton'
export default () => {

    const [saveFile, setSave] = React.useState(null as SaveFile)

    React.useEffect(()=>{
        const getSave = async ()=>{
            let save = await tryLoadFile()
            setSave(save)
        }
        getSave()
    },[])

    const startNewGame = () => {
        const { setActiveMapKey } = useAppStore.getState()
        setActiveMapKey(Maps.Ambush)
        onShowModal(Modal.Briefing)
    }

    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ display:'flex' }}>
                {saveFile && <ToolButton onClick={()=>onShowModal(null)}>Continue</ToolButton>}
                <ToolButton onClick={startNewGame}>New</ToolButton>
                <ToolButton onClick={()=>console.log('quit!')}>Exit</ToolButton>
            </div>
        </div>
    )
}
