import { describe, expect, it } from 'vitest';
import { buildShapedRing, rollingState } from '../src/geom/shapedRing';
import { buildGearProfile, defaultGearParams } from '../src/geom/involute';
import {
  SHAPE_PRESETS,
  circleShape,
  isCircle,
  pitchCurveForTeeth,
  radiusAt,
  unitPerimeter,
  type RingShape,
} from '../src/geom/shape';
import { TAU, type Pt } from '../src/geom/types';
import { PolyIndex } from './mesh';
import { defaultSegmentOptions, segmentRing } from '../src/geom/segment';
import { defaultGearDefaults, newRingSpec } from '../src/geom/gear';

const gp = defaultGearParams();
const { teeth: _t, internal: _i, ...BASE } = { ...gp, module: 3, kerf: 0.18, chordTol: 0.02 };

const preset = (id: string): RingShape => SHAPE_PRESETS.find((p) => p.id === id)!.shape;

describe('pitch curve', () => {
  it('scales every shape to exactly a whole number of tooth pitches', () => {
    for (const p of SHAPE_PRESETS) {
      for (const teeth of [60, 97, 120]) {
        const curve = pitchCurveForTeeth(p.shape, teeth, 3);
        expect(curve.length).toBeCloseTo(teeth * Math.PI * 3, 6);
      }
    }
  });

  it('gives a circle constant curvature equal to its radius', () => {
    const curve = pitchCurveForTeeth(circleShape(), 96, 3);
    expect(curve.scale).toBeCloseTo(144, 9);
    for (const s of [0, 100, 250, 400]) {
      expect(curve.at(s).rho).toBeCloseTo(144, 6);
    }
    expect(curve.minConvexRho).toBeCloseTo(144, 4);
    expect(curve.minConcaveRho).toBe(Infinity);
  });

  it('turns the tangent through exactly one full turn', () => {
    for (const p of SHAPE_PRESETS) {
      const curve = pitchCurveForTeeth(p.shape, 120, 3);
      expect(curve.at(curve.length).psi - curve.at(0).psi).toBeCloseTo(TAU, 4);
    }
  });

  it('reports concave stretches only where the curve really dents inward', () => {
    // A gentle oval is convex all the way round; a deep one is not.
    expect(pitchCurveForTeeth(preset('oval'), 120, 3).minConcaveRho).toBe(Infinity);
    expect(pitchCurveForTeeth({ ...circleShape(), lobes: 2, amplitude: 0.3 }, 120, 3).minConcaveRho).toBeLessThan(
      Infinity,
    );
  });

  it('agrees with a numerical perimeter', () => {
    const shape = preset('blob');
    let numeric = 0;
    const n = 20000;
    let prev: Pt | null = null;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * TAU;
      const r = radiusAt(shape, th).r;
      const q = { x: r * Math.cos(th), y: r * Math.sin(th) };
      if (prev) numeric += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    expect(unitPerimeter(shape)).toBeCloseTo(numeric, 4);
  });

  it('recognises a circle however it is spelled', () => {
    expect(isCircle(circleShape())).toBe(true);
    expect(isCircle({ ...circleShape(), lobes: 4, amplitude: 0 })).toBe(true);
    expect(isCircle({ ...circleShape(), lobes: 0, amplitude: 0.3 })).toBe(true);
    expect(isCircle(preset('oval'))).toBe(false);
  });
});

describe('a circular shape reproduces the circular ring', () => {
  const Z = 96;
  const shaped = buildShapedRing({ shape: circleShape(), teeth: Z, rimWidth: 15 }, BASE);
  const plain = buildGearProfile({ ...BASE, teeth: Z, internal: true });

  const radii = (pts: Pt[]) => pts.map((p) => Math.hypot(p.x, p.y));

  it('matches the tip and root circles exactly', () => {
    const a = radii(shaped.inner.pts);
    const b = radii(plain.path.pts);
    expect(Math.min(...a)).toBeCloseTo(Math.min(...b), 6);
    expect(Math.max(...a)).toBeCloseTo(Math.max(...b), 6);
  });

  it('leaves no step between neighbouring teeth', () => {
    expect(shaped.maxJointGap).toBeLessThan(1e-9);
  });

  it('cuts the same number of teeth', () => {
    // Count crossings of the pitch circle, as in the involute tests.
    const pitchR = 144;
    let crossings = 0;
    const pts = shaped.inner.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = Math.hypot(pts[i]!.x, pts[i]!.y) - pitchR;
      const b = Math.hypot(pts[(i + 1) % pts.length]!.x, pts[(i + 1) % pts.length]!.y) - pitchR;
      if (a < 0 && b >= 0) crossings++;
    }
    expect(crossings).toBe(Z);
  });
});

