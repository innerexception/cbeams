import { create } from 'zustand';
import { v4 } from 'uuid';
import type MapScene from '../components/scenes/MapScene';
import { Modal, FactoryKind, ShipType, MAX_WAYPOINTS, CELL_SIZE } from '../../enum';

// Mirrors MapScene's grid-to-world conversion so ship-to-waypoint distances can be compared here too.
const toWorld = (x: number, y: number) => ({ x: x*CELL_SIZE + CELL_SIZE/2, y: y*CELL_SIZE + CELL_SIZE/2 });

// Index of the waypoint closest to a ship's current position, so a retargeted route resumes from
// wherever the ship already is rather than always restarting at the first waypoint.
const nearestWaypointIndex = (shipX: number, shipY: number, waypoints: Array<{ x: number, y: number }>) => {
  let bestIndex = 0;
  let bestDistSq = Infinity;
  waypoints.forEach((w, i) => {
    const p = toWorld(w.x, w.y);
    const distSq = (p.x-shipX)**2 + (p.y-shipY)**2;
    if(distSq < bestDistSq){ bestDistSq = distSq; bestIndex = i; }
  });
  return bestIndex;
};

interface AppState {
  activeModal: Modal | null;
  isLoaded: boolean;
  scene: MapScene | null;
  mySave: SaveFile | null;
  activeMap: MapData | null;
  factories: Array<FactoryData>;
  ships: Array<ShipInstanceData>;
  placingFactory: FactoryKind | null;
  selectedFactoryId: string | null;
  settingWaypointsFactoryId: string | null;
  metal: number;
  setModal: (modal: Modal | null) => void;
  setScene: (scene: MapScene | null) => void;
  setSave: (save: SaveFile | null) => void;
  setLoaded: (loaded: boolean) => void;
  setActiveMap: (map: MapData | null) => void;
  addFactory: (factory: FactoryData) => void;
  setPlacingFactory: (kind: FactoryKind | null) => void;
  setSelectedFactoryId: (id: string | null) => void;
  setSettingWaypointsFactoryId: (id: string | null) => void;
  addWaypoint: (shipyardId: string, x: number, y: number) => void;
  clearWaypoints: (shipyardId: string) => void;
  addMetal: (amount: number) => void;
  queueShip: (shipyardId: string, type: ShipType) => void;
  completeQueueItem: (shipyardId: string) => void;
  addShip: (ship: ShipInstanceData) => void;
  setShips: (ships: Array<ShipInstanceData>) => void;
}

const initialState = {
  activeModal: null as Modal | null,
  isLoaded: false,
  scene: null as MapScene | null,
  mySave: null as SaveFile | null,
  activeMap: null as MapData | null,
  factories: [] as Array<FactoryData>,
  ships: [] as Array<ShipInstanceData>,
  placingFactory: null as FactoryKind | null,
  selectedFactoryId: null as string | null,
  settingWaypointsFactoryId: null as string | null,
  metal: 0,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setModal: (modal) => set({ activeModal: modal }),
  setScene: (scene) => set({ scene }),
  setSave: (mySave) => set({ mySave }),
  setLoaded: (isLoaded) => set({ isLoaded }),
  setActiveMap: (activeMap) => set({ activeMap }),
  addFactory: (factory) => set((state) => ({ factories: [...state.factories, factory] })),
  setPlacingFactory: (placingFactory) => set((state) => ({
    placingFactory,
    selectedFactoryId: placingFactory ? null : state.selectedFactoryId,
    settingWaypointsFactoryId: placingFactory ? null : state.settingWaypointsFactoryId,
  })),
  setSelectedFactoryId: (selectedFactoryId) => set((state) => ({
    selectedFactoryId,
    placingFactory: selectedFactoryId ? null : state.placingFactory,
    settingWaypointsFactoryId: selectedFactoryId === state.settingWaypointsFactoryId ? state.settingWaypointsFactoryId : null,
  })),
  setSettingWaypointsFactoryId: (settingWaypointsFactoryId) => set({ settingWaypointsFactoryId }),
  // Existing ships from this shipyard retarget onto the edited route whenever orders change, resuming
  // from whichever waypoint is nearest to where each ship currently is rather than starting over.
  addWaypoint: (shipyardId, x, y) => set((state) => {
    let newWaypoints: Array<{ x: number, y: number }> | null = null;
    const factories = state.factories.map((f) => {
      if(f.id !== shipyardId) return f;
      const waypoints = f.waypoints || [];
      if(waypoints.length >= MAX_WAYPOINTS) return f;
      newWaypoints = [...waypoints, { x, y }];
      return { ...f, waypoints: newWaypoints };
    });
    if(!newWaypoints) return { factories };
    const waypoints = newWaypoints;
    return {
      factories,
      ships: state.ships.map((s) => (s.shipyardId === shipyardId ? { ...s, pathIndex: nearestWaypointIndex(s.x, s.y, waypoints) } : s)),
    };
  }),
  clearWaypoints: (shipyardId) => set((state) => ({
    factories: state.factories.map((f) => (f.id === shipyardId ? { ...f, waypoints: [] } : f)),
    ships: state.ships.map((s) => (s.shipyardId === shipyardId ? { ...s, pathIndex: 0 } : s)),
  })),
  addMetal: (amount) => set((state) => ({ metal: state.metal + amount })),
  queueShip: (shipyardId, type) => set((state) => ({
    factories: state.factories.map((f) => {
      if(f.id !== shipyardId) return f;
      const queue = f.queue || [];
      if(queue.length >= 3) return f;
      const item: ProductionQueueItem = { id: v4(), type, startedAt: queue.length === 0 ? Date.now() : null };
      return { ...f, queue: [...queue, item] };
    }),
  })),
  completeQueueItem: (shipyardId) => set((state) => ({
    factories: state.factories.map((f) => {
      if(f.id !== shipyardId) return f;
      const [, ...rest] = f.queue || [];
      if(rest.length > 0) rest[0] = { ...rest[0], startedAt: Date.now() };
      return { ...f, queue: rest };
    }),
  })),
  addShip: (ship) => set((state) => ({ ships: [...state.ships, ship] })),
  setShips: (ships) => set({ ships }),
}));
