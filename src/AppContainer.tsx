import * as React from 'react'
import { Modal } from '../enum';
import Viewport from './components/Viewport';
import NewGame from './components/NewGame';
import Briefing from './components/Briefing';
import GameOverModal from './components/GameOverModal';
import FactoryToolbar from './components/FactoryToolbar';
import { useAppStore } from './common/store';
import { FLOOR_PADDING_PX, MODAL_PADDING_PX } from './styles/AppStyles';
import { stars } from './assets/Assets';

export default () => {
  const { activeModal, isLoaded } = useAppStore((state) => ({
    activeModal: state.activeModal,
    isLoaded: state.isLoaded,
  }));

  const getModal = () => {
    switch (activeModal) {
      case Modal.NewGame:
        return <NewGame />;
      case Modal.Victory:
        return <GameOverModal won={true} />;
      case Modal.Defeat:
        return <GameOverModal won={false} />;
      default:
        return <span />;
    }
  };

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {activeModal === Modal.Briefing && <Briefing />}
      {activeModal && activeModal !== Modal.Briefing && <div style={{ position: 'absolute', height: '100%', width: '100%', zIndex: 1, padding: MODAL_PADDING_PX, backgroundImage:'url('+stars+')', backgroundSize:'2048px, 2048px', backgroundPosition:'center', display:'flex', justifyContent:'center'  }}>{getModal()}</div>}
      <div style={{ position: 'relative', height: '100%', width: '100%', boxSizing: 'border-box' }}>
        {!activeModal && isLoaded && <FactoryToolbar />}
        <Viewport />
      </div>
    </div>
  );
};

