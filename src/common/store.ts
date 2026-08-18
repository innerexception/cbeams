import { create } from 'zustand';
import type MapScene from '../components/scenes/MapScene';
import { Faction, Modal, ShipType } from '../../enum';

export interface AppState {
  activeModal: Modal | null;
  isLoaded: boolean;
  scene: MapScene | null;
  mySave: SaveFile | null;
  activeMap: MapData | null;
  // A low-frequency summary of every ship in the match, both factions' — see ShipSummary's own doc
  // comment (types.d.ts) for why this isn't the real ship data. Pushed by MapScene's
  // syncShipSummaries, never mutated directly here.
  ships: Array<ShipSummary>;
  // The live (owner) half of every Objective on the map — see ObjectiveSpawn (in mapData/activeMap)
  // for each one's fixed id/position/sprite, decided once at generation and never duplicated here.
  objectives: Array<ObjectiveData>;
  // Every Asteroid currently on the map (see MapScene's spawnEntitiesFromMap) — removed from this array
  // outright once a Harvester drains its metal to 0 (see updateHarvesters). There's no faction-wide
  // metal stockpile anymore — a GAIN ship carries what it mines itself (see ShipSprite's metalCarried).
  resourceNodes: Array<ResourceNodeData>;
  // The player's currently selected ship(s) — either a drag-selected group of combat ships (see
  // MapScene's drag-select box) taking move orders, or a single clicked Base opening its production
  // panel (see FactoryToolbar). Both go through this same field/setter; there's no separate
  // "selected building" concept anymore.
  selectedShipIds: Array<string>;
  // Each faction's own running Machine Relics count — starts at zero, gains one every time that faction
  // captures an Objective (see MapScene's updateObjectives), and is spent building ships (see MapScene's
  // tickProduction/Utils' getShipRelicCost). A simple stockpile, not a per-ship-in-the-field upkeep cap
  // the way logistics used to be — there's nothing that hands relics back once spent.
  machineRelics: Record<Faction, number>;
  setModal: (modal: Modal | null) => void;
  setScene: (scene: MapScene | null) => void;
  setSave: (save: SaveFile | null) => void;
  setLoaded: (loaded: boolean) => void;
  setActiveMap: (map: MapData | null) => void;
  setSelectedShipIds: (ids: Array<string>) => void;
  // Every one of these actually mutates a real ShipSprite instance on the scene (see MapScene's own
  // methods of the same name) — none of it lives in this store. Kept here purely as the stable,
  // store-shaped API surface React components (FactoryToolbar) and MapScene's own AI helpers
  // (AIPlayers.ts) already call through, same as any other store action.
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
  // Positive to award (an Objective capture), negative to spend (a completed build) — either way just a
  // delta against that faction's current total, never a replace.
  addMachineRelics: (faction: Faction, amount: number) => void;
}

const initialState = {
  activeModal: null as Modal | null,
  isLoaded: false,
  scene: null as MapScene | null,
  mySave: null as SaveFile | null,
  activeMap: null as MapData | null,
  ships: [] as Array<ShipSummary>,
  objectives: [] as Array<ObjectiveData>,
  resourceNodes: [] as Array<ResourceNodeData>,
  selectedShipIds: [] as Array<string>,
  machineRelics: { [Faction.Player]: 0, [Faction.Enemy]: 0 } as Record<Faction, number>,
};

export const useAppStore = create<AppState>((set, get) => ({
  ...initialState,
  setModal: (modal) => set({ activeModal: modal }),
  setScene: (scene) => set({ scene }),
  setSave: (mySave) => set({ mySave }),
  setLoaded: (isLoaded) => set({ isLoaded }),
  setActiveMap: (activeMap) => set({ activeMap }),
  setSelectedShipIds: (selectedShipIds) => set({ selectedShipIds }),
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
