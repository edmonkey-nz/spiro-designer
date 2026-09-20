/**
 * Secondary part features: hub bore, bolt circles, mounting holes, lightening
 * cutouts, pen holes and engraved labels.
 *
 * Kerf convention throughout: a hole is *drawn* smaller than nominal by kerf/2
 * so the cut hole comes out at the nominal size; material outlines are drawn
 * larger by kerf/2 for the same reason.
 */

import { textPaths, textWidth } from './hershey';
import {
  TAU,
  arcPoints,
  circlePath,
  clamp,
  polar,
  type Path,
  type PenHole,
  type Pt,
} from './types';

export interface HubSpec {
  /** Centre bore diameter, mm. 0 disables the bore. */
  boreDia: number;
  /** Solid boss kept around the bore; pen holes are never placed inside it. */
  bossDia: number;
  boltCount: number;
  boltCircleDia: number;
  boltDia: number;
  /** Engrave a small cross at the exact centre, for setting the part up. */
  crosshair: boolean;
}

export interface MountSpec {
  enabled: boolean;
  count: number;
  /** Pitch circle diameter of the bolt pattern, mm. */
  circleDia: number;
  holeDia: number;
}

export interface CutoutSpec {
  enabled: boolean;
  count: number;
  /** Material left between adjacent cutouts, mm. */
  webWidth: number;
  /** Material left inside and outside the cutout band, mm. */
  edgeMargin: number;
  cornerRadius: number;
}

export type PenLayout = 'radial-line' | 'radial-spokes' | 'spiral' | 'ring';

export interface PenHoleSpec {
  layout: PenLayout;
  count: number;
  /** Number of radial arms for the 'radial-spokes' layout. */
  arms: number;
  /** Requested radial range, mm. Clamped to the usable annulus. */
  minR: number;
  maxR: number;
  dia: number;
  annotate: boolean;
  /** Also engrave each hole's radius in mm, not just its index. */
  annotateRadius: boolean;
}

export interface LayerPaths {
  cut: Path[];
  engrave: Path[];
}

export const defaultHub = (): HubSpec => ({
  boreDia: 8,
  bossDia: 26,
  boltCount: 0,
  boltCircleDia: 40,
  boltDia: 5.2,
  crosshair: true,
});

export const defaultMount = (): MountSpec => ({ enabled: false, count: 6, circleDia: 0, holeDia: 5.2 });

export const defaultCutouts = (): CutoutSpec => ({
  enabled: false,
  count: 5,
  webWidth: 12,
  edgeMargin: 10,
  cornerRadius: 4,
});

export const defaultPenHoles = (): PenHoleSpec => ({
  layout: 'radial-line',
  count: 8,
  arms: 3,
  minR: 0,
  maxR: 0,
  dia: 5,
  annotate: true,
  annotateRadius: true,
});

const empty = (): LayerPaths => ({ cut: [], engrave: [] });

/** A hole drawn kerf-compensated so the finished bore measures `dia`. */
export function holePath(cx: number, cy: number, dia: number, kerf: number, chordTol: number): Path | null {
  const r = dia / 2 - kerf / 2;
  if (r <= 0.05) return null;
  return circlePath(cx, cy, r, Math.min(chordTol, Math.max(r / 50, 0.01)));
}

export function hubPaths(hub: HubSpec, kerf: number, chordTol: number): LayerPaths {
  const out = empty();
  const bore = hub.boreDia > 0 ? holePath(0, 0, hub.boreDia, kerf, chordTol) : null;
  if (bore) out.cut.push(bore);

  if (hub.boltCount > 0 && hub.boltCircleDia > 0) {
    const pcd = hub.boltCircleDia / 2;
    for (let i = 0; i < hub.boltCount; i++) {
      const a = (i / hub.boltCount) * TAU;
      const h = holePath(pcd * Math.cos(a), pcd * Math.sin(a), hub.boltDia, kerf, chordTol);
      if (h) out.cut.push(h);
    }
  }

  if (hub.crosshair) {
    const s = Math.max(2, hub.boreDia > 0 ? hub.boreDia * 0.7 : 4);
    out.engrave.push({ pts: [{ x: -s, y: 0 }, { x: s, y: 0 }], closed: false });
    out.engrave.push({ pts: [{ x: 0, y: -s }, { x: 0, y: s }], closed: false });
  }

  return out;
}

