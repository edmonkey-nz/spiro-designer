/**
 * Measurement helpers for the geometry tests.
 *
 * These deliberately measure the *generated polyline* rather than re-deriving
 * from the same formulas the code under test uses — otherwise the tests only
 * prove the code agrees with itself.
 */

import type { Pt } from '../src/geom/types';

export const radiusOf = (p: Pt): number => Math.hypot(p.x, p.y);

/** Unwrapped polar angles for a profile traversed monotonically counter-clockwise. */
export function unwrappedAngles(pts: Pt[]): number[] {
  const out: number[] = [];
  let prev = 0;
  let turns = 0;
  pts.forEach((p, i) => {
    const a = Math.atan2(p.y, p.x);
    if (i > 0 && a - prev < -Math.PI) turns += 1;
    else if (i > 0 && a - prev > Math.PI) turns -= 1;
    prev = a;
    out.push(a + turns * Math.PI * 2);
  });
  return out;
}

/**
 * Angular widths of the intervals where the profile lies outside radius `r`.
 *
 * For an external gear at the pitch circle these are the teeth; for an internal
 * ring's inner boundary they are the tooth spaces.
 */
export function outsideArcWidths(pts: Pt[], r: number): number[] {
  const n = pts.length;
  // Close the loop explicitly so the wrap-around segment is measured like any other.
  const ang = [...unwrappedAngles(pts)];
  ang.push(ang[0]! + Math.PI * 2);
  const rad = pts.map(radiusOf);
  rad.push(rad[0]!);

  const crossings: { a: number; out: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const d0 = rad[i]! - r;
    const d1 = rad[i + 1]! - r;
    if (d0 === 0 || d0 * d1 > 0) continue;
    const f = d0 / (d0 - d1);
    crossings.push({ a: ang[i]! + (ang[i + 1]! - ang[i]!) * f, out: d1 > 0 });
  }
  crossings.sort((x, y) => x.a - y.a);

  const widths: number[] = [];
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i]!;
    if (!c.out) continue;
    const next = crossings[(i + 1) % crossings.length]!;
    let w = next.a - c.a;
    if (w < 0) w += Math.PI * 2;
    widths.push(w);
  }
  return widths;
}

/** Total arc length of material (or space) outside radius `r`, measured at `r`. */
export function totalArcThickness(pts: Pt[], r: number): number {
  return outsideArcWidths(pts, r).reduce((s, w) => s + w, 0) * r;
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
