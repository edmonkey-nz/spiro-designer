/**
 * A compact single-stroke ("engraving") font.
 *
 * Laser software fills outline fonts, which on an engrave layer means either a
 * long raster pass or a double-cut outline. Single-stroke glyphs are centreline
 * polylines, so the head traces each character once — much faster, and legible
 * down to ~3mm cap height in ply.
 *
 * Glyphs are defined on a grid with the baseline at y=0, cap height at y=10 and
 * a nominal 5-wide body; `ADVANCE` includes the side bearing.
 */

import type { Path, Pt } from './types';

type Glyph = number[][][]; // strokes -> points -> [x, y]

const CAP = 10;
const ADVANCE = 7;

const G: Record<string, Glyph> = {
  ' ': [],
  '0': [[[1, 0], [0, 2], [0, 8], [1, 10], [4, 10], [5, 8], [5, 2], [4, 0], [1, 0]]],
  '1': [[[0.5, 8], [2.5, 10], [2.5, 0]], [[0.5, 0], [4.5, 0]]],
  '2': [[[0, 8], [1, 10], [4, 10], [5, 8], [5, 6.5], [0, 0], [5, 0]]],
  '3': [[[0, 10], [5, 10], [2.2, 6], [4, 6], [5, 5], [5, 1], [4, 0], [1, 0], [0, 1]]],
  '4': [[[3.8, 0], [3.8, 10], [0, 3], [5, 3]]],
  '5': [[[5, 10], [1, 10], [0.4, 5.6], [1.4, 6.2], [4, 6.2], [5, 5], [5, 1.5], [3.8, 0], [1, 0], [0, 1]]],
  '6': [[[5, 9], [4, 10], [1, 10], [0, 8], [0, 2], [1, 0], [4, 0], [5, 1.6], [5, 3.4], [4, 5], [1, 5], [0, 3.6]]],
  '7': [[[0, 10], [5, 10], [2, 0]]],
  '8': [
    [[1, 5], [0, 6], [0, 9], [1, 10], [4, 10], [5, 9], [5, 6], [4, 5], [1, 5], [0, 3.8], [0, 1], [1, 0], [4, 0], [5, 1], [5, 3.8], [4, 5]],
  ],
  '9': [[[0, 1], [1, 0], [4, 0], [5, 2], [5, 8], [4, 10], [1, 10], [0, 8.4], [0, 6.6], [1, 5], [4, 5], [5, 6.4]]],
  A: [[[0, 0], [2.5, 10], [5, 0]], [[0.9, 3.5], [4.1, 3.5]]],
  B: [[[0, 0], [0, 10], [4, 10], [5, 9], [5, 6], [4, 5], [0, 5]], [[4, 5], [5, 4], [5, 1], [4, 0], [0, 0]]],
  C: [[[5, 8.8], [3.8, 10], [1, 10], [0, 8], [0, 2], [1, 0], [3.8, 0], [5, 1.2]]],
  D: [[[0, 0], [0, 10], [3, 10], [5, 8], [5, 2], [3, 0], [0, 0]]],
  E: [[[5, 10], [0, 10], [0, 0], [5, 0]], [[0, 5], [3.6, 5]]],
  F: [[[5, 10], [0, 10], [0, 0]], [[0, 5], [3.6, 5]]],
  G: [[[5, 8.8], [3.8, 10], [1, 10], [0, 8], [0, 2], [1, 0], [4, 0], [5, 1.4], [5, 4], [3, 4]]],
  H: [[[0, 10], [0, 0]], [[5, 10], [5, 0]], [[0, 5], [5, 5]]],
  I: [[[1, 10], [4, 10]], [[2.5, 10], [2.5, 0]], [[1, 0], [4, 0]]],
  J: [[[4, 10], [4, 2], [3, 0], [1, 0], [0, 2]]],
  K: [[[0, 10], [0, 0]], [[5, 10], [0, 4.6]], [[1.7, 6.2], [5, 0]]],
  L: [[[0, 10], [0, 0], [5, 0]]],
  M: [[[0, 0], [0, 10], [2.5, 4.5], [5, 10], [5, 0]]],
  N: [[[0, 0], [0, 10], [5, 0], [5, 10]]],
  O: [[[1, 0], [0, 2], [0, 8], [1, 10], [4, 10], [5, 8], [5, 2], [4, 0], [1, 0]]],
  P: [[[0, 0], [0, 10], [4, 10], [5, 9], [5, 6], [4, 5], [0, 5]]],
  Q: [[[1, 0], [0, 2], [0, 8], [1, 10], [4, 10], [5, 8], [5, 2], [4, 0], [1, 0]], [[3.2, 2.2], [5.4, -0.4]]],
  R: [[[0, 0], [0, 10], [4, 10], [5, 9], [5, 6], [4, 5], [0, 5]], [[2.6, 5], [5, 0]]],
  S: [[[5, 8.8], [4, 10], [1, 10], [0, 8.8], [0, 6.2], [1, 5], [4, 5], [5, 3.8], [5, 1.2], [4, 0], [1, 0], [0, 1.2]]],
  T: [[[0, 10], [5, 10]], [[2.5, 10], [2.5, 0]]],
  U: [[[0, 10], [0, 2], [1, 0], [4, 0], [5, 2], [5, 10]]],
  V: [[[0, 10], [2.5, 0], [5, 10]]],
  W: [[[0, 10], [1, 0], [2.5, 6], [4, 0], [5, 10]]],
  X: [[[0, 10], [5, 0]], [[0, 0], [5, 10]]],
  Y: [[[0, 10], [2.5, 5], [5, 10]], [[2.5, 5], [2.5, 0]]],
  Z: [[[0, 10], [5, 10], [0, 0], [5, 0]]],
  '.': [[[2.1, 0], [2.9, 0], [2.9, 0.8], [2.1, 0.8], [2.1, 0]]],
  ',': [[[2.9, 0.8], [2.1, 0], [2.1, -1.2]]],
  '-': [[[0.5, 5], [4.5, 5]]],
  '+': [[[0.5, 5], [4.5, 5]], [[2.5, 3], [2.5, 7]]],
  '=': [[[0.5, 6.4], [4.5, 6.4]], [[0.5, 3.6], [4.5, 3.6]]],
  '/': [[[0, 0], [5, 10]]],
  ':': [[[2.1, 2], [2.9, 2], [2.9, 2.8], [2.1, 2.8], [2.1, 2]], [[2.1, 6], [2.9, 6], [2.9, 6.8], [2.1, 6.8], [2.1, 6]]],
  '#': [[[1.2, 0], [1.9, 10]], [[3.1, 0], [3.8, 10]], [[0.4, 3.2], [4.6, 3.2]], [[0.6, 6.8], [4.8, 6.8]]],
  '%': [[[0, 0], [5, 10]], [[0.4, 8], [1.8, 8], [1.8, 10], [0.4, 10], [0.4, 8]], [[3.2, 0], [4.6, 0], [4.6, 2], [3.2, 2], [3.2, 0]]],
  '(': [[[3.5, 10], [1.5, 7], [1.5, 3], [3.5, 0]]],
  ')': [[[1.5, 10], [3.5, 7], [3.5, 3], [1.5, 0]]],
  '*': [[[2.5, 3], [2.5, 9]], [[0.4, 4.2], [4.6, 7.8]], [[0.4, 7.8], [4.6, 4.2]]],
  '_': [[[0, 0], [5, 0]]],
  // Diameter sign: an O with the slash through it. Reads unambiguously in ply.
  'ø': [[[1, 1], [0, 2.6], [0, 6.4], [1, 8], [3.4, 8], [4.4, 6.4], [4.4, 2.6], [3.4, 1], [1, 1]], [[0, 0.4], [4.6, 8.6]]],
  '×': [[[0.8, 2.4], [4.2, 6.6]], [[0.8, 6.6], [4.2, 2.4]]],
  '°': [[[1.6, 8], [1.2, 8.6], [1.6, 9.2], [2.4, 9.2], [2.8, 8.6], [2.4, 8], [1.6, 8]]],
};

