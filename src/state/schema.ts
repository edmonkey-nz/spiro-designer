/**
 * The saved design document.
 *
 * Everything the app knows lives in this one object, so "save" is a JSON dump
 * and "load" is a parse. `schemaVersion` plus `migrate` means a file written
 * today still opens after the format moves on.
 */

import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const hubSchema = z.object({
  boreDia: z.number().min(0).max(200),
  bossDia: z.number().min(0).max(400),
  boltCount: z.number().int().min(0).max(64),
  boltCircleDia: z.number().min(0).max(1000),
  boltDia: z.number().min(0).max(50),
  crosshair: z.boolean(),
});

const mountSchema = z.object({
  enabled: z.boolean(),
  count: z.number().int().min(0).max(128),
  circleDia: z.number().min(0).max(4000),
  holeDia: z.number().min(0).max(50),
});

const cutoutSchema = z.object({
  enabled: z.boolean(),
  count: z.number().int().min(0).max(64),
  webWidth: z.number().min(0).max(200),
  edgeMargin: z.number().min(0).max(200),
  cornerRadius: z.number().min(0).max(100),
});

const penHolesSchema = z.object({
  layout: z.enum(['radial-line', 'radial-spokes', 'spiral', 'ring']),
  count: z.number().int().min(1).max(200),
  arms: z.number().int().min(1).max(24),
  minR: z.number().min(0).max(4000),
  maxR: z.number().min(0).max(4000),
  dia: z.number().min(0.5).max(40),
  annotate: z.boolean(),
  annotateRadius: z.boolean(),
});

const baseSpec = {
  id: z.string().min(1),
  name: z.string(),
  teeth: z.number().int().min(3).max(2000),
  module: z.number().min(0.5).max(40).optional(),
  hub: hubSchema,
  mount: mountSchema,
  cutouts: cutoutSchema,
  label: z.boolean(),
};

export const cogSpecSchema = z.object({
  ...baseSpec,
  kind: z.literal('cog'),
  penHoles: penHolesSchema,
});

/**
 * Ring pitch-curve shape. Defaulted rather than required, so a design saved
 * before shapes existed still loads as the circle it was.
 */
export const ringShapeSchema = z
  .object({
    lobes: z.number().int().min(0).max(12),
    amplitude: z.number().min(-0.6).max(0.6),
    lobes2: z.number().int().min(0).max(12),
    amplitude2: z.number().min(-0.6).max(0.6),
    phase2: z.number().min(-360).max(360),
  })
  .default({ lobes: 0, amplitude: 0, lobes2: 0, amplitude2: 0, phase2: 0 });

export const ringSpecSchema = z.object({
  ...baseSpec,
  kind: z.literal('ring'),
  rimWidth: z.number().min(2).max(300),
  outerTeeth: z.boolean(),
  outerTeethCount: z.number().int().min(0).max(4000),
  shape: ringShapeSchema,
});

export const rackSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.literal('rack'),
  teeth: z.number().int().min(2).max(2000),
  module: z.number().min(0.5).max(40).optional(),
  bodyHeight: z.number().min(2).max(300),
  mount: mountSchema,
  label: z.boolean(),
});

export const partSpecSchema = z.discriminatedUnion('kind', [
  cogSpecSchema,
  ringSpecSchema,
  rackSpecSchema,
]);

export const setupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mode: z.enum(['inside-ring', 'outside-ring', 'rack', 'cog-on-cog']),
  /** Ring, fixed cog or rack. Null only makes sense mid-edit. */
  fixedPartId: z.string().nullable(),
  rollingPartId: z.string().nullable(),
  /**
   * 1-based pen hole indices, not ids: indices survive a change of hole layout,
   * which is exactly when a stored id would dangle.
   */
  penHoleIndices: z.array(z.number().int().min(1)).max(40),
});

export const machineSchema = z.object({
  bedWidth: z.number().min(50).max(5000),
  bedHeight: z.number().min(50).max(5000),
  kerf: z.number().min(0).max(2),
  materialThickness: z.number().min(0.5).max(50),
  margin: z.number().min(0).max(200),
  partGap: z.number().min(0).max(200),
  cutColor: z.string(),
  engraveColor: z.string(),
  strokeWidth: z.number().min(0.01).max(2),
});

export const gearDefaultsSchema = z.object({
  module: z.number().min(0.5).max(40),
  pressureAngleDeg: z.number().min(10).max(35),
  addendum: z.number().min(0.5).max(1.5),
  clearance: z.number().min(0).max(0.6),
  backlash: z.number().min(0).max(3),
  profileShift: z.number().min(-0.8).max(0.8),
  filletCoeff: z.number().min(0).max(0.5),
  chordTol: z.number().min(0.001).max(0.5),
});

export const designSchema = z.object({
  schemaVersion: z.number().int(),
  name: z.string(),
  units: z.literal('mm'),
  machine: machineSchema,
  defaults: gearDefaultsSchema,
  parts: z.array(partSpecSchema),
  setups: z.array(setupSchema),
});

export type Machine = z.infer<typeof machineSchema>;
export type Setup = z.infer<typeof setupSchema>;
export type Design = z.infer<typeof designSchema>;

export const defaultMachine = (): Machine => ({
  bedWidth: 900,
  bedHeight: 600,
  kerf: 0.18,
  materialThickness: 6,
  margin: 10,
  partGap: 5,
  cutColor: '#000000',
  engraveColor: '#0000ff',
  strokeWidth: 0.1,
});

export interface ParseResult {
  design?: Design;
  error?: string;
}

/**
 * Bring an older document up to the current shape. Unknown *newer* versions are
 * attempted anyway — a forward-compatible field is usually harmless, and
 * refusing to open the user's own file is worse than a validation message.
 */
function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const doc = { ...(raw as Record<string, unknown>) };
  if (typeof doc.schemaVersion !== 'number') doc.schemaVersion = SCHEMA_VERSION;
  if (doc.units !== 'mm') doc.units = 'mm';
  return doc;
}

export function parseDesign(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${(e as Error).message}` };
  }
  const result = designSchema.safeParse(migrate(raw));
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.join('.') || 'document';
    return { error: `${where}: ${first?.message ?? 'did not match the expected shape'}` };
  }
  return { design: result.data };
}

export function serializeDesign(design: Design): string {
  return JSON.stringify({ ...design, schemaVersion: SCHEMA_VERSION }, null, 2);
}
