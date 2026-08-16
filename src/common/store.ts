import { create } from 'zustand';
import { v4 } from 'uuid';
import type MapScene from '../components/scenes/MapScene';
import { Modal, ShipType, ShipData, Faction } from '../../enum';
import { MAX_WAYPOINTS, MAX_QUEUE, STARTING_METAL, gridToWorld } from './Constants';

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
  // Every ship in the match, both factions' — a faction's own Base (see enum.ts's ShipType.CATH) is
  // just another entry here, not a separate building collection the way it used to be.
  ships: Array<ShipData>;
  // The live (owner) half of every Objective on the map — see ObjectiveSpawn (in mapData/activeMap)
  // for each one's fixed id/position/sprite, decided once at generation and never duplicated here.
  objectives: Array<ObjectiveData>;
  // Every Asteroid/GasCloud currently on the map (see MapScene's spawnResourceNodes) — an Asteroid is
  // removed from this array outright once a Harvester drains its metal to 0 (see updateHarvesters).
  resourceNodes: Array<ResourceNodeData>;
  // Each faction's banked metal — starts at STARTING_METAL, collected by its Harvesters (see MapScene's
  // updateHarvesters), and spent up front the instant a ship is queued (see queueShip).
  metal: Record<Faction, number>;
  // The player's currently selected ship(s) — either a drag-selected group of combat ships (see
  // MapScene's drag-select box) taking move orders, or a single clicked Base opening its production
  // panel (see FactoryToolbar). Both go through this same field/setter; there's no separate
  // "selected building" concept anymore.
  selectedShipIds: Array<string>;
  setModal: (modal: Modal | null) => void;
  setScene: (scene: MapScene | null) => void;
  setSave: (save: SaveFile | null) => void;
  setLoaded: (loaded: boolean) => void;
  setActiveMap: (map: MapData | null) => void;
  setSelectedShipIds: (ids: Array<string>) => void;
  addShipWaypoints: (shipIds: Array<string>, x: number, y: number) => void;
  setShipWaypoints: (shipIds: Array<string>, x: number, y: number) => void;
  removeShipWaypoints: (shipIds: Array<string>, x: number, y: number) => void;
  clearShipWaypoints: (shipIds: Array<string>) => void;
  queueShip: (baseId: string, type: ShipType) => void;
  completeQueueItem: (baseId: string) => void;
  addShip: (ship: ShipData) => void;
  setShips: (ships: Array<ShipData>) => void;
  addObjective: (objective: ObjectiveData) => void;
  setObjectives: (objectives: Array<ObjectiveData>) => void;
  addResourceNode: (node: ResourceNodeData) => void;
  setResourceNodes: (nodes: Array<ResourceNodeData>) => void;
  addMetal: (faction: Faction, amount: number) => void;
}

