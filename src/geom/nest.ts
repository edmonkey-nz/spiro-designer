/**
 * Laying parts out on sheets.
 *
 * Two passes:
 *
 *  1. **Fill the holes.** A ring is an annulus, so its whole interior is scrap.
 *     Smaller parts are packed into it first, which on a big ring is most of a
 *     sheet's worth of area recovered. Nesting is recursive: a small ring
 *     packed inside a large one still gets its own interior filled.
 *
 *  2. **Pack** whatever is left (including the rings, now carrying their
 *     passengers) onto sheets with MaxRects, best-short-side-fit.
 *
 * The packing pass works on bounding boxes, not true outlines, but it does
 * track the free space as a set of overlapping rectangles rather than as
 * shelves. Shelves were the obvious first choice and they are badly wrong
 * here: one 550mm ring claims a shelf as tall as the sheet, and the whole
 * column above every smaller part beside it becomes unreachable, so a 60mm
 * cog spills onto a second sheet with 70% of the first still empty.
 *
 * Hole filling is where the largest saving is, and that part is exact,
 * because a ring's empty interior really is a circle.
 */

import { bboxHeight, bboxWidth, transformPath, type Part, type Path } from './types';

export interface NestOptions {
  bedWidth: number;
  bedHeight: number;
  /** Clear border kept around the whole sheet, mm. */
  margin: number;
  /** Clear space between neighbouring parts, mm. */
  gap: number;
  /** Allow turning a part 90 degrees when that is the only way it fits. */
  allowRotate?: boolean;
  /** Pack smaller parts into the empty interior of rings. Default true. */
  fillHoles?: boolean;
}

export const defaultNestOptions = (): NestOptions => ({
  bedWidth: 900,
  bedHeight: 600,
  margin: 10,
  gap: 5,
  allowRotate: true,
  fillHoles: true,
});

export interface Placement {
  part: Part;
  /** Translation applied to the part's own coordinates, mm. */
  dx: number;
  dy: number;
  /** 0 or PI/2. */
  rotation: number;
  /** Id of the part this one sits inside, when it was packed into a hole. */
  insideOf?: string;
}

export interface Sheet {
  index: number;
  placements: Placement[];
  /** Fraction of the usable sheet area covered by top-level bounding boxes. */
  utilisation: number;
  /** How many of the placements were packed into another part's interior. */
  nested: number;
}

export interface NestResult {
  sheets: Sheet[];
  /** Parts that will not fit a sheet at all, even rotated. */
  rejected: Part[];
}

// ---------------------------------------------------------------------------
// circles

interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * A circle enclosing the part, in the part's own coordinates.
 *
 * Cogs and rings really are circles centred on their origin, and using their
 * exact outer radius is what makes hole filling tight. Anything else falls
 * back to the bounding box's circumscribed circle.
 */
export function boundingCircle(part: Part): Circle {
  const b = part.meta.bbox;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const halfW = bboxWidth(b) / 2;
  const halfH = bboxHeight(b) / 2;
  const o = part.meta.outerR;
  const round =
    o > 0 && Math.abs(cx) < 0.5 && Math.abs(cy) < 0.5 && Math.abs(halfW - o) < 1.5 && Math.abs(halfH - o) < 1.5;
  return round ? { x: 0, y: 0, r: o } : { x: cx, y: cy, r: Math.hypot(halfW, halfH) };
}

/** The (0, 1 or 2) points where two circles cross. */
function circleIntersections(a: Circle, b: Circle): { x: number; y: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const t = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h2 = a.r * a.r - t * t;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const mx = a.x + (t * dx) / d;
  const my = a.y + (t * dy) / d;
  return [
    { x: mx - (dy * h) / d, y: my + (dx * h) / d },
    { x: mx + (dy * h) / d, y: my - (dx * h) / d },
  ];
}

/**
 * Greedily pack circles into a circular hole, largest first.
 *
 * Candidate positions are the hole centre, plus every point where the new
 * circle would sit tangent to two already-placed circles, or tangent to one
 * and against the hole wall. The candidate nearest the centre wins, which
 * keeps the cluster compact and leaves the usable space in one piece.
 *
 * Returns a position per item, or null where the item did not fit.
 */
