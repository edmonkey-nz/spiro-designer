/**
 * Non-circular ring pitch curves.
 *
 * A cog rolls inside any smooth closed curve, not just a circle, and the
 * pattern it draws is far richer for it. Two conditions have to hold:
 *
 *  1. **The perimeter must be a whole number of tooth pitches.** Teeth are
 *     spaced by arc length, so if the loop is not exactly N * pi * m long the
 *     last tooth does not meet the first. The builder solves this by scaling
 *     the shape to the tooth count rather than the other way round.
 *
 *  2. **The cog must fit the tightest bend.** Where the curve is convex, the
 *     rolling cog's pitch radius has to be smaller than the local radius of
 *     curvature, or it simply cannot reach into the corner.
 *
 * Shapes are defined in polar form, r(theta), which keeps them simple and
 * self-intersection-free, and keeps every downstream consumer that assumes a
 * star-shaped profile (slicing, segmenting, nesting) working unchanged.
 */

import { TAU, type Pt } from './types';

export interface RingShape {
  /** Lobes of the primary harmonic. 0 (or zero amplitude) gives a circle. */
  lobes: number;
  /** Primary amplitude as a fraction of the mean radius. */
  amplitude: number;
  /** A second harmonic makes the blob less regular. */
  lobes2: number;
  amplitude2: number;
  /** Phase of the second harmonic, degrees. */
  phase2: number;
}

export const circleShape = (): RingShape => ({
  lobes: 0,
  amplitude: 0,
  lobes2: 0,
  amplitude2: 0,
  phase2: 0,
});

export const isCircle = (s: RingShape): boolean =>
  (s.lobes === 0 || Math.abs(s.amplitude) < 1e-9) && (s.lobes2 === 0 || Math.abs(s.amplitude2) < 1e-9);

/** Named starting points for the shape controls. */
export const SHAPE_PRESETS: { id: string; name: string; hint: string; shape: RingShape }[] = [
  { id: 'circle', name: 'Circle', hint: 'The classic spirograph ring', shape: circleShape() },
  { id: 'egg', name: 'Egg', hint: 'One lobe — fat at one end', shape: { ...circleShape(), lobes: 1, amplitude: 0.12 } },
  { id: 'oval', name: 'Oval', hint: 'Two lobes — the classic elliptical gear', shape: { ...circleShape(), lobes: 2, amplitude: 0.12 } },
  { id: 'triangular', name: 'Rounded triangle', hint: 'Three lobes', shape: { ...circleShape(), lobes: 3, amplitude: 0.09 } },
  { id: 'squarish', name: 'Rounded square', hint: 'Four lobes', shape: { ...circleShape(), lobes: 4, amplitude: 0.06 } },
  { id: 'flower', name: 'Flower', hint: 'Five lobes, deeper', shape: { ...circleShape(), lobes: 5, amplitude: 0.07 } },
  {
    id: 'blob',
    name: 'Blob',
    hint: 'Two harmonics out of phase — properly irregular',
    shape: { lobes: 2, amplitude: 0.11, lobes2: 3, amplitude2: 0.06, phase2: 40 },
  },
  {
    id: 'peanut',
    name: 'Peanut',
    hint: 'A waisted shape, with concave stretches the teeth have to invert for',
    shape: { lobes: 2, amplitude: 0.24, lobes2: 0, amplitude2: 0, phase2: 0 },
  },
];

// ---------------------------------------------------------------------------
// the radius function and its derivatives

/** Unit-scale polar radius and its first two derivatives with respect to theta. */
export function radiusAt(shape: RingShape, theta: number): { r: number; d1: number; d2: number } {
  const k1 = Math.max(0, Math.round(shape.lobes));
  const k2 = Math.max(0, Math.round(shape.lobes2));
  const a1 = k1 > 0 ? shape.amplitude : 0;
  const a2 = k2 > 0 ? shape.amplitude2 : 0;
  const ph = (shape.phase2 * Math.PI) / 180;

  const r = 1 + a1 * Math.cos(k1 * theta) + a2 * Math.cos(k2 * theta + ph);
  const d1 = -a1 * k1 * Math.sin(k1 * theta) - a2 * k2 * Math.sin(k2 * theta + ph);
  const d2 = -a1 * k1 * k1 * Math.cos(k1 * theta) - a2 * k2 * k2 * Math.cos(k2 * theta + ph);
  return { r, d1, d2 };
}

