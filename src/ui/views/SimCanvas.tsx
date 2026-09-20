/**
 * The simulator.
 *
 * Two things make this worth more than a formula plotter:
 *
 *  - the gears you see turning are the *generated* profiles, at the real
 *    centre distance, so the animation cannot drift away from the parts;
 *  - the pen offset is the engraved radius of a real hole, so what you watch
 *    is what the machine will draw.
 *
 * The trail is accumulated on an offscreen canvas and only the new segments
 * are stroked each frame. A dense pattern runs to a hundred thousand points,
 * which is far too many to re-stroke sixty times a second, and drawing only
 * the new part is also what makes it look like a pen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  carrierState,
  curveInfo,
  curveMetrics,
  penAt,
  sampleCurve,
  type CurveSpec,
} from '../../geom/curves';
import {
  TAU,
  bboxOf,
  normalizeBBox,
  transformPath,
  unionBBox,
  type BBox,
  type Part,
  type Path,
  type Pt,
} from '../../geom/types';
import { PEN_COLORS } from '../../state/design';
import { drawCircle, drawDot, drawPaths, drawPolyline, fitView, prepare, usePanZoom, useSizedCanvas, type View } from '../canvas';
import { Button } from '../widgets';

export interface SimPen {
  index: number;
  spec: CurveSpec;
  color: string;
}

export interface SimCanvasProps {
  pens: SimPen[];
  fixedPart?: Part;
  rollingPart?: Part;
  /** Called with the fully-sampled curves so the export panel can reuse them. */
  onCurves?: (curves: { index: number; pts: Pt[] }[]) => void;
}

const BG = '#0f1115';
const INK = '#e6e8ee';

