import { create } from 'zustand';
import type MapScene from '../components/scenes/MapScene';
import { Faction, Maps, Modal, ShipType } from '../../enum';

export interface PlayerSettings {
  volume: number;
  musicVolume: number;
}

export interface AppState {
  activeModal: Modal | null;
  isLoaded: boolean;
  scene: MapScene | null;
  playerSettings: PlayerSettings;
  mySave: SaveFile | null;
  activeMapKey: Maps;
  // A low-frequency summary of every ship in the match, both factions' — see ShipSummary's own doc
  // comment (types.d.ts) for why this isn't the real ship data. Pushed by MapScene's
  // syncShipSummaries, never mutated directly here.
  ships: Array<ShipSummary>;
  objectives: Array<ObjectiveData>;
  resourceNodes: Array<ResourceNodeData>;
  selectedShipIds: Array<string>;
  // The STL currently armed and awaiting a manual strike target (see Thunks' onToggleStrikeTargeting,
  // MapScene's own handleClick, and FactoryToolbar's Strike button) — null when nothing's targeting.
  // Only ever the sole selected ship's id; setSelectedShipIds itself clears this the instant the
  // selection changes to anything else, so "changing the selection ends targeting" holds regardless of
  // which code path actually changed it (a fresh order, ESC, a ship dying, ...).
  targetingShipId: string | null;
  machineRelics: Record<Faction, number>;
  setModal: (modal: Modal | null) => void;
  setScene: (scene: MapScene | null) => void;
  setVolume: (volume: number) => void;
  setMusicVolume: (musicVolume: number) => void;
  setSave: (save: SaveFile | null) => void;
  setLoaded: (loaded: boolean) => void;
  setActiveMapKey: (key: Maps) => void;
  setSelectedShipIds: (ids: Array<string>) => void;
  setTargetingShipId: (id: string | null) => void;
  addShipWaypoints: (shipIds: Array<string>, x: number, y: number) => void;
  setShipWaypoints: (shipIds: Array<string>, x: number, y: number) => void;
  removeShipWaypoints: (shipIds: Array<string>, x: number, y: number) => void;
  clearShipWaypoints: (shipIds: Array<string>) => void;
  queueShip: (baseId: string, type: ShipType) => void;
  completeQueueItem: (baseId: string) => void;
  setShips: (ships: Array<ShipSummary>) => void;
  addObjective: (objective: ObjectiveData) => void;
  setObjectives: (objectives: Array<ObjectiveData>) => void;
  addResourceNode: (node: ResourceNodeData) => void;
  setResourceNodes: (nodes: Array<ResourceNodeData>) => void;
  addMachineRelics: (faction: Faction, amount: number) => void;
}

const DEFAULT_VOLUME = 0.1;
const DEFAULT_MUSIC_VOLUME = 0.05;

const initialState = {
  activeModal: null as Modal | null,
  isLoaded: false,
  scene: null as MapScene | null,
  playerSettings: { volume: DEFAULT_VOLUME, musicVolume: DEFAULT_MUSIC_VOLUME } as PlayerSettings,
  mySave: null as SaveFile | null,
  activeMapKey: null,
  ships: [] as Array<ShipSummary>,
  objectives: [] as Array<ObjectiveData>,
  resourceNodes: [] as Array<ResourceNodeData>,
  selectedShipIds: [] as Array<string>,
  targetingShipId: null as string | null,
  machineRelics: { [Faction.Player]: 0, [Faction.Enemy]: 0 } as Record<Faction, number>,
};

export const useAppStore = create<AppState>((set, get) => ({
  ...initialState,
  setModal: (modal) => set({ activeModal: modal }),
  setScene: (scene) => set({ scene }),
  setVolume: (volume) => set((state) => ({ playerSettings: { ...state.playerSettings, volume } })),
  setMusicVolume: (musicVolume) => set((state) => ({ playerSettings: { ...state.playerSettings, musicVolume } })),
  setSave: (mySave) => set({ mySave }),
  setLoaded: (isLoaded) => set({ isLoaded }),
  setActiveMapKey: (activeMapKey) => set({ activeMapKey }),
  setSelectedShipIds: (selectedShipIds) => set((state) => ({
    selectedShipIds,
    targetingShipId: (state.targetingShipId && selectedShipIds.length === 1 && selectedShipIds[0] === state.targetingShipId)
      ? state.targetingShipId : null,
  })),
  setTargetingShipId: (targetingShipId) => set({ targetingShipId }),
  addShipWaypoints: (shipIds, x, y) => get().scene?.addShipWaypoints(shipIds, x, y),
  setShipWaypoints: (shipIds, x, y) => get().scene?.setShipWaypoints(shipIds, x, y),
  removeShipWaypoints: (shipIds, x, y) => get().scene?.removeShipWaypoints(shipIds, x, y),
  clearShipWaypoints: (shipIds) => get().scene?.clearShipWaypoints(shipIds),
  queueShip: (baseId, type) => get().scene?.queueShip(baseId, type),
  completeQueueItem: (baseId) => get().scene?.completeQueueItem(baseId),
  setShips: (ships) => set({ ships }),
  addObjective: (objective) => set((state) => ({ objectives: [...state.objectives, objective] })),
  setObjectives: (objectives) => set({ objectives }),
  addResourceNode: (node) => set((state) => ({ resourceNodes: [...state.resourceNodes, node] })),
  setResourceNodes: (resourceNodes) => set({ resourceNodes }),
  addMachineRelics: (faction, amount) => set((state) => ({
    machineRelics: { ...state.machineRelics, [faction]: (state.machineRelics[faction] ?? 0) + amount },
  })),
}));
