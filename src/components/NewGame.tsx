import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { Maps, Modal } from '../../enum';
import { saveFile as writeSaveFile, tryLoadFile } from '../common/Utils';
import { useAppStore } from '../common/store';
import ToolButton from './ToolButton'
export default () => {

    const [saveFile, setSave] = React.useState(null as SaveFile)

    React.useEffect(()=>{
        const getSave = async ()=>{
            const save = tryLoadFile()
            setSave(save)
        }
        getSave()
    },[])

    const startNewGame = () => {
        const save:SaveFile = { currentMap:Maps.Ambush, completedMaps:[], veteranShips:[] }
        const { setActiveMapKey, setSave } = useAppStore.getState()
        setSave(save)
        writeSaveFile(save)
        setActiveMapKey(save.currentMap)
        onShowModal(Modal.Briefing)
    }

    const continueGame = () => {
        if(!saveFile) return
        const { setActiveMapKey, setSave } = useAppStore.getState()
        setSave(saveFile)
        setActiveMapKey(saveFile.currentMap)
        onShowModal(Modal.Briefing)
    }

    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div>TOMB OF ADAM</div>
            <div style={{ display:'flex' }}>
                {saveFile && <ToolButton onClick={continueGame}>Continue</ToolButton>}
                <ToolButton onClick={startNewGame}>New</ToolButton>
                <ToolButton onClick={()=>console.log('quit!')}>Exit</ToolButton>
            </div>
        </div>
    )
}
