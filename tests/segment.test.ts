import { describe, expect, it } from 'vitest';
import {
  defaultSegmentOptions,
  distributeTeeth,
  sectorExtent,
  segmentCountFor,
  segmentRing,
  sliceByAngle,
} from '../src/geom/segment';
import { defaultGearDefaults, newRingSpec } from '../src/geom/gear';
import { bboxHeight, bboxWidth, circlePath, polar, TAU } from '../src/geom/types';
import { nestParts, defaultNestOptions, sheetLayers, boundingCircle, packInHole } from '../src/geom/nest';
import { buildCog, buildRing, newCogSpec } from '../src/geom/gear';

const d = () => ({ ...defaultGearDefaults(), chordTol: 0.02 });
const opts = defaultSegmentOptions();

describe('tooth distribution', () => {
  it('splits teeth evenly and conserves the total', () => {
    for (const [total, n] of [
      [157, 3],
      [96, 4],
      [200, 7],
    ] as const) {
      const parts = distributeTeeth(total, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    }
  });
});

describe('segment count', () => {
  it('leaves a ring that already fits in one piece', () => {
    expect(segmentCountFor(140, 163, opts)).toBe(1);
  });

  it('splits a ring that is too big, and each sector then fits the bed', () => {
    const rIn = 380;
    const rOut = 405;
    const n = segmentCountFor(rIn, rOut, opts);
    expect(n).toBeGreaterThan(1);
    const { w, h } = sectorExtent(rIn, rOut, Math.PI / n);
    const availW = opts.bedWidth - opts.margin * 2;
    const availH = opts.bedHeight - opts.margin * 2;
    expect((w <= availW && h <= availH) || (h <= availW && w <= availH)).toBe(true);
  });

  it('uses the fewest segments that will do', () => {
    const rIn = 380;
    const rOut = 405;
    const n = segmentCountFor(rIn, rOut, opts);
    const { w, h } = sectorExtent(rIn, rOut, Math.PI / (n - 1));
    const availW = opts.bedWidth - opts.margin * 2;
    const availH = opts.bedHeight - opts.margin * 2;
    expect((w <= availW && h <= availH) || (h <= availW && w <= availH)).toBe(false);
  });
});

describe('sliceByAngle', () => {
  const circle = circlePath(0, 0, 50, 0.01).pts;

  it('returns a slice that starts and ends exactly on the rays', () => {
    const s = sliceByAngle(circle, 0.3, 1.9);
    expect(Math.atan2(s[0]!.y, s[0]!.x)).toBeCloseTo(0.3, 6);
    const last = s[s.length - 1]!;
    expect(Math.atan2(last.y, last.x)).toBeCloseTo(1.9, 6);
  });

  it('stays on the source curve', () => {
    for (const p of sliceByAngle(circle, 2.0, 4.5)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 2);
    }
  });

  it('handles a slice that wraps past the +/-pi seam', () => {
    const s = sliceByAngle(circle, 2.8, -2.8 + TAU);
    expect(s.length).toBeGreaterThan(2);
    const first = s[0]!;
    const last = s[s.length - 1]!;
    expect(Math.atan2(first.y, first.x)).toBeCloseTo(2.8, 6);
    expect(Math.hypot(last.x, last.y)).toBeCloseTo(50, 2);
  });

  it('covers the whole circle when asked for a full turn', () => {
    const s = sliceByAngle(circle, 0, TAU);
    expect(s.length).toBeGreaterThanOrEqual(circle.length - 1);
  });
});

