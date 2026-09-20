/**
 * Shared geometry types.
 *
 * Conventions that hold everywhere in `src/geom`:
 *   - units are millimetres,
 *   - the coordinate system is Y-up (maths convention), origin at the part centre,
 *   - angles are radians unless a name says `Deg`,
 *   - paths are polylines; curves are flattened to a chord tolerance at build time.
 *
 * `svg.ts` is the only module that flips to SVG's Y-down page space.
 */

export type Pt = { x: number; y: number };

/** A polyline. `closed` means the last point joins back to the first. */
export type Path = {
  pts: Pt[];
  closed: boolean;
};

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/** Which laser operation a path belongs to. */
export type Layer = 'cut' | 'engrave';

/** A pen hole in a cog. `r` is exactly the offset the simulator uses as `d`. */
export type PenHole = {
  id: string;
  /** 1-based, engraved on the part. */
  index: number;
  /** Distance from the cog centre, mm. */
  r: number;
  /** Angular position, radians. */
  theta: number;
  /** Nominal finished hole diameter, mm. */
  dia: number;
};

export type PartKind = 'cog' | 'ring' | 'rack' | 'splice';

/** Everything the exporter and the simulator need about one physical piece. */
export type Part = {
  id: string;
  name: string;
  kind: PartKind;
  cut: Path[];
  engrave: Path[];
  meta: PartMeta;
};

export type PartMeta = {
  /** Tooth count. Racks report the number of teeth on that segment. */
  teeth: number;
  module: number;
  /** Nominal (kerf-free) radii. Racks report 0. */
  pitchR: number;
  baseR: number;
  tipR: number;
  rootR: number;
  /** Outermost radius of the material, including a ring's rim. */
  outerR: number;
  /**
   * Radius of a concentric empty circle at the part's centre, or 0 if there is
   * none. Rings report their tooth-tip radius: the interior of a ring is just
   * scrap, so the nester packs smaller parts into it.
   */
  innerHoleR: number;
  bbox: BBox;
  penHoles: PenHole[];
  /** Total cut-path length, mm — a decent proxy for machine time. */
  cutLength: number;
  warnings: string[];
};

export const TAU = Math.PI * 2;

export const deg = (d: number): number => (d * Math.PI) / 180;

export const pt = (x: number, y: number): Pt => ({ x, y });

export const polar = (r: number, a: number): Pt => ({ x: r * Math.cos(a), y: r * Math.sin(a) });

export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

export const rotatePt = (p: Pt, a: number): Pt => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export const translatePt = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });

/** Involute function: inv(a) = tan(a) - a. */
export const involuteFn = (a: number): number => Math.tan(a) - a;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function pathLength(path: Path): number {
  const { pts, closed } = path;
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1]!, pts[i]!);
  if (closed) total += dist(pts[pts.length - 1]!, pts[0]!);
  return total;
}

export function bboxOf(paths: Path[]): BBox {
  const b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const path of paths) {
    for (const p of path.pts) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return b;
}

/** An empty path list yields an inverted box; union works on it, callers normalise at the end. */
export const isEmptyBBox = (b: BBox): boolean => !Number.isFinite(b.minX);

export const normalizeBBox = (b: BBox): BBox =>
  isEmptyBBox(b) ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : b;

export const bboxWidth = (b: BBox): number => b.maxX - b.minX;
export const bboxHeight = (b: BBox): number => b.maxY - b.minY;

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function transformPath(path: Path, dx: number, dy: number, rot = 0): Path {
  return {
    closed: path.closed,
    pts: path.pts.map((p) => {
      const q = rot === 0 ? p : rotatePt(p, rot);
      return { x: q.x + dx, y: q.y + dy };
    }),
  };
}

/**
 * A circle as a closed polyline, flattened to `chordTol`.
 * Used for bores, bolt holes and pitch-circle guides.
 */
export function circlePath(cx: number, cy: number, r: number, chordTol: number): Path {
  const n = segmentsForArc(r, TAU, chordTol);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return { pts, closed: true };
}

/**
 * Open arc polyline from `a0` to `a1` (signed sweep), flattened to `chordTol`.
 * Both endpoints are included.
 */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, chordTol: number): Pt[] {
  const sweep = a1 - a0;
  const n = Math.max(1, segmentsForArc(r, Math.abs(sweep), chordTol));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Number of chords needed to approximate an arc within `chordTol`.
 * Sagitta of a chord subtending `t` on radius `r` is r(1-cos(t/2)).
 */
export function segmentsForArc(r: number, sweep: number, chordTol: number): number {
  if (r <= 0 || sweep <= 0) return 1;
  const maxStep = 2 * Math.acos(clamp(1 - chordTol / r, -1, 1));
  if (!Number.isFinite(maxStep) || maxStep <= 1e-9) return 1;
  return Math.max(1, Math.ceil(sweep / maxStep));
}

/** Drop consecutive duplicate points, which otherwise produce zero-length laser moves. */
export function dedupe(pts: Pt[], eps = 1e-9): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) out.push(p);
  }
  return out;
}
