import { describe, expect, it } from 'vitest';
import { pageForBed, pageForContent, renderSvg, type SvgLayers } from '../src/geom/svg';
import { circlePath } from '../src/geom/types';
import { buildCog, defaultGearDefaults, newCogSpec } from '../src/geom/gear';
import { buildFitCoupon } from '../src/geom/coupon';
import { parseDesign, serializeDesign, defaultMachine } from '../src/state/schema';
import { presets } from '../src/state/presets';

const style = { cutColor: '#000000', engraveColor: '#0000ff', strokeWidth: 0.1 };

/** Pull every absolute coordinate out of the rendered path data. */
function coords(svg: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const m of svg.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return out;
}

describe('1:1 millimetre output', () => {
  it('declares mm dimensions and a matching unitless viewBox', () => {
    const svg = renderSvg({ cut: [], engrave: [] }, pageForBed(900, 600), style);
    expect(svg).toContain('width="900mm"');
    expect(svg).toContain('height="600mm"');
    expect(svg).toContain('viewBox="0 0 900 600"');
  });

  it('puts no transform on the root, so one user unit is one millimetre', () => {
    const svg = renderSvg({ cut: [], engrave: [] }, pageForBed(900, 600), style);
    const root = svg.slice(svg.indexOf('<svg'), svg.indexOf('>', svg.indexOf('<svg')));
    expect(root).not.toMatch(/transform=/);
  });

  it('measures a 100mm circle as 100 user units across', () => {
    // Flattened finely: a polygon inscribed in the circle only touches 100mm
    // where a vertex happens to land on the extreme, so a coarse tolerance
    // would measure the chord deficit rather than the scale.
    const layers: SvgLayers = { cut: [circlePath(0, 0, 50, 0.0005)], engrave: [] };
    const svg = renderSvg(layers, pageForContent(layers, 10), style);
    const pts = coords(svg);
    const width = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const height = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(width).toBeCloseTo(100, 2);
    expect(height).toBeCloseTo(100, 2);
  });

  it('honours the requested margin exactly', () => {
    const layers: SvgLayers = { cut: [circlePath(0, 0, 50, 0.01)], engrave: [] };
    const svg = renderSvg(layers, pageForContent(layers, 12), style);
    expect(svg).toContain('width="124mm"');
    const pts = coords(svg);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(12, 2);
  });

  it('flips Y so the model Y-up frame lands correctly on the page', () => {
    // A point at model (0, 40) on a 100-tall page must sit at page y = 60.
    const layers: SvgLayers = {
      cut: [{ pts: [{ x: 0, y: 40 }, { x: 10, y: 40 }], closed: false }],
      engrave: [],
    };
    const svg = renderSvg(layers, { width: 100, height: 100, originX: 0, originY: 0 }, style);
    expect(coords(svg)[0]).toEqual({ x: 0, y: 60 });
  });

  it('separates cut and engrave into their own coloured groups', () => {
    const part = buildCog(newCogSpec('c', 24), defaultGearDefaults(), 0.18);
    const layers = { cut: part.cut, engrave: part.engrave };
    const svg = renderSvg(layers, pageForContent(layers, 5), style);
    expect(svg).toContain('<g id="cut"');
    expect(svg).toContain('<g id="engrave"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke="#0000ff"');
    // Every path belongs to exactly one group.
    const cutGroup = svg.slice(svg.indexOf('<g id="cut"'), svg.indexOf('<g id="engrave"'));
    expect((cutGroup.match(/<path /g) ?? []).length).toBe(part.cut.length);
  });

  it('closes closed paths and leaves open ones open', () => {
    const layers: SvgLayers = {
      cut: [circlePath(0, 0, 10, 0.05)],
      engrave: [{ pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }], closed: false }],
    };
    const svg = renderSvg(layers, pageForContent(layers, 2), style);
    const cutGroup = svg.slice(svg.indexOf('<g id="cut"'), svg.indexOf('<g id="engrave"'));
    const engGroup = svg.slice(svg.indexOf('<g id="engrave"'));
    expect(cutGroup).toContain(' Z"');
    expect(engGroup).not.toContain(' Z"');
  });

  it('emits well-formed XML with no NaN coordinates', () => {
    const part = buildCog(newCogSpec('c', 43), defaultGearDefaults(), 0.18);
    const layers = { cut: part.cut, engrave: part.engrave };
    const svg = renderSvg(layers, pageForContent(layers, 5), style);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
});

describe('fit coupon', () => {
  it('produces a cog and a ring arc that both fit a small sheet', () => {
    const parts = buildFitCoupon(defaultGearDefaults(), 0.18);
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p.meta.bbox.maxX - p.meta.bbox.minX).toBeLessThan(250);
      expect(p.meta.bbox.maxY - p.meta.bbox.minY).toBeLessThan(250);
    }
  });

  it('uses a tooth count that does not undercut', () => {
    const parts = buildFitCoupon(defaultGearDefaults(), 0.18);
    expect(parts[0]!.meta.warnings.join(' ')).not.toMatch(/undercut/i);
  });

  it('stamps the settings it was cut at onto the part', () => {
    const svg = renderSvg(
      { cut: [], engrave: buildFitCoupon(defaultGearDefaults(), 0.18)[0]!.engrave },
      pageForBed(200, 200),
      style,
    );
    // The stamp is single-stroke vector text, so just check it drew something.
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(20);
  });
});

describe('design document round trip', () => {
  it('reloads every preset unchanged', () => {
    for (const preset of presets) {
      const design = preset.build();
      const result = parseDesign(serializeDesign(design));
      expect(result.error).toBeUndefined();
      expect(result.design).toEqual(design);
    }
  });

  it('reports where a malformed document went wrong', () => {
    const bad = { ...presets[0]!.build(), machine: { ...defaultMachine(), bedWidth: 'wide' } };
    const result = parseDesign(JSON.stringify(bad));
    expect(result.design).toBeUndefined();
    expect(result.error).toMatch(/machine\.bedWidth/);
  });

  it('rejects text that is not JSON at all', () => {
    expect(parseDesign('not json').error).toMatch(/not valid json/i);
  });

  it('fills in a missing schema version rather than refusing the file', () => {
    const doc = presets[0]!.build() as Record<string, unknown>;
    delete doc.schemaVersion;
    expect(parseDesign(JSON.stringify(doc)).design).toBeDefined();
  });
});
