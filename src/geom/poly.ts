/** Polyline algorithms shared by the profile builders. */

import type { Pt } from './types';

export type PolyHit = {
  /** Index of the segment start in A. */
  ia: number;
  /** Index of the segment start in B. */
  ib: number;
  /** The intersection point itself. */
  p: Pt;
};

/**
 * Intersection of segments p1->p2 and p3->p4, excluding parallel/degenerate cases.
 * Returns null when they do not cross within both segments.
 */
export function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * First intersection between two open polylines, scanning A from its start.
 *
 * Both profile splices in `involute.ts` rely on "first from the root end", so the
 * scan order matters: A is walked outermost-loop.
 */
export function firstIntersection(a: Pt[], b: Pt[]): PolyHit | null {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const p = segIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!);
      if (p) return { ia: i, ib: j, p };
    }
  }
  return null;
}

/**
 * Splice two polylines at their first crossing: keep A up to the hit, then B after it.
 * Returns null when they do not cross, leaving the caller to pick a fallback join.
 */
export function spliceAtIntersection(a: Pt[], b: Pt[]): Pt[] | null {
  const hit = firstIntersection(a, b);
  if (!hit) return null;
  return [...a.slice(0, hit.ia + 1), hit.p, ...b.slice(hit.ib + 1)];
}

/**
 * Drop points that step backwards in polar angle by less than `tolMm` of arc.
 *
 * Splicing a trochoid onto an involute onto an arc can leave a sub-micron
 * backtrack where the curves meet almost tangentially. It is far below the
 * kerf, but it is still a reversal in the cut path, so it is worth removing.
 *
 * Backtracks *larger* than the tolerance are kept: a severely undercut tooth is
 * genuinely re-entrant, and silently straightening that out would be a lie.
 */
export function dropTinyBacktracks(pts: Pt[], tolMm: number): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [];
  let maxAngle = -Infinity;
  let turns = 0;
  let prevRaw = Math.atan2(pts[0]!.y, pts[0]!.x);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const raw = Math.atan2(p.y, p.x);
    if (i > 0 && raw - prevRaw < -Math.PI) turns += 1;
    else if (i > 0 && raw - prevRaw > Math.PI) turns -= 1;
    prevRaw = raw;
    const a = raw + turns * Math.PI * 2;
    const deficit = maxAngle - a;
    if (deficit > 0 && deficit * Math.hypot(p.x, p.y) < tolMm) continue;
    maxAngle = Math.max(maxAngle, a);
    out.push(p);
  }
  return out;
}

/** Signed area; positive means counter-clockwise in a Y-up frame. */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** Reflect a point list about the X axis (the tooth/space centreline in local frames). */
export function mirrorX(pts: Pt[]): Pt[] {
  return pts.map((p) => ({ x: p.x, y: -p.y }));
}

/**
 * Remove points that sit within `tol` of the chord between their neighbours.
 * Cuts file size substantially on large gears without visibly changing the path.
 */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3 || tol <= 0) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const abx = c.x - a.x;
    const aby = c.y - a.y;
    const len = Math.hypot(abx, aby);
    const devi = len < 1e-12 ? 0 : Math.abs(abx * (a.y - b.y) - (a.x - b.x) * aby) / len;
    if (devi > tol) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
