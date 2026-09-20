/** Single-part view: what will actually be cut, plus the reference circles. */

import { useEffect, useMemo } from 'react';
import type { Part } from '../../geom/types';
import { drawCircle, drawPaths, fitView, prepare, usePanZoom, useSizedCanvas } from '../canvas';
import { Button } from '../widgets';

const BG = '#0f1115';

export function PartPreview({
  part,
  highlightHole,
  showGuides,
  onToggleGuides,
}: {
  part?: Part;
  highlightHole?: number;
  showGuides: boolean;
  onToggleGuides: (v: boolean) => void;
}) {
  const { canvasRef, wrapRef, size } = useSizedCanvas();
  const pan = usePanZoom();

  const view = useMemo(
    () => pan.view ?? fitView(part?.meta.bbox ?? { minX: -50, minY: -50, maxX: 50, maxY: 50 }, size.width, size.height, 28),
    [pan.view, part, size.width, size.height],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepare(canvas, size, BG);
    if (!ctx) return;

    if (!part) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No part selected', size.width / 2, size.height / 2);
      return;
    }

    if (showGuides && part.meta.pitchR > 0) {
      const guide = { color: '#2f3646', width: 1, dash: [5, 5] };
      drawCircle(ctx, view, { x: 0, y: 0 }, part.meta.pitchR, { ...guide, color: '#3b82f6', alpha: 0.65 });
      drawCircle(ctx, view, { x: 0, y: 0 }, part.meta.baseR, guide);
      drawCircle(ctx, view, { x: 0, y: 0 }, part.meta.rootR, guide);
      drawCircle(ctx, view, { x: 0, y: 0 }, part.meta.tipR, guide);
    }

    drawPaths(ctx, part.engrave, view, { color: '#5f7fd6', width: 1 });
    drawPaths(ctx, part.cut, view, { color: '#e6e8ee', width: 1.2 });

    if (highlightHole !== undefined) {
      const hole = part.meta.penHoles.find((h) => h.index === highlightHole);
      if (hole) {
        drawCircle(
          ctx,
          view,
          { x: hole.r * Math.cos(hole.theta), y: hole.r * Math.sin(hole.theta) },
          Math.max(hole.dia, 6),
          { color: '#f59e0b', width: 2 },
        );
      }
    }
  }, [part, view, size, showGuides, highlightHole, canvasRef]);

  return (
    <div className="view">
      <div className="view-canvas" ref={wrapRef} {...pan.handlers}>
        <canvas ref={canvasRef} />
      </div>
      <div className="view-controls">
        <label className="inline-check">
          <input type="checkbox" checked={showGuides} onChange={(e) => onToggleGuides(e.target.checked)} /> Pitch / base
          / root circles
        </label>
        <Button variant="ghost" onClick={pan.reset}>
          Fit
        </Button>
      </div>
      {part ? (
        <div className="view-readout">
          <span>{part.meta.teeth}T</span>
          <span>module {part.meta.module}</span>
          <span>pitch ø{(part.meta.pitchR * 2).toFixed(2)}mm</span>
          <span>tip ø{(part.meta.tipR * 2).toFixed(2)}mm</span>
          <span>root ø{(part.meta.rootR * 2).toFixed(2)}mm</span>
          <span className="muted">{(part.meta.cutLength / 1000).toFixed(2)}m of cut</span>
        </div>
      ) : null}
    </div>
  );
}
