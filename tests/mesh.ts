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

/**
 * A spatial index over a closed polygon, for clearance tests that cannot
 * assume the boundary is single-valued in angle.
 *
 * `radialProfile` above is fine for a circular gear, whose profile really is
 * a function of angle. A ring bent into a stadium or a flower is not: its
 * teeth tilt up to 25 degrees off-radial, which is enough to make the
 * boundary double back, and sorting those samples by angle silently
 * interleaves teeth from different parts of the rim. Measuring against a
 * proper index instead costs a little more and cannot lie.
 */
export class PolyIndex {
  private readonly segs: { ax: number; ay: number; bx: number; by: number }[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly minX: number;
  private readonly minY: number;
  private readonly cell: number;
  private readonly cols: number;

  constructor(pts: Pt[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    this.minX = minX;
    this.minY = minY;
    this.cell = Math.max((maxX - minX) / 256, (maxY - minY) / 256, 1e-6);
    this.cols = Math.ceil((maxX - minX) / this.cell) + 2;

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const n = this.segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y }) - 1;
      const x0 = this.ix(Math.min(a.x, b.x));
      const x1 = this.ix(Math.max(a.x, b.x));
      const y0 = this.iy(Math.min(a.y, b.y));
      const y1 = this.iy(Math.max(a.y, b.y));
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const key = gy * this.cols + gx;
          const list = this.cells.get(key);
          if (list) list.push(n);
          else this.cells.set(key, [n]);
        }
      }
    }
  }

  private ix = (x: number) => Math.floor((x - this.minX) / this.cell);
  private iy = (y: number) => Math.floor((y - this.minY) / this.cell);

  /** Ray cast along +x; robust enough for the well-conditioned profiles here. */
  contains(p: Pt): boolean {
    let inside = false;
    for (const s of this.segs) {
      if (s.ay > p.y !== s.by > p.y) {
        const t = (p.y - s.ay) / (s.by - s.ay);
        if (p.x < s.ax + t * (s.bx - s.ax)) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Shortest distance from the point to the boundary, giving up beyond
   * `maxRings` grid cells.
   *
   * Searching outward until a hit is found is quadratic in the distance, and
   * most of a cog sits tens of millimetres from the rim where the exact figure
   * is of no interest. Only near misses matter, so the search stops early and
   * reports Infinity for anything comfortably clear.
   */
  distanceTo(p: Pt, maxRings = 4): number {
    let best = Infinity;
    const gx = this.ix(p.x);
    const gy = this.iy(p.y);
    for (let ring = 0; ring <= maxRings; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const list = this.cells.get((gy + dy) * this.cols + (gx + dx));
          if (!list) continue;
          for (const i of list) best = Math.min(best, segDistance(p, this.segs[i]!));
        }
      }
      // One extra ring past the first hit, since a nearer segment can sit
      // diagonally in the next ring out.
      if (best <= ring * this.cell) break;
    }
    return best;
  }
}

function segDistance(p: Pt, s: { ax: number; ay: number; bx: number; by: number }): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / len2));
  return Math.hypot(p.x - (s.ax + t * dx), p.y - (s.ay + t * dy));
}