describe('teeth stay aligned on a blobby ring', () => {
  it('keeps the step between neighbouring teeth well under the kerf', () => {
    for (const p of SHAPE_PRESETS) {
      const ring = buildShapedRing({ shape: p.shape, teeth: 120, rimWidth: 14 }, BASE);
      expect(ring.maxJointGap).toBeLessThan(BASE.kerf / 2);
    }
  });

  it('warns rather than silently drifting when the shape is too aggressive for the tooth count', () => {
    // Deep lobes on a coarse tooth count: curvature changes a lot across one tooth.
    const ring = buildShapedRing(
      { shape: { ...circleShape(), lobes: 7, amplitude: 0.22 }, teeth: 40, rimWidth: 10 },
      BASE,
    );
    expect(ring.warnings.join(' ')).toMatch(/curvature|folds over/i);
  });

  it('warns when the rim is thicker than a concave bend can take', () => {
    const ring = buildShapedRing(
      { shape: { ...circleShape(), lobes: 2, amplitude: 0.32 }, teeth: 90, rimWidth: 120 },
      BASE,
    );
    expect(ring.warnings.join(' ')).toMatch(/folds over/i);
  });
});

describe('rolling inside a shaped ring', () => {
  it('reduces exactly to the hypotrochoid on a circle', () => {
    const Z = 96;
    const z = 32;
    const curve = pitchCurveForTeeth(circleShape(), Z, 3);
    const r = (3 * z) / 2;
    const R = (3 * Z) / 2;
    for (let i = 0; i <= 64; i++) {
      const theta = (i / 64) * TAU;
      const st = rollingState(curve, r, (theta / TAU) * curve.length);
      expect(st.centre.x).toBeCloseTo((R - r) * Math.cos(theta), 6);
      expect(st.centre.y).toBeCloseTo((R - r) * Math.sin(theta), 6);
      expect(st.rotation).toBeCloseTo(-((R - r) / r) * theta, 6);
    }
  });

  it('keeps the cog tangent to the pitch curve all the way round', () => {
    const curve = pitchCurveForTeeth(preset('blob'), 120, 3);
    const r = 43.5;
    for (let i = 0; i < 48; i++) {
      const s = (i / 48) * curve.length;
      const st = rollingState(curve, r, s);
      const contact = curve.at(s).p;
      expect(Math.hypot(st.centre.x - contact.x, st.centre.y - contact.y)).toBeCloseTo(r, 6);
    }
  });

  it('turns the cog by the same total angle a circular ring would', () => {
    // Closure depends only on the tooth counts, not the shape, because the
    // perimeter is a whole number of pitches either way.
    const N = 120;
    const z = 29;
    const r = (3 * z) / 2;
    for (const p of SHAPE_PRESETS) {
      const curve = pitchCurveForTeeth(p.shape, N, 3);
      // The *change* over the loop, not the absolute angle: the cog starts
      // turned to face the contact normal, which is not zero on a shape whose
      // harmonics are out of phase.
      const turned =
        rollingState(curve, r, curve.length).rotation - rollingState(curve, r, 0).rotation;
      expect(turned).toBeCloseTo(TAU - curve.length / r, 4);
      expect(turned).toBeCloseTo(-TAU * ((N - z) / z), 4);
    }
  });
});

