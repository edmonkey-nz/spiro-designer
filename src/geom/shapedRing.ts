/**
 * Non-circular rings.
 *
 * Each tooth is built for the circle that osculates the pitch curve where that
 * tooth sits, then placed by rotating it about that circle's centre. This is
 * the standard construction for non-circular gears, and it degenerates exactly
 * to the circular case when the curvature is constant.
 *
 * Three regimes, by the signed radius of curvature `rho` at the tooth:
 *
 *   rho > 0   the curve bends like a circle does, so the local equivalent is
 *             an internal gear of pitch radius rho — teeth pointing inward.
 *   rho < 0   a dent poking into the rolling space. Seen from the rolling cog
 *             that surface is convex, so the local equivalent is an *external*
 *             gear of pitch radius |rho|.
 *   |rho| huge  an inflection, where the equivalent gear has no finite radius.
 *             The limit of an involute as the radius grows is the straight
 *             flank of a rack, so that is what gets used.
 *
 * The approximation this makes is that curvature is constant across a single
 * tooth. The error scales with how fast curvature changes over one pitch, so
 * gentle blobs are effectively exact and aggressive ones drift. `maxJointGap`
 * measures the drift directly, by how far consecutive teeth miss each other.
 */

import { buildToothPeriod, type GearParams } from './involute';
import {
  TAU,
  dedupe,
  deg,
  type Path,
  type Pt,
} from './types';
import { dropTinyBacktracks, signedArea } from './poly';
import { offsetOutward, pitchCurveForTeeth, type PitchCurve, type RingShape } from './shape';

/** Beyond this equivalent tooth count the involute is a straight line to well under a micron. */
const RACK_LIMIT = 800;

/** Equivalent tooth counts are cached to this resolution; the shape change is ~0.1 micron. */
const CACHE_STEP = 0.25;

export interface ShapedRingOptions {
  shape: RingShape;
  teeth: number;
  rimWidth: number;
}

export interface ShapedRing {
  inner: Path;
  outer: Path;
  /**
   * The placed tooth periods that make up `inner`, one array per tooth, in
   * world coordinates. Segmenting an oversized ring slices here rather than
   * into the concatenated path, because the boundaries are exact.
   */
  periods: Pt[][];
  curve: PitchCurve;
  /** Largest gap between consecutive tooth periods, mm. */
  maxJointGap: number;
  /** Tightest convex bend, which bounds how big the rolling cog can be. */
  minConvexRho: number;
  /** Tightest concave bend, which bounds how thick the rim can be. */
  minConcaveRho: number;
  maxR: number;
  minR: number;
  warnings: string[];
}

/**
 * One tooth period expressed in the pitch curve's local frame:
 * x runs along the tangent in the direction of travel, y points into the
 * interior where the cog rolls. (x, y) is right-handed, so every placement
 * below is a pure rotation with no reflection.
 */
type ToothBase = Omit<GearParams, 'teeth' | 'internal'>;

function periodLocal(base: ToothBase, rho: number): { pts: Pt[]; warnings: string[] } {
  const m = base.module;
  const zEq = (2 * Math.abs(rho)) / m;

  if (!Number.isFinite(rho) || zEq > RACK_LIMIT) {
    return { pts: rackPeriodLocal(base), warnings: [] };
  }

  const internal = rho > 0;
  const zUsed = Math.max(3, zEq);
  const period = buildToothPeriod({ ...base, teeth: zUsed, internal });
  const a = Math.abs(rho);

  // A period is centred on whichever feature lies at its outer radius, and for
  // an external gear that is the *tooth*, not the space. Placing it unshifted
  // would flip the tooth phase by half a pitch at every inflection, so the
  // concave stretches get re-phased to be space-centred like the convex ones.
  const gear = internal ? period.pts : rephaseHalfPitch(period.pts, zUsed);

  // Gear coordinates put the period centre on angle 0 with the pitch point at
  // (|rho|, 0). Mapping that into the local frame:
  //   internal — the centre of curvature is inside, so radius grows outward
  //   external — the centre is outside, so radius grows inward, and the
  //              traversal runs backwards along the curve, hence the reverse
  const pts = internal
    ? gear.map((q) => ({ x: q.y, y: a - q.x }))
    : gear.map((q) => ({ x: -q.y, y: q.x - a })).reverse();

  return { pts, warnings: period.warnings };
}

