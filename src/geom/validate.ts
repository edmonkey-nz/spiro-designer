/**
 * Design rules, surfaced as a live list rather than as blockers.
 *
 * Nothing here refuses to build a part. A slider being mid-drag through an
 * invalid value is normal, and a part you can see is far more useful for
 * understanding *why* it is wrong than an error message. Severity tells the UI
 * how loudly to complain.
 */

import { minTeethWithoutUndercut } from './involute';
import { curveInfo, type CurveSpec } from './curves';
import type { GearDefaults, PartSpec } from './gear';
import { moduleOf } from './gear';
import type { Part } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  message: string;
  /** Part this concerns, when it concerns one. */
  partId?: string;
  /** Stable key so the UI can offer a fix for specific issues. */
  code: string;
}

export interface Bed {
  width: number;
  height: number;
  margin: number;
}

/** Does a part fit the bed in either orientation? */
export function fitsBed(part: Part, bed: Bed): boolean {
  const w = part.meta.bbox.maxX - part.meta.bbox.minX;
  const h = part.meta.bbox.maxY - part.meta.bbox.minY;
  const availW = bed.width - bed.margin * 2;
  const availH = bed.height - bed.margin * 2;
  return (w <= availW && h <= availH) || (h <= availW && w <= availH);
}

/** Theoretical centre distance for a pairing, mm. */
export function centreDistance(fixedTeeth: number, rollingTeeth: number, module: number, internal: boolean): number {
  return ((internal ? fixedTeeth - rollingTeeth : fixedTeeth + rollingTeeth) * module) / 2;
}

export function validateParts(
  specs: PartSpec[],
  parts: Part[],
  defaults: GearDefaults,
  bed: Bed,
): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(specs.map((s) => [s.id, s]));

  for (const part of parts) {
    const spec = byId.get(part.id);

    for (const w of part.meta.warnings) {
      issues.push({ severity: 'warning', message: w, partId: part.id, code: 'build' });
    }

    if (!fitsBed(part, bed)) {
      const w = (part.meta.bbox.maxX - part.meta.bbox.minX).toFixed(0);
      const h = (part.meta.bbox.maxY - part.meta.bbox.minY).toFixed(0);
      const size = `${w}×${h}mm`;
      if (part.kind === 'cog') {
        issues.push({
          severity: 'error',
          message:
            `${part.name} is ${size}, larger than the ${bed.width}×${bed.height}mm bed, ` +
            'and a cog cannot be split. Reduce the tooth count or the module.',
          partId: part.id,
          code: 'bed-cog',
        });
      } else {
        issues.push({
          severity: 'warning',
          message: `${part.name} is ${size} and exceeds the bed — it will be cut as segments.`,
          partId: part.id,
          code: 'bed-segment',
        });
      }
    }

    if (spec && spec.kind !== 'rack') {
      const zMin = minTeethWithoutUndercut({
        pressureAngleDeg: defaults.pressureAngleDeg,
        addendum: defaults.addendum,
        profileShift: defaults.profileShift,
      });
      if (spec.kind === 'cog' && spec.teeth < zMin) {
        issues.push({
          severity: 'warning',
          message: `${part.name} has ${spec.teeth} teeth; below ${zMin} the flanks undercut and the tooth root gets thin.`,
          partId: part.id,
          code: 'undercut',
        });
      }
    }

    if (spec?.kind === 'cog') {
      const band = part.meta.penHoles;
      if (band.length > 0) {
        const requested = spec.penHoles;
        const lo = Math.min(...band.map((h) => h.r));
        const hi = Math.max(...band.map((h) => h.r));
        if (requested.minR > 0 && Math.abs(requested.minR - lo) > 0.05) {
          issues.push({
            severity: 'info',
            message: `Innermost pen hole moved to ${lo.toFixed(1)}mm — ${requested.minR.toFixed(1)}mm falls inside the hub boss.`,
            partId: part.id,
            code: 'pen-clamped',
          });
        }
        if (requested.maxR > 0 && Math.abs(requested.maxR - hi) > 0.05) {
          issues.push({
            severity: 'info',
            message: `Outermost pen hole moved to ${hi.toFixed(1)}mm — ${requested.maxR.toFixed(1)}mm runs into the tooth roots.`,
            partId: part.id,
            code: 'pen-clamped',
          });
        }
      }
    }
  }

  return issues;
}

export interface SetupRef {
  mode: CurveSpec['mode'];
  fixedSpec?: PartSpec;
  rollingSpec?: PartSpec;
  /** The built fixed part, needed for the bend limits of a non-circular ring. */
  fixedPart?: Part;
}

