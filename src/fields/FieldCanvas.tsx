import { useEffect, useRef, type PointerEvent } from 'react';
import { useTheme } from '../ui/theme';
import type { Vec2 } from './electrostatics';

/** Transformación entre el mundo (metros, origen al centro, y hacia arriba) y la pantalla. */
export interface View {
  width: number;
  height: number;
  /** Píxeles por metro. */
  scale: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  toScreen: (x: number, y: number) => [number, number];
  toWorld: (px: number, py: number) => Vec2;
}

export function makeView(width: number, height: number, worldWidth: number): View {
  const scale = width / worldWidth;
  const halfH = height / 2 / scale;
  return {
    width,
    height,
    scale,
    xMin: -worldWidth / 2,
    xMax: worldWidth / 2,
    yMin: -halfH,
    yMax: halfH,
    toScreen: (x, y) => [width / 2 + x * scale, height / 2 - y * scale],
    toWorld: (px, py) => ({ x: (px - width / 2) / scale, y: (height / 2 - py) / scale }),
  };
}

interface FieldCanvasProps {
  /** Ancho visible del mundo, en metros. */
  worldWidth: number;
  /** Función de dibujo. Cambiar su identidad provoca un redibujado. */
  draw: (ctx: CanvasRenderingContext2D, view: View) => void;
  onDown?: (p: Vec2, view: View) => void;
  onMove?: (p: Vec2, view: View, dragging: boolean) => void;
  onUp?: () => void;
  onLeave?: () => void;
  ariaLabel: string;
  cursor?: string;
}

/** Lienzo 2D que se adapta al contenedor y a la densidad de píxeles. */
export function FieldCanvas({
  worldWidth,
  draw,
  onDown,
  onMove,
  onUp,
  onLeave,
  ariaLabel,
  cursor = 'crosshair',
}: FieldCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>(makeView(600, 400, worldWidth));
  const dragging = useRef(false);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const theme = useTheme();

  const render = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    view.current = makeView(rect.width, rect.height, worldWidth);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawRef.current(ctx, view.current);
  };
  const renderRef = useRef(render);
  renderRef.current = render;

  useEffect(() => {
    renderRef.current();
  }, [draw, theme, worldWidth]);

  useEffect(() => {
    const canvas = ref.current!;
    const ro = new ResizeObserver(() => renderRef.current());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const world = (e: PointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = ref.current!.getBoundingClientRect();
    return view.current.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  return (
    <canvas
      ref={ref}
      className="field-canvas"
      role="img"
      aria-label={ariaLabel}
      style={{ cursor }}
      onPointerDown={(e) => {
        ref.current!.setPointerCapture(e.pointerId);
        dragging.current = true;
        onDown?.(world(e), view.current);
      }}
      onPointerMove={(e) => onMove?.(world(e), view.current, dragging.current)}
      onPointerUp={() => {
        dragging.current = false;
        onUp?.();
      }}
      onPointerLeave={() => !dragging.current && onLeave?.()}
    />
  );
}

/** Flecha de longitud fija centrada en (px, py). */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ux: number,
  uy: number,
  length: number,
) {
  const hx = px + (ux * length) / 2;
  const hy = py + (uy * length) / 2;
  const tx = px - (ux * length) / 2;
  const ty = py - (uy * length) / 2;
  const head = Math.min(4.5, length * 0.4);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - ux * head - uy * head * 0.6, hy - uy * head + ux * head * 0.6);
  ctx.lineTo(hx - ux * head + uy * head * 0.6, hy - uy * head - ux * head * 0.6);
  ctx.closePath();
  ctx.fill();
}

/** Dibuja una poligonal en coordenadas del mundo, con una punta de flecha a mitad de camino. */
export function drawPolyline(ctx: CanvasRenderingContext2D, view: View, pts: Vec2[], arrow = true) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = view.toScreen(p.x, p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  if (!arrow || pts.length < 8) return;
  const k = Math.floor(pts.length / 2);
  const [x0, y0] = view.toScreen(pts[k - 1].x, pts[k - 1].y);
  const [x1, y1] = view.toScreen(pts[k + 1].x, pts[k + 1].y);
  const m = Math.hypot(x1 - x0, y1 - y0);
  if (m < 1e-6) return;
  const ux = (x1 - x0) / m;
  const uy = (y1 - y0) / m;
  const [cx, cy] = view.toScreen(pts[k].x, pts[k].y);
  ctx.beginPath();
  ctx.moveTo(cx + ux * 5, cy + uy * 5);
  ctx.lineTo(cx - ux * 4 - uy * 3.6, cy - uy * 4 + ux * 3.6);
  ctx.lineTo(cx - ux * 4 + uy * 3.6, cy - uy * 4 - ux * 3.6);
  ctx.closePath();
  ctx.fill();
}

/** Opacidad según el módulo del campo, en escala logarítmica entre lo y hi. */
export function logAlpha(mag: number, lo: number, hi: number): number {
  if (!(mag > 0)) return 0;
  const t = (Math.log10(mag) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return 0.18 + 0.82 * Math.min(1, Math.max(0, t));
}