/**
 * Shift a tooth period by half a pitch, swapping which feature sits at its
 * centre.
 *
 * Half a pitch is not a symmetry of a gear, so this cannot be a plain
 * rotation. Instead each half of the period is rotated to the opposite side:
 * the points past the centre move back by half a pitch and the points before
 * it move forward, which puts the inner-radius feature in the middle.
 */
function rephaseHalfPitch(pts: Pt[], teeth: number): Pt[] {
  const half = Math.PI / teeth;
  const angle = (q: Pt) => Math.atan2(q.y, q.x);
  const split = pts.findIndex((q) => angle(q) >= 0);
  if (split <= 0) return pts;

  // The split has to land on angle 0 exactly. A tip arc one pitch wide is
  // often a single chord, so the nearest *sample* can be a whole half-tooth
  // away, which would shorten the period and leave a visible step between
  // neighbouring teeth. Interpolate the crossing instead.
  const before = pts[split - 1]!;
  const after = pts[split]!;
  const a0 = angle(before);
  const a1 = angle(after);
  const f = Math.abs(a1 - a0) < 1e-15 ? 0 : (0 - a0) / (a1 - a0);
  const r0 = Math.hypot(before.x, before.y);
  const r1 = Math.hypot(after.x, after.y);
  const crossing: Pt = { x: r0 + (r1 - r0) * f, y: 0 };

  const turn = (q: Pt, a: number): Pt => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: q.x * c - q.y * s, y: q.x * s + q.y * c };
  };
  return [
    ...[crossing, ...pts.slice(split)].map((q) => turn(q, -half)),
    ...[...pts.slice(0, split), crossing].map((q) => turn(q, half)),
  ];
}

/** The rack limit: straight flanks at the pressure angle, used near inflections. */
function rackPeriodLocal(p: ToothBase): Pt[] {
  const m = p.module;
  const alpha = deg(p.pressureAngleDeg);
  const tanA = Math.tan(alpha);
  const kh = p.kerf / 2;
  const pitch = Math.PI * m;

  // Ring tooth half-thickness at the pitch line, grown by the kerf.
  const half = pitch / 4 - p.backlash / 4 + kh / Math.cos(alpha);
  const tipY = p.addendum * m + kh; // teeth point into the rolling space
  const rootY = -(p.addendum + p.clearance) * m - kh;

  const leftTooth = -pitch / 2;
  const rightTooth = pitch / 2;
  return [
    { x: leftTooth, y: tipY },
    { x: leftTooth + half - tipY * tanA, y: tipY },
    { x: leftTooth + half - rootY * tanA, y: rootY },
    { x: rightTooth - half + rootY * tanA, y: rootY },
    { x: rightTooth - half + tipY * tanA, y: tipY },
    { x: rightTooth, y: tipY },
  ];
}