export type TextAnchor = 'start' | 'middle' | 'end';

export interface TextOptions {
  /** Cap height in mm. */
  size: number;
  /** Rotation in radians, about the anchor point. */
  rotate?: number;
  anchor?: TextAnchor;
  /** Vertical placement of `y`: the baseline, or the vertical centre of the caps. */
  baseline?: 'baseline' | 'middle';
}

/** Width in mm the string will occupy at the given cap height. */
export function textWidth(text: string, size: number): number {
  if (text.length === 0) return 0;
  const scale = size / CAP;
  return (text.length * ADVANCE - (ADVANCE - 5)) * scale;
}

/**
 * Render `text` as engrave-layer polylines with its anchor at (x, y).
 * Unsupported characters are silently skipped rather than drawn as tofu.
 */
export function textPaths(text: string, x: number, y: number, opts: TextOptions): Path[] {
  const { size, rotate = 0, anchor = 'start', baseline = 'baseline' } = opts;
  const scale = size / CAP;
  const upper = text.toUpperCase();

  const total = textWidth(upper, size);
  const dx = anchor === 'middle' ? -total / 2 : anchor === 'end' ? -total : 0;
  const dy = baseline === 'middle' ? -size / 2 : 0;

  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  const place = (gx: number, gy: number): Pt => {
    const lx = dx + gx * scale;
    const ly = dy + gy * scale;
    return { x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos };
  };

  const out: Path[] = [];
  let pen = 0;
  for (const ch of upper) {
    const glyph = G[ch] ?? G[ch.normalize('NFD')[0] ?? ' '] ?? [];
    for (const stroke of glyph) {
      out.push({
        pts: stroke.map(([gx, gy]) => place(pen + (gx ?? 0), gy ?? 0)),
        closed: false,
      });
    }
    pen += ADVANCE;
  }
  return out;
}