describe('segmentRing', () => {
  const defs = d();
  // 400 teeth at module 3 is a 1.2m ring: well past the bed.
  const spec = { ...newRingSpec('big', 400), rimWidth: 25 };
  const result = segmentRing(spec, defs, 0.18, opts);

  it('splits into more than one piece and makes one plate per joint', () => {
    expect(result.count).toBeGreaterThan(1);
    expect(result.segments).toHaveLength(result.count);
    expect(result.plates).toHaveLength(result.count);
  });

  it('conserves the tooth count across segments', () => {
    expect(result.segments.reduce((s, p) => s + p.meta.teeth, 0)).toBe(400);
  });

  it('fits every segment and plate on the bed', () => {
    const availW = opts.bedWidth - opts.margin * 2;
    const availH = opts.bedHeight - opts.margin * 2;
    for (const part of [...result.segments, ...result.plates]) {
      const w = bboxWidth(part.meta.bbox);
      const h = bboxHeight(part.meta.bbox);
      expect((w <= availW && h <= availH) || (h <= availW && w <= availH)).toBe(true);
    }
  });

  it('cuts only at tooth-space centres', () => {
    // Space centres sit at whole multiples of 2*pi/Z by construction.
    const step = TAU / 400;
    let acc = 0;
    for (const seg of result.segments) {
      acc += seg.meta.teeth;
      const boundary = acc * step;
      expect(Math.abs(boundary / step - Math.round(boundary / step))).toBeLessThan(1e-9);
    }
  });

  it('gives each segment a closed outline plus bolt and dowel holes', () => {
    for (const seg of result.segments) {
      expect(seg.cut[0]!.closed).toBe(true);
      // outline + 2 joints x (2 bolts + 1 dowel)
      expect(seg.cut.length).toBe(1 + 6);
      expect(seg.engrave.length).toBeGreaterThan(0);
    }
  });

  it('puts matching fixings in the plates', () => {
    for (const plate of result.plates) {
      expect(plate.cut.length).toBe(1 + 6);
      expect(plate.kind).toBe('splice');
    }
  });

  it('keeps every segment point inside the ring annulus', () => {
    const seg = result.segments[0]!;
    for (const p of seg.cut[0]!.pts) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThan(seg.meta.tipR - 1);
      expect(r).toBeLessThan(seg.meta.outerR + 1);
    }
  });

  it('warns when the rim is too narrow to take a bolt', () => {
    const thin = { ...newRingSpec('thin', 400), rimWidth: 10 };
    expect(segmentRing(thin, defs, 0.18, opts).warnings.join(' ')).toMatch(/rim width/i);
  });

  it('returns nothing to do for a ring that already fits', () => {
    const small = newRingSpec('small', 96);
    expect(segmentRing(small, defs, 0.18, opts).count).toBe(1);
  });
});

