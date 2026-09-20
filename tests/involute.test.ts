import { describe, expect, it } from 'vitest';
import { buildGearProfile, defaultGearParams, gearRadii, toothThickness } from '../src/geom/involute';
import { deg, involuteFn, clamp } from '../src/geom/types';
import { outsideArcWidths, radiusOf, totalArcThickness, unwrappedAngles } from './helpers';

/**
 * Tests run at a far finer flattening tolerance than the 0.05mm production
 * default, and dimensional assertions are stated against that tolerance rather
 * than a fixed number of decimal places.
 *
 * The reason: chords always fall inside the true curve, so a measurement taken
 * off the flattened polyline understates arc thickness by almost exactly the
 * sagitta — which is `chordTol` by construction. Asserting to 4dp would not be
 * testing the involute maths, it would be testing the flattening budget.
 * `stays within the flattening tolerance` below pins the production value.
 */
const FLAT = 1e-4;

/** Slack for a measurement taken off a polyline flattened to FLAT. */
const NEAR = FLAT * 3;

const base = (over: Partial<ReturnType<typeof defaultGearParams>> = {}) => ({
  ...defaultGearParams(),
  kerf: 0,
  chordTol: FLAT,
  ...over,
});

const expectNear = (actual: number, expected: number, tol = NEAR) =>
  expect(Math.abs(actual - expected)).toBeLessThan(tol);

/** Theoretical involute arc tooth thickness at radius rho. */
function theoreticalThickness(rho: number, r: number, rb: number, sAtPitch: number, alpha: number): number {
  const ar = Math.acos(clamp(rb / rho, -1, 1));
  return 2 * rho * (sAtPitch / (2 * r) + involuteFn(alpha) - involuteFn(ar));
}

