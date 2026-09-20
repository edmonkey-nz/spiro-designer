/**
 * Interference checking for a meshed pair.
 *
 * This answers the question the whole app exists to answer before a sheet of
 * ply is burned: *will these two tooth counts roll without binding?*
 *
 * Both profiles are star-shaped about their own centre, so each one can be
 * treated as radius-as-a-function-of-angle. A cog point collides with the ring
 * exactly when its radius about the ring centre reaches the ring's inner
 * boundary at the same angle.
 */

import type { Pt } from '../src/geom/types';

const TAU = Math.PI * 2;

/** Radius-as-a-function-of-angle sampler for a star-shaped closed profile. */
export function radialProfile(pts: Pt[]): (angle: number) => number {
  const samples = pts
    .map((p) => ({ a: Math.atan2(p.y, p.x), r: Math.hypot(p.x, p.y) }))
    .sort((x, y) => x.a - y.a);

  return (angle: number) => {
    let a = angle % TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;

    let lo = 0;
    let hi = samples.length - 1;
    if (a <= samples[0]!.a || a >= samples[hi]!.a) {
      // Wrap-around segment between the last and first sample.
      const p = samples[hi]!;
      const q = samples[0]!;
      const span = q.a + TAU - p.a;
      const t = span < 1e-12 ? 0 : ((a < samples[0]!.a ? a + TAU : a) - p.a) / span;
      return p.r + (q.r - p.r) * t;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid]!.a <= a) lo = mid;
      else hi = mid;
    }
    const p = samples[lo]!;
    const q = samples[hi]!;
    const span = q.a - p.a;
    return span < 1e-12 ? p.r : p.r + ((q.r - p.r) * (a - p.a)) / span;
  };
}

export interface MeshCheck {
  /** Smallest gap found, mm. Negative means the parts overlap. */
  minClearance: number;
  /** Rotation of the rolling member at which the tightest point occurred. */
  atAngle: number;
}

/**
 * Sweep a full tooth engagement of an external cog inside an internal ring and
 * report the tightest clearance.
 *
 * Centres are held at the theoretical centre distance; the cog turns by `phi`
 * while the ring turns by `phi * z / Z`, which is the fixed-centre ratio for an
 * internal pair (both turn the same way).
 */
export function meshClearanceInternal(
  ringPts: Pt[],
  cogPts: Pt[],
  ringTeeth: number,
  cogTeeth: number,
  module: number,
  steps = 24,
): MeshCheck {
  const ringR = radialProfile(ringPts);
  const centreDistance = ((ringTeeth - cogTeeth) * module) / 2;
  let minClearance = Infinity;
  let atAngle = 0;

  for (let s = 0; s < steps; s++) {
    const phi = (s / steps) * (TAU / cogTeeth);
    const ringPhi = (phi * cogTeeth) / ringTeeth;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    for (const p of cogPts) {
      const x = p.x * c - p.y * sn + centreDistance;
      const y = p.x * sn + p.y * c;
      const r = Math.hypot(x, y);
      const gap = ringR(Math.atan2(y, x) - ringPhi) - r;
      if (gap < minClearance) {
        minClearance = gap;
        atAngle = phi;
      }
    }
  }
  return { minClearance, atAngle };
}

/** The same sweep for two external gears at their theoretical centre distance. */
export function meshClearanceExternal(
  aPts: Pt[],
  bPts: Pt[],
  aTeeth: number,
  bTeeth: number,
  module: number,
  steps = 24,
): MeshCheck {
  const aR = radialProfile(aPts);
  const centreDistance = ((aTeeth + bTeeth) * module) / 2;
  let minClearance = Infinity;
  let atAngle = 0;

  // B is offset by half a tooth so its teeth sit in A's spaces.
  const bPhase = Math.PI / bTeeth;

  for (let s = 0; s < steps; s++) {
    const phi = (s / steps) * (TAU / bTeeth);
    // External pair: the members counter-rotate.
    const aPhi = (-phi * bTeeth) / aTeeth;
    const c = Math.cos(phi + bPhase);
    const sn = Math.sin(phi + bPhase);
    for (const p of bPts) {
      const x = p.x * c - p.y * sn + centreDistance;
      const y = p.x * sn + p.y * c;
      const r = Math.hypot(x, y);
      // Distance from A's centre out to A's boundary along this bearing.
      const gap = r - aR(Math.atan2(y, x) - aPhi);
      if (gap < minClearance) {
        minClearance = gap;
        atAngle = phi;
      }
    }
  }
  return { minClearance, atAngle };
}
