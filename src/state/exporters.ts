/**
 * Turning parts and patterns into files the laser or the plotter can use.
 */

import { buildFitCoupon } from '../geom/coupon';
import { nestParts, sheetLayers, type NestOptions } from '../geom/nest';
import { segmentRing, defaultSegmentOptions } from '../geom/segment';
import { pageForBed, pageForContent, renderSvg, type SvgLayers, type SvgStyle } from '../geom/svg';
import { fitsBed } from '../geom/validate';
import type { GearDefaults, PartSpec, RingSpec } from '../geom/gear';
import type { Part, Pt } from '../geom/types';
import type { Design, Machine } from './schema';
import { buildPartCached } from './design';
import { downloadBlob, downloadText, safeFilename } from './storage';

export const styleOf = (m: Machine): SvgStyle => ({
  cutColor: m.cutColor,
  engraveColor: m.engraveColor,
  strokeWidth: m.strokeWidth,
});

export const nestOptionsOf = (m: Machine): NestOptions => ({
  bedWidth: m.bedWidth,
  bedHeight: m.bedHeight,
  margin: m.margin,
  gap: m.partGap,
  allowRotate: true,
});

export interface OutputFile {
  filename: string;
  text: string;
}

/** One part, on a page sized to fit it. */
export function partSvg(part: Part, machine: Machine): string {
  const layers: SvgLayers = { cut: part.cut, engrave: part.engrave };
  return renderSvg(layers, pageForContent(layers, machine.margin), styleOf(machine));
}

/**
 * The parts a design actually cuts: oversized rings are replaced by their
 * segments and splice plates, everything else passes through unchanged.
 */
export function cuttableParts(design: Design): { parts: Part[]; notes: string[] } {
  const bed = { width: design.machine.bedWidth, height: design.machine.bedHeight, margin: design.machine.margin };
  const segOpts = {
    ...defaultSegmentOptions(),
    bedWidth: design.machine.bedWidth,
    bedHeight: design.machine.bedHeight,
    margin: design.machine.margin,
  };

  const out: Part[] = [];
  const notes: string[] = [];
  for (const spec of design.parts) {
    const part = buildPartCached(spec, design.defaults, design.machine.kerf);
    if (fitsBed(part, bed)) {
      out.push(part);
      continue;
    }
    if (spec.kind === 'ring') {
      const res = segmentRing(spec as RingSpec, design.defaults, design.machine.kerf, segOpts);
      out.push(...res.segments, ...res.plates);
      notes.push(
        `${spec.name} split into ${res.count} segments with ${res.plates.length} splice plates.`,
        ...res.warnings,
      );
    } else {
      out.push(part);
      notes.push(`${spec.name} does not fit the bed and cannot be split.`);
    }
  }
  return { parts: out, notes };
}

/** Nested sheets, one SVG each. */
export function sheetSvgs(parts: Part[], machine: Machine, name: string): { files: OutputFile[]; rejected: Part[] } {
  const opts = nestOptionsOf(machine);
  const { sheets, rejected } = nestParts(parts, opts);
  const style = styleOf(machine);
  const page = pageForBed(machine.bedWidth, machine.bedHeight);
  const files = sheets.map((sheet) => ({
    filename: `${safeFilename(name)}-sheet-${sheet.index + 1}.svg`,
    text: renderSvg(sheetLayers(sheet), page, style),
  }));
  return { files, rejected };
}

/** The drawn pattern at true scale, as a single open polyline. */
export function patternSvg(pts: Pt[], machine: Machine, margin = 10): string {
  const layers: SvgLayers = { cut: [{ pts, closed: false }], engrave: [] };
  return renderSvg(layers, pageForContent(layers, margin), styleOf(machine));
}

/** The drawn pattern as a raster image at a chosen resolution. */
export async function patternPng(pts: Pt[], dpi = 300, margin = 10, lineWidthMm = 0.35): Promise<Blob | null> {
  if (pts.length < 2) return null;
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
  const wMm = maxX - minX + margin * 2;
  const hMm = maxY - minY + margin * 2;
  const pxPerMm = dpi / 25.4;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wMm * pxPerMm));
  canvas.height = Math.max(1, Math.round(hMm * pxPerMm));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1, lineWidthMm * pxPerMm);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    // Y-up model space to Y-down canvas space.
    const x = (p.x - minX + margin) * pxPerMm;
    const y = (maxY - p.y + margin) * pxPerMm;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export function fitCouponSvg(defaults: GearDefaults, machine: Machine): string {
  const parts = buildFitCoupon(defaults, machine.kerf);
  const opts = { ...nestOptionsOf(machine), bedWidth: 300, bedHeight: 200, margin: 8 };
  const { sheets } = nestParts(parts, opts);
  const sheet = sheets[0];
  const layers = sheet ? sheetLayers(sheet) : { cut: [], engrave: [] };
  return renderSvg(layers, pageForContent(layers, 8), styleOf(machine));
}

// ---------------------------------------------------------------------------
// download helpers

export function downloadPartSvg(part: Part, machine: Machine): void {
  downloadText(`${safeFilename(part.name)}.svg`, partSvg(part, machine), 'image/svg+xml');
}

export function downloadSheets(design: Design): { count: number; notes: string[]; rejected: Part[] } {
  const { parts, notes } = cuttableParts(design);
  const { files, rejected } = sheetSvgs(parts, design.machine, design.name);
  for (const f of files) downloadText(f.filename, f.text, 'image/svg+xml');
  return { count: files.length, notes, rejected };
}

export function downloadPatternSvg(pts: Pt[], design: Design, label: string): void {
  downloadText(`${safeFilename(design.name)}-${safeFilename(label)}.svg`, patternSvg(pts, design.machine), 'image/svg+xml');
}

export async function downloadPatternPng(pts: Pt[], design: Design, label: string, dpi: number): Promise<boolean> {
  const blob = await patternPng(pts, dpi);
  if (!blob) return false;
  downloadBlob(`${safeFilename(design.name)}-${safeFilename(label)}.png`, blob);
  return true;
}

export function downloadFitCoupon(design: Design): void {
  downloadText('fit-coupon.svg', fitCouponSvg(design.defaults, design.machine), 'image/svg+xml');
}

export const specName = (s: PartSpec): string => s.name;
