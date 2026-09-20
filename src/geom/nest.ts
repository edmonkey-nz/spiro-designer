/**
 * Laying parts out on sheets.
 *
 * This is bounding-box shelf packing (first-fit decreasing by height), not true
 * outline nesting. For mostly-round parts on a 900x600 bed the difference is
 * small, and the predictability is worth more than the last few percent of
 * sheet: you can look at the preview and know what you are going to get.
 *
 * If utilisation ever becomes the bottleneck, replace `nestParts` with a
 * no-fit-polygon implementation behind this same signature.
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
}

export const defaultNestOptions = (): NestOptions => ({
  bedWidth: 900,
  bedHeight: 600,
  margin: 10,
  gap: 5,
  allowRotate: true,
});

export interface Placement {
  part: Part;
  /** Translation applied to the part's own coordinates, mm. */
  dx: number;
  dy: number;
  /** 0 or PI/2. */
  rotation: number;
}

export interface Sheet {
  index: number;
  placements: Placement[];
  /** Fraction of the usable sheet area covered by part bounding boxes. */
  utilisation: number;
}

export interface NestResult {
  sheets: Sheet[];
  /** Parts that will not fit a sheet at all, even rotated. */
  rejected: Part[];
}

interface Box {
  part: Part;
  w: number;
  h: number;
  rotation: number;
}

function boxFor(part: Part, rotate: boolean): Box {
  const w = bboxWidth(part.meta.bbox);
  const h = bboxHeight(part.meta.bbox);
  return rotate
    ? { part, w: h, h: w, rotation: Math.PI / 2 }
    : { part, w, h, rotation: 0 };
}

export function nestParts(parts: Part[], opts: NestOptions = defaultNestOptions()): NestResult {
  const availW = opts.bedWidth - opts.margin * 2;
  const availH = opts.bedHeight - opts.margin * 2;

  const boxes: Box[] = [];
  const rejected: Part[] = [];
  for (const part of parts) {
    const flat = boxFor(part, false);
    if (flat.w <= availW && flat.h <= availH) {
      boxes.push(flat);
      continue;
    }
    const turned = boxFor(part, true);
    if (opts.allowRotate !== false && turned.w <= availW && turned.h <= availH) {
      boxes.push(turned);
      continue;
    }
    rejected.push(part);
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

    // New shelf when the row is full.
    if (c.cursorX > 0 && c.cursorX + box.w > availW) {
      c.shelfY += c.shelfH + opts.gap;
      c.shelfH = 0;
      c.cursorX = 0;
    }
    // New sheet when the column is full.
    if (c.shelfY + box.h > availH) {
      flush();
      startSheet();
      c = current!;
    }

    // The part's own bbox may not start at its origin, so shift by its minimum.
    const bb = box.part.meta.bbox;
    const localMinX = box.rotation === 0 ? bb.minX : -bb.maxY;
    const localMinY = box.rotation === 0 ? bb.minY : bb.minX;

    c.placements.push({
      part: box.part,
      dx: opts.margin + c.cursorX - localMinX,
      dy: opts.margin + c.shelfY - localMinY,
      rotation: box.rotation,
    });
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
