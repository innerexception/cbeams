import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { SceneNames } from '../../enum';
import { MAP_SIZE, GREEN } from '../common/Constants';
import { tryLoadFile } from '../common/Utils';
import { useAppStore } from '../common/store';
import { generateMap } from '../common/MapGenerator';
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
        const { setActiveMap, scene } = useAppStore.getState()
        setActiveMap(generateMap(MAP_SIZE))
        onShowModal(null)
        scene?.scene.start(SceneNames.Main)
    }

    return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ display:'flex' }}>
                <ToolButton disabled={!saveFile} onClick={()=>onShowModal(null)}>Continue</ToolButton>
                <ToolButton onClick={startNewGame}>New</ToolButton>
                <ToolButton onClick={()=>console.log('quit!')}>Exit</ToolButton>
            </div>
            {!saveFile && <div style={{ color:GREEN, marginTop:6, fontSize:12, fontFamily:'Body' }}>No save found</div>}
        </div>
    )
}
