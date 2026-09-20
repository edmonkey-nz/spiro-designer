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
 *  2. **Shelf pack** whatever is left (including the rings, now carrying their
 *     passengers) onto sheets, first-fit decreasing by height.
 *
 * The shelf pass works on bounding boxes, not true outlines. For mostly-round
 * parts on a 900x600 bed the difference is small, and the predictability is
 * worth more than the last few percent: you can look at the preview and know
 * what you are going to get. Hole filling is where the real saving is, and
 * that part is exact, because a ring's empty interior is an exact circle.
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

interface Box {
  node: Node;
  w: number;
  h: number;
  rotation: number;
}

function boxFor(node: Node, rotate: boolean): Box {
  const w = bboxWidth(node.part.meta.bbox);
  const h = bboxHeight(node.part.meta.bbox);
  return rotate ? { node, w: h, h: w, rotation: Math.PI / 2 } : { node, w, h, rotation: 0 };
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

export function nestParts(parts: Part[], opts: NestOptions = defaultNestOptions()): NestResult {
  const availW = opts.bedWidth - opts.margin * 2;
  const availH = opts.bedHeight - opts.margin * 2;

  const nodes: Node[] = parts.map((part) => ({
    part,
    circle: boundingCircle(part),
    holeR: part.meta.innerHoleR,
    children: [],
    parent: null,
  }));

  if (opts.fillHoles !== false) fillHoles(nodes, opts.gap);

  const boxes: Box[] = [];
  const rejected: Part[] = [];
  for (const node of nodes) {
    if (node.parent) continue; // rides inside another part
    const flat = boxFor(node, false);
    if (flat.w <= availW && flat.h <= availH) {
      boxes.push(flat);
      continue;
    }
    const turned = boxFor(node, true);
    if (opts.allowRotate !== false && turned.w <= availW && turned.h <= availH) {
      boxes.push(turned);
      continue;
    }
    // A container that will not fit takes its passengers with it, so release
    // them back to the top level rather than losing them silently.
    for (const child of node.children) child.node.parent = null;
    node.children = [];
    rejected.push(node.part);
  }

  // Re-admit anything freed by a rejected container.
  for (const node of nodes) {
    if (node.parent || rejected.includes(node.part) || boxes.some((b) => b.node === node)) continue;
    const flat = boxFor(node, false);
    if (flat.w <= availW && flat.h <= availH) boxes.push(flat);
    else {
      const turned = boxFor(node, true);
      if (opts.allowRotate !== false && turned.w <= availW && turned.h <= availH) boxes.push(turned);
      else rejected.push(node.part);
    }
  }

  // Tallest first: shelf packing wastes least when each shelf is started by its
  // own tallest member.
  boxes.sort((a, b) => b.h - a.h || b.w - a.w);

  const sheets: Sheet[] = [];
  let current: { placements: Placement[]; shelfY: number; shelfH: number; cursorX: number } | null = null;
  let usedArea = 0;

  const flush = () => {
    if (!current) return;
    sheets.push({
      index: sheets.length,
      placements: current.placements,
      utilisation: usedArea / (availW * availH),
      nested: current.placements.filter((p) => p.insideOf).length,
    });
    current = null;
    usedArea = 0;
  };

  const startSheet = () => {
    current = { placements: [], shelfY: 0, shelfH: 0, cursorX: 0 };
  };

  for (const box of boxes) {
    if (!current) startSheet();
    let c = current!;

    if (c.cursorX > 0 && c.cursorX + box.w > availW) {
      c.shelfY += c.shelfH + opts.gap;
      c.shelfH = 0;
      c.cursorX = 0;
    }
    if (c.shelfY + box.h > availH) {
      flush();
      startSheet();
      c = current!;
    }

    // The part's own bbox may not start at its origin, so shift by its minimum.
    const bb = box.node.part.meta.bbox;
    const localMinX = box.rotation === 0 ? bb.minX : -bb.maxY;
    const localMinY = box.rotation === 0 ? bb.minY : bb.minX;

    expand(
      box.node,
      opts.margin + c.cursorX - localMinX,
      opts.margin + c.shelfY - localMinY,
      box.rotation,
      c.placements,
    );
    usedArea += box.w * box.h;

    c.cursorX += box.w + opts.gap;
    c.shelfH = Math.max(c.shelfH, box.h);
  }
  flush();

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