/** Rules that only make sense for a *pairing* rather than a single part. */
export function validateSetup(setup: SetupRef, defaults: GearDefaults, curve: CurveSpec): Issue[] {
  const issues: Issue[] = [];
  const { fixedSpec, rollingSpec } = setup;

  if (!rollingSpec) {
    issues.push({ severity: 'error', message: 'No rolling cog selected for this setup.', code: 'no-cog' });
    return issues;
  }
  if (setup.mode !== 'rack' && !fixedSpec) {
    issues.push({ severity: 'error', message: 'No fixed ring or cog selected for this setup.', code: 'no-fixed' });
    return issues;
  }

  if (fixedSpec) {
    const mFixed = moduleOf(fixedSpec, defaults);
    const mRolling = moduleOf(rollingSpec, defaults);
    if (Math.abs(mFixed - mRolling) > 1e-9) {
      issues.push({
        severity: 'error',
        message: `Modules differ (${mFixed} vs ${mRolling}) — these two will not mesh at all.`,
        code: 'module-mismatch',
      });
    }
  }

  // A non-circular ring is limited by its tightest bend, not by tooth counts:
  // the cog physically cannot reach into a corner sharper than itself.
  const shaped = setup.fixedPart?.meta.shaped;
  if (shaped && setup.mode === 'inside-ring') {
    const module = moduleOf(rollingSpec, defaults);
    const cogR = (rollingSpec.teeth * module) / 2;
    const maxTeeth = Math.floor((2 * shaped.minConvexRho) / module);
    if (cogR >= shaped.minConvexRho) {
      issues.push({
        severity: 'error',
        message:
          `The ring pinches to a ${shaped.minConvexRho.toFixed(0)}mm radius, tighter than this ` +
          `${rollingSpec.teeth}-tooth cog at ${cogR.toFixed(0)}mm. It cannot reach into the corners — ` +
          `use ${maxTeeth} teeth or fewer, or reduce the lobe amplitude.`,
        code: 'blob-too-tight',
      });
    } else if (shaped.minConvexRho - cogR < 5 * module) {
      issues.push({
        severity: 'warning',
        message:
          `Only ${(shaped.minConvexRho - cogR).toFixed(0)}mm between the cog and the ring's tightest ` +
          `bend. Tips foul as they come into mesh below about ${(5 * module).toFixed(0)}mm; ` +
          `${maxTeeth - 10} teeth or fewer is comfortable.`,
        code: 'blob-tight',
      });
    }
    if (shaped.maxJointGap > defaults.chordTol * 4) {
      issues.push({
        severity: 'warning',
        message:
          `Neighbouring teeth on the ring step by ${shaped.maxJointGap.toFixed(2)}mm because the ` +
          'curvature changes quickly. Raise the tooth count or soften the lobes.',
        code: 'blob-joint',
      });
    }
  }

  if (setup.mode === 'inside-ring' && fixedSpec && !shaped) {
    const diff = fixedSpec.teeth - rollingSpec.teeth;
    if (diff <= 0) {
      issues.push({
        severity: 'error',
        message: 'The cog must have fewer teeth than the ring it runs inside.',
        code: 'cog-too-big',
      });
    } else if (diff < 10) {
      issues.push({
        severity: 'warning',
        message:
          `Only ${diff} teeth between ring and cog. Below about 10 the tips of an internal pair ` +
          'foul on each other as they come into mesh.',
        code: 'internal-interference',
      });
    }
  }

  const info = curveInfo(curve);
  if (info.degenerate) {
    issues.push({
      severity: 'warning',
      message:
        curve.penR < 1e-9
          ? 'The pen is on the cog centre, so this draws a plain circle.'
          : 'Ring and cog have the same tooth count, so this draws a plain circle.',
      code: 'degenerate',
    });
  } else if (info.closes && info.petals < 3) {
    issues.push({
      severity: 'info',
      message: `Only ${info.petals} petal(s) — try tooth counts that share no common factor.`,
      code: 'few-petals',
    });
  }

  if (info.closes && fixedSpec) {
    const cd = centreDistance(
      fixedSpec.teeth,
      rollingSpec.teeth,
      moduleOf(rollingSpec, defaults),
      setup.mode === 'inside-ring',
    );
    issues.push({
      severity: 'info',
      message: `Centre distance ${cd.toFixed(2)}mm · ${info.petals} petals · closes after ${info.carrierRevs} turn(s).`,
      code: 'setup-summary',
    });
  }

  return issues;
}

export const worstSeverity = (issues: Issue[]): Severity | null =>
  issues.some((i) => i.severity === 'error')
    ? 'error'
    : issues.some((i) => i.severity === 'warning')
      ? 'warning'
      : issues.length
        ? 'info'
        : null;