/** Smallest unit radius anywhere on the shape; <= 0 means the curve is degenerate. */
export function minUnitRadius(shape: RingShape, samples = 2048): number {
  let min = Infinity;
  for (let i = 0; i < samples; i++) {
    const v = radiusAt(shape, (i / samples) * TAU).r;
    if (v < min) min = v;
  }
  return min;
}

export interface CurvePoint {
  theta: number;
  /** Position, mm. */
  p: Pt;
  /** Cumulative arc length from theta = 0, mm. */
  s: number;
  /** Unit tangent, in the direction of increasing theta (counter-clockwise). */
  tangent: Pt;
  /**
   * Unit normal pointing into the interior, where the cog rolls.
   * This is the tangent rotated +90 degrees, so (tangent, normalIn) is a
   * right-handed frame and every tooth transform below is a pure rotation.
   */
  normalIn: Pt;
  /** Signed curvature: positive where the curve bends like a circle does. */
  kappa: number;
  /** Signed radius of curvature, 1/kappa. Infinite at an inflection. */
  rho: number;
  /** Unwrapped tangent angle, which gains exactly 2*pi over the whole loop. */
  psi: number;
}

export interface PitchCurve {
  samples: CurvePoint[];
  /** Total perimeter, mm. */
  length: number;
  /** Scale applied to the unit shape. */
  scale: number;
  shape: RingShape;
  /** State at an arbitrary arc length; wraps around the loop. */
  at(s: number): CurvePoint;
  /** Smallest positive radius of curvature — the tightest bend the cog must enter. */
  minConvexRho: number;
  /** Smallest |rho| over concave stretches, or Infinity if the curve is convex. */
  minConcaveRho: number;
  /** Largest and smallest distance from the origin. */
  maxR: number;
  minR: number;
}

function evaluate(shape: RingShape, scale: number, theta: number): Omit<CurvePoint, 's' | 'psi'> {
  const { r, d1, d2 } = radiusAt(shape, theta);
  const rr = r * scale;
  const rp = d1 * scale;
  const rpp = d2 * scale;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const p = { x: rr * cos, y: rr * sin };
  // dp/dtheta
  const dx = rp * cos - rr * sin;
  const dy = rp * sin + rr * cos;
  const speed = Math.hypot(dx, dy) || 1e-12;
  const tangent = { x: dx / speed, y: dy / speed };
  // +90 degrees: for a counter-clockwise loop this points at the interior.
  const normalIn = { x: -tangent.y, y: tangent.x };

  // Signed curvature of a polar curve. For r = R this gives 1/R.
  const kappa = (rr * rr + 2 * rp * rp - rr * rpp) / Math.pow(rr * rr + rp * rp, 1.5);
  const rho = Math.abs(kappa) < 1e-12 ? Infinity : 1 / kappa;

  return { theta, p, tangent, normalIn, kappa, rho };
}

/** Perimeter of the unit shape, by Simpson's rule over the polar speed. */
export function unitPerimeter(shape: RingShape, samples = 4096): number {
  const n = samples % 2 === 0 ? samples : samples + 1;
  const h = TAU / n;
  const speed = (theta: number) => {
    const { r, d1 } = radiusAt(shape, theta);
    return Math.hypot(r, d1);
  };
  let total = speed(0) + speed(TAU);
  for (let i = 1; i < n; i++) total += speed(i * h) * (i % 2 === 1 ? 4 : 2);
  return (total * h) / 3;
}

/**
 * Build the pitch curve at a given scale.
 *
 * Arc length is accumulated with the trapezoidal rule over the polar speed,
 * which converges quickly and — unlike summing chord lengths — does not
 * systematically undershoot.
 */