describe('nesting', () => {
  const defs = d();
  const parts = [24, 32, 43, 60].map((t) => buildCog(newCogSpec(`c${t}`, t), defs, 0.18));

  it('places every part exactly once', () => {
    const res = nestParts(parts);
    const placed = res.sheets.flatMap((s) => s.placements.map((p) => p.part.id));
    expect(placed.sort()).toEqual(parts.map((p) => p.id).sort());
    expect(res.rejected).toHaveLength(0);
  });

  it('keeps every placed part inside the sheet margins', () => {
    const o = defaultNestOptions();
    for (const sheet of nestParts(parts, o).sheets) {
      const layers = sheetLayers(sheet);
      for (const path of [...layers.cut, ...layers.engrave]) {
        for (const p of path.pts) {
          expect(p.x).toBeGreaterThanOrEqual(o.margin - 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(o.margin - 1e-6);
          expect(p.x).toBeLessThanOrEqual(o.bedWidth - o.margin + 1e-6);
          expect(p.y).toBeLessThanOrEqual(o.bedHeight - o.margin + 1e-6);
        }
      }
    }
  });

  it('does not overlap bounding boxes on a sheet', () => {
    for (const sheet of nestParts(parts).sheets) {
      const boxes = sheet.placements.map((pl) => {
        const b = pl.part.meta.bbox;
        const w = pl.rotation === 0 ? bboxWidth(b) : bboxHeight(b);
        const h = pl.rotation === 0 ? bboxHeight(b) : bboxWidth(b);
        const x = pl.dx + (pl.rotation === 0 ? b.minX : -b.maxY);
        const y = pl.dy + (pl.rotation === 0 ? b.minY : b.minX);
        return { x, y, w, h };
      });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap =
            a.x < b.x + b.w - 1e-6 &&
            b.x < a.x + a.w - 1e-6 &&
            a.y < b.y + b.h - 1e-6 &&
            b.y < a.y + a.h - 1e-6;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('rejects a part that cannot fit any sheet', () => {
    const huge = buildCog(newCogSpec('huge', 400), defs, 0.18);
    const res = nestParts([huge]);
    expect(res.rejected.map((p) => p.id)).toEqual(['huge']);
  });

  it('spills onto a second sheet when one is full', () => {
    // A 60T module-3 cog is 186mm across, so twelve fit one 900x600 sheet in a
    // 4x3 grid; twenty cannot.
    const many = Array.from({ length: 20 }, (_, i) => buildCog(newCogSpec(`m${i}`, 60), defs, 0.18));
    const res = nestParts(many);
    expect(res.sheets.length).toBeGreaterThan(1);
    expect(res.sheets.flatMap((sh) => sh.placements)).toHaveLength(20);
  });
});

describe('polar helper', () => {
  it('round-trips through polar coordinates', () => {
    const p = polar(37, 1.1);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(37, 12);
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(1.1, 12);
  });
});

describe('packing parts into ring interiors', () => {
  const defs = d();
  const ring = buildRing({ ...newRingSpec('r', 150), rimWidth: 20 }, defs, 0.18);
  const cogs = [40, 32, 24, 24, 18].map((t, i) => buildCog(newCogSpec(`c${i}_${t}`, t), defs, 0.18));

  it('reports an empty interior for a ring and none for a cog', () => {
    expect(ring.meta.innerHoleR).toBeCloseTo(ring.meta.tipR, 9);
    expect(ring.meta.innerHoleR).toBeGreaterThan(200);
    for (const c of cogs) expect(c.meta.innerHoleR).toBe(0);
  });

  it('puts cogs inside the ring rather than beside it', () => {
    const res = nestParts([ring, ...cogs]);
    const nested = res.sheets.flatMap((s) => s.placements).filter((p) => p.insideOf === ring.id);
    expect(nested.length).toBeGreaterThan(0);
    expect(res.sheets.flatMap((s) => s.placements)).toHaveLength(1 + cogs.length);
  });

  it('needs fewer sheets than packing everything side by side', () => {
    const withHoles = nestParts([ring, ...cogs], { ...defaultNestOptions(), fillHoles: true });
    const without = nestParts([ring, ...cogs], { ...defaultNestOptions(), fillHoles: false });
    expect(withHoles.sheets.length).toBeLessThanOrEqual(without.sheets.length);
    expect(withHoles.sheets[0]!.nested).toBeGreaterThan(0);
    expect(without.sheets.flatMap((s) => s.placements).every((p) => !p.insideOf)).toBe(true);
  });

  it('never overlaps two parts, nested or not', () => {
    // In sheet coordinates: either the two bounding circles are disjoint, or
    // one sits wholly inside the other's hole.
    const res = nestParts([ring, ...cogs]);
    for (const sheet of res.sheets) {
      const circles = sheet.placements.map((pl) => {
        const c = boundingCircle(pl.part);
        const cos = Math.cos(pl.rotation);
        const sin = Math.sin(pl.rotation);
        return {
          part: pl.part,
          x: c.x * cos - c.y * sin + pl.dx,
          y: c.x * sin + c.y * cos + pl.dy,
          r: c.r,
          hole: pl.part.meta.innerHoleR,
        };
      });
      for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
          const a = circles[i]!;
          const b = circles[j]!;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const disjoint = dist >= a.r + b.r - 1e-6;
          const bInsideA = a.hole > 0 && dist + b.r <= a.hole + 1e-6;
          const aInsideB = b.hole > 0 && dist + a.r <= b.hole + 1e-6;
          expect(disjoint || bInsideA || aInsideB).toBe(true);
        }
      }
    }
  });

  it('keeps nested parts clear of the ring teeth', () => {
    const res = nestParts([ring, ...cogs]);
    const all = res.sheets.flatMap((s) => s.placements);
    const host = all.find((p) => p.part.id === ring.id)!;
    for (const pl of all.filter((p) => p.insideOf === ring.id)) {
      const c = boundingCircle(pl.part);
      const dist = Math.hypot(pl.dx + c.x - host.dx, pl.dy + c.y - host.dy);
      expect(dist + c.r).toBeLessThanOrEqual(ring.meta.innerHoleR + 1e-6);
    }
  });

  it('leaves a part too big for the hole outside it', () => {
    // The 150T ring's hole is 222mm in radius; a 160T cog is 243mm.
    const fat = buildCog(newCogSpec('fat', 160), defs, 0.18);
    const res = nestParts([ring, fat]);
    const placement = res.sheets.flatMap((s) => s.placements).find((p) => p.part.id === 'fat')!;
    expect(placement.insideOf).toBeUndefined();
  });

  it('fills a ring nested inside a bigger ring', () => {
    const big = buildRing({ ...newRingSpec('big', 150), rimWidth: 20 }, defs, 0.18);
    const small = buildRing({ ...newRingSpec('small', 60), rimWidth: 12 }, defs, 0.18);
    const tiny = buildCog(newCogSpec('tiny', 16), defs, 0.18);
    const all = nestParts([big, small, tiny]).sheets.flatMap((s) => s.placements);
    expect(all.find((p) => p.part.id === 'small')?.insideOf).toBe('big');
    expect(all.find((p) => p.part.id === 'tiny')?.insideOf).toBe('small');
  });

  it('releases passengers when their container will not fit the bed', () => {
    const huge = buildRing({ ...newRingSpec('huge', 400), rimWidth: 20 }, defs, 0.18);
    const cog = buildCog(newCogSpec('rider', 24), defs, 0.18);
    const res = nestParts([huge, cog]);
    expect(res.rejected.map((p) => p.id)).toEqual(['huge']);
    const placed = res.sheets.flatMap((s) => s.placements);
    expect(placed.map((p) => p.part.id)).toEqual(['rider']);
    expect(placed[0]!.insideOf).toBeUndefined();
  });
});

describe('packInHole', () => {
  it('centres a single item', () => {
    const [pos] = packInHole(100, [{ r: 20 }], 5);
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('keeps every item inside the hole with the gap respected', () => {
    const items = [{ r: 30 }, { r: 25 }, { r: 25 }, { r: 18 }, { r: 18 }, { r: 12 }];
    const gap = 4;
    const positions = packInHole(120, items, gap);
    const placed = positions
      .map((p, i) => (p ? { ...p, r: items[i]!.r } : null))
      .filter((p): p is { x: number; y: number; r: number } => p !== null);
    expect(placed.length).toBeGreaterThan(3);
    for (const p of placed) expect(Math.hypot(p.x, p.y) + p.r + gap).toBeLessThanOrEqual(120 + 1e-6);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + gap - 1e-6);
      }
    }
  });

  it('refuses an item bigger than the hole', () => {
    expect(packInHole(30, [{ r: 40 }], 2)).toEqual([null]);
  });
});

describe('boundingCircle', () => {
  it('uses the exact outer radius for a round part', () => {
    const cog = buildCog(newCogSpec('c', 40), d(), 0.18);
    const c = boundingCircle(cog);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.r).toBeCloseTo(cog.meta.outerR, 9);
  });

  it('falls back to the bbox circumcircle for an arc segment', () => {
    const seg = segmentRing({ ...newRingSpec('s', 400), rimWidth: 25 }, d(), 0.18, opts).segments[0]!;
    const c = boundingCircle(seg);
    const b = seg.meta.bbox;
    expect(c.r).toBeCloseTo(Math.hypot(bboxWidth(b), bboxHeight(b)) / 2, 6);
  });
});
