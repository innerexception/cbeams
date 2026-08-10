import { useAppStore } from './store';
import { Modal, SoundEffects } from '../../enum';
import MapScene from '../components/scenes/MapScene';

export const onSetScene = (s: MapScene | null) => {
    useAppStore.getState().setScene(s);
};

export const onShowModal = (m: Modal | null) => {
    const { scene, setModal } = useAppStore.getState();
    scene?.sound.get(SoundEffects.Click)?.play();
    setModal(m);
};