const initialState = {
  activeModal: null as Modal | null,
  isLoaded: false,
  scene: null as MapScene | null,
  mySave: null as SaveFile | null,
  activeMap: null as MapData | null,
  ships: [] as Array<ShipData>,
  objectives: [] as Array<ObjectiveData>,
  resourceNodes: [] as Array<ResourceNodeData>,
  metal: { [Faction.Player]: STARTING_METAL, [Faction.Enemy]: STARTING_METAL } as Record<Faction, number>,
  selectedShipIds: [] as Array<string>,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setModal: (modal) => set({ activeModal: modal }),
  setScene: (scene) => set({ scene }),
  setSave: (mySave) => set({ mySave }),
  setLoaded: (isLoaded) => set({ isLoaded }),
  setActiveMap: (activeMap) => set({ activeMap }),
  setSelectedShipIds: (selectedShipIds) => set({ selectedShipIds }),
  // Appends one waypoint onto each selected ship's own route — used for a drag-selected group of combat
  // ships (a Base itself is never included; MapScene's handleClick filters it out before calling this,
  // since it never actually moves and doesn't hand orders down to newly produced ships anymore either —
  // see spawnShip). Each ship keeps whatever progress it's already made; this only adds on.
  addShipWaypoints: (shipIds, x, y) => set((state) => ({
    ships: state.ships.map((s) => {
      if(!shipIds.includes(s.id)) return s;
      const waypoints = s.waypoints || [];
      if(waypoints.length >= MAX_WAYPOINTS) return s;
      // A new order overrides ARMOR's own Objective-latch the same way it overrides anything else it
      // was doing — see ShipData's latchedObjectiveId/objectiveAttached.
      return { ...s, waypoints: [...waypoints, { x, y }], latchedObjectiveId: undefined, objectiveAttached: undefined };
    }),
  })),
  // A plain (non-shift) order-giving click — wipes whatever route a ship already had and replaces it
  // outright with this one single waypoint, rather than appending onto it (see addShipWaypoints, used
  // instead when shift is held). Same latch-clearing as any other new order.
  setShipWaypoints: (shipIds, x, y) => set((state) => ({
    ships: state.ships.map((s) => (shipIds.includes(s.id) ? { ...s, waypoints: [{ x, y }], pathIndex: 0, latchedObjectiveId: undefined, objectiveAttached: undefined } : s)),
  })),
  // Clicking an existing waypoint marker for a selection removes it from every selected ship that
  // actually has a waypoint there (not just the one whose marker was clicked), same click-to-remove
  // gesture as adding is a bulk operation. Ships with no matching waypoint are left untouched; each ship
  // that does have one keeps its own progress otherwise, resuming from whichever waypoint is nearest to
  // where it currently is.
  removeShipWaypoints: (shipIds, x, y) => set((state) => ({
    ships: state.ships.map((s) => {
      if(!shipIds.includes(s.id)) return s;
      const waypoints = s.waypoints || [];
      const index = waypoints.findIndex((w) => w.x === x && w.y === y);
      if(index < 0) return s;
      const newWaypoints = waypoints.filter((_, i) => i !== index);
      const p = s.pathIndex ?? 0;
      const minIndex = p > index ? p-1 : p;
      const pathIndex = minIndex >= newWaypoints.length ? newWaypoints.length : nearestWaypointIndex(s.x, s.y, newWaypoints, minIndex);
      return { ...s, waypoints: newWaypoints, pathIndex, latchedObjectiveId: undefined, objectiveAttached: undefined };
    }),
  })),
  // Selected ships drop their route and just sit wherever they currently are until new orders are given.
  clearShipWaypoints: (shipIds) => set((state) => ({
    ships: state.ships.map((s) => (shipIds.includes(s.id) ? { ...s, waypoints: [], pathIndex: 0, latchedObjectiveId: undefined, objectiveAttached: undefined } : s)),
  })),
  // Refuses outright — no queue change, no metal spent — if the queue's already full or the building
  // faction (the Base's own, not necessarily the player: the enemy AI's own queueShip calls go through
  // this exact same gate) can't afford metalCost. Paid up front the instant it's queued, not on
  // completion, same as the queue slot itself is claimed immediately.
  queueShip: (baseId, type) => set((state) => {
    const base = state.ships.find((s) => s.id === baseId);
    if(!base) return {};
    const queue = base.queue || [];
    if(queue.length >= MAX_QUEUE) return {};
    const cost = ShipData[type].metalCost;
    if((state.metal[base.faction] ?? 0) < cost) return {};

    const item: ProductionQueueItem = { id: v4(), type, startedAt: queue.length === 0 ? Date.now() : null };
    return {
      ships: state.ships.map((s) => (s.id === baseId ? { ...s, queue: [...queue, item] } : s)),
      metal: { ...state.metal, [base.faction]: state.metal[base.faction] - cost },
    };
  }),
  completeQueueItem: (baseId) => set((state) => ({
    ships: state.ships.map((s) => {
      if(s.id !== baseId) return s;
      const [, ...rest] = s.queue || [];
      if(rest.length > 0) rest[0] = { ...rest[0], startedAt: Date.now() };
      return { ...s, queue: rest };
    }),
  })),
  addShip: (ship) => set((state) => ({ ships: [...state.ships, ship] })),
  setShips: (ships) => set({ ships }),
  addObjective: (objective) => set((state) => ({ objectives: [...state.objectives, objective] })),
  setObjectives: (objectives) => set({ objectives }),
  addResourceNode: (node) => set((state) => ({ resourceNodes: [...state.resourceNodes, node] })),
  setResourceNodes: (resourceNodes) => set({ resourceNodes }),
  addMetal: (faction, amount) => set((state) => ({ metal: { ...state.metal, [faction]: state.metal[faction] + amount } })),
}));
