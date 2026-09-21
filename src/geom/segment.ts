/**
 * Splitting oversized rings (and racks) into bed-sized pieces.
 *
 * Two rules drive the geometry:
 *
 *  1. **Cut at a tooth-space centre.** Splitting through a tooth would leave
 *     two half-teeth that are both fragile and useless for meshing. The
 *     internal profile puts a space centre at every multiple of 2*pi/Z, so
 *     segment boundaries snap to whole tooth counts.
 *
 *  2. **Carry the joint on a separate plate.** A butt joint in 6mm ply has no
 *     strength in bending, so each joint gets a splice plate that bolts across
 *     it underneath, plus dowel holes so the two halves line up before the
 *     bolts go in.
 */

import { buildGearProfile, type GearParams } from './involute';
import { holePath } from './features';
import { flatLabel, labelPaths } from './features';
import {
  TAU,
  arcPoints,
  bboxOf,
  circlePath,
  dedupe,
  normalizeBBox,
  pathLength,
  polar,
  type Part,
  type Path,
  type Pt,
} from './types';
import { moduleOf, outerTeethFor, type GearDefaults, type RingSpec } from './gear';
import { buildShapedRing } from './shapedRing';
import { isCircle } from './shape';

export interface SegmentOptions {
  bedWidth: number;
  bedHeight: number;
  margin: number;
  /** Bolt hole diameter for the splice plates, mm (M5 clearance by default). */
  boltDia: number;
  /** Alignment dowel diameter, mm. */
  dowelDia: number;
  /** Arc distances from the joint line to each fixing, mm. */
  boltOffsets: [number, number];
  dowelOffset: number;
}

export const defaultSegmentOptions = (): SegmentOptions => ({
  bedWidth: 900,
  bedHeight: 600,
  margin: 10,
  boltDia: 5.2,
  dowelDia: 3.1,
  boltOffsets: [14, 34],
  dowelOffset: 24,
});

export interface SegmentResult {
  /** How many arc pieces the ring was split into. 1 means it already fitted. */
  count: number;
  segments: Part[];
  plates: Part[];
  warnings: string[];
}

const modTau = (a: number): number => ((a % TAU) + TAU) % TAU;

/**
 * Bounding box of an annular sector of half-angle `half` (<= pi/2 per side),
 * measured with the sector centred on the +X axis.
 */
export function sectorExtent(rIn: number, rOut: number, half: number): { w: number; h: number } {
  if (half >= Math.PI / 2) {
    // The sector reaches past +/-90 degrees, so it spans the full height.
    const minX = half >= Math.PI ? -rOut : Math.min(rOut * Math.cos(half), rIn * Math.cos(half));
    return { w: rOut - minX, h: 2 * rOut };
  }
  return { w: rOut - rIn * Math.cos(half), h: 2 * rOut * Math.sin(half) };
}

/** Fewest equal segments of a ring that each fit the bed, or 1 if the whole ring fits. */
export function segmentCountFor(rIn: number, rOut: number, opts: SegmentOptions): number {
  const availW = opts.bedWidth - opts.margin * 2;
  const availH = opts.bedHeight - opts.margin * 2;
  const fits = (w: number, h: number) => (w <= availW && h <= availH) || (h <= availW && w <= availH);

  if (fits(2 * rOut, 2 * rOut)) return 1;
  for (let n = 2; n <= 64; n++) {
    const { w, h } = sectorExtent(rIn, rOut, Math.PI / n);
    if (fits(w, h)) return n;
  }
  return 64;
}