describe('external involute profile', () => {
  const p = base({ teeth: 32, module: 3 });
  const prof = buildGearProfile(p);
  const pts = prof.path.pts;

  it('produces exactly one tooth per tooth count', () => {
    expect(outsideArcWidths(pts, prof.radii.pitch)).toHaveLength(32);
  });

  it('keeps every point between the root and tip circles', () => {
    const radii = pts.map(radiusOf);
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(prof.radii.root - 1e-6);
    expect(Math.max(...radii)).toBeLessThanOrEqual(prof.radii.tip + 1e-6);
  });

  it('reaches both the root and the tip circle', () => {
    const radii = pts.map(radiusOf);
    expect(Math.min(...radii)).toBeCloseTo(prof.radii.root, 3);
    expect(Math.max(...radii)).toBeCloseTo(prof.radii.tip, 3);
  });

  it('is star-shaped about the centre, so it cannot self-intersect', () => {
    // Splice points between the trochoid, the involute and the arcs can back up
    // by a few nanoradians; anything larger would mean a genuine crossing.
    const ang = unwrappedAngles(pts);
    for (let i = 1; i < ang.length; i++) {
      expect(ang[i]!).toBeGreaterThanOrEqual(ang[i - 1]! - 1e-5);
    }
    expect(ang[ang.length - 1]! - ang[0]!).toBeLessThan(Math.PI * 2);
  });

  it('stays within the flattening tolerance at the production default', () => {
    // Sagitta of each chord on the tip arc must not exceed chordTol.
    const coarse = buildGearProfile({ ...base({ teeth: 32, module: 3 }), chordTol: 0.05 });
    const tipR = coarse.radii.tip;
    let worst = 0;
    const cp = coarse.path.pts;
    for (let i = 0; i < cp.length; i++) {
      const a = cp[i]!;
      const b = cp[(i + 1) % cp.length]!;
      if (radiusOf(a) < tipR - 1e-6 || radiusOf(b) < tipR - 1e-6) continue;
      worst = Math.max(worst, tipR - Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2));
    }
    expect(worst).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('matches the theoretical involute thickness across the flank', () => {
    const { pitch: r, base: rb } = prof.radii;
    const s = toothThickness(p);
    const alpha = deg(p.pressureAngleDeg);
    for (const factor of [0.995, 1.0, 1.005, 1.01, 1.015]) {
      const rho = r * factor;
      const measured = totalArcThickness(pts, rho) / p.teeth;
      const expected = theoreticalThickness(rho, r, rb, s, alpha);
      expectNear(measured, expected);
    }
  });

  it('spaces teeth evenly', () => {
    const widths = outsideArcWidths(pts, prof.radii.pitch);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    for (const w of widths) expect(w).toBeCloseTo(mean, 9);
  });
});

describe('kerf compensation', () => {
  const alpha = deg(20);

  it('thickens each tooth by exactly kerf/cos(alpha) at the pitch circle', () => {
    const nominal = buildGearProfile(base({ teeth: 40, kerf: 0 }));
    const cut = buildGearProfile(base({ teeth: 40, kerf: 0.18 }));
    const r = nominal.radii.pitch;
    const a = totalArcThickness(nominal.path.pts, r) / 40;
    const b = totalArcThickness(cut.path.pts, r) / 40;
    expectNear(b - a, 0.18 / Math.cos(alpha));
  });

  it('pushes the tip out and the root in by kerf/2', () => {
    const nominal = buildGearProfile(base({ teeth: 40, kerf: 0 }));
    const cut = buildGearProfile(base({ teeth: 40, kerf: 0.18 }));
    const rn = nominal.path.pts.map(radiusOf);
    const rc = cut.path.pts.map(radiusOf);
    expect(Math.max(...rc) - Math.max(...rn)).toBeCloseTo(0.09, 4);
    expect(Math.min(...rc) - Math.min(...rn)).toBeCloseTo(-0.09, 4);
  });

  it('leaves the nominal radii unchanged in the reported metadata', () => {
    const a = gearRadii(base({ teeth: 40, kerf: 0 }));
    const b = gearRadii(base({ teeth: 40, kerf: 0.18 }));
    expect(b).toEqual(a);
  });
});

describe('backlash', () => {
  it('removes half the total backlash from each member', () => {
    const none = buildGearProfile(base({ teeth: 40, backlash: 0 }));
    const some = buildGearProfile(base({ teeth: 40, backlash: 0.3 }));
    const r = none.radii.pitch;
    const a = totalArcThickness(none.path.pts, r) / 40;
    const b = totalArcThickness(some.path.pts, r) / 40;
    expectNear(a - b, 0.15);
  });

  it('leaves tooth plus space equal to the circular pitch', () => {
    const p = base({ teeth: 48, module: 4, backlash: 0 });
    const prof = buildGearProfile(p);
    const per = totalArcThickness(prof.path.pts, prof.radii.pitch) / 48;
    const space = (Math.PI * 2 * prof.radii.pitch) / 48 - per;
    expect(per + space).toBeCloseTo(Math.PI * p.module, 9);
    expectNear(per, (Math.PI * p.module) / 2);
  });
});

describe('low tooth counts', () => {
  it('flags undercut below 17 teeth but still returns a usable profile', () => {
    const prof = buildGearProfile(base({ teeth: 12 }));
    expect(prof.undercut).toBe(true);
    expect(prof.warnings.join(' ')).toMatch(/undercut/i);
    expect(prof.path.pts.length).toBeGreaterThan(100);
    expect(outsideArcWidths(prof.path.pts, prof.radii.pitch)).toHaveLength(12);
  });

  it('does not report undercut at 40 teeth', () => {
    expect(buildGearProfile(base({ teeth: 40 })).undercut).toBe(false);
  });
});

describe('internal ring profile', () => {
  const p = base({ teeth: 96, module: 3, internal: true });
  const prof = buildGearProfile(p);
  const pts = prof.path.pts;

  it('puts the tip circle inside and the root circle outside the pitch circle', () => {
    expect(prof.radii.tip).toBeLessThan(prof.radii.pitch);
    expect(prof.radii.root).toBeGreaterThan(prof.radii.pitch);
    expect(prof.radii.tip).toBeCloseTo(prof.radii.pitch - p.module, 9);
    expect(prof.radii.root).toBeCloseTo(prof.radii.pitch + 1.25 * p.module, 9);
  });

  it('produces one tooth space per tooth count', () => {
    expect(outsideArcWidths(pts, prof.radii.pitch)).toHaveLength(96);
  });

  it('gives the ring tooth its nominal thickness at the pitch circle', () => {
    const spacePer = totalArcThickness(pts, prof.radii.pitch) / 96;
    const circularPitch = Math.PI * p.module;
    expectNear(circularPitch - spacePer, toothThickness(p));
  });

  it('keeps the tooth space open all the way to the root circle', () => {
    const widths = outsideArcWidths(pts, prof.radii.root - 1e-4);
    expect(widths).toHaveLength(96);
    for (const w of widths) expect(w * prof.radii.root).toBeGreaterThan(0.2);
  });

  it('narrows the space by kerf/cos(alpha) when kerf is applied', () => {
    const nominal = buildGearProfile(base({ teeth: 96, internal: true, kerf: 0 }));
    const cut = buildGearProfile(base({ teeth: 96, internal: true, kerf: 0.18 }));
    const r = nominal.radii.pitch;
    const a = totalArcThickness(nominal.path.pts, r) / 96;
    const b = totalArcThickness(cut.path.pts, r) / 96;
    expectNear(a - b, 0.18 / Math.cos(deg(20)));
  });
});

describe('meshing pair', () => {
  it('leaves clearance between the cog tip and the ring root', () => {
    const m = 3;
    const cog = gearRadii(base({ teeth: 43, module: m }));
    const ring = gearRadii(base({ teeth: 157, module: m, internal: true }));
    const centreDistance = ((157 - 43) * m) / 2;
    expect(centreDistance).toBeCloseTo(ring.pitch - cog.pitch, 9);
    // Furthest the cog tip reaches from the ring centre:
    const reach = centreDistance + cog.tip;
    expect(ring.root - reach).toBeCloseTo(0.25 * m, 9);
  });

  it('leaves clearance between two external tips and roots', () => {
    const m = 4;
    const a = gearRadii(base({ teeth: 30, module: m }));
    const b = gearRadii(base({ teeth: 50, module: m }));
    const centreDistance = ((30 + 50) * m) / 2;
    expect(centreDistance).toBeCloseTo(a.pitch + b.pitch, 9);
    expect(centreDistance - a.tip - b.root).toBeCloseTo(0.25 * m, 9);
  });
});
