/**
 * The fit-test coupon.
 *
 * A small cog and a short arc of matching internal ring, cut from the same
 * material at the same settings. It exists because kerf and backlash are the
 * two numbers this app cannot know: they depend on the laser, the focus, the
 * ply and the day. Cutting a 100mm coupon and feeling how the pair meshes
 * settles both in ten minutes, and is a great deal cheaper than finding out on
 * a 600mm ring.
 */

import { buildGearProfile, type GearParams } from './involute';
import { flatLabel } from './features';
import { sliceByAngle } from './segment';
import {
  TAU,
  arcPoints,
  bboxOf,
  circlePath,
  dedupe,
  normalizeBBox,
  pathLength,
  type Part,
  type Path,
} from './types';
import type { GearDefaults } from './gear';

export interface CouponOptions {
  /** Teeth on the test cog. 20 avoids undercut at a 20 degree pressure angle. */
  cogTeeth: number;
  /** Teeth on the notional ring the arc is taken from. */
  ringTeeth: number;
  /** How much of that ring to cut, radians. */
  arcAngle: number;
  rimWidth: number;
}

export const defaultCouponOptions = (): CouponOptions => ({
  cogTeeth: 20,
  ringTeeth: 40,
  arcAngle: (TAU * 100) / 360,
  rimWidth: 12,
});

/**
 * Build the coupon as two parts. They are returned separately so the nester
 * places them like anything else.
 */
export function buildFitCoupon(
  defaults: GearDefaults,
  kerf: number,
  opts: CouponOptions = defaultCouponOptions(),
): Part[] {
  const m = defaults.module;
  const chordTol = defaults.chordTol;
  const kh = kerf / 2;

  const common: Omit<GearParams, 'teeth' | 'internal' | 'profileShift'> = {
    module: m,
    pressureAngleDeg: defaults.pressureAngleDeg,
    addendum: defaults.addendum,
    clearance: defaults.clearance,
    backlash: defaults.backlash,
    filletCoeff: defaults.filletCoeff,
    kerf,
    chordTol,
  };

  const stamp = `M${m} K${kerf} B${defaults.backlash}`;

  // ---- the cog ----------------------------------------------------------
  const cogProfile = buildGearProfile({
    ...common,
    teeth: opts.cogTeeth,
    internal: false,
    profileShift: defaults.profileShift,
  });
  const cogCut: Path[] = [cogProfile.path];
  const bore = circlePath(0, 0, Math.max(1, m * 1.2 - kh), chordTol);
  cogCut.push(bore);
  const cogEngrave = [
    ...flatLabel(`${opts.cogTeeth}T`, 0, m * 2.6, Math.min(5, m * 1.4)),
    ...flatLabel(stamp, 0, -m * 2.6, Math.min(3.2, m)),
  ];

  const cog: Part = {
    id: 'coupon-cog',
    name: `Fit coupon cog ${opts.cogTeeth}T`,
    kind: 'cog',
    cut: cogCut,
    engrave: cogEngrave,
    meta: {
      teeth: opts.cogTeeth,
      module: m,
      pitchR: cogProfile.radii.pitch,
      baseR: cogProfile.radii.base,
      tipR: cogProfile.radii.tip,
      rootR: cogProfile.radii.root,
      outerR: cogProfile.radii.tip,
      bbox: normalizeBBox(bboxOf([...cogCut, ...cogEngrave])),
      penHoles: [],
      cutLength: cogCut.reduce((s, p) => s + pathLength(p), 0),
      warnings: cogProfile.warnings,
    },
  };

  // ---- the ring arc -----------------------------------------------------
  const ringProfile = buildGearProfile({
    ...common,
    teeth: opts.ringTeeth,
    internal: true,
    profileShift: 0,
  });
  const outerR = ringProfile.radii.root + opts.rimWidth;
  const a0 = -opts.arcAngle / 2;
  const a1 = opts.arcAngle / 2;
  const innerSlice = sliceByAngle(ringProfile.path.pts, a0, a1);
  const outerSlice = arcPoints(0, 0, outerR + kh, a1, a0, chordTol);

  const arcCut: Path[] = [{ pts: dedupe([...innerSlice, ...outerSlice], 1e-9), closed: true }];
  const midR = (ringProfile.radii.root + outerR) / 2;
  const arcEngrave = [
    ...flatLabel(`${opts.ringTeeth}T`, midR, 0, Math.min(5, opts.rimWidth * 0.4)),
  ];

  const arc: Part = {
    id: 'coupon-ring',
    name: `Fit coupon ring arc ${opts.ringTeeth}T`,
    kind: 'ring',
    cut: arcCut,
    engrave: arcEngrave,
    meta: {
      teeth: opts.ringTeeth,
      module: m,
      pitchR: ringProfile.radii.pitch,
      baseR: ringProfile.radii.base,
      tipR: ringProfile.radii.tip,
      rootR: ringProfile.radii.root,
      outerR,
      bbox: normalizeBBox(bboxOf([...arcCut, ...arcEngrave])),
      penHoles: [],
      cutLength: arcCut.reduce((s, p) => s + pathLength(p), 0),
      warnings: ringProfile.warnings,
    },
  };

  return [cog, arc];
}