/** Split `total` teeth across `n` segments as evenly as possible. */
export function distributeTeeth(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Take the portion of a star-shaped closed profile between two angles, walking
 * counter-clockwise, with both endpoints interpolated onto the exact rays.
 */
export function sliceByAngle(pts: Pt[], a0: number, a1: number): Pt[] {
  const span = modTau(a1 - a0) || TAU;
  const shifted = pts.map((p) => ({ p, a: modTau(Math.atan2(p.y, p.x) - a0) }));

  // Rotate so the list starts just after the a0 ray.
  let start = 0;
  for (let i = 1; i < shifted.length; i++) if (shifted[i]!.a < shifted[start]!.a) start = i;
  const ordered = [...shifted.slice(start), ...shifted.slice(0, start)];

  const radiusAt = (lo: { p: Pt; a: number }, hi: { p: Pt; a: number }, a: number) => {
    const d = hi.a - lo.a;
    const t = Math.abs(d) < 1e-12 ? 0 : (a - lo.a) / d;
    const rl = Math.hypot(lo.p.x, lo.p.y);
    const rh = Math.hypot(hi.p.x, hi.p.y);
    return rl + (rh - rl) * t;
  };

  const out: Pt[] = [];
  const last = ordered[ordered.length - 1]!;
  const first = ordered[0]!;
  // Endpoint on the a0 ray, between the wrap-around pair.
  out.push(polar(radiusAt({ p: last.p, a: last.a - TAU }, first, 0), a0));

  let prev = { p: last.p, a: last.a - TAU };
  for (const s of ordered) {
    if (s.a > span) {
      out.push(polar(radiusAt(prev, s, span), a0 + span));
      return dedupe(out, 1e-9);
    }
    out.push(s.p);
    prev = s;
  }
  out.push(polar(radiusAt(prev, { p: first.p, a: first.a + TAU }, span), a0 + span));
  return dedupe(out, 1e-9);
}

interface JointFixings {
  /** Angular offsets from the joint ray, signed. */
  bolts: number[];
  dowels: number[];
}

function fixingsAt(rMid: number, side: 1 | -1, opts: SegmentOptions): JointFixings {
  return {
    bolts: opts.boltOffsets.map((d) => (side * d) / rMid),
    dowels: [(side * opts.dowelOffset) / rMid],
  };
}

/**
 * Split a ring into bed-sized arc segments plus the splice plates that join them.
 *
 * Returns `count: 1` and an empty list when the ring already fits — callers can
 * then just use the whole part.
 */
export function segmentRing(
  spec: RingSpec,
  defaults: GearDefaults,
  kerf: number,
  opts: SegmentOptions = defaultSegmentOptions(),
): SegmentResult {
  if (!isCircle(spec.shape)) return segmentShapedRing(spec, defaults, kerf, opts);
  const warnings: string[] = [];
  const m = moduleOf(spec, defaults);
  const chordTol = defaults.chordTol;
  const kh = kerf / 2;

  const innerParams: GearParams = {
    module: m,
    teeth: spec.teeth,
    pressureAngleDeg: defaults.pressureAngleDeg,
    addendum: defaults.addendum,
    clearance: defaults.clearance,
    backlash: defaults.backlash,
    profileShift: 0,
    filletCoeff: defaults.filletCoeff,
    kerf,
    chordTol,
    internal: true,
  };
  const inner = buildGearProfile(innerParams);
  const innerR = inner.radii.tip;

  let outerPts: Pt[];
  let outerR: number;
  if (spec.outerTeeth) {
    const zOuter = outerTeethFor(spec, defaults);
    const outer = buildGearProfile({ ...innerParams, internal: false, teeth: zOuter });
    outerPts = outer.path.pts;
    outerR = outer.radii.tip;
  } else {
    outerR = inner.radii.root + spec.rimWidth;
    outerPts = circlePath(0, 0, outerR + kh, chordTol).pts;
  }

  const count = segmentCountFor(innerR, outerR, opts);
  if (count <= 1) return { count: 1, segments: [], plates: [], warnings };

  const rimWidth = outerR - inner.radii.root;
  if (rimWidth < 18) {
    warnings.push(
      `Rim is only ${rimWidth.toFixed(1)}mm wide; splice plates need about 18mm to take a ` +
        `${opts.boltDia}mm bolt with material either side. Increase the rim width.`,
    );
  }

  const rMid = (inner.radii.root + outerR) / 2;
  const teethPer = distributeTeeth(spec.teeth, count);
  const bounds: number[] = [0];
  let acc = 0;
  for (const t of teethPer) {
    acc += t;
    bounds.push((acc * TAU) / spec.teeth);
  }

  const jointLetter = (i: number) => String.fromCharCode(65 + (i % 26));

  const segments: Part[] = [];
  for (let i = 0; i < count; i++) {
    const a0 = bounds[i]!;
    const a1 = bounds[i + 1]!;

    const cut: Path[] = [];
    const engrave: Path[] = [];

    const innerSlice = sliceByAngle(inner.path.pts, a0, a1);
    const outerSlice = sliceByAngle(outerPts, a0, a1).reverse();
    cut.push({ pts: dedupe([...innerSlice, ...outerSlice], 1e-9), closed: true });

    // Fixings: each end of this segment carries half of a joint's pattern.
    for (const [ray, side, joint] of [
      [a0, 1, i],
      [a1, -1, (i + 1) % count],
    ] as const) {
      const f = fixingsAt(rMid, side, opts);
      for (const da of f.bolts) {
        const p = polar(rMid, ray + da);
        const h = holePath(p.x, p.y, opts.boltDia, kerf, chordTol);
        if (h) cut.push(h);
      }
      for (const da of f.dowels) {
        const p = polar(rMid, ray + da);
        const h = holePath(p.x, p.y, opts.dowelDia, kerf, chordTol);
        if (h) cut.push(h);
      }
      // Match mark just inside the joint so the pieces can only go together one way.
      const mark = polar(rMid, ray + (side * 6) / rMid);
      engrave.push(
        ...flatLabel(jointLetter(joint), mark.x, mark.y, Math.min(5, rimWidth * 0.3)),
      );
    }

    const mid = (a0 + a1) / 2;
    engrave.push(
      ...labelPaths(
        [`${spec.teeth}T M${m}`, `SEG ${i + 1}/${count}`],
        rMid,
        mid,
        Math.min(5, rimWidth * 0.26),
      ),
    );

    segments.push(
      finishPart(`${spec.id}-seg${i + 1}`, `${spec.name} segment ${i + 1}/${count}`, 'ring', cut, engrave, {
        teeth: teethPer[i]!,
        module: m,
        pitchR: inner.radii.pitch,
        baseR: inner.radii.base,
        tipR: inner.radii.tip,
        rootR: inner.radii.root,
        outerR,
        // An arc is not an annulus: nothing can be packed "inside" it.
        innerHoleR: 0,
        penHoles: [],
        warnings: [],
      }),
    );
  }

  // Splice plates: one per joint, spanning the rim on both sides of the cut.
  const plates: Part[] = [];
  const plateHalf = (Math.max(...opts.boltOffsets) + 10) / rMid;
  const plateIn = inner.radii.root + 1 + kh;
  const plateOut = outerR - 1 - kh;
  for (let i = 0; i < count; i++) {
    const ray = bounds[i]!;
    const cut: Path[] = [
      {
        closed: true,
        pts: dedupe([
          ...arcPoints(0, 0, plateIn, ray - plateHalf, ray + plateHalf, chordTol),
          ...arcPoints(0, 0, plateOut, ray + plateHalf, ray - plateHalf, chordTol),
        ]),
      },
    ];
    for (const side of [1, -1] as const) {
      const f = fixingsAt(rMid, side, opts);
      for (const da of f.bolts) {
        const p = polar(rMid, ray + da);
        const h = holePath(p.x, p.y, opts.boltDia, kerf, chordTol);
        if (h) cut.push(h);
      }
      for (const da of f.dowels) {
        const p = polar(rMid, ray + da);
        const h = holePath(p.x, p.y, opts.dowelDia, kerf, chordTol);
        if (h) cut.push(h);
      }
    }
    const engrave = labelPaths([`JOINT ${jointLetter(i)}`], rMid, ray, Math.min(4, rimWidth * 0.22));
    plates.push(
      finishPart(`${spec.id}-plate${i + 1}`, `${spec.name} splice ${jointLetter(i)}`, 'splice', cut, engrave, {
        teeth: 0,
        module: m,
        pitchR: 0,
        baseR: 0,
        tipR: 0,
        rootR: 0,
        outerR: plateOut,
        innerHoleR: 0,
        penHoles: [],
        warnings: [],
      }),
    );
  }

  return { count, segments, plates, warnings };
}

function finishPart(
  id: string,
  name: string,
  kind: Part['kind'],
  cut: Path[],
  engrave: Path[],
  meta: Omit<Part['meta'], 'bbox' | 'cutLength'>,
): Part {
  return {
    id,
    name,
    kind,
    cut,
    engrave,
    meta: {
      ...meta,
      bbox: normalizeBBox(bboxOf([...cut, ...engrave])),
      cutLength: cut.reduce((s, p) => s + pathLength(p), 0),
    },
  };
}

/**
 * Splitting a non-circular ring.
 *
 * `segmentRing` above cannot be reused: it slices by polar angle and assumes
 * teeth sit at equal angles, which is only true of a circle. On a blob the
 * teeth are equally spaced by *arc length*, so the split has to be counted in
 * teeth and the boundaries taken from the placed tooth periods.
 *
 * The joint line falls out for free. A tooth boundary on the inner edge and
 * the matching point on the offset rim share an arc position, so the straight
 * line between them already runs along the pitch curve's normal.
 */
export function segmentShapedRing(
  spec: RingSpec,
  defaults: GearDefaults,
  kerf: number,
  opts: SegmentOptions = defaultSegmentOptions(),
): SegmentResult {
  const m = moduleOf(spec, defaults);
  const chordTol = defaults.chordTol;
  const kh = kerf / 2;
  const base = {
    module: m,
    pressureAngleDeg: defaults.pressureAngleDeg,
    addendum: defaults.addendum,
    clearance: defaults.clearance,
    backlash: defaults.backlash,
    profileShift: 0,
    filletCoeff: defaults.filletCoeff,
    kerf,
    chordTol,
  };

  const shaped = buildShapedRing(
    { shape: spec.shape, teeth: spec.teeth, rimWidth: spec.rimWidth },
    base,
  );
  const warnings = [...shaped.warnings];

  const availW = opts.bedWidth - opts.margin * 2;
  const availH = opts.bedHeight - opts.margin * 2;
  const fits = (b: { w: number; h: number }) =>
    (b.w <= availW && b.h <= availH) || (b.h <= availW && b.w <= availH);

  const curve = shaped.curve;
  const teeth = shaped.periods.length;
  const rimDepth = (defaults.addendum + defaults.clearance) * m + spec.rimWidth + kh;

  /** Inner and outer boundary of the arc covering teeth [from, to). */
  const arcOf = (from: number, to: number): Pt[] => {
    const inner: Pt[] = [];
    for (let j = from; j < to; j++) inner.push(...shaped.periods[j % teeth]!);
    // The rim, walked back the other way over the same arc range.
    const s0 = ((from - 0.5) / teeth) * curve.length;
    const s1 = ((to - 0.5) / teeth) * curve.length;
    const steps = Math.max(16, (to - from) * 8);
    const outer: Pt[] = [];
    for (let i = steps; i >= 0; i--) {
      const q = curve.at(s0 + ((s1 - s0) * i) / steps);
      outer.push({ x: q.p.x - q.normalIn.x * rimDepth, y: q.p.y - q.normalIn.y * rimDepth });
    }
    return dedupe([...inner, ...outer], 1e-9);
  };

  const extentOf = (pts: Pt[]) => {
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
    return { w: maxX - minX, h: maxY - minY };
  };

  if (fits(extentOf([...shaped.inner.pts, ...shaped.outer.pts]))) {
    return { count: 1, segments: [], plates: [], warnings };
  }

  // Try progressively more segments. A blob's arcs differ in size, so every
  // one has to be measured rather than assuming the worst is the average.
  let count = 2;
  let split: Pt[][] = [];
  for (; count <= 32; count++) {
    const per = distributeTeeth(teeth, count);
    const bounds: number[] = [0];
    for (const t of per) bounds.push(bounds[bounds.length - 1]! + t);
    const arcs = per.map((_, i) => arcOf(bounds[i]!, bounds[i + 1]!));
    if (arcs.every((a) => fits(extentOf(a)))) {
      split = arcs;
      break;
    }
  }
  if (split.length === 0) {
    warnings.push('Could not split this ring into bed-sized pieces — reduce the tooth count or the module.');
    return { count: 1, segments: [], plates: [], warnings };
  }

  const per = distributeTeeth(teeth, count);
  const bounds: number[] = [0];
  for (const t of per) bounds.push(bounds[bounds.length - 1]! + t);

  const rimMid = (defaults.addendum + defaults.clearance) * m + spec.rimWidth / 2;
  if (spec.rimWidth < 18) {
    warnings.push(
      `Rim is only ${spec.rimWidth.toFixed(1)}mm wide; splice plates need about 18mm to take a ` +
        `${opts.boltDia}mm bolt with material either side. Increase the rim width.`,
    );
  }

  /** A point on the rim's mid-line, `offset` mm of arc past a joint. */
  const rimAt = (jointTooth: number, offset: number): Pt => {
    const s = ((jointTooth - 0.5) / teeth) * curve.length + offset;
    const q = curve.at(s);
    return { x: q.p.x - q.normalIn.x * rimMid, y: q.p.y - q.normalIn.y * rimMid };
  };

  const jointLetter = (i: number) => String.fromCharCode(65 + (i % 26));
  const fixingOffsets = [...opts.boltOffsets.map((d) => ({ d, dia: opts.boltDia })), { d: opts.dowelOffset, dia: opts.dowelDia }];

  const segments: Part[] = [];
  for (let i = 0; i < count; i++) {
    const cut: Path[] = [{ pts: split[i]!, closed: true }];
    const engrave: Path[] = [];

    for (const [joint, side] of [
      [i, 1],
      [(i + 1) % count, -1],
    ] as const) {
      for (const f of fixingOffsets) {
        const p = rimAt(bounds[side === 1 ? i : i + 1]!, side * f.d);
        const h = holePath(p.x, p.y, f.dia, kerf, chordTol);
        if (h) cut.push(h);
      }
      const mark = rimAt(bounds[side === 1 ? i : i + 1]!, side * 6);
      engrave.push(...flatLabel(jointLetter(joint), mark.x, mark.y, Math.min(5, spec.rimWidth * 0.3)));
    }

    const mid = rimAt(Math.floor((bounds[i]! + bounds[i + 1]!) / 2), 0);
    engrave.push(...flatLabel(`SEG ${i + 1}/${count}`, mid.x, mid.y, Math.min(4.5, spec.rimWidth * 0.26)));

    segments.push(
      finishPart(`${spec.id}-seg${i + 1}`, `${spec.name} segment ${i + 1}/${count}`, 'ring', cut, engrave, {
        teeth: per[i]!,
        module: m,
        pitchR: (teeth * m) / 2,
        baseR: 0,
        tipR: shaped.minR,
        rootR: shaped.minR,
        outerR: shaped.maxR,
        innerHoleR: 0,
        penHoles: [],
        warnings: [],
      }),
    );
  }

  // Splice plates: straight-sided pieces spanning each joint, following the rim.
  const plates: Part[] = [];
  const span = Math.max(...opts.boltOffsets) + 10;
  for (let i = 0; i < count; i++) {
    const jointS = ((bounds[i]! - 0.5) / teeth) * curve.length;
    const steps = 48;
    const outer: Pt[] = [];
    const inner: Pt[] = [];
    for (let k = 0; k <= steps; k++) {
      const s = jointS - span + (2 * span * k) / steps;
      const q = curve.at(s);
      const deep = (defaults.addendum + defaults.clearance) * m + 1 + kh;
      const shallow = (defaults.addendum + defaults.clearance) * m + spec.rimWidth - 1 - kh;
      inner.push({ x: q.p.x - q.normalIn.x * deep, y: q.p.y - q.normalIn.y * deep });
      outer.push({ x: q.p.x - q.normalIn.x * shallow, y: q.p.y - q.normalIn.y * shallow });
    }
    const cut: Path[] = [{ pts: dedupe([...inner, ...outer.reverse()], 1e-9), closed: true }];
    for (const side of [1, -1] as const) {
      for (const f of fixingOffsets) {
        const p = rimAt(bounds[i]!, side * f.d);
        const h = holePath(p.x, p.y, f.dia, kerf, chordTol);
        if (h) cut.push(h);
      }
    }
    const at = rimAt(bounds[i]!, 0);
    const engrave = flatLabel(`JOINT ${jointLetter(i)}`, at.x, at.y, Math.min(4, spec.rimWidth * 0.22));
    plates.push(
      finishPart(`${spec.id}-plate${i + 1}`, `${spec.name} splice ${jointLetter(i)}`, 'splice', cut, engrave, {
        teeth: 0,
        module: m,
        pitchR: 0,
        baseR: 0,
        tipR: 0,
        rootR: 0,
        outerR: 0,
        innerHoleR: 0,
        penHoles: [],
        warnings: [],
      }),
    );
  }

  return { count, segments, plates, warnings };
}
