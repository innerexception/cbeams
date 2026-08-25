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

    // Loads `save` into the store and hands off to Briefing for whichever map it's currently on — shared
    // by both New (a freshly-created save) and Continue (the one already on disk).
    const enterGame = (save:SaveFile) => {
        const { setActiveMapKey, setSave } = useAppStore.getState()
        setSave(save)
        setActiveMapKey(save.currentMap)
        onShowModal(Modal.Briefing)
    }

    const startNewGame = () => {
        const save:SaveFile = { currentMap:Maps.Ambush, completedMaps:[], veteranShips:[] }
        writeSaveFile(save)
        enterGame(save)
    }

    const continueGame = () => {
        if(!saveFile) return
        enterGame(saveFile)
    }

    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
            <div style={{fontSize:'48px', fontFamily:'Phase1'}}>TOMB OF ADAM</div>
            <div style={{fontSize:'24px', marginBottom:'1em'}}>TOMB OF ADAM</div>
            <div style={{ display:'flex' }}>
                {saveFile && <ToolButton onClick={continueGame}>Continue</ToolButton>}
                <ToolButton onClick={startNewGame}>New</ToolButton>
                <ToolButton onClick={()=>console.log('quit!')}>Exit</ToolButton>
            </div>
        </div>
    )
}
