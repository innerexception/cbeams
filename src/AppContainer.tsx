import * as React from 'react'
import { Modal } from '../enum';
import Viewport from './components/Viewport';
import NewGame from './components/NewGame';
import FactoryToolbar from './components/FactoryToolbar';
import ResourceHUD from './components/ResourceHUD';
import { useAppStore } from './common/store';

export default () => {
  const { activeModal, isLoaded } = useAppStore((state) => ({
    activeModal: state.activeModal,
    isLoaded: state.isLoaded,
  }));

  const getModal = () => {
    switch (activeModal) {
      case Modal.NewGame:
        return <NewGame />;
      default:
        return <span />;
    }
  };

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {activeModal && <div style={{ position: 'absolute', height: 'fit-content', width: '500px', left: 0, right: 0, bottom: 0, top: 0, margin: 'auto', zIndex: 1 }}>{getModal()}</div>}
      <div style={{ position: 'relative' }}>
        {activeModal !== Modal.NewGame && isLoaded && <FactoryToolbar />}
        {activeModal !== Modal.NewGame && isLoaded && <ResourceHUD />}
        <Viewport />
      </div>
    </div>
  );
};