export function mountPaths(mount: MountSpec, kerf: number, chordTol: number, phase = 0): LayerPaths {
  const out = empty();
  if (!mount.enabled || mount.count <= 0 || mount.circleDia <= 0) return out;
  const pcd = mount.circleDia / 2;
  for (let i = 0; i < mount.count; i++) {
    const a = phase + (i / mount.count) * TAU;
    const h = holePath(pcd * Math.cos(a), pcd * Math.sin(a), mount.holeDia, kerf, chordTol);
    if (h) out.cut.push(h);
  }
  return out;
}

/**
 * Lightening cutouts: annular sectors between `innerR` and `outerR`, with
 * quadratic-Bézier corner blends. Bézier blends rather than true tangent arcs
 * because they can never degenerate, and this is a stress-relief/weight feature
 * rather than a fitted one.
 */
export function cutoutPaths(
  spec: CutoutSpec,
  innerR: number,
  outerR: number,
  kerf: number,
  chordTol: number,
): LayerPaths {
  const out = empty();
  if (!spec.enabled || spec.count <= 0) return out;

  // The cutout is a hole, so its boundary is drawn *inside* the nominal opening.
  const r0 = innerR + spec.edgeMargin + kerf / 2;
  const r1 = outerR - spec.edgeMargin - kerf / 2;
  if (r1 - r0 < 4) return out;

  const pitch = TAU / spec.count;
  // Angular allowance for the web, measured at the outer radius where it is tightest.
  const webAngle = (spec.webWidth + kerf) / r1;
  const halfAngle = pitch / 2 - webAngle / 2;
  if (halfAngle <= 0.02) return out;

  const cr = clamp(spec.cornerRadius, 0, Math.min((r1 - r0) / 2.5, (halfAngle * r0) / 2.5));

  for (let i = 0; i < spec.count; i++) {
    const c = i * pitch;
    out.cut.push(roundedSector(c, halfAngle, r0, r1, cr, chordTol));
  }
  return out;
}

function roundedSector(
  centreAngle: number,
  halfAngle: number,
  r0: number,
  r1: number,
  cr: number,
  chordTol: number,
): Path {
  const dA0 = cr / r0;
  const dA1 = cr / r1;
  const a0n = centreAngle - halfAngle;
  const a0p = centreAngle + halfAngle;

  const pts: Pt[] = [];
  // Inner arc, negative side to positive side.
  pts.push(...arcPoints(0, 0, r0, a0n + dA0, a0p - dA0, chordTol));
  // Corner into the +angle radial edge.
  pts.push(...quadBezier(polar(r0, a0p - dA0), polar(r0, a0p), polar(r0 + cr, a0p), 8));
  pts.push(polar(r1 - cr, a0p));
  pts.push(...quadBezier(polar(r1 - cr, a0p), polar(r1, a0p), polar(r1, a0p - dA1), 8));
  // Outer arc back.
  pts.push(...arcPoints(0, 0, r1, a0p - dA1, a0n + dA1, chordTol));
  pts.push(...quadBezier(polar(r1, a0n + dA1), polar(r1, a0n), polar(r1 - cr, a0n), 8));
  pts.push(polar(r0 + cr, a0n));
  pts.push(...quadBezier(polar(r0 + cr, a0n), polar(r0, a0n), polar(r0, a0n + dA0), 8));

  return { pts, closed: true };
}

function quadBezier(p0: Pt, c: Pt, p1: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    });
  }
  return out;
}

/**
 * Place pen holes for a layout spec inside the usable annulus.
 *
 * `usableMin`/`usableMax` come from the part (boss edge and root circle minus a
 * wall). Requested radii are clamped rather than rejected, so dragging a slider
 * never produces an invalid part — `validate.ts` raises the warning instead.
 */
