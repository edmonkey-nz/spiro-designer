/**
 * SVG output at true 1:1 millimetre scale.
 *
 * The one rule that makes a file land correctly in LightBurn / Illustrator /
 * Inkscape: `width`/`height` carry explicit `mm` units and the viewBox is the
 * same numbers with no unit and no transform on the root. One user unit is then
 * exactly one millimetre, so a 100mm circle measures 100mm on the bed.
 *
 * This is also the only module in `src/geom` that knows SVG is Y-down.
 */

import { bboxOf, normalizeBBox, unionBBox, type BBox, type Path } from './types';

export interface SvgStyle {
  cutColor: string;
  engraveColor: string;
  /** Drawn stroke width in mm — cosmetic only, the laser follows the centreline. */
  strokeWidth: number;
}

export const defaultSvgStyle = (): SvgStyle => ({
  cutColor: '#000000',
  engraveColor: '#0000ff',
  strokeWidth: 0.1,
});

export interface SvgPage {
  /** Page size in mm. */
  width: number;
  height: number;
  /** Model-space point (Y-up mm) that maps to the page's bottom-left corner. */
  originX: number;
  originY: number;
}

export interface SvgLayers {
  cut: Path[];
  engrave: Path[];
}

/** Trim to 4 decimal places — below the kerf, and well below any laser's resolution. */
function n(v: number): string {
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
}

function pathData(path: Path, page: SvgPage): string {
  if (path.pts.length === 0) return '';
  const parts: string[] = [];
  path.pts.forEach((p, i) => {
    const x = p.x - page.originX;
    const y = page.height - (p.y - page.originY); // Y-up model -> Y-down page
    parts.push(`${i === 0 ? 'M' : 'L'}${n(x)},${n(y)}`);
  });
  if (path.closed) parts.push('Z');
  return parts.join(' ');
}

function group(id: string, color: string, sw: number, paths: Path[], page: SvgPage): string {
  if (paths.length === 0) return '';
  const body = paths
    .map((p) => pathData(p, page))
    .filter(Boolean)
    .map((d) => `    <path d="${d}" />`)
    .join('\n');
  return (
    `  <g id="${id}" fill="none" stroke="${color}" stroke-width="${n(sw)}" ` +
    `stroke-linecap="round" stroke-linejoin="round">\n${body}\n  </g>`
  );
}

export function renderSvg(layers: SvgLayers, page: SvgPage, style: SvgStyle = defaultSvgStyle()): string {
  const groups = [
    group('cut', style.cutColor, style.strokeWidth, layers.cut, page),
    group('engrave', style.engraveColor, style.strokeWidth, layers.engrave, page),
  ].filter(Boolean);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`,
    `     width="${n(page.width)}mm" height="${n(page.height)}mm"`,
    `     viewBox="0 0 ${n(page.width)} ${n(page.height)}">`,
    ...groups,
    '</svg>',
    '',
  ].join('\n');
}

/** A page sized to the content plus a uniform margin — used for single-part export. */
export function pageForContent(layers: SvgLayers, margin: number): SvgPage {
  const b = boundsOf(layers);
  return {
    width: b.maxX - b.minX + margin * 2,
    height: b.maxY - b.minY + margin * 2,
    originX: b.minX - margin,
    originY: b.minY - margin,
  };
}

/** A fixed bed-sized page with the model origin at the bottom-left — used for nested sheets. */
export function pageForBed(width: number, height: number): SvgPage {
  return { width, height, originX: 0, originY: 0 };
}

export function boundsOf(layers: SvgLayers): BBox {
  return normalizeBBox(unionBBox(bboxOf(layers.cut), bboxOf(layers.engrave)));
}
