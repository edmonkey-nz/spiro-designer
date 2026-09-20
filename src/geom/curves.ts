/**
 * Spirograph curve generation.
 *
 * Everything here is driven by **tooth counts**, never by measured radii. That
 * is the whole point: the machine cannot slip, so the curve it draws is fixed
 * by Z, z and the pen hole's radius. Deriving the maths the same way keeps the
 * on-screen preview and the physical part in agreement by construction.
 *
 * Convention: at carrier angle theta = 0 the rolling cog's own frame is aligned
 * with the world frame, so a pen hole at cog-frame angle `penTheta` starts at
 * `centre + penR * (cos penTheta, sin penTheta)`.
 */

import { TAU, type Pt } from './types';

export type RollMode = 'inside-ring' | 'outside-ring' | 'rack' | 'cog-on-cog';

export const ROLL_MODES: { id: RollMode; label: string; hint: string }[] = [
  { id: 'inside-ring', label: 'Cog inside ring', hint: 'Hypotrochoid — the classic spirograph' },
  { id: 'outside-ring', label: 'Cog outside ring', hint: 'Epitrochoid — flower and rosette forms' },
  { id: 'cog-on-cog', label: 'Cog on cog', hint: 'Epitrochoid against a fixed external cog' },
  { id: 'rack', label: 'Cog on rack', hint: 'Trochoid — repeating waves along a line' },
];

export interface CurveSpec {
  mode: RollMode;
  /** Tooth count of the fixed member (ring or fixed cog). Unused for a rack. */
  fixedTeeth: number;
  /** Tooth count of the rolling cog. */
  rollingTeeth: number;
  module: number;
  /** Pen hole distance from the rolling cog's centre, mm — the hole's engraved radius. */
  penR: number;
  /** Pen hole angle in the cog's own frame, radians. */
  penTheta: number;
  /** Teeth on the rack, which bounds how far a rack run can travel. */
  rackTeeth?: number;
}

export const greatestCommonDivisor = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
};

/** Pitch radius of the fixed member. */
export const fixedRadius = (s: CurveSpec): number => (s.module * s.fixedTeeth) / 2;
/** Pitch radius of the rolling cog. */
export const rollingRadius = (s: CurveSpec): number => (s.module * s.rollingTeeth) / 2;

/**
 * State of the rolling cog at carrier angle `theta`: where its centre is and
 * how far it has turned. The simulator uses this to draw the real gear outlines
 * rolling, so the animation and the curve can never disagree.
 */
export function carrierState(s: CurveSpec, theta: number): { centre: Pt; rotation: number } {
  const r = rollingRadius(s);
  if (s.mode === 'rack') {
    return { centre: { x: r * theta, y: r }, rotation: -theta };
  }
  const R = fixedRadius(s);
  if (s.mode === 'inside-ring') {
    const d = R - r;
    return {
      centre: { x: d * Math.cos(theta), y: d * Math.sin(theta) },
      rotation: (-d / r) * theta,
    };
  }
  // outside-ring and cog-on-cog are the same rolling problem.
  const d = R + r;
  return {
    centre: { x: d * Math.cos(theta), y: d * Math.sin(theta) },
    rotation: (d / r) * theta,
  };
}

/** Pen position at carrier angle `theta`. */
export function penAt(s: CurveSpec, theta: number): Pt {
  const { centre, rotation } = carrierState(s, theta);
  const a = s.penTheta + rotation;
  return { x: centre.x + s.penR * Math.cos(a), y: centre.y + s.penR * Math.sin(a) };
}

export interface CurveInfo {
  /** Lobes around the pattern. */
  petals: number;
  /** Turns of the carrier arm before the pen returns to its start. */
  carrierRevs: number;
  /** Turns of the cog itself over that run. */
  cogRevs: number;
  /** Carrier angle at which the curve closes. */
  thetaMax: number;
  closes: boolean;
  /** True when the pen sits on the cog's centre, so the "curve" is just a circle. */
  degenerate: boolean;
  /** Ratio of cog rotation to carrier rotation. */
  ratio: number;
}

export function curveInfo(s: CurveSpec): CurveInfo {
  const z = Math.max(1, Math.round(s.rollingTeeth));
  const r = rollingRadius(s);

  if (s.mode === 'rack') {
    const teeth = Math.max(1, Math.round(s.rackTeeth ?? 60));
    const travel = teeth * Math.PI * s.module;
    return {
      petals: teeth,
      carrierRevs: travel / (TAU * r),
      cogRevs: travel / (TAU * r),
      thetaMax: travel / r,
      closes: false,
      degenerate: s.penR < 1e-9,
      ratio: -1,
    };
  }

  const Z = Math.max(1, Math.round(s.fixedTeeth));
  const g = greatestCommonDivisor(Z, z);
  const carrierRevs = z / g;
  const ratio = s.mode === 'inside-ring' ? -(Z - z) / z : (Z + z) / z;
  return {
    petals: Z / g,
    carrierRevs,
    cogRevs: Math.abs(ratio) * carrierRevs,
    thetaMax: TAU * carrierRevs,
    closes: true,
    // A pen exactly on the cog centre traces a plain circle, as does a cog the
    // same size as the ring.
    degenerate: s.penR < 1e-9 || Z === z,
    ratio,
  };
}

export interface SampleOptions {
  /** Upper bound on returned points. */
  maxPoints?: number;
  /** Points per turn of the *cog*, which is what sets the curve's detail. */
  perCogRev?: number;
  /** Stop partway through, 0..1 of the closed run — used by the scrub bar. */
  fraction?: number;
}

/** Number of samples the full run wants at the given density. */
export function sampleCount(s: CurveSpec, opts: SampleOptions = {}): number {
  const { maxPoints = 200_000, perCogRev = 240 } = opts;
  const info = curveInfo(s);
  const wanted = Math.ceil(Math.max(info.cogRevs, info.carrierRevs) * perCogRev);
  return Math.min(maxPoints, Math.max(64, wanted));
}

/** Sample the curve as a polyline in world millimetres. */
export function sampleCurve(s: CurveSpec, opts: SampleOptions = {}): Pt[] {
  const info = curveInfo(s);
  const frac = Math.min(1, Math.max(0, opts.fraction ?? 1));
  const n = Math.max(2, Math.round(sampleCount(s, opts) * frac));
  const end = info.thetaMax * frac;
  const pts: Pt[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) pts[i] = penAt(s, (end * i) / n);
  return pts;
}

export interface CurveMetrics {
  /** Radius of the smallest circle centred on the origin containing the curve. */
  outerRadius: number;
  innerRadius: number;
  /** Total drawn length, mm — a rough proxy for how long it takes to crank. */
  length: number;
  /** Paper size needed, mm. */
  width: number;
  height: number;
}

export function curveMetrics(pts: Pt[]): CurveMetrics {
  let outer = 0;
  let inner = Infinity;
  let length = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const r = Math.hypot(p.x, p.y);
    if (r > outer) outer = r;
    if (r < inner) inner = r;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) length += Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y);
  }
  return {
    outerRadius: outer,
    innerRadius: Number.isFinite(inner) ? inner : 0,
    length,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * A short human description of what the pairing will draw, for the UI.
 */
export function describeCurve(s: CurveSpec): string {
  const info = curveInfo(s);
  if (s.mode === 'rack') return `${info.petals} waves over the rack`;
  if (info.degenerate) return 'A plain circle — move the pen off centre';
  const turns = info.carrierRevs === 1 ? '1 turn' : `${info.carrierRevs} turns`;
  return `${info.petals} petals, closes after ${turns}`;
}
