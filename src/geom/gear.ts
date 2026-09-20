/**
 * Part builders: a spec in, a cuttable `Part` out.
 *
 * A `Part` is the unit everything downstream works with — the preview, the
 * nester, the SVG writer and the simulator all take parts, never specs.
 */

import {
  buildGearProfile,
  defaultGearParams,
  gearRadii,
  type GearParams,
} from './involute';
import {
  cutoutPaths,
  defaultCutouts,
  defaultHub,
  defaultMount,
  defaultPenHoles,
  flatLabel,
  generatePenHoles,
  hubPaths,
  labelPaths,
  mountPaths,
  penHolePaths,
  type CutoutSpec,
  type HubSpec,
  type LayerPaths,
  type MountSpec,
  type PenHoleSpec,
} from './features';
import {
  bboxOf,
  circlePath,
  deg,
  normalizeBBox,
  pathLength,
  type Part,
  type Path,
  type PenHole,
} from './types';

/** Tooth-form parameters shared by every part in a design. */
export interface GearDefaults {
  module: number;
  pressureAngleDeg: number;
  addendum: number;
  clearance: number;
  backlash: number;
  profileShift: number;
  filletCoeff: number;
  chordTol: number;
}

export const defaultGearDefaults = (): GearDefaults => {
  const { module, pressureAngleDeg, addendum, clearance, backlash, profileShift, filletCoeff, chordTol } =
    defaultGearParams();
  return { module, pressureAngleDeg, addendum, clearance, backlash, profileShift, filletCoeff, chordTol };
};

export interface BaseSpec {
  id: string;
  name: string;
  teeth: number;
  /** Per-part module override; falls back to the design default. */
  module?: number;
  hub: HubSpec;
  mount: MountSpec;
  cutouts: CutoutSpec;
  label: boolean;
}

export interface CogSpec extends BaseSpec {
  kind: 'cog';
  penHoles: PenHoleSpec;
}

export interface RingSpec extends BaseSpec {
  kind: 'ring';
  /** Radial material between the root circle and the outer edge, mm. */
  rimWidth: number;
  /** Cut external teeth on the outer edge too, for cog-outside-ring patterns. */
  outerTeeth: boolean;
  /** Tooth count of the outer set. 0 means "derive from the rim width". */
  outerTeethCount: number;
}

export interface RackSpec {
  kind: 'rack';
  id: string;
  name: string;
  /** Number of teeth on this rack segment. */
  teeth: number;
  module?: number;
  /** Material below the root line, mm. */
  bodyHeight: number;
  mount: MountSpec;
  label: boolean;
}

export type PartSpec = CogSpec | RingSpec | RackSpec;

export const newCogSpec = (id: string, teeth = 32): CogSpec => ({
  kind: 'cog',
  id,
  name: `Cog ${teeth}T`,
  teeth,
  hub: defaultHub(),
  mount: { ...defaultMount(), enabled: false },
  cutouts: defaultCutouts(),
  penHoles: defaultPenHoles(),
  label: true,
});

export const newRingSpec = (id: string, teeth = 96): RingSpec => ({
  kind: 'ring',
  id,
  name: `Ring ${teeth}T`,
  teeth,
  hub: { ...defaultHub(), boreDia: 0, bossDia: 0, crosshair: true },
  mount: { ...defaultMount(), enabled: true, count: 8, circleDia: 0 },
  cutouts: { ...defaultCutouts(), enabled: false },
  rimWidth: 15,
  outerTeeth: false,
  outerTeethCount: 0,
  label: true,
});

export const newRackSpec = (id: string, teeth = 60): RackSpec => ({
  kind: 'rack',
  id,
  name: `Rack ${teeth}T`,
  teeth,
  bodyHeight: 18,
  mount: { ...defaultMount(), enabled: true, count: 6, circleDia: 0 },
  label: true,
});

export const moduleOf = (spec: PartSpec, defaults: GearDefaults): number => spec.module ?? defaults.module;

