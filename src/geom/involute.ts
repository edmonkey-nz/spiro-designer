/**
 * Involute tooth profile generation for external cogs and internal rings.
 *
 * Everything here is analytic — there is no polygon boolean library in the
 * dependency tree. Two constructions carry the whole module:
 *
 *  1. The *flank* is a true involute of the base circle, parametrised by roll
 *     angle `t`, so a point sits at radius rb*sqrt(1+t^2) and the angle it
 *     subtends from the tooth centreline is psi + inv(alpha) - inv(atan(t)).
 *
 *  2. The external *root fillet* is the analytic trochoid swept by the rounded
 *     tip corner of the generating rack. This is what gives a correct undercut
 *     on low tooth counts instead of a wrong-but-pretty circular blend, and it
 *     is found by the classic "common normal passes through the pitch point"
 *     condition rather than by offsetting polygons.
 *
 * Kerf is applied here, not afterwards, and exactly: offsetting an involute
 * along its own normal by d yields the *same* involute rotated by d/rb, so the
 * whole compensation is one extra term in the tooth half-angle.
 */

import {
  TAU,
  arcPoints,
  clamp,
  dedupe,
  deg,
  involuteFn,
  polar,
  rotatePt,
  type Path,
  type Pt,
} from './types';
import { dropTinyBacktracks, mirrorX, signedArea, simplify, spliceAtIntersection } from './poly';

export interface GearParams {
  module: number;
  teeth: number;
  pressureAngleDeg: number;
  /** Addendum coefficient ha*, normally 1.0. */
  addendum: number;
  /** Clearance coefficient c*, normally 0.25. */
  clearance: number;
  /** Total circumferential backlash at the pitch circle, mm. Split evenly between the pair. */
  backlash: number;
  /** Profile shift coefficient x. */
  profileShift: number;
  /** External root fillet radius as a coefficient of module (0.38 is the standard maximum). */
  filletCoeff: number;
  /** Laser kerf, mm. The drawn path is offset by kerf/2 so the *cut* part is nominal. */
  kerf: number;
  /** Flattening tolerance, mm. */
  chordTol: number;
  internal: boolean;
}

export const defaultGearParams = (): GearParams => ({
  module: 3,
  teeth: 32,
  pressureAngleDeg: 20,
  addendum: 1,
  clearance: 0.25,
  backlash: 0.15,
  profileShift: 0,
  filletCoeff: 0.38,
  kerf: 0.18,
  chordTol: 0.05,
  internal: false,
});

export interface GearRadii {
  /** Pitch radius. */
  pitch: number;
  /** Base circle radius. */
  base: number;
  /** Tip radius — for an internal ring this is *smaller* than the pitch radius. */
  tip: number;
  /** Root radius — for an internal ring this is *larger* than the pitch radius. */
  root: number;
}

/** Nominal (kerf-free) radii. These are the numbers the UI reports and the tests assert on. */
export function gearRadii(p: GearParams): GearRadii {
  const m = p.module;
  const r = (m * p.teeth) / 2;
  const base = r * Math.cos(deg(p.pressureAngleDeg));
  if (p.internal) {
    return {
      pitch: r,
      base,
      tip: r - m * (p.addendum - p.profileShift),
      root: r + m * (p.addendum + p.clearance + p.profileShift),
    };
  }
  return {
    pitch: r,
    base,
    tip: r + m * (p.addendum + p.profileShift),
    root: r - m * (p.addendum + p.clearance - p.profileShift),
  };
}

/**
 * Arc tooth thickness at the pitch circle, nominal (no kerf).
 * For an internal ring this is the thickness of the *ring tooth*, not the space.
 */
export function toothThickness(p: GearParams): number {
  const m = p.module;
  const a = deg(p.pressureAngleDeg);
  if (p.internal) return (m * Math.PI) / 2 - p.backlash / 2;
  return m * (Math.PI / 2 + 2 * p.profileShift * Math.tan(a)) - p.backlash / 2;
}

export interface GearProfile {
  /** Closed, kerf-compensated tooth profile. For a ring this is the inner toothed boundary. */
  path: Path;
  radii: GearRadii;
  /** Tip came to a point before reaching the tip circle. */
  pointed: boolean;
  /** The generating rack cut into the involute flank — real, and usually undesirable. */
  undercut: boolean;
  warnings: string[];
}

