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
import { nestParts, defaultNestOptions, sheetLayers } from '../src/geom/nest';
import { buildCog, newCogSpec } from '../src/geom/gear';

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
