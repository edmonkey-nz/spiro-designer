/** Nested sheets: what comes off the laser, before you commit to it. */

import { useEffect, useMemo, useState } from 'react';
import { nestParts, sheetLayers } from '../../geom/nest';
import type { Part } from '../../geom/types';
import { nestOptionsOf } from '../../state/exporters';
import type { Machine } from '../../state/schema';
import { drawPaths, fitView, prepare, toScreen, usePanZoom, useSizedCanvas } from '../canvas';
import { Button } from '../widgets';

const BG = '#0f1115';

export function SheetPreview({
  parts,
  machine,
  notes,
}: {
  parts: Part[];
  machine: Machine;
  notes: string[];
}) {
  const { canvasRef, wrapRef, size } = useSizedCanvas();
  const pan = usePanZoom();
  const [sheetIndex, setSheetIndex] = useState(0);

  const opts = useMemo(() => nestOptionsOf(machine), [machine]);
  const result = useMemo(() => nestParts(parts, opts), [parts, opts]);
  const sheet = result.sheets[Math.min(sheetIndex, Math.max(0, result.sheets.length - 1))];

  const view = useMemo(
    () =>
      pan.view ??
      fitView({ minX: 0, minY: 0, maxX: machine.bedWidth, maxY: machine.bedHeight }, size.width, size.height, 24),
    [pan.view, machine.bedWidth, machine.bedHeight, size.width, size.height],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepare(canvas, size, BG);
    if (!ctx) return;

    // Bed outline and the usable area inside the margin.
    const bed = { minX: 0, minY: 0, maxX: machine.bedWidth, maxY: machine.bedHeight };
    const tl = toScreen(view, { x: bed.minX, y: bed.maxY });
    const br = toScreen(view, { x: bed.maxX, y: bed.minY });
    ctx.fillStyle = '#15181f';
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = '#3a4152';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    const m = machine.margin * view.scale;
    ctx.strokeStyle = '#242a36';
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(tl.x + m, tl.y + m, br.x - tl.x - 2 * m, br.y - tl.y - 2 * m);
    ctx.setLineDash([]);

    if (!sheet) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nothing to nest yet', size.width / 2, size.height / 2);
      return;
    }

    const layers = sheetLayers(sheet);
    drawPaths(ctx, layers.engrave, view, { color: '#5f7fd6', width: 1 });
    drawPaths(ctx, layers.cut, view, { color: '#e6e8ee', width: 1 });

    // Name each part where it sits.
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of sheet.placements) {
      const b = p.part.meta.bbox;
      const cx = p.dx + (p.rotation === 0 ? (b.minX + b.maxX) / 2 : -(b.minY + b.maxY) / 2);
      const cy = p.dy + (p.rotation === 0 ? (b.minY + b.maxY) / 2 : (b.minX + b.maxX) / 2);
      const s = toScreen(view, { x: cx, y: cy });
      ctx.fillText(p.part.name, s.x, s.y);
    }
  }, [sheet, view, size, machine, canvasRef]);

  return (
    <div className="view">
      <div className="view-canvas" ref={wrapRef} {...pan.handlers}>
        <canvas ref={canvasRef} />
      </div>
      <div className="view-controls">
        {result.sheets.map((s) => (
          <Button
            key={s.index}
            variant={s.index === sheetIndex ? 'primary' : 'default'}
            onClick={() => setSheetIndex(s.index)}
          >
            Sheet {s.index + 1}
          </Button>
        ))}
        <Button variant="ghost" onClick={pan.reset}>
          Fit
        </Button>
      </div>
      <div className="view-readout">
        <span>
          {result.sheets.length} sheet{result.sheets.length === 1 ? '' : 's'} of {machine.bedWidth}×
          {machine.bedHeight}mm
        </span>
        {sheet ? (
          <span>
            {sheet.placements.length} part{sheet.placements.length === 1 ? '' : 's'} on this sheet
          </span>
        ) : null}
        {sheet ? <span className="muted">{Math.round(sheet.utilisation * 100)}% of the sheet used</span> : null}
        {result.rejected.length > 0 ? (
          <span className="warn">{result.rejected.length} part(s) too big for the bed</span>
        ) : null}
      </div>
      {notes.length > 0 ? (
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