describe('a cog rolls inside a blobby ring without binding', () => {
  const N = 120;
  const z = 29;
  const r = (3 * z) / 2;

  /**
   * Sweep the cog round the ring and return the tightest clearance, negative
   * if the cog ever enters the ring's material.
   *
   * Measured against a spatial index rather than a radius-versus-angle
   * profile: a blobby ring's teeth tilt far enough off-radial that the
   * boundary doubles back on itself, and a radial measurement silently
   * compares a tooth against the wrong neighbour. 47 sample positions over a
   * 120-tooth ring is deliberately coprime, so the samples land on many
   * different sub-tooth phases rather than only on tooth centres.
   */
  function sweep(shape: RingShape, steps = 47): number {
    const nominal = { ...BASE, kerf: 0, chordTol: 0.05 };
    const ring = buildShapedRing({ shape, teeth: N, rimWidth: 14 }, nominal);
    const cog = buildGearProfile({ ...nominal, teeth: z, internal: false });
    const curve = pitchCurveForTeeth(shape, N, 3);
    const index = new PolyIndex(ring.inner.pts);

    let worst = Infinity;
    for (let step = 0; step < steps; step++) {
      const st = rollingState(curve, r, (step / steps) * curve.length);
      const c = Math.cos(st.rotation);
      const sn = Math.sin(st.rotation);
      for (const q of cog.path.pts) {
        const p: Pt = {
          x: q.x * c - q.y * sn + st.centre.x,
          y: q.x * sn + q.y * c + st.centre.y,
        };
        const d = index.distanceTo(p);
        const gap = index.contains(p) ? d : -d;
        if (gap < worst) worst = gap;
      }
    }
    return worst;
  }

  for (const id of ['oval', 'triangular', 'blob', 'peanut']) {
    it(`clears all the way round the ${id}, convex and concave alike`, () => {
      const shape = preset(id);
      const ring = buildShapedRing({ shape, teeth: N, rimWidth: 14 }, { ...BASE, kerf: 0 });
      // The cog has to fit the tightest bend before anything else matters.
      expect(ring.minConvexRho).toBeGreaterThan(r);

      // The gap that remains is the designed backlash, shared between the
      // flanks, so it should land near half of it rather than merely above nil.
      const worst = sweep(shape);
      expect(worst).toBeGreaterThan(0);
      expect(worst).toBeCloseTo(BASE.backlash / 2, 1);
    });
  }

  it('reports interference when the cog is too big for the tightest bend', () => {
    const shape = preset('flower');
    const ring = buildShapedRing({ shape, teeth: N, rimWidth: 14 }, { ...BASE, kerf: 0 });
    // The flower pinches to about 71mm, so a 60-tooth cog at 90mm cannot enter.
    expect((3 * 60) / 2).toBeGreaterThan(ring.minConvexRho);
    expect((3 * z) / 2).toBeLessThan(ring.minConvexRho);
  });
});

describe('segmenting an oversized blobby ring', () => {
  const defs = { ...defaultGearDefaults(), chordTol: 0.03 };
  const opts = defaultSegmentOptions();
  // 420 teeth at module 3 is well over a metre across.
  const spec = { ...newRingSpec('bigblob', 420), rimWidth: 24, shape: preset('blob') };
  const result = segmentRing(spec, defs, 0.18, opts);

  it('splits by tooth count rather than by polar angle', () => {
    // Slicing a blob by equal angles would not land on tooth boundaries,
    // because its teeth are spaced by arc length, not by angle.
    expect(result.count).toBeGreaterThan(1);
    expect(result.segments.reduce((s, p) => s + p.meta.teeth, 0)).toBe(420);
  });

  it('makes one splice plate per joint', () => {
    expect(result.plates).toHaveLength(result.count);
    expect(result.plates.every((p) => p.kind === 'splice')).toBe(true);
  });

  it('fits every piece on the bed', () => {
    const availW = opts.bedWidth - opts.margin * 2;
    const availH = opts.bedHeight - opts.margin * 2;
    for (const part of [...result.segments, ...result.plates]) {
      const w = part.meta.bbox.maxX - part.meta.bbox.minX;
      const h = part.meta.bbox.maxY - part.meta.bbox.minY;
      expect((w <= availW && h <= availH) || (h <= availW && w <= availH)).toBe(true);
    }
  });

  it('gives every segment a closed outline with fixings at both joints', () => {
    for (const seg of result.segments) {
      expect(seg.cut[0]!.closed).toBe(true);
      // outline + 2 joints x (2 bolts + 1 dowel)
      expect(seg.cut.length).toBe(1 + 6);
      expect(seg.engrave.length).toBeGreaterThan(0);
    }
  });

  it('leaves a ring that already fits in one piece', () => {
    const small = { ...newRingSpec('okblob', 132), rimWidth: 18, shape: preset('blob') };
    expect(segmentRing(small, defs, 0.18, opts).count).toBe(1);
  });
});