/**
 * Build the full closed tooth profile.
 *
 * The external and internal cases share one skeleton, because an internal
 * ring's tooth *space* has the same shape family as an external tooth:
 *
 *   sideProfile (rInner -> rOuter)  +  arc at rOuter  +  mirrored side (back down)
 *   ... then an arc at rInner bridges to the next period.
 *
 * For an external gear rInner is the root circle and rOuter the tip circle.
 * For an internal ring those swap: rInner is the (inward-pointing) tip circle
 * and rOuter is the root circle.
 */
export interface ToothPeriod {
  /**
   * Exactly one tooth pitch of profile, in gear coordinates, with the tooth
   * *space* centred on angle 0 and spanning [-pi/z, +pi/z], ordered
   * counter-clockwise. Repeating this z times gives the whole gear; placing
   * copies of it along an arbitrary curve gives a non-circular one.
   */
  pts: Pt[];
  radii: GearRadii;
  /** Tooth count it was built for, which may be fractional. */
  teeth: number;
  pointed: boolean;
  undercut: boolean;
  warnings: string[];
}

/**
 * Build one tooth period.
 *
 * `teeth` may be fractional here. A non-circular ring needs the tooth form of
 * the circle that osculates its pitch curve at each tooth, and that circle's
 * equivalent tooth count 2*rho/m is almost never a whole number.
 */
