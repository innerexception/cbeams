import { create } from 'zustand';
import { v4 } from 'uuid';
import type MapScene from '../components/scenes/MapScene';
import { Modal, BuildingType, VehicleType } from '../../enum';
import { MAX_WAYPOINTS, MAX_QUEUE, gridToWorld } from './Constants';

// Index of the closest waypoint at or after minIndex, so a retargeted route resumes from wherever
// the ship already is without ever sending it back to a waypoint it has already passed.
const nearestWaypointIndex = (shipX: number, shipY: number, waypoints: Array<{ x: number, y: number }>, minIndex = 0) => {
  let bestIndex = Math.min(minIndex, waypoints.length-1);
  let bestDistSq = Infinity;
  for(let i = minIndex; i < waypoints.length; i++){
    const p = gridToWorld(waypoints[i].x, waypoints[i].y);
    const distSq = (p.x-shipX)**2 + (p.y-shipY)**2;
    if(distSq < bestDistSq){ bestDistSq = distSq; bestIndex = i; }
  }
  return bestIndex;
};

export interface AppState {
  activeModal: Modal | null;
  isLoaded: boolean;
  scene: MapScene | null;
  mySave: SaveFile | null;
  activeMap: MapData | null;
  buildings: Array<BuildingData>;
  vehicles: Array<VehicleData>;
  placingFactory: BuildingType | null;
  selectedFactoryId: string | null;
  setModal: (modal: Modal | null) => void;
  setScene: (scene: MapScene | null) => void;
  setSave: (save: SaveFile | null) => void;
  setLoaded: (loaded: boolean) => void;
  setActiveMap: (map: MapData | null) => void;
  addFactory: (factory: BuildingData) => void;
  setFactories: (factories: Array<BuildingData>) => void;
  setPlacingBuilding: (kind: BuildingType | null) => void;
  setSelectedBuildingId: (id: string | null) => void;
  addWaypoint: (shipyardId: string, x: number, y: number) => void;
  removeWaypoint: (shipyardId: string, index: number) => void;
  clearWaypoints: (shipyardId: string) => void;
  queueShip: (shipyardId: string, type: VehicleType) => void;
  completeQueueItem: (shipyardId: string) => void;
  addShip: (ship: VehicleData) => void;
  setShips: (ships: Array<VehicleData>) => void;
}

const initialState = {
  activeModal: null as Modal | null,
  isLoaded: false,
  scene: null as MapScene | null,
  mySave: null as SaveFile | null,
  activeMap: null as MapData | null,
  buildings: [] as Array<BuildingData>,
  vehicles: [] as Array<VehicleData>,
  placingFactory: null as BuildingType | null,
  selectedFactoryId: null as string | null,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setModal: (modal) => set({ activeModal: modal }),
  setScene: (scene) => set({ scene }),
  setSave: (mySave) => set({ mySave }),
  setLoaded: (isLoaded) => set({ isLoaded }),
  setActiveMap: (activeMap) => set({ activeMap }),
  addFactory: (factory) => set((state) => ({ buildings: [...state.buildings, factory] })),
  setFactories: (factories) => set({ buildings: factories }),
  setPlacingBuilding: (placingFactory) => set((state) => ({
    placingFactory,
    selectedFactoryId: placingFactory ? null : state.selectedFactoryId,
  })),
  setSelectedBuildingId: (selectedFactoryId) => set((state) => ({
    selectedFactoryId,
    placingFactory: selectedFactoryId ? null : state.placingFactory,
  })),
  // Existing ships from this shipyard retarget onto the edited route whenever orders change, resuming
  // from whichever waypoint is nearest to where each ship currently is rather than starting over.
  addWaypoint: (shipyardId, x, y) => set((state) => {
    let newWaypoints: Array<{ x: number, y: number }> | null = null;
    const factories = state.buildings.map((f) => {
      if(f.id !== shipyardId) return f;
      const waypoints = f.waypoints || [];
      if(waypoints.length >= MAX_WAYPOINTS) return f;
      newWaypoints = [...waypoints, { x, y }];
      return { ...f, waypoints: newWaypoints };
    });
    if(!newWaypoints) return { buildings: factories };
    const waypoints = newWaypoints;
    return {
      buildings: factories,
      vehicles: state.vehicles.map((s) => (s.shipyardId === shipyardId ? { ...s, pathIndex: nearestWaypointIndex(s.x, s.y, waypoints, s.pathIndex ?? 0), orbitAnchor: undefined } : s)),
    };
  }),
  // Removing one waypoint shifts every later index down by one, so each ship's progress is carried
  // over onto the same physical point it was already heading for (or the nearest one after it).
  removeWaypoint: (shipyardId, index) => set((state) => {
    let newWaypoints: Array<{ x: number, y: number }> | null = null;
    const factories = state.buildings.map((f) => {
      if(f.id !== shipyardId) return f;
      const waypoints = f.waypoints || [];
      if(index < 0 || index >= waypoints.length) return f;
      newWaypoints = waypoints.filter((_, i) => i !== index);
      return { ...f, waypoints: newWaypoints };
    });
    if(!newWaypoints) return { buildings: factories };
    const waypoints = newWaypoints;
    return {
      buildings: factories,
      vehicles: state.vehicles.map((s) => {
        if(s.shipyardId !== shipyardId) return s;
        const p = s.pathIndex ?? 0;
        const minIndex = p > index ? p-1 : p;
        const pathIndex = minIndex >= waypoints.length ? waypoints.length : nearestWaypointIndex(s.x, s.y, waypoints, minIndex);
        return { ...s, pathIndex, orbitAnchor: undefined };
      }),
    };
  }),
  // Ships from this shipyard drop their route and loiter in place (orbiting wherever they currently
  // are) until new orders are given; orbitAnchor is cleared so movement re-anchors on their position now.
  clearWaypoints: (shipyardId) => set((state) => ({
    buildings: state.buildings.map((f) => (f.id === shipyardId ? { ...f, waypoints: [] } : f)),
    vehicles: state.vehicles.map((s) => (s.shipyardId === shipyardId ? { ...s, pathIndex: 0, orbitAnchor: undefined } : s)),
  })),
  queueShip: (shipyardId, type) => set((state) => ({
    buildings: state.buildings.map((f) => {
      if(f.id !== shipyardId) return f;
      const queue = f.queue || [];
      if(queue.length >= MAX_QUEUE) return f;
      const item: ProductionQueueItem = { id: v4(), type, startedAt: queue.length === 0 ? Date.now() : null };
      return { ...f, queue: [...queue, item] };
    }),
  })),
  completeQueueItem: (shipyardId) => set((state) => ({
    buildings: state.buildings.map((f) => {
      if(f.id !== shipyardId) return f;
      const [, ...rest] = f.queue || [];
      if(rest.length > 0) rest[0] = { ...rest[0], startedAt: Date.now() };
      return { ...f, queue: rest };
    }),
  })),
  addShip: (ship) => set((state) => ({ vehicles: [...state.vehicles, ship] })),
  setShips: (ships) => set({ vehicles: ships }),
}));
