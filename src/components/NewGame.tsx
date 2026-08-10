import * as React from 'react'
import { Button } from '../common/Shared';
import AppStyles from '../styles/AppStyles';
import { onShowModal } from '../common/Thunks';
import { Modal, SceneNames, MAP_SIZE } from '../../enum';
import { tryLoadFile } from '../common/Utils';
import { useAppStore } from '../common/store';
import { generateMap } from '../common/MapGenerator';

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
        <div style={{...AppStyles.modal, width:400}}>
                <div style={{display:'flex', justifyContent:'space-between'}}>
                    <div style={{width:'100px'}}>
                        <Button text="Continue" disabled={!saveFile} disabledTooltip={<div>No save found</div>} handler={()=>{onShowModal(null)}} />
                    </div>
                    <div style={{width:'100px'}}>
                        <Button text="New" handler={startNewGame} />
                    </div>
                    <div style={{width:'100px'}}>
                        <Button text="Exit" handler={()=>console.log('quit!')} />
                    </div>
                </div>
        </div>
    )
}
    