export function buildToothPeriod(p: GearParams): ToothPeriod {
  const warnings: string[] = [];
  const z = Math.max(3, p.teeth);
  const m = p.module;
  const alpha = deg(p.pressureAngleDeg);
  const invAlpha = involuteFn(alpha);
  const kh = p.kerf / 2;
  const radii = gearRadii(p);
  const r = radii.pitch;
  const rb = radii.base;
  const pitchAngle = TAU / z;

  // Half-angle at the pitch circle of whichever feature the side profile bounds
  // (the tooth for an external gear, the space for an internal ring), including
  // the kerf term. Offsetting an involute normally by kh rotates it by kh/rb.
  let psi: number;
  let rInner: number;
  let rOuter: number;
  if (p.internal) {
    const spaceWidth = (m * Math.PI) / 2 + p.backlash / 2;
    psi = spaceWidth / (2 * r) - kh / rb;
    rInner = radii.tip - kh; // ring tooth tips reach further in once kerf is added
    rOuter = radii.root - kh; // ring root sits closer in, keeping material
  } else {
    psi = toothThickness(p) / (2 * r) + kh / rb;
    // Material on an external gear lies *inside* the root circle, so growing it
    // by the kerf means drawing a shallower space, not a deeper one.
    rInner = radii.root + kh;
    rOuter = radii.tip + kh;
  }

  if (psi <= 0) {
    warnings.push('Kerf and backlash together consume the whole tooth thickness — reduce one of them.');
    psi = 1e-4;
  }

  /** Angle of the flank at radius rho, measured from the feature centreline (negative side). */
  const flankAngleAt = (rho: number): number => {
    const ar = Math.acos(clamp(rb / rho, -1, 1));
    return psi + invAlpha - involuteFn(ar);
  };

  // ---- flank -------------------------------------------------------------
  // Parametrised by roll angle t: rho = rb*sqrt(1+t^2), inv(alpha_rho) = t - atan(t).
  const tAt = (rho: number) => Math.sqrt(Math.max(0, (rho / rb) ** 2 - 1));
  const flankPt = (t: number): Pt => {
    const rho = rb * Math.sqrt(1 + t * t);
    const phi = psi + invAlpha - (t - Math.atan(t));
    return polar(rho, -phi);
  };

  let tMax = tAt(rOuter);
  let pointed = false;
  const phiAtT = (t: number) => psi + invAlpha - (t - Math.atan(t));
  if (phiAtT(tMax) <= 0) {
    // Tooth (or space) closes to a point before the outer circle: bisect for the crossing.
    pointed = true;
    let lo = 0;
    let hi = tMax;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (phiAtT(mid) > 0) lo = mid;
      else hi = mid;
    }
    tMax = lo;
    warnings.push(
      p.internal
        ? 'Ring tooth space closes to a point before the root circle.'
        : 'Tooth comes to a point before the tip circle — reduce addendum or add profile shift.',
    );
  }

  // The generating rack's straight flank only reaches down to the *form radius*;
  // below that the rounded corner takes over. So the flank must start there, not
  // at the root or base circle.
  let undercut = false;
  let troch: TrochoidResult | null = null;
  let flankStartR = Math.max(rInner, rb);
  if (!p.internal) {
    troch = rackTrochoid(p, radii, psi, rOuter);
    undercut = troch.undercut;
    flankStartR = Math.max(flankStartR, troch.formRadius);
    if (undercut) {
      warnings.push(
        `Undercut: with ${Math.round(z)} teeth the generating rack cuts into the involute flank. ` +
          `Use at least ${minTeethWithoutUndercut(p)} teeth, or add profile shift.`,
      );
    }
  }

  const tStart = flankStartR > rb ? tAt(flankStartR) : 0;
  const flank: Pt[] = [];
  {
    // Step so the sagitta stays within chordTol. The involute's radius of
    // curvature at roll angle t is rb*t, and ds/dt = rb*t.
    const span = Math.max(tMax - tStart, 1e-9);
    const minStep = Math.max(span / 4000, 1e-9);
    const maxStep = Math.max(span / 16, minStep);
    let t = tStart;
    while (t < tMax) {
      flank.push(flankPt(t));
      const rc = Math.max(rb * t, 1e-6);
      const chord = Math.sqrt(8 * rc * p.chordTol);
      const dt = clamp(chord / rc, minStep, maxStep);
      t += dt;
    }
    flank.push(flankPt(tMax));
  }

  // ---- lower end of the side profile -------------------------------------
  let side: Pt[];

  if (p.internal || !troch) {
    // No shaper trochoid: below the base circle the flank is extended radially
    // inward to the tip circle. That region never carries contact.
    if (rInner < rb) {
      side = [polar(rInner, -flankAngleAt(rb)), ...flank];
    } else {
      side = flank;
    }
  } else if (undercut) {
    // Undercut is the one case where the fillet genuinely crosses the involute
    // rather than meeting it tangentially, so the crossing can be found directly.
    // Scanning the trochoid from the root end finds the undercut crossing before
    // the curl at the far end of the trochoid.
    side = spliceAtIntersection(troch.pts, flank) ?? [...belowRadius(troch.pts, flankStartR), ...flank];
  } else {
    // Tangential meeting: there is no crossing to find, so trust the analytic
    // form radius and butt the two curves together there.
    side = [...belowRadius(troch.pts, flankStartR), ...flank];
  }

  side = dedupe(side);

  // Neighbouring periods must not overlap: clip anything past the half-pitch ray.
  side = clipBelowAngle(side, -pitchAngle / 2);
  if (side.length < 2) {
    warnings.push('Profile degenerated — check module, tooth count and clearance.');
    side = [polar(rInner, -pitchAngle / 2), polar(rOuter, -1e-6)];
  }

  const first = side[0]!;
  const last = side[side.length - 1]!;
  const phiInner = Math.abs(Math.atan2(first.y, first.x));
  const phiOuter = Math.abs(Math.atan2(last.y, last.x));
  const rInnerActual = Math.hypot(first.x, first.y);

  // ---- assemble one period -----------------------------------------------
  // Runs from one tooth centre to the next: half a root arc, up the flank,
  // over the tip, down the mirrored flank, then half a root arc again.
  const pts: Pt[] = [];
  const mirrored = mirrorX(side).reverse();
  const hasRootArc = phiInner < pitchAngle / 2 - 1e-12;
  if (hasRootArc) {
    pts.push(...arcPoints(0, 0, rInnerActual, -pitchAngle / 2, -phiInner, p.chordTol));
  }
  pts.push(...side);
  if (!pointed && phiOuter > 1e-12) {
    pts.push(...arcPoints(0, 0, rOuter, -phiOuter, phiOuter, p.chordTol));
  }
  pts.push(...mirrored);
  if (hasRootArc) {
    pts.push(...arcPoints(0, 0, rInnerActual, phiInner, pitchAngle / 2, p.chordTol));
  }

  return { pts: dedupe(pts, 1e-9), radii, teeth: z, pointed, undercut, warnings };
}