export function buildPitchCurve(shape: RingShape, scale: number, samples = 4096): PitchCurve {
  const n = Math.max(256, samples);
  const pts: CurvePoint[] = [];
  let s = 0;
  let psi = 0;
  let prevSpeed = 0;
  let prevTangentAngle = 0;

  for (let i = 0; i <= n; i++) {
    const theta = (i / n) * TAU;
    const base = evaluate(shape, scale, theta);
    const { r, d1 } = radiusAt(shape, theta);
    const speed = Math.hypot(r, d1) * scale;

    if (i > 0) s += ((prevSpeed + speed) / 2) * (TAU / n);
    prevSpeed = speed;

    const angle = Math.atan2(base.tangent.y, base.tangent.x);
    if (i === 0) {
      psi = angle;
    } else {
      // Unwrap: the tangent turns smoothly, so keep the nearest branch.
      let delta = angle - prevTangentAngle;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      psi += delta;
    }
    prevTangentAngle = angle;

    pts.push({ ...base, s, psi });
  }

  // The closing sample duplicates theta = 0; keep it only as the length marker.
  const length = pts[pts.length - 1]!.s;
  const closingPsi = pts[pts.length - 1]!.psi;

  let minConvexRho = Infinity;
  let minConcaveRho = Infinity;
  let maxR = 0;
  let minR = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const q = pts[i]!;
    const rr = Math.hypot(q.p.x, q.p.y);
    if (rr > maxR) maxR = rr;
    if (rr < minR) minR = rr;
    if (q.rho > 0 && q.rho < minConvexRho) minConvexRho = q.rho;
    if (q.rho < 0 && -q.rho < minConcaveRho) minConcaveRho = -q.rho;
  }

  const at = (target: number): CurvePoint => {
    // Wrap, then binary search the cumulative arc-length table.
    const loops = Math.floor(target / length);
    const local = target - loops * length;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid]!.s <= local) lo = mid;
      else hi = mid;
    }
    const a = pts[lo]!;
    const b = pts[hi]!;
    const span = b.s - a.s;
    const f = span < 1e-12 ? 0 : (local - a.s) / span;
    const theta = a.theta + (b.theta - a.theta) * f;
    // Re-evaluate analytically rather than interpolating position and normals,
    // so the frame stays exactly on the curve.
    const exact = evaluate(shape, scale, theta);
    return {
      ...exact,
      s: target,
      psi: a.psi + (b.psi - a.psi) * f + loops * (closingPsi - pts[0]!.psi),
    };
  };

  return {
    samples: pts.slice(0, -1),
    length,
    scale,
    shape,
    at,
    minConvexRho,
    minConcaveRho,
    maxR,
    minR,
  };
}

/**
 * Scale a shape so its perimeter is exactly `teeth` tooth pitches.
 *
 * Solving for scale rather than for tooth count is what makes a non-circular
 * ring buildable at all: teeth are laid out by arc length, so the loop has to
 * close on a whole tooth or the last one collides with the first.
 */
export function pitchCurveForTeeth(shape: RingShape, teeth: number, module: number, samples = 4096): PitchCurve {
  const wanted = teeth * Math.PI * module;
  const unit = unitPerimeter(shape, samples);
  return buildPitchCurve(shape, wanted / unit, samples);
}

/**
 * Offset the pitch curve along its outward normal by a constant distance.
 * Used for the rim. Self-intersects if the distance exceeds the radius of
 * curvature anywhere concave, which the caller checks for.
 */
export function offsetOutward(curve: PitchCurve, distance: number, samples = 1024): Pt[] {
  const out: Pt[] = [];
  const n = Math.max(64, samples);
  for (let i = 0; i < n; i++) {
    const q = curve.at((i / n) * curve.length);
    out.push({ x: q.p.x - q.normalIn.x * distance, y: q.p.y - q.normalIn.y * distance });
  }
  return out;
}

/** A readable summary of what a shape is, for the UI. */
export function describeShape(shape: RingShape): string {
  if (isCircle(shape)) return 'Circle';
  const bits: string[] = [];
  if (shape.lobes > 0 && Math.abs(shape.amplitude) > 1e-9) {
    bits.push(`${shape.lobes} lobe${shape.lobes === 1 ? '' : 's'} at ${(shape.amplitude * 100).toFixed(0)}%`);
  }
  if (shape.lobes2 > 0 && Math.abs(shape.amplitude2) > 1e-9) {
    bits.push(`${shape.lobes2} at ${(shape.amplitude2 * 100).toFixed(0)}%`);
  }
  return bits.join(' + ');
}