function paramsFor(spec: PartSpec, defaults: GearDefaults, kerf: number, internal: boolean): GearParams {
  return {
    module: moduleOf(spec, defaults),
    teeth: spec.teeth,
    pressureAngleDeg: defaults.pressureAngleDeg,
    addendum: defaults.addendum,
    clearance: defaults.clearance,
    backlash: defaults.backlash,
    // Profile shift only makes sense on external gears here; rings stay standard.
    profileShift: internal ? 0 : defaults.profileShift,
    filletCoeff: defaults.filletCoeff,
    kerf,
    chordTol: defaults.chordTol,
    internal,
  };
}

function finish(
  spec: { id: string; name: string },
  kind: Part['kind'],
  layers: LayerPaths,
  meta: Omit<Part['meta'], 'bbox' | 'cutLength'>,
): Part {
  return {
    id: spec.id,
    name: spec.name,
    kind,
    cut: layers.cut,
    engrave: layers.engrave,
    meta: {
      ...meta,
      bbox: normalizeBBox(bboxOf([...layers.cut, ...layers.engrave])),
      cutLength: layers.cut.reduce((sum, p) => sum + pathLength(p), 0),
    },
  };
}

/** Usable radial band for pen holes: outside the hub boss, inside the tooth roots. */
export function penHoleBand(spec: CogSpec, rootR: number): { min: number; max: number } {
  const wall = Math.max(3, spec.penHoles.dia * 0.8);
  const min = Math.max(spec.hub.bossDia / 2, spec.hub.boreDia / 2 + 4) + spec.penHoles.dia / 2 + 2;
  const max = rootR - spec.penHoles.dia / 2 - wall;
  return { min: Math.min(min, Math.max(max, min)), max: Math.max(max, min) };
}

export function buildCog(spec: CogSpec, defaults: GearDefaults, kerf: number): Part {
  const p = paramsFor(spec, defaults, kerf, false);
  const profile = buildGearProfile(p);
  const warnings = [...profile.warnings];
  const chordTol = defaults.chordTol;

  const cut: Path[] = [profile.path];
  const engrave: Path[] = [];

  const hub = hubPaths(spec.hub, kerf, chordTol);
  cut.push(...hub.cut);
  engrave.push(...hub.engrave);

  const band = penHoleBand(spec, profile.radii.root);
  const holes: PenHole[] = generatePenHoles(spec.penHoles, band.min, band.max, `${spec.id}-p`);
  const pen = penHolePaths(holes, spec.penHoles, kerf, chordTol);
  cut.push(...pen.cut);
  engrave.push(...pen.engrave);

  if (spec.mount.enabled) {
    const mount = { ...spec.mount, circleDia: spec.mount.circleDia || profile.radii.root * 0.9 };
    const m = mountPaths(mount, kerf, chordTol, Math.PI / spec.teeth);
    cut.push(...m.cut);
  }

  if (spec.cutouts.enabled) {
    // Pen holes usually occupy the middle of the disc, leaving a clear band
    // inside them and another outside. Use whichever is wider rather than
    // always reaching for the outer one, which on a hole-filled cog is empty.
    const gapInner = { lo: spec.hub.bossDia / 2, hi: band.min - spec.penHoles.dia };
    const gapOuter = { lo: band.max + spec.penHoles.dia, hi: profile.radii.root };
    const gap = gapOuter.hi - gapOuter.lo >= gapInner.hi - gapInner.lo ? gapOuter : gapInner;
    const c = cutoutPaths(spec.cutouts, gap.lo, gap.hi, kerf, chordTol);
    if (c.cut.length === 0) {
      warnings.push(
        `Lightening cutouts do not fit: the widest clear band is ${Math.max(0, gap.hi - gap.lo).toFixed(1)}mm. ` +
          'Narrow the pen-hole range, or reduce the edge margin and web width.',
      );
    }
    cut.push(...c.cut);
  }

  if (spec.label) {
    // The hub annulus is the one place on a cog guaranteed to be clear of pen
    // holes, so the identification block goes there when it will fit.
    const m = moduleOf(spec, defaults);
    const boreR = spec.hub.boreDia / 2;
    const bossR = spec.hub.bossDia / 2;
    const room = bossR - boreR;
    if (room >= 7) {
      const size = Math.min(4.5, room * 0.42);
      const rl = boreR + room * 0.55;
      engrave.push(...flatLabel(`${spec.teeth}T`, 0, rl, size));
      engrave.push(...flatLabel(`M${m}`, 0, -rl, size));
    } else {
      const r = Math.max(band.min * 0.62, bossR + 5);
      engrave.push(...labelPaths([`${spec.teeth}T`, `M${m}`], r, Math.PI / 2, Math.min(6, r * 0.42)));
    }
  }

  return finish(spec, 'cog', { cut, engrave }, {
    teeth: spec.teeth,
    module: moduleOf(spec, defaults),
    pitchR: profile.radii.pitch,
    baseR: profile.radii.base,
    tipR: profile.radii.tip,
    rootR: profile.radii.root,
    outerR: profile.radii.tip,
    innerHoleR: 0,
    penHoles: holes,
    warnings,
  });
}