/** Repeat a tooth period around a full circular gear. */
export function buildGearProfile(p: GearParams): GearProfile {
  const z = Math.max(3, Math.round(p.teeth));
  const period = buildToothPeriod({ ...p, teeth: z });
  const pitchAngle = TAU / z;

  const pts: Pt[] = [];
  for (let k = 0; k < z; k++) {
    const theta = k * pitchAngle;
    for (const q of period.pts) pts.push(rotatePt(q, theta));
  }

  // 1 micron: 200x below the kerf, so this only ever removes numerical noise
  // from the curve splices, never real geometry.
  let ring = dropTinyBacktracks(dedupe(pts, 1e-7), 1e-3);
  if (signedArea(ring) < 0) ring = ring.reverse();

  return {
    path: { pts: ring, closed: true },
    radii: period.radii,
    pointed: period.pointed,
    undercut: period.undercut,
    warnings: period.warnings,
  };
}

interface TrochoidResult {
  /** Ordered from the root circle outward. */
  pts: Pt[];
  undercut: boolean;
  /**
   * Radius at which the rack's straight flank first makes contact — the point
   * where the trochoid hands over to the involute.
   */
  formRadius: number;
}

/**
 * The root fillet: the trochoid swept by the generating rack's rounded tip corner.
 *
 * Frame for the derivation (then rotated so the tooth centreline lands on +X):
 * gear centre at the origin, pitch circle radius r, the rack's pitch line the
 * horizontal y = r, rolling without slip so the pitch point stays at (0, r).
 * A point fixed in the rack at rack coordinates (a, b) appears in the rotating
 * gear frame at
 *     X = (a + r*phi) cos(phi) - (r + b) sin(phi)
 *     Y = (a + r*phi) sin(phi) + (r + b) cos(phi)
 *
 * The cut surface is the envelope of the corner circle, whose point of contact
 * is where the common normal runs through the pitch point — so the envelope
 * point is simply the circle centre pushed a further rho_f directly away from
 * the pitch point.
 */
export function rackTrochoid(p: GearParams, radii: GearRadii, psi: number, rOuter: number): TrochoidResult {
  const m = p.module;
  const alpha = deg(p.pressureAngleDeg);
  const tanA = Math.tan(alpha);
  const cosA = Math.cos(alpha);
  const r = radii.pitch;
  const kh = p.kerf / 2;

  // Cut depth below the pitch line. The rack tip generates the root circle, and
  // cutting kerf/2 shallower is what leaves the *finished* root at nominal.
  const hD = m * (p.addendum + p.clearance - p.profileShift) - kh;

  // Half-width of the rack tooth where it meets its tip line; the corner radius
  // has to fit inside that, and inside the clearance zone.
  const halfAtTip = Math.max(1e-4, (Math.PI * m) / 2 - psi * r - hD * tanA);
  // Two corners must fit on one rack tooth: the corner centre is inset from the
  // flank by rho/cos(a) while the tooth widens by rho*tan(a) over that height,
  // so the centre stays on the tooth while rho <= halfAtTip*cos(a)/(1-sin(a)).
  const cornerFit = (halfAtTip * cosA) / (1 - Math.sin(alpha));
  const rhoF = Math.max(
    0,
    Math.min(p.filletCoeff * m, (p.clearance * m) / (1 - Math.sin(alpha)), 0.45 * hD, 0.95 * cornerFit),
  );

  const bc = -hD + rhoF;
  const ac = psi * r - bc * tanA + rhoF / cosA;

  // Rack travel of +/- 6 modules is far more than enough to sweep past the flank.
  const range = (6 * m) / r;
  const n = 1200;
  const raw: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = -range + (2 * range * i) / n;
    const cx = (ac + r * phi) * Math.cos(phi) - (r + bc) * Math.sin(phi);
    const cy = (ac + r * phi) * Math.sin(phi) + (r + bc) * Math.cos(phi);
    const px = -r * Math.sin(phi);
    const py = r * Math.cos(phi);
    let qx = cx;
    let qy = cy;
    if (rhoF > 0) {
      const dx = cx - px;
      const dy = cy - py;
      const len = Math.hypot(dx, dy) || 1;
      qx = cx + (rhoF * dx) / len;
      qy = cy + (rhoF * dy) / len;
    }
    // Rotate -90 degrees so the tooth centreline sits on +X.
    raw.push({ x: qy, y: -qx });
  }

  // The deepest point is the tangency with the root circle; walk outward from it
  // in the direction that climbs towards the tooth centreline.
  let minIdx = 0;
  let minR = Infinity;
  for (let i = 0; i < raw.length; i++) {
    const rr = Math.hypot(raw[i]!.x, raw[i]!.y);
    if (rr < minR) {
      minR = rr;
      minIdx = i;
    }
  }
  const angleAt = (i: number) => Math.atan2(raw[i]!.y, raw[i]!.x);
  const fwd = minIdx + 1 < raw.length ? angleAt(minIdx + 1) : -Infinity;
  const back = minIdx > 0 ? angleAt(minIdx - 1) : -Infinity;
  const step = fwd > back ? 1 : -1;

  const branch: Pt[] = [];
  for (let i = minIdx; i >= 0 && i < raw.length; i += step) {
    const q = raw[i]!;
    branch.push(q);
    if (Math.hypot(q.x, q.y) > rOuter) break;
  }
  // The sweep is sampled at a fixed high rate to locate the deepest point
  // reliably; thin it back down to the flattening budget so a 157-tooth ring
  // does not carry tens of thousands of redundant points into the SVG.
  const pts = simplify(branch, p.chordTol / 2);

  // Form radius. The rack flank is tangent to the corner circle at depth
  // b_t = bc - rho*sin(a) below the pitch line; that flank point makes contact
  // a distance L = -b_t/sin(a) along the line of action from the pitch point,
  // and the pitch point sits r*sin(a) from where the line of action touches the
  // base circle.
  const bt = bc - rhoF * Math.sin(alpha);
  const L = -bt / Math.sin(alpha);
  const along = r * Math.sin(alpha) - L;
  const formRadius = Math.sqrt(radii.base * radii.base + along * along);

  return { pts, undercut: undercutsWithRack(p), formRadius };
}