/** Tangent directions tried around each already-placed circle. */
const RING_SAMPLES = 64;

export function packInHole(
  holeR: number,
  items: { r: number }[],
  gap: number,
): ({ x: number; y: number } | null)[] {
  const placed: Circle[] = [];
  const out: ({ x: number; y: number } | null)[] = [];

  for (const item of items) {
    // Furthest the new centre can sit from the hole centre.
    const maxCentre = holeR - gap - item.r;
    if (maxCentre < -1e-9) {
      out.push(null);
      continue;
    }
    const limit = Math.max(0, maxCentre);
    const wall: Circle = { x: 0, y: 0, r: limit };
    const grown = (c: Circle): Circle => ({ x: c.x, y: c.y, r: c.r + item.r + gap });

    const candidates: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (const p of placed) {
      // Tangent to p and against the hole wall. These vanish when p sits on the
      // hole centre, because the two circles are then concentric...
      candidates.push(...circleIntersections(wall, grown(p)));
      // ...so also ring p with tangent positions all the way round. Without
      // this the very first circle, placed dead centre, blocks everything else.
      const g = grown(p);
      for (let k = 0; k < RING_SAMPLES; k++) {
        const a = (k / RING_SAMPLES) * Math.PI * 2;
        candidates.push({ x: p.x + g.r * Math.cos(a), y: p.y + g.r * Math.sin(a) });
      }
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        candidates.push(...circleIntersections(grown(placed[i]!), grown(placed[j]!)));
      }
    }

    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.x, c.y);
      if (d > limit + 1e-9 || d >= bestDist) continue;
      let clear = true;
      for (const p of placed) {
        if (Math.hypot(c.x - p.x, c.y - p.y) < p.r + item.r + gap - 1e-9) {
          clear = false;
          break;
        }
      }
      if (clear) {
        best = c;
        bestDist = d;
      }
    }

    out.push(best);
    if (best) placed.push({ x: best.x, y: best.y, r: item.r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// nesting

interface Node {
  part: Part;
  circle: Circle;
  holeR: number;
  children: { node: Node; ox: number; oy: number }[];
  parent: Node | null;
}

/**
 * Pack parts into ring interiors, best-fit: the *smallest* hole that will take
 * a part gets first refusal on it.
 *
 * Filling small holes first matters. A small ring's interior is only ever
 * useful for small parts, whereas a big ring's interior is flexible, so
 * spending the big hole on something a small hole could have swallowed wastes
 * the more valuable space. It also means a ring nested inside a bigger ring
 * has already been filled by the time it becomes a passenger, and it carries
 * its own contents along.
 *
 * A part only goes inside a hole strictly bigger than itself, and a container's
 * outer radius always exceeds its hole radius, so a cycle is impossible
 * whatever order these are processed in.
 */
function fillHoles(nodes: Node[], gap: number): void {
  const containers = nodes.filter((n) => n.holeR > 0).sort((a, b) => a.holeR - b.holeR);
  for (const container of containers) {
    const available = nodes
      .filter((n) => n !== container && !n.parent && n.circle.r + gap <= container.holeR)
      .sort((a, b) => b.circle.r - a.circle.r);
    if (available.length === 0) continue;

    const positions = packInHole(container.holeR, available.map((n) => ({ r: n.circle.r })), gap);
    available.forEach((node, i) => {
      const pos = positions[i];
      if (!pos) return;
      // Offset so the child's bounding-circle centre lands on the packed point,
      // which is not the same as its origin for an off-centre part.
      container.children.push({ node, ox: pos.x - node.circle.x, oy: pos.y - node.circle.y });
      node.parent = container;
    });
  }
}

/** Walk a nesting tree, turning it into absolute placements. */
function expand(node: Node, dx: number, dy: number, rot: number, out: Placement[], insideOf?: string): void {
  out.push({ part: node.part, dx, dy, rotation: rot, insideOf });
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const child of node.children) {
    // The child's offset rides along with the parent's rotation.
    expand(
      child.node,
      dx + child.ox * c - child.oy * s,
      dy + child.ox * s + child.oy * c,
      rot,
      out,
      node.part.id,
    );
  }
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * MaxRects bin packing, best-short-side-fit.
 *
 * Free space is kept as a list of maximal rectangles, which may overlap. Each
 * placement splits every free rectangle it touches and then drops any that are
 * wholly inside another. It is slower than shelf packing and it beats it
 * comfortably on exactly the case that matters here: a few large discs with
 * small ones to tuck around them.
 */
class MaxRects {
  private free: Placed[];

  constructor(width: number, height: number) {
    this.free = [{ x: 0, y: 0, w: width, h: height }];
  }

  insert(w: number, h: number, allowRotate: boolean): { x: number; y: number; rotated: boolean } | null {
    let best: (Placed & { rotated: boolean }) | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;

    for (const fr of this.free) {
      const tries: [number, number, boolean][] = allowRotate
        ? [
            [w, h, false],
            [h, w, true],
          ]
        : [[w, h, false]];
      for (const [pw, ph, rotated] of tries) {
        if (pw > fr.w + 1e-9 || ph > fr.h + 1e-9) continue;
        const short = Math.min(fr.w - pw, fr.h - ph);
        const long = Math.max(fr.w - pw, fr.h - ph);
        if (short < bestShort - 1e-9 || (Math.abs(short - bestShort) < 1e-9 && long < bestLong)) {
          best = { x: fr.x, y: fr.y, w: pw, h: ph, rotated };
          bestShort = short;
          bestLong = long;
        }
      }
    }
    if (!best) return null;

    const next: Placed[] = [];
    for (const fr of this.free) {
      if (!splitFree(fr, best, next)) next.push(fr);
    }
    this.free = pruneFree(next);
    return { x: best.x, y: best.y, rotated: best.rotated };
  }
}

/**
 * Split a free rectangle around a placed one, pushing the remainders.
 * Returns false when they do not overlap, leaving the caller to keep it whole.
 */
function splitFree(fr: Placed, used: Placed, out: Placed[]): boolean {
  if (
    used.x >= fr.x + fr.w - 1e-9 ||
    used.x + used.w <= fr.x + 1e-9 ||
    used.y >= fr.y + fr.h - 1e-9 ||
    used.y + used.h <= fr.y + 1e-9
  ) {
    return false;
  }

  if (used.x < fr.x + fr.w && used.x + used.w > fr.x) {
    if (used.y > fr.y && used.y < fr.y + fr.h) {
      out.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
    }
    if (used.y + used.h < fr.y + fr.h) {
      out.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: fr.y + fr.h - (used.y + used.h) });
    }
  }
  if (used.y < fr.y + fr.h && used.y + used.h > fr.y) {
    if (used.x > fr.x && used.x < fr.x + fr.w) {
      out.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
    }
    if (used.x + used.w < fr.x + fr.w) {
      out.push({ x: used.x + used.w, y: fr.y, w: fr.x + fr.w - (used.x + used.w), h: fr.h });
    }
  }
  return true;
}