export function buildShapedRing(opts: ShapedRingOptions, base: ToothBase): ShapedRing {
  const warnings: string[] = [];
  const m = base.module;
  const teeth = Math.max(8, Math.round(opts.teeth));
  const kh = base.kerf / 2;

  const curve = pitchCurveForTeeth(opts.shape, teeth, m);
  const pitchStep = curve.length / teeth;

  // Cache periods by equivalent tooth count: a smooth curve reuses most of them.
  const cache = new Map<string, Pt[]>();
  const periodFor = (rho: number): Pt[] => {
    const zEq = (2 * Math.abs(rho)) / m;
    const key = zEq > RACK_LIMIT ? 'rack' : `${rho > 0 ? 'i' : 'e'}${Math.round(zEq / CACHE_STEP)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const quantised =
      zEq > RACK_LIMIT ? rho : Math.sign(rho) * ((Math.round(zEq / CACHE_STEP) * CACHE_STEP * m) / 2);
    const built = periodLocal(base, quantised);
    for (const w of built.warnings) if (!warnings.includes(w)) warnings.push(w);
    cache.set(key, built.pts);
    return built.pts;
  };

  const pts: Pt[] = [];
  const periods: Pt[][] = [];
  let maxJointGap = 0;
  let previousEnd: Pt | null = null;

  for (let j = 0; j < teeth; j++) {
    const st = curve.at(j * pitchStep);
    const local = periodFor(st.rho);
    // Right-handed frame on the curve; placing through it is a pure rotation.
    const tx = st.tangent;
    const ny = st.normalIn;
    const placed = local.map((q) => ({
      x: st.p.x + q.x * tx.x + q.y * ny.x,
      y: st.p.y + q.x * tx.y + q.y * ny.y,
    }));

    const first = placed[0]!;
    if (previousEnd) {
      maxJointGap = Math.max(maxJointGap, Math.hypot(first.x - previousEnd.x, first.y - previousEnd.y));
    }
    previousEnd = placed[placed.length - 1]!;
    periods.push(placed);
    pts.push(...placed);
  }
  // Closing joint, from the last tooth back to the first.
  if (previousEnd && pts.length > 0) {
    maxJointGap = Math.max(maxJointGap, Math.hypot(pts[0]!.x - previousEnd.x, pts[0]!.y - previousEnd.y));
  }

  let inner = dropTinyBacktracks(dedupe(pts, 1e-7), 1e-3);
  if (signedArea(inner) < 0) inner = inner.reverse();

  // Rim: a constant normal offset of the pitch curve, past the tooth roots.
  const rootDepth = (base.addendum + base.clearance) * m + kh;
  const offset = rootDepth + opts.rimWidth;
  const outer = offsetOutward(curve, offset, Math.max(512, teeth * 8));

  if (curve.minConcaveRho <= offset) {
    warnings.push(
      `The rim is ${opts.rimWidth}mm but the shape has a concave bend of radius ` +
        `${curve.minConcaveRho.toFixed(0)}mm, so the outer edge folds over itself. ` +
        'Reduce the rim width or the lobe amplitude.',
    );
  }
  if (maxJointGap > base.kerf) {
    warnings.push(
      `Curvature changes by enough across one tooth to leave a ${maxJointGap.toFixed(2)}mm step ` +
        'between neighbouring teeth. Reduce the lobe amplitude, raise the tooth count, or use a smaller module.',
    );
  }

  return {
    inner: { pts: inner, closed: true },
    outer: { pts: outer, closed: true },
    periods,
    curve,
    maxJointGap,
    minConvexRho: curve.minConvexRho,
    minConcaveRho: curve.minConcaveRho,
    maxR: curve.maxR + offset,
    minR: curve.minR - base.addendum * m - kh,
    warnings,
  };
}

/**
 * Where the rolling cog's centre sits, and how far it has turned, at arc
 * length `s` around a non-circular ring.
 *
 * Rolling without slipping means the cog's rotation rate is the curve's own
 * turning rate minus the rolling rate:  dphi/ds = kappa - 1/r. Integrated,
 * phi(s) = psi(s) - psi(0) - s/r, which reduces to the familiar
 * -theta*(R-r)/r on a circle.
 */
export function rollingState(
  curve: PitchCurve,
  rollingRadius: number,
  s: number,
): { centre: Pt; rotation: number } {
  const st = curve.at(s);
  return {
    centre: {
      x: st.p.x + st.normalIn.x * rollingRadius,
      y: st.p.y + st.normalIn.y * rollingRadius,
    },
    rotation: st.psi - startPhase(curve).psi - s / rollingRadius + startPhase(curve).offset,
  };
}

/**
 * Where the cog has to start.
 *
 * The ring carries a tooth *space* at arc length 0, and a cog built by
 * `buildGearProfile` carries a *tooth* on its own angle 0, so the cog has to
 * begin turned far enough that its first tooth points down the contact normal.
 * On a circle the normal at s = 0 is radial and this is zero, which is why it
 * never mattered before; on a shape whose harmonics are out of phase the
 * normal is tilted, and being half a tooth out puts tooth against tooth.
 */
function startPhase(curve: PitchCurve): { psi: number; offset: number } {
  const start = curve.at(0);
  return {
    psi: start.psi,
    offset: Math.atan2(-start.normalIn.y, -start.normalIn.x),
  };
}

/** Total turning of the tangent over one loop, which is 2*pi for a simple curve. */
export function totalTurning(curve: PitchCurve): number {
  return curve.at(curve.length).psi - curve.at(0).psi;
}

export const fullTurn = TAU;