/** Keep the leading run of a root-outward curve that stays inside `rMax`. */
function belowRadius(pts: Pt[], rMax: number): Pt[] {
  const out: Pt[] = [];
  for (const q of pts) {
    if (Math.hypot(q.x, q.y) >= rMax) break;
    out.push(q);
  }
  return out;
}

/**
 * Whether a rack-generated gear undercuts, by the standard criterion
 * z < 2(ha* - x)/sin^2(alpha) — about 17.1 teeth for a full-depth 20° tooth.
 *
 * Tempting alternatives measured off the generated polyline all misfire: for
 * any gear under roughly 42 teeth the base circle already sits above the root
 * circle, so "the fillet climbs past the base circle" is true of healthy gears
 * too. This is the actual definition for rack generation, so use it.
 */
export function undercutsWithRack(p: GearParams): boolean {
  if (p.internal) return false;
  const sinA = Math.sin(deg(p.pressureAngleDeg));
  const zMin = (2 * (p.addendum - p.profileShift)) / (sinA * sinA);
  return p.teeth < zMin - 1e-9;
}

/** Smallest tooth count that avoids undercut at the current pressure angle and shift. */
export function minTeethWithoutUndercut(p: Pick<GearParams, 'pressureAngleDeg' | 'addendum' | 'profileShift'>): number {
  const sinA = Math.sin(deg(p.pressureAngleDeg));
  return Math.ceil((2 * (p.addendum - p.profileShift)) / (sinA * sinA) - 1e-9);
}

/**
 * Drop the leading part of a side profile that runs past `minAngle` (a negative
 * half-pitch ray), interpolating a point exactly on the ray. This is what makes
 * deep roots on low tooth counts meet cleanly instead of self-intersecting.
 */
function clipBelowAngle(pts: Pt[], minAngle: number): Pt[] {
  const ang = (q: Pt) => Math.atan2(q.y, q.x);
  let i = 0;
  while (i < pts.length && ang(pts[i]!) < minAngle) i++;
  if (i === 0) return pts;
  if (i >= pts.length) return [];
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const aa = ang(a);
  const ab = ang(b);
  const f = Math.abs(ab - aa) < 1e-15 ? 0 : (minAngle - aa) / (ab - aa);
  const cross = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  return [cross, ...pts.slice(i)];
}
