import { useAppStore } from './store';
import { Modal, ShipAckSounds, SoundEffects } from '../../enum';
import MapScene from '../components/scenes/MapScene';

export const onSetScene = (s: MapScene | null) => {
    useAppStore.getState().setScene(s);
};

export const onShowModal = (m: Modal | null) => {
    const { scene, setModal, playerSettings } = useAppStore.getState();
    scene?.sound.get(SoundEffects.Click)?.play(undefined, { volume: playerSettings.volume });
    setModal(m);
};

// Sets the selection same as setSelectedShipIds, but also acknowledges it with a random ack1-4 voice
// line — only when the selection is actually growing/changing to a non-empty one, not when it's being
// cleared (ESC, clicking empty space) or silently trimmed (a selected ship dying, see MapScene's
// useAppStore.subscribe), both of which go through setSelectedShipIds directly instead of this.
export const onSelectShips = (ids: Array<string>) => {
    const { scene, playerSettings, setSelectedShipIds } = useAppStore.getState();
    if(ids.length > 0){
        const ack = ShipAckSounds[Math.floor(Math.random() * ShipAckSounds.length)];
        scene?.sound.get(ack)?.play(undefined, { volume: playerSettings.volume });
    }
    setSelectedShipIds(ids);
};