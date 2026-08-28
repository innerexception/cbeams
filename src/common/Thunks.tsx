import { useAppStore } from './store';
import { Modal, ShipAckSounds, ShipType, SoundEffects } from '../../enum';
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

// FactoryToolbar's own Strike button — arms/disarms an STL's manual targeting (see store's own
// targetingShipId doc comment, and MapScene's handleClick, which is what actually fires once a valid
// target is clicked). Reads the real ShipSprite (not the store's low-frequency ShipSummary, which
// doesn't carry ammoRemaining at all — see that interface's own doc comment for why) so a truly
// out-of-ammo STL can't be armed in the first place, rather than arming and then silently doing nothing
// on the next click.
export const onToggleStrikeTargeting = (shipId: string) => {
    const { scene, targetingShipId, setTargetingShipId } = useAppStore.getState();
    if(targetingShipId === shipId){
        setTargetingShipId(null);
        return;
    }
    const ship = scene?.shipSprites.get(shipId);
    if(!ship || !ship.ammoRemaining) return;
    setTargetingShipId(shipId);
};

// FactoryToolbar's own 3-way DRN build-type buttons. KKZ/HUSK queue immediately (a no-op if the DRN's
// already mid-build or out of ammo — see MapScene's own queueDrnBuild, which enforces that). EYE instead
// arms/disarms drnEyeTargetShipId — building one needs a launch destination first, so the actual
// queueDrnBuild call for EYE happens in MapScene's handleClick once the player picks one, not here.
export const onDrnBuildTypeClicked = (shipId: string, type: ShipType) => {
    const { scene, drnEyeTargetShipId, setDrnEyeTargetShipId } = useAppStore.getState();
    if(type === ShipType.EYE){
        setDrnEyeTargetShipId(drnEyeTargetShipId === shipId ? null : shipId);
        return;
    }
    scene?.queueDrnBuild(shipId, type);
};