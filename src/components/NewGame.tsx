import * as React from 'react'
import { onShowModal } from '../common/Thunks';
import { Modal, SceneNames, MAP_SIZE } from '../../enum';
import { tryLoadFile } from '../common/Utils';
import { useAppStore } from '../common/store';
import { generateMap } from '../common/MapGenerator';

// Matches FactoryToolbar's look: transparent green-on-black terminal buttons.
const GREEN = '#33ff55'

const toolButtonStyle = (disabled?:boolean):React.CSSProperties => ({
    padding: '8px 14px',
    marginRight: '8px',
    background: 'black',
    color: GREEN,
    border: '2px solid '+GREEN,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontFamily: 'Body',
    fontSize: '14px',
    userSelect: 'none',
})

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
                <div style={toolButtonStyle(!saveFile)} onClick={()=>saveFile && onShowModal(null)}>Continue</div>
                <div style={toolButtonStyle(false)} onClick={startNewGame}>New</div>
                <div style={toolButtonStyle(false)} onClick={()=>console.log('quit!')}>Exit</div>
            </div>
            {!saveFile && <div style={{ color:GREEN, marginTop:6, fontSize:12, fontFamily:'Body' }}>No save found</div>}
        </div>
    )
}
