/**
 * Application store and the derived build.
 *
 * Building a big ring costs a few milliseconds, which is enough to be felt
 * while dragging a slider, so built parts are memoised on the exact inputs that
 * affect them (the spec, the shared tooth defaults and the kerf) and nothing
 * else.
 */

import { create } from 'zustand';
import { buildPart, type GearDefaults, type PartSpec } from '../geom/gear';
import { newCogSpec, newRackSpec, newRingSpec } from '../geom/gear';
import type { Part } from '../geom/types';
import type { CurveSpec, RollMode } from '../geom/curves';
import { moduleOf } from '../geom/gear';
import { defaultDesign } from './presets';
import type { Design, Setup } from './schema';

// ---------------------------------------------------------------------------
// memoised part building

const cache = new Map<string, Part>();
const CACHE_LIMIT = 200;

function buildKey(spec: PartSpec, defaults: GearDefaults, kerf: number): string {
  return JSON.stringify([spec, defaults, kerf]);
}

export function buildPartCached(spec: PartSpec, defaults: GearDefaults, kerf: number): Part {
  const key = buildKey(spec, defaults, kerf);
  const hit = cache.get(key);
  if (hit) return hit;
  const part = buildPart(spec, defaults, kerf);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, part);
  return part;
}

export function buildAll(design: Design): Part[] {
  return design.parts.map((s) => buildPartCached(s, design.defaults, design.machine.kerf));
}

// ---------------------------------------------------------------------------
// store

let nextId = 1;
const genId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export interface DesignState {
  design: Design;
  activePartId: string | null;
  activeSetupId: string | null;
  /** Last message to show in the status bar, e.g. after a load or export. */
  status: string | null;

  setDesign: (design: Design, status?: string) => void;
  patchDesign: (patch: Partial<Design>) => void;
  updateMachine: (patch: Partial<Design['machine']>) => void;
  updateDefaults: (patch: Partial<GearDefaults>) => void;

  addPart: (kind: PartSpec['kind']) => void;
  duplicatePart: (id: string) => void;
  updatePart: (id: string, patch: Partial<PartSpec>) => void;
  removePart: (id: string) => void;
  selectPart: (id: string | null) => void;

  addSetup: () => void;
  updateSetup: (id: string, patch: Partial<Setup>) => void;
  removeSetup: (id: string) => void;
  selectSetup: (id: string | null) => void;

  setStatus: (status: string | null) => void;
}

const firstOf = (design: Design, kind: PartSpec['kind']): string | null =>
  design.parts.find((p) => p.kind === kind)?.id ?? null;

