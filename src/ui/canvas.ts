/**
 * Canvas plumbing shared by the three views.
 *
 * The model is Y-up millimetres; canvases are Y-down pixels. A `View` is the
 * single place that conversion happens, so no drawing code has to think about
 * it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BBox, Path, Pt } from '../geom/types';

export interface View {
  /** Pixels per millimetre. */
  scale: number;
  /** Screen position of the model origin. */
  tx: number;
  ty: number;
}

export const identityView = (): View => ({ scale: 1, tx: 0, ty: 0 });

export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.scale + v.tx, y: -p.y * v.scale + v.ty });

export const toModel = (v: View, x: number, y: number): Pt => ({
  x: (x - v.tx) / v.scale,
  y: -(y - v.ty) / v.scale,
});

export function fitView(bbox: BBox, width: number, height: number, pad = 24): View {
  const w = Math.max(bbox.maxX - bbox.minX, 1e-6);
  const h = Math.max(bbox.maxY - bbox.minY, 1e-6);
  const scale = Math.min((width - pad * 2) / w, (height - pad * 2) / h);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 + cy * scale };
}

export interface StrokeStyle {
  color: string;
  /** Line width in *pixels*, so lines stay visible at any zoom. */
  width?: number;
  dash?: number[];
  alpha?: number;
}

export function drawPaths(ctx: CanvasRenderingContext2D, paths: Path[], v: View, style: StrokeStyle): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width ?? 1;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  for (const path of paths) {
    if (path.pts.length === 0) continue;
    path.pts.forEach((p, i) => {
      const s = toScreen(v, p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (path.closed) ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

/** Draw a point list as one open polyline, optionally only part of it. */
export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  v: View,
  style: StrokeStyle,
  from = 0,
  to = pts.length,
): void {
  if (to - from < 2) return;
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width ?? 1.5;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = from; i < to; i++) {
    const s = toScreen(v, pts[i]!);
    if (i === from) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawCircle(ctx: CanvasRenderingContext2D, v: View, c: Pt, rMm: number, style: StrokeStyle): void {
  const s = toScreen(v, c);
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width ?? 1;
  ctx.globalAlpha = style.alpha ?? 1;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  ctx.arc(s.x, s.y, rMm * v.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawDot(ctx: CanvasRenderingContext2D, v: View, c: Pt, rPx: number, color: string): void {
  const s = toScreen(v, c);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, rPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

/**
 * Keep a canvas sized to its container at device pixel ratio, and report the
 * CSS-pixel size for layout maths. Returns a ref for the canvas and one for
 * its wrapper.
 */
export function useSizedCanvas(): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  size: CanvasSize;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 600, height: 400, dpr: 1 });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      setSize((prev) =>
        prev.width === width && prev.height === height && prev.dpr === dpr
          ? prev
          : { width, height, dpr },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  }, [size]);

  return { canvasRef, wrapRef, size };
}

/** Prepare a context for drawing in CSS pixels on a DPR-scaled canvas. */
export function prepare(canvas: HTMLCanvasElement, size: CanvasSize, background: string): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size.width, size.height);
  return ctx;
}

export interface PanZoom {
  view: View | null;
  setView: React.Dispatch<React.SetStateAction<View | null>>;
  /** Reset to the fitted view on the next draw. */
  reset: () => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onWheel: (e: React.WheelEvent) => void;
  };
}

/**
 * Mouse pan and wheel zoom. `view` starts null, meaning "fit the content";
 * views reset to null whenever the content changes shape.
 */
export function usePanZoom(): PanZoom {
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => setView(null), []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => (v ? { ...v, tx: v.tx + dx, ty: v.ty + dy } : v));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      if (!v) return v;
      const scale = Math.min(200, Math.max(0.02, v.scale * factor));
      const k = scale / v.scale;
      // Keep the model point under the cursor pinned.
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  }, []);

  return { view, setView, reset, handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel } };
}
