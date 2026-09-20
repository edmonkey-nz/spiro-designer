import { describe, expect, it } from 'vitest';
import { buildGearProfile, defaultGearParams } from '../src/geom/involute';
import {
  buildCog,
  buildRack,
  buildRing,
  defaultGearDefaults,
  newCogSpec,
  newRackSpec,
  newRingSpec,
  outerTeethFor,
  penHoleBand,
} from '../src/geom/gear';
import { bboxHeight, bboxWidth } from '../src/geom/types';
import { meshClearanceExternal, meshClearanceInternal } from './mesh';

const FLAT = 5e-4;
const defs = () => ({ ...defaultGearDefaults(), chordTol: FLAT });

const profile = (teeth: number, module: number, internal: boolean) =>
  buildGearProfile({ ...defaultGearParams(), teeth, module, internal, kerf: 0, chordTol: FLAT }).path.pts;

/**
 * The tightest clearance is a *radial* difference rather than a true normal
 * distance, so it understates the gap on steep flanks. It is still a sound
 * collision test — positive means the profiles do not overlap — which is what
 * matters here.
 */
describe('meshing without binding', () => {
  it('clears through a full tooth engagement for a cog inside a ring', () => {
    const m = 3;
    for (const [Z, z] of [
      [96, 32],
      [157, 43],
      [96, 43],
      [120, 24],
    ] as const) {
      const check = meshClearanceInternal(profile(Z, m, true), profile(z, m, false), Z, z, m);
      expect(check.minClearance).toBeGreaterThan(0);
    }
  });

  it('clears for two external cogs rolling on each other', () => {
    const m = 3;
    for (const [a, b] of [
      [50, 30],
      [60, 24],
    ] as const) {
      const check = meshClearanceExternal(profile(a, m, false), profile(b, m, false), a, b, m);
      expect(check.minClearance).toBeGreaterThan(0);
    }
  });

  it('binds when the pair is built at mismatched modules', () => {
    // A sanity check on the checker itself: a 4mm cog cannot run in a 3mm ring.
    const check = meshClearanceInternal(profile(96, 3, true), profile(32, 4, false), 96, 32, 3);
    expect(check.minClearance).toBeLessThan(0);
  });

  it('loses clearance as backlash goes to zero', () => {
    const m = 3;
    const pts = (teeth: number, internal: boolean, backlash: number) =>
      buildGearProfile({
        ...defaultGearParams(),
        teeth,
        module: m,
        internal,
        backlash,
        kerf: 0,
        chordTol: FLAT,
      }).path.pts;
    const loose = meshClearanceInternal(pts(96, true, 0.4), pts(32, false, 0.4), 96, 32, m);
    const tight = meshClearanceInternal(pts(96, true, 0), pts(32, false, 0), 96, 32, m);
    expect(loose.minClearance).toBeGreaterThan(tight.minClearance);
  });
});

describe('buildCog', () => {
  const d = defs();
  const spec = newCogSpec('c1', 43);
  const part = buildCog(spec, d, 0.18);

  it('reports the nominal radii and a sane cut length', () => {
    expect(part.meta.pitchR).toBeCloseTo((43 * d.module) / 2, 9);
    expect(part.meta.tipR).toBeCloseTo(part.meta.pitchR + d.module, 9);
    expect(part.meta.cutLength).toBeGreaterThan(2 * Math.PI * part.meta.pitchR);
  });

  it('places every pen hole inside the usable band', () => {
    const band = penHoleBand(spec, part.meta.rootR);
    expect(part.meta.penHoles).toHaveLength(spec.penHoles.count);
    for (const h of part.meta.penHoles) {
      expect(h.r).toBeGreaterThanOrEqual(band.min - 1e-9);
      expect(h.r).toBeLessThanOrEqual(band.max + 1e-9);
    }
  });

  it('numbers pen holes from 1 with no gaps', () => {
    expect(part.meta.penHoles.map((h) => h.index)).toEqual(
      part.meta.penHoles.map((_, i) => i + 1),
    );
  });

  it('cuts a bore and a closed outline', () => {
    expect(part.cut.length).toBeGreaterThan(1);
    expect(part.cut.every((p) => p.closed)).toBe(true);
    expect(part.engrave.length).toBeGreaterThan(0);
  });

  it('fits inside a square of the tip diameter', () => {
    const outer = 2 * (part.meta.tipR + 0.09);
    expect(bboxWidth(part.meta.bbox)).toBeLessThanOrEqual(outer + 1e-6);
    expect(bboxHeight(part.meta.bbox)).toBeLessThanOrEqual(outer + 1e-6);
  });
});

describe('buildRing', () => {
  const d = defs();

  it('puts the outer edge one rim width beyond the root circle', () => {
    const spec = newRingSpec('r1', 96);
    const part = buildRing(spec, d, 0.18);
    expect(part.meta.outerR).toBeCloseTo(part.meta.rootR + spec.rimWidth, 9);
    expect(part.meta.tipR).toBeLessThan(part.meta.pitchR);
  });

  it('derives an outer tooth count that clears the inner root circle', () => {
    const spec = { ...newRingSpec('r2', 96), outerTeeth: true, rimWidth: 24 };
    const zOuter = outerTeethFor(spec, d);
    expect(zOuter).toBeGreaterThan(spec.teeth);
    const part = buildRing(spec, d, 0.18);
    expect(part.meta.outerR).toBeGreaterThan(part.meta.rootR);
    expect(part.meta.warnings.join(' ')).not.toMatch(/too close/);
  });

  it('warns and clamps when the rim is too thin for outer teeth', () => {
    const spec = { ...newRingSpec('r3', 96), outerTeeth: true, rimWidth: 2 };
    const part = buildRing(spec, d, 0.18);
    expect(part.meta.warnings.join(' ')).toMatch(/rim width/i);
    // Clamped rather than abandoned: the part is still cuttable.
    expect(part.meta.outerR).toBeGreaterThan(part.meta.rootR + 4);
  });
});

describe('buildRack', () => {
  const d = defs();

  it('spaces teeth at the circular pitch', () => {
    const spec = newRackSpec('k1', 10);
    const part = buildRack(spec, d, 0);
    const pitch = Math.PI * d.module;
    expect(part.meta.teeth).toBe(10);
    expect(bboxWidth(part.meta.bbox)).toBeCloseTo(10 * pitch, 6);
  });

  it('reaches one addendum above and one dedendum below the pitch line', () => {
    const part = buildRack(newRackSpec('k2', 6), d, 0);
    const ys = part.cut[0]!.pts.map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(d.module * d.addendum, 6);
    expect(Math.min(...ys)).toBeCloseTo(
      -(d.module * (d.addendum + d.clearance) + newRackSpec('k2', 6).bodyHeight),
      6,
    );
  });
});