/**
 * Tooth count of a ring's outer gear set, derived from the rim width unless the
 * spec names one. The rim width is honoured as asked; `buildRing` is what warns
 * and clamps if the result would cut into the inner root circle.
 */
export function outerTeethFor(spec: RingSpec, defaults: GearDefaults): number {
  if (spec.outerTeethCount > 0) return Math.max(3, Math.round(spec.outerTeethCount));
  const m = moduleOf(spec, defaults);
  const rootR = gearRadii(paramsFor(spec, defaults, 0, true)).root;
  // Outer pitch radius sits one addendum inside the rim edge.
  return Math.max(3, Math.round((2 * (rootR + spec.rimWidth - m)) / m));
}

/** Fewest outer teeth that still leave `gap` mm of rim inside the outer roots. */
export function minOuterTeeth(innerRootR: number, module: number, clearanceCoeff: number, gap = 4): number {
  return Math.ceil((2 * (innerRootR + gap + (1 + clearanceCoeff) * module)) / module);
}

export function buildRing(spec: RingSpec, defaults: GearDefaults, kerf: number): Part {
  const p = paramsFor(spec, defaults, kerf, true);
  const inner = buildGearProfile(p);
  const warnings = [...inner.warnings];
  const chordTol = defaults.chordTol;
  const m = moduleOf(spec, defaults);

  const cut: Path[] = [inner.path];
  const engrave: Path[] = [];

  let outerR: number;
  if (spec.outerTeeth) {
    let zOuter = outerTeethFor(spec, defaults);
    const safe = minOuterTeeth(inner.radii.root, m, defaults.clearance);
    if (zOuter < safe) {
      warnings.push(
        `Outer teeth would cut into the inner root circle at a ${spec.rimWidth}mm rim width. ` +
          `Raised to ${safe} teeth (about ${(((safe * m) / 2 - (1 + defaults.clearance) * m - inner.radii.root)).toFixed(1)}mm of rim); ` +
          'increase the rim width or set the outer tooth count explicitly.',
      );
      zOuter = safe;
    }
    const outerParams: GearParams = { ...paramsFor(spec, defaults, kerf, false), teeth: zOuter };
    const outer = buildGearProfile(outerParams);
    cut.push(outer.path);
    outerR = outer.radii.tip;
    warnings.push(...outer.warnings.map((w) => `Outer teeth: ${w}`));
  } else {
    outerR = inner.radii.root + spec.rimWidth;
    cut.push(circlePath(0, 0, outerR + kerf / 2, chordTol));
  }

  // No hub features on a ring. Its centre is a hole, so a centre crosshair
  // would be engraved onto scrap — and it would foul any part the nester packs
  // into the interior.

  if (spec.mount.enabled) {
    // Default the bolt circle to the middle of the rim.
    const pcd = spec.mount.circleDia || (inner.radii.root + outerR);
    const m2 = mountPaths({ ...spec.mount, circleDia: pcd }, kerf, chordTol, Math.PI / spec.teeth);
    if (pcd / 2 > inner.radii.root + spec.mount.holeDia && pcd / 2 < outerR - spec.mount.holeDia) {
      cut.push(...m2.cut);
    } else {
      warnings.push('Mounting holes fall outside the rim — set the bolt circle diameter explicitly.');
    }
  }

  if (spec.label) {
    const r = (inner.radii.root + outerR) / 2;
    const size = Math.min(7, Math.max(3, spec.rimWidth * 0.32));
    engrave.push(...labelPaths([`${spec.teeth}T M${m}`], r, Math.PI / 2, size));
  }

  return finish(spec, 'ring', { cut, engrave }, {
    teeth: spec.teeth,
    module: m,
    pitchR: inner.radii.pitch,
    baseR: inner.radii.base,
    tipR: inner.radii.tip,
    rootR: inner.radii.root,
    outerR,
    // The tooth tips are the innermost material, so everything inside is free.
    innerHoleR: inner.radii.tip,
    penHoles: [],
    warnings,
  });
}

