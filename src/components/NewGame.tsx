import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { Maps, Modal } from '../../enum';
import { MAP_SIZE } from '../common/Constants';
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
        const { setActiveMap, setActiveMapKey } = useAppStore.getState()
        // Everything real (grid size, ships, objectives) gets filled in from the loaded map file itself
        // once MapScene's create() runs (see spawnEntitiesFromMap and its width/height read-off right
        // before it) — this is just a placeholder shell so activeMap is non-null in the meantime.
        setActiveMap({ width:MAP_SIZE, height:MAP_SIZE, objectives:[], terrain:null })
        // The first map a new game ever loads — see Briefing, which actually starts MapScene once the
        // player clicks through it.
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