export function SimCanvas({ pens, fixedPart, rollingPart, onCurves }: SimCanvasProps) {
  const { canvasRef, wrapRef, size } = useSizedCanvas();
  const pan = usePanZoom();

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0.6);
  const [showGears, setShowGears] = useState(true);
  const [showGuides, setShowGuides] = useState(false);

  const primary = pens[0]?.spec;
  const info = useMemo(() => (primary ? curveInfo(primary) : null), [primary]);

  // Sample every selected pen once. Keyed on the specs so dragging a slider
  // that does not affect the curve does not resample.
  const curves = useMemo(
    () =>
      pens.map((p) => ({
        index: p.index,
        color: p.color,
        pts: sampleCurve(p.spec, { perCogRev: 160, maxPoints: 120_000 }),
      })),
    [pens],
  );

  useEffect(() => {
    onCurves?.(curves.map((c) => ({ index: c.index, pts: c.pts })));
  }, [curves, onCurves]);

  const metrics = useMemo(
    () => (curves[0] ? curveMetrics(curves[0].pts) : null),
    [curves],
  );

  // Content bounds: the fixed part, the rolling cog where it starts, and the
  // curve itself — so an epitrochoid that swings outside the ring still fits.
  const bounds: BBox = useMemo(() => {
    let b: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    if (fixedPart) b = unionBBox(b, fixedPart.meta.bbox);
    for (const c of curves) b = unionBBox(b, bboxOf([{ pts: c.pts, closed: false }]));
    if (primary && rollingPart) {
      const st = carrierState(primary, 0);
      const bb = rollingPart.meta.bbox;
      b = unionBBox(b, {
        minX: bb.minX + st.centre.x,
        maxX: bb.maxX + st.centre.x,
        minY: bb.minY + st.centre.y,
        maxY: bb.maxY + st.centre.y,
      });
    }
    return normalizeBBox(b);
  }, [fixedPart, rollingPart, curves, primary]);

  const view: View = useMemo(
    () => pan.view ?? fitView(bounds, size.width, size.height, 28),
    [pan.view, bounds, size.width, size.height],
  );

  // ---- trail -------------------------------------------------------------
  const trailRef = useRef<HTMLCanvasElement | null>(null);
  const drawnTo = useRef(0);

  const resetTrail = () => {
    const trail = trailRef.current;
    if (!trail) return;
    const ctx = trail.getContext('2d');
    ctx?.clearRect(0, 0, trail.width, trail.height);
    drawnTo.current = 0;
  };

  useEffect(() => {
    // Anything that changes where things land invalidates the accumulated trail.
    let trail = trailRef.current;
    if (!trail) {
      trail = document.createElement('canvas');
      trailRef.current = trail;
    }
    trail.width = Math.round(size.width * size.dpr);
    trail.height = Math.round(size.height * size.dpr);
    resetTrail();
  }, [size.width, size.height, size.dpr, view.scale, view.tx, view.ty, curves]);

  // ---- animation ---------------------------------------------------------
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing || !info) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // `speed` is carrier turns per second, so a long run takes proportionally
      // longer rather than always finishing in the same wall-clock time.
      const perSecond = speed / Math.max(1, info.carrierRevs);
      const next = progressRef.current + dt * perSecond;
      if (next >= 1) {
        setProgress(1);
        setPlaying(false);
        return;
      }
      setProgress(next);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, info]);

  // ---- rendering ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const trail = trailRef.current;
    if (!canvas) return;
    const ctx = prepare(canvas, size, BG);
    if (!ctx) return;

    const n = curves[0]?.pts.length ?? 0;
    const upto = Math.max(0, Math.min(n, Math.round(n * progress)));

    // Extend (or rebuild) the trail.
    if (trail) {
      const tctx = trail.getContext('2d');
      if (tctx) {
        if (upto < drawnTo.current) {
          tctx.clearRect(0, 0, trail.width, trail.height);
          drawnTo.current = 0;
        }
        tctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        if (upto > drawnTo.current) {
          for (const c of curves) {
            drawPolyline(tctx, c.pts, view, { color: c.color, width: 1.6 }, Math.max(0, drawnTo.current - 1), upto);
          }
          drawnTo.current = upto;
        }
      }
    }

    if (showGuides) drawPaper(ctx, view, size.width, size.height, metrics?.outerRadius ?? 0);

    if (trail) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(trail, 0, 0);
      ctx.restore();
    }

    if (primary && showGears) {
      const theta = curveInfo(primary).thetaMax * progress;
      if (fixedPart) {
        drawPaths(ctx, fixedPart.cut, view, { color: '#5b6272', width: 1 });
      }
      if (rollingPart) {
        const st = carrierState(primary, theta);
        const moved: Path[] = rollingPart.cut.map((p) => transformPath(p, st.centre.x, st.centre.y, st.rotation));
        drawPaths(ctx, moved, view, { color: '#8b93a7', width: 1 });
        if (showGuides) {
          drawCircle(ctx, view, st.centre, (primary.module * primary.rollingTeeth) / 2, {
            color: '#3b82f6',
            width: 1,
            dash: [4, 4],
            alpha: 0.7,
          });
        }
      }
      for (const p of pens) {
        drawDot(ctx, view, penAt(p.spec, theta), 3.5, p.color);
      }
    }

    if (!primary) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a ring and a cog, then choose a pen hole.', size.width / 2, size.height / 2);
    }
  }, [curves, view, size, progress, showGears, showGuides, fixedPart, rollingPart, pens, primary, metrics, canvasRef]);

  const restart = () => {
    setProgress(0);
    resetTrail();
  };

  return (
    <div className="view">
      <div className="view-canvas" ref={wrapRef} {...pan.handlers}>
        <canvas ref={canvasRef} />
      </div>

      <div className="view-controls">
        <Button variant="primary" onClick={() => (progress >= 1 ? (restart(), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? '❚❚ Pause' : progress >= 1 ? '↻ Replay' : '▶ Play'}
        </Button>
        <Button onClick={restart}>Reset</Button>
        <Button onClick={() => { setPlaying(false); setProgress(1); }}>Draw all</Button>

        <input
          className="scrub"
          type="range"
          min={0}
          max={1}
          step={0.0005}
          value={progress}
          onChange={(e) => {
            setPlaying(false);
            setProgress(Number(e.target.value));
          }}
        />

        <label className="inline-field">
          Speed
          <input
            type="range"
            min={0.05}
            max={4}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span className="mono">{speed.toFixed(2)}×</span>
        </label>

        <label className="inline-check">
          <input type="checkbox" checked={showGears} onChange={(e) => setShowGears(e.target.checked)} /> Gears
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} /> Guides
        </label>
        <Button variant="ghost" onClick={pan.reset} title="Fit the view to the pattern">
          Fit
        </Button>
      </div>

      {info && metrics ? (
        <div className="view-readout">
          <span>{info.petals} petals</span>
          <span>{info.closes ? `closes after ${info.carrierRevs} turn${info.carrierRevs === 1 ? '' : 's'}` : 'open path'}</span>
          <span>{(metrics.outerRadius * 2).toFixed(0)}mm across</span>
          <span>{(metrics.length / 1000).toFixed(1)}m of line</span>
          <span className="muted">{Math.round(progress * 100)}%</span>
        </div>
      ) : null}
    </div>
  );
}

function drawPaper(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, outerR: number): void {
  // A 100mm grid, plus the circle the pattern needs to fit on.
  ctx.save();
  ctx.strokeStyle = '#1c2029';
  ctx.lineWidth = 1;
  const step = 100 * view.scale;
  if (step > 8) {
    ctx.beginPath();
    for (let x = view.tx % step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = view.ty % step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  if (outerR > 0) {
    drawCircle(ctx, view, { x: 0, y: 0 }, outerR, { color: '#2b3140', width: 1, dash: [6, 6] });
  }
}

export const simColorFor = (i: number): string => PEN_COLORS[i % PEN_COLORS.length]!;
export const FULL_TURN = TAU;
export const INK_COLOR = INK;