const inside = (a: Placed, b: Placed): boolean =>
  a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;

/** Drop free rectangles that are wholly inside another, which splitting creates freely. */
function pruneFree(list: Placed[]): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (a.w <= 1e-9 || a.h <= 1e-9) continue;
    let redundant = false;
    for (let j = 0; j < list.length && !redundant; j++) {
      if (i === j) continue;
      const b = list[j]!;
      // Identical rectangles would swallow each other, so keep the earlier one.
      if (inside(a, b) && (!inside(b, a) || j < i)) redundant = true;
    }
    if (!redundant) out.push(a);
  }
  return out;
}

interface Item {
  node: Node;
  w: number;
  h: number;
}

export function nestParts(parts: Part[], opts: NestOptions = defaultNestOptions()): NestResult {
  const availW = opts.bedWidth - opts.margin * 2;
  const availH = opts.bedHeight - opts.margin * 2;
  const gap = opts.gap;
  const allowRotate = opts.allowRotate !== false;

  const nodes: Node[] = parts.map((part) => ({
    part,
    circle: boundingCircle(part),
    holeR: part.meta.innerHoleR,
    children: [],
    parent: null,
  }));

  if (opts.fillHoles !== false) fillHoles(nodes, gap);

  const fits = (w: number, h: number) =>
    (w <= availW + 1e-9 && h <= availH + 1e-9) || (allowRotate && h <= availW + 1e-9 && w <= availH + 1e-9);

  const items: Item[] = [];
  const rejected: Part[] = [];
  const consider = (node: Node) => {
    const w = bboxWidth(node.part.meta.bbox);
    const h = bboxHeight(node.part.meta.bbox);
    if (fits(w, h)) {
      items.push({ node, w, h });
      return true;
    }
    return false;
  };

  for (const node of nodes) {
    if (node.parent) continue;
    if (consider(node)) continue;
    // A container that will not fit takes its passengers with it, so release
    // them back to the top level rather than losing them silently.
    for (const child of node.children) child.node.parent = null;
    node.children = [];
    rejected.push(node.part);
  }
  for (const node of nodes) {
    if (node.parent || rejected.includes(node.part) || items.some((i) => i.node === node)) continue;
    if (!consider(node)) rejected.push(node.part);
  }

  // Largest first. Placing the big discs before the small ones is what leaves
  // the small ones somewhere sensible to go.
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);

  // Every part is inflated by one gap, and the bin by one gap, so neighbours
  // end up exactly `gap` apart while a part on the far edge still fits the
  // usable area.
  const bins: MaxRects[] = [];
  const sheets: Sheet[] = [];
  const used: number[] = [];

  for (const item of items) {
    let target = -1;
    let at: { x: number; y: number; rotated: boolean } | null = null;
    for (let b = 0; b < bins.length; b++) {
      at = bins[b]!.insert(item.w + gap, item.h + gap, allowRotate);
      if (at) {
        target = b;
        break;
      }
    }
    if (!at) {
      bins.push(new MaxRects(availW + gap, availH + gap));
      sheets.push({ index: sheets.length, placements: [], utilisation: 0, nested: 0 });
      used.push(0);
      target = bins.length - 1;
      at = bins[target]!.insert(item.w + gap, item.h + gap, allowRotate);
      if (!at) {
        rejected.push(item.node.part);
        continue;
      }
    }

    const rotation = at.rotated ? Math.PI / 2 : 0;
    const bb = item.node.part.meta.bbox;
    const localMinX = rotation === 0 ? bb.minX : -bb.maxY;
    const localMinY = rotation === 0 ? bb.minY : bb.minX;

    expand(
      item.node,
      opts.margin + at.x - localMinX,
      opts.margin + at.y - localMinY,
      rotation,
      sheets[target]!.placements,
    );
    used[target] = used[target]! + item.w * item.h;
  }

  for (const sheet of sheets) {
    sheet.utilisation = used[sheet.index]! / (availW * availH);
    sheet.nested = sheet.placements.filter((p) => p.insideOf).length;
  }

  return { sheets, rejected };
}

/** Flatten a sheet's placements into ready-to-write cut and engrave paths. */
export function sheetLayers(sheet: Sheet): { cut: Path[]; engrave: Path[] } {
  const cut: Path[] = [];
  const engrave: Path[] = [];
  for (const p of sheet.placements) {
    for (const path of p.part.cut) cut.push(transformPath(path, p.dx, p.dy, p.rotation));
    for (const path of p.part.engrave) engrave.push(transformPath(path, p.dx, p.dy, p.rotation));
  }
  return { cut, engrave };
}

/** Sheet outline, drawn on the engrave layer as a visual check, never cut. */
export function bedOutline(opts: NestOptions): Path {
  return {
    closed: true,
    pts: [
      { x: 0, y: 0 },
      { x: opts.bedWidth, y: 0 },
      { x: opts.bedWidth, y: opts.bedHeight },
      { x: 0, y: opts.bedHeight },
    ],
  };
}
