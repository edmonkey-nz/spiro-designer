import { describe, expect, it } from 'vitest';
import {
  carrierState,
  curveInfo,
  curveMetrics,
  greatestCommonDivisor,
  penAt,
  sampleCurve,
  type CurveSpec,
} from '../src/geom/curves';
import { TAU } from '../src/geom/types';

const spec = (over: Partial<CurveSpec> = {}): CurveSpec => ({
  mode: 'inside-ring',
  fixedTeeth: 96,
  rollingTeeth: 32,
  module: 3,
  penR: 30,
  penTheta: 0,
  ...over,
});

describe('closure', () => {
  it('returns the pen exactly to its start after the predicted turns', () => {
    for (const [Z, z] of [
      [96, 32],
      [157, 43],
      [100, 36],
      [63, 28],
    ] as const) {
      for (const mode of ['inside-ring', 'outside-ring'] as const) {
        const s = spec({ mode, fixedTeeth: Z, rollingTeeth: z });
        const info = curveInfo(s);
        const start = penAt(s, 0);
        const end = penAt(s, info.thetaMax);
        expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(1e-9);
      }
    }
  });

  it('does not close early', () => {
    const s = spec({ fixedTeeth: 157, rollingTeeth: 43 });
    const info = curveInfo(s);
    const start = penAt(s, 0);
    // Check every earlier whole carrier turn.
    for (let n = 1; n < info.carrierRevs; n++) {
      const p = penAt(s, TAU * n);
      expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeGreaterThan(1e-6);
    }
  });

  it('counts petals and turns from the tooth counts', () => {
    expect(curveInfo(spec({ fixedTeeth: 96, rollingTeeth: 32 }))).toMatchObject({
      petals: 3,
      carrierRevs: 1,
    });
    expect(curveInfo(spec({ fixedTeeth: 157, rollingTeeth: 43 }))).toMatchObject({
      petals: 157,
      carrierRevs: 43,
    });
    expect(curveInfo(spec({ fixedTeeth: 100, rollingTeeth: 36 }))).toMatchObject({
      petals: 25,
      carrierRevs: 9,
    });
  });

  it('agrees with gcd', () => {
    expect(greatestCommonDivisor(157, 43)).toBe(1);
    expect(greatestCommonDivisor(96, 32)).toBe(32);
    expect(greatestCommonDivisor(100, 36)).toBe(4);
  });
});

describe('degenerate cases', () => {
  it('draws a circle of radius R-r when the pen sits on the cog centre', () => {
    const s = spec({ penR: 0 });
    const pts = sampleCurve(s, { perCogRev: 400 });
    const radii = pts.map((p) => Math.hypot(p.x, p.y));
    const expected = (3 * (96 - 32)) / 2;
    for (const r of radii) expect(r).toBeCloseTo(expected, 9);
    expect(curveInfo(s).degenerate).toBe(true);
  });

  it('flags a cog the same size as the ring', () => {
    expect(curveInfo(spec({ fixedTeeth: 48, rollingTeeth: 48 })).degenerate).toBe(true);
  });

  it('draws a straight line for the Tusi couple, R = 2r with the pen on the pitch circle', () => {
    // 64 teeth inside 128, pen at the cog's pitch radius: the classic degenerate
    // hypotrochoid, and a sharp check that the rolling relation is right.
    const s = spec({ fixedTeeth: 128, rollingTeeth: 64, module: 2, penR: 64 });
    const pts = sampleCurve(s, { perCogRev: 200 });
    for (const p of pts) expect(Math.abs(p.y)).toBeLessThan(1e-9);
    expect(Math.max(...pts.map((p) => Math.abs(p.x)))).toBeCloseTo(128, 6);
  });
});

describe('rolling without slipping', () => {
  it('keeps the contact point stationary on both bodies, inside a ring', () => {
    // Arc travelled along the ring must equal arc travelled around the cog.
    const s = spec({ fixedTeeth: 96, rollingTeeth: 32 });
    const R = (s.module * s.fixedTeeth) / 2;
    const r = (s.module * s.rollingTeeth) / 2;
    for (const theta of [0.3, 1.1, 2.7, 5.0]) {
      const { rotation } = carrierState(s, theta);
      // The contact point sweeps R*theta along the ring while the carrier
      // carries the cog centre through r*theta of that, so the cog must spin
      // off the difference against its own circumference.
      expect(-rotation * r).toBeCloseTo((R - r) * theta, 9);
    }
  });

  it('keeps the cog tangent to the ring at every angle', () => {
    const s = spec({ fixedTeeth: 96, rollingTeeth: 32 });
    const R = (s.module * s.fixedTeeth) / 2;
    const r = (s.module * s.rollingTeeth) / 2;
    for (const theta of [0, 0.7, 2.2, 4.4]) {
      const { centre } = carrierState(s, theta);
      expect(Math.hypot(centre.x, centre.y) + r).toBeCloseTo(R, 9);
    }
  });

  it('places the cog centre one pitch radius above a rack', () => {
    const s = spec({ mode: 'rack', rollingTeeth: 24, rackTeeth: 40 });
    const r = (s.module * 24) / 2;
    for (const theta of [0, 1, 3]) {
      const { centre, rotation } = carrierState(s, theta);
      expect(centre.y).toBeCloseTo(r, 9);
      expect(centre.x).toBeCloseTo(r * theta, 9);
      expect(rotation).toBeCloseTo(-theta, 9);
    }
  });
});

describe('metrics', () => {
  it('bounds a hypotrochoid by R - r + d', () => {
    const s = spec({ penR: 30 });
    const m = curveMetrics(sampleCurve(s, { perCogRev: 600 }));
    expect(m.outerRadius).toBeCloseTo((3 * (96 - 32)) / 2 + 30, 2);
  });

  it('reports a non-zero drawn length and paper size', () => {
    const m = curveMetrics(sampleCurve(spec(), { perCogRev: 400 }));
    expect(m.length).toBeGreaterThan(100);
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBeGreaterThan(0);
  });
});

describe('pen hole angle', () => {
  it('starts the pen at its cog-frame angle when the carrier is at zero', () => {
    const s = spec({ penR: 20, penTheta: Math.PI / 3 });
    const p = penAt(s, 0);
    const centre = carrierState(s, 0).centre;
    expect(p.x - centre.x).toBeCloseTo(20 * Math.cos(Math.PI / 3), 9);
    expect(p.y - centre.y).toBeCloseTo(20 * Math.sin(Math.PI / 3), 9);
  });

  it('produces the same curve rotated, for a different hole on the same circle', () => {
    // Two holes at the same radius trace congruent curves, so their metrics match.
    // Sampled at finite resolution, so the extremes land a few microns apart.
    const a = curveMetrics(sampleCurve(spec({ penTheta: 0 }), { perCogRev: 400 }));
    const b = curveMetrics(sampleCurve(spec({ penTheta: 1.234 }), { perCogRev: 400 }));
    expect(Math.abs(b.outerRadius - a.outerRadius)).toBeLessThan(1e-3);
    expect(Math.abs(b.length - a.length)).toBeLessThan(1e-3);
  });
});