export function generatePenHoles(
  spec: PenHoleSpec,
  usableMin: number,
  usableMax: number,
  idPrefix = 'p',
): PenHole[] {
  const lo = Math.min(Math.max(spec.minR || usableMin, usableMin), usableMax);
  const hi = Math.max(Math.min(spec.maxR || usableMax, usableMax), lo);
  const count = Math.max(1, Math.round(spec.count));
  const holes: PenHole[] = [];

  const push = (r: number, theta: number) => {
    holes.push({
      id: `${idPrefix}${holes.length + 1}`,
      index: holes.length + 1,
      r,
      theta,
      dia: spec.dia,
    });
  };

  const spread = (i: number, n: number) => (n <= 1 ? hi : lo + ((hi - lo) * i) / (n - 1));

  switch (spec.layout) {
    case 'radial-line':
      for (let i = 0; i < count; i++) push(spread(i, count), 0);
      break;
    case 'radial-spokes': {
      const arms = Math.max(1, Math.round(spec.arms));
      const perArm = Math.max(1, Math.round(count / arms));
      for (let a = 0; a < arms; a++) {
        for (let i = 0; i < perArm; i++) push(spread(i, perArm), (a / arms) * TAU);
      }
      break;
    }
    case 'spiral': {
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < count; i++) push(spread(i, count), i * golden);
      break;
    }
    case 'ring':
      for (let i = 0; i < count; i++) push(hi, (i / count) * TAU);
      break;
  }

  return holes;
}

/**
 * Cut circles plus engraved annotation for each pen hole.
 * Labels are rotated to read outward along the radius.
 */
export function penHolePaths(
  holes: PenHole[],
  spec: Pick<PenHoleSpec, 'annotate' | 'annotateRadius'>,
  kerf: number,
  chordTol: number,
): LayerPaths {
  const out = empty();
  for (const h of holes) {
    const c = polar(h.r, h.theta);
    const circle = holePath(c.x, c.y, h.dia, kerf, chordTol);
    if (circle) out.cut.push(circle);
    if (!spec.annotate) continue;

    // Labels run *along* the radius and are offset *across* it. Offsetting
    // radially instead would march each label into the next hole on the same
    // spoke, which is exactly what makes a dense hole field unreadable.
    const size = clamp(h.dia * 0.62, 2.2, 4);
    const flip = Math.cos(h.theta) < 0; // keep text from reading upside down
    const rot = flip ? h.theta + Math.PI : h.theta;
    const across = { x: -Math.sin(rot), y: Math.cos(rot) };
    const off = h.dia / 2 + size * 0.75;

    out.engrave.push(
      ...textPaths(String(h.index), c.x + across.x * off, c.y + across.y * off, {
        size,
        rotate: rot,
        anchor: 'middle',
        baseline: 'middle',
      }),
    );

    if (spec.annotateRadius) {
      const small = size * 0.78;
      const offR = h.dia / 2 + small * 0.75;
      out.engrave.push(
        ...textPaths(h.r.toFixed(1), c.x - across.x * offR, c.y - across.y * offR, {
          size: small,
          rotate: rot,
          anchor: 'middle',
          baseline: 'middle',
        }),
      );
    }
  }
  return out;
}

/** Engraved identification block, placed at a given radius and angle. */
export function labelPaths(lines: string[], r: number, theta: number, size: number): Path[] {
  const out: Path[] = [];
  const lead = size * 1.5;
  const centre = polar(r, theta);
  const rot = theta - Math.PI / 2; // text runs tangentially, reading outward
  lines.forEach((line, i) => {
    const off = -(i - (lines.length - 1) / 2) * lead;
    const x = centre.x + Math.cos(rot + Math.PI / 2) * off;
    const y = centre.y + Math.sin(rot + Math.PI / 2) * off;
    out.push(...textPaths(line, x, y, { size, rotate: rot, anchor: 'middle', baseline: 'middle' }));
  });
  return out;
}

/** Horizontal engraved text, used on racks and splice plates. */
export function flatLabel(text: string, x: number, y: number, size: number): Path[] {
  return textPaths(text, x, y, { size, anchor: 'middle', baseline: 'middle' });
}

export { textWidth };