/**
 * A straight rack: the limiting case of an involute gear, so the flanks are
 * plain straight lines at the pressure angle. Pitch line on y = 0, teeth up.
 */
export function buildRack(spec: RackSpec, defaults: GearDefaults, kerf: number): Part {
  const m = moduleOf(spec, defaults);
  const alpha = deg(defaults.pressureAngleDeg);
  const tanA = Math.tan(alpha);
  const kh = kerf / 2;
  const pitch = Math.PI * m;
  const z = Math.max(2, Math.round(spec.teeth));

  const ha = defaults.addendum * m;
  const hf = (defaults.addendum + defaults.clearance) * m;

  // Tooth half-width at the pitch line, kerf-compensated the same way a gear is:
  // a normal offset of kerf/2 on a flank at pressure angle alpha is kerf/2/cos(alpha)
  // measured along the pitch line.
  const half = (Math.PI * m) / 4 - defaults.backlash / 4 + kh / Math.cos(alpha);

  const tipY = ha + kh;
  const rootY = -hf - kh;
  const bottomY = -hf - spec.bodyHeight - kh;
  const length = z * pitch;

  const pts = [];
  // Left edge, then the toothed top from left to right.
  pts.push({ x: -kh, y: bottomY });
  pts.push({ x: -kh, y: rootY });
  for (let i = 0; i < z; i++) {
    const c = (i + 0.5) * pitch;
    pts.push({ x: c - half - hf * tanA, y: rootY });
    pts.push({ x: c - half + ha * tanA, y: tipY });
    pts.push({ x: c + half - ha * tanA, y: tipY });
    pts.push({ x: c + half + hf * tanA, y: rootY });
  }
  pts.push({ x: length + kh, y: rootY });
  pts.push({ x: length + kh, y: bottomY });

  const cut: Path[] = [{ pts, closed: true }];
  const engrave: Path[] = [];

  if (spec.mount.enabled && spec.mount.count > 0) {
    const y = (rootY + bottomY) / 2;
    for (let i = 0; i < spec.mount.count; i++) {
      const x = ((i + 0.5) / spec.mount.count) * length;
      const r = spec.mount.holeDia / 2 - kh;
      if (r > 0.05) cut.push(circlePath(x, y, r, defaults.chordTol));
    }
  }

  if (spec.label) {
    engrave.push(...flatLabel(`${z}T M${m} RACK`, length / 2, (rootY + bottomY) / 2, Math.min(6, spec.bodyHeight * 0.4)));
  }

  return finish(spec, 'rack', { cut, engrave }, {
    teeth: z,
    module: m,
    pitchR: 0,
    baseR: 0,
    tipR: 0,
    rootR: 0,
    outerR: 0,
    innerHoleR: 0,
    penHoles: [],
    warnings: [],
  });
}

export function buildPart(spec: PartSpec, defaults: GearDefaults, kerf: number): Part {
  switch (spec.kind) {
    case 'cog':
      return buildCog(spec, defaults, kerf);
    case 'ring':
      return buildRing(spec, defaults, kerf);
    case 'rack':
      return buildRack(spec, defaults, kerf);
  }
}