export const useDesign = create<DesignState>((set, get) => ({
  design: defaultDesign(),
  activePartId: defaultDesign().parts[0]?.id ?? null,
  activeSetupId: defaultDesign().setups[0]?.id ?? null,
  status: null,

  setDesign: (design, status) =>
    set({
      design,
      activePartId: design.parts[0]?.id ?? null,
      activeSetupId: design.setups[0]?.id ?? null,
      status: status ?? null,
    }),

  patchDesign: (patch) => set((s) => ({ design: { ...s.design, ...patch } })),

  updateMachine: (patch) =>
    set((s) => ({ design: { ...s.design, machine: { ...s.design.machine, ...patch } } })),

  updateDefaults: (patch) =>
    set((s) => ({ design: { ...s.design, defaults: { ...s.design.defaults, ...patch } } })),

  addPart: (kind) => {
    const id = genId(kind[0]!);
    const spec =
      kind === 'cog' ? newCogSpec(id, 32) : kind === 'ring' ? newRingSpec(id, 96) : newRackSpec(id, 60);
    set((s) => ({ design: { ...s.design, parts: [...s.design.parts, spec] }, activePartId: id }));
  },

  duplicatePart: (id) => {
    const src = get().design.parts.find((p) => p.id === id);
    if (!src) return;
    const copy = { ...structuredClone(src), id: genId(src.kind[0]!), name: `${src.name} copy` };
    set((s) => ({ design: { ...s.design, parts: [...s.design.parts, copy] }, activePartId: copy.id }));
  },

  updatePart: (id, patch) =>
    set((s) => ({
      design: {
        ...s.design,
        parts: s.design.parts.map((p) => (p.id === id ? ({ ...p, ...patch } as PartSpec) : p)),
      },
    })),

  removePart: (id) =>
    set((s) => {
      const parts = s.design.parts.filter((p) => p.id !== id);
      // Drop the part from any setup that referenced it rather than leaving a
      // dangling id that would silently break the simulator.
      const setups = s.design.setups.map((su) => ({
        ...su,
        fixedPartId: su.fixedPartId === id ? null : su.fixedPartId,
        rollingPartId: su.rollingPartId === id ? null : su.rollingPartId,
      }));
      return {
        design: { ...s.design, parts, setups },
        activePartId: s.activePartId === id ? (parts[0]?.id ?? null) : s.activePartId,
      };
    }),

  selectPart: (id) => set({ activePartId: id }),

  addSetup: () => {
    const design = get().design;
    const id = genId('s');
    const setup: Setup = {
      id,
      name: `Setup ${design.setups.length + 1}`,
      mode: 'inside-ring',
      fixedPartId: firstOf(design, 'ring'),
      rollingPartId: firstOf(design, 'cog'),
      penHoleIndices: [1],
    };
    set((s) => ({ design: { ...s.design, setups: [...s.design.setups, setup] }, activeSetupId: id }));
  },

  updateSetup: (id, patch) =>
    set((s) => ({
      design: {
        ...s.design,
        setups: s.design.setups.map((su) => (su.id === id ? { ...su, ...patch } : su)),
      },
    })),

  removeSetup: (id) =>
    set((s) => {
      const setups = s.design.setups.filter((su) => su.id !== id);
      return {
        design: { ...s.design, setups },
        activeSetupId: s.activeSetupId === id ? (setups[0]?.id ?? null) : s.activeSetupId,
      };
    }),

  selectSetup: (id) => set({ activeSetupId: id }),

  setStatus: (status) => set({ status }),
}));

// ---------------------------------------------------------------------------
// derivations

export function partById(design: Design, id: string | null): PartSpec | undefined {
  return id ? design.parts.find((p) => p.id === id) : undefined;
}

/**
 * Turn a setup into the curve spec the simulator consumes.
 *
 * The pen radius comes from the *built* cog's hole list, so the number the
 * maths uses is literally the number engraved on the part.
 */
export function curveForSetup(
  design: Design,
  setup: Setup | undefined,
  parts: Part[],
  holeIndex?: number,
): CurveSpec | null {
  if (!setup || !setup.rollingPartId) return null;
  const rollingSpec = partById(design, setup.rollingPartId);
  const fixedSpec = partById(design, setup.fixedPartId);
  if (!rollingSpec) return null;
  if (setup.mode !== 'rack' && !fixedSpec) return null;

  const rollingPart = parts.find((p) => p.id === setup.rollingPartId);
  const index = holeIndex ?? setup.penHoleIndices[0] ?? 1;
  const hole = rollingPart?.meta.penHoles.find((h) => h.index === index);

  return {
    mode: setup.mode as RollMode,
    fixedTeeth: fixedSpec?.teeth ?? 0,
    rollingTeeth: rollingSpec.teeth,
    module: moduleOf(rollingSpec, design.defaults),
    penR: hole?.r ?? 0,
    penTheta: hole?.theta ?? 0,
    rackTeeth: fixedSpec?.kind === 'rack' ? fixedSpec.teeth : undefined,
    shape: fixedSpec?.kind === 'ring' ? fixedSpec.shape : undefined,
  };
}

/** Distinct colours for multi-pen runs; deliberately readable in both themes. */
export const PEN_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];
