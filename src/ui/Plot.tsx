import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatValue } from '../engine/units';
import { cssVar, SERIES_VARS, useTheme } from './theme';

export interface PlotSeries {
  label: string;
  data: ArrayLike<number>;
  dashed?: boolean;
  /** Índice de color fijo (para que una señal conserve su color entre gráficos). */
  color?: number;
}

export interface PlotMarker {
  x: number;
  label: string;
}

interface PlotProps {
  x: ArrayLike<number>;
  series: PlotSeries[];
  xUnit: string;
  yUnit: string;
  /** Formato de los valores del eje y (por defecto, con prefijos SI). */
  yFormat?: (v: number) => string;
  logX?: boolean;
  markers?: PlotMarker[];
  /** Posición (en unidades de x) de un cursor vertical. */
  cursor?: number | null;
  height?: number;
  ariaLabel: string;
}

/** Gráfico de líneas sobre uPlot, con marcadores verticales y tema claro/oscuro. */
export function Plot(props: PlotProps) {
  // uPlot no admite series vacías: mientras no haya datos se reserva el lugar.
  if (props.x.length < 2) {
    return <div className="plot plot-empty" style={{ height: (props.height ?? 200) + 30 }} />;
  }
  return <PlotInner {...props} />;
}

function PlotInner({
  x,
  series,
  xUnit,
  yUnit,
  yFormat,
  logX = false,
  markers,
  cursor,
  height = 200,
  ariaLabel,
}: PlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const extras = useRef({ markers, cursor });
  extras.current = { markers, cursor };
  const latest = useRef({ x, series });
  latest.current = { x, series };
  const fmtRef = useRef(yFormat);
  fmtRef.current = yFormat;
  const theme = useTheme();
  const shape = series.map((s) => `${s.label}:${s.dashed ? 1 : 0}:${s.color ?? ''}`).join('|');

  useEffect(() => {
    const el = host.current!;
    const muted = cssVar('--muted');
    const line = cssVar('--line');
    const accent = cssVar('--accent-2');
    const font = "11px 'JetBrains Mono', monospace";
    const fy = (v: number) => (fmtRef.current ? fmtRef.current(v) : formatValue(v, yUnit));
    const axis = (values: uPlot.Axis['values'], size: number): uPlot.Axis => ({
      stroke: muted,
      font,
      size,
      grid: { stroke: line, width: 1 },
      ticks: { stroke: line, width: 1, size: 4 },
      values,
    });
    const { x: x0, series: s0 } = latest.current;
    const opts: uPlot.Options = {
      width: Math.max(160, el.clientWidth),
      height,
      scales: { x: { time: false, distr: logX ? 3 : 1 } },
      axes: [
        axis((_u, vals) => vals.map((v) => (v == null ? '' : formatValue(v, xUnit, 3))), 30),
        axis((_u, vals) => vals.map((v) => (v == null ? '' : fy(v))), 64),
      ],
      series: [
        {
          label: xUnit === 'Hz' ? 'f' : 't',
          value: (_u, v) => (v == null ? '—' : formatValue(v, xUnit, 4)),
        },
        ...s0.map((s, i): uPlot.Series => ({
          label: s.label,
          stroke: cssVar(SERIES_VARS[(s.color ?? i) % SERIES_VARS.length]),
          width: 1.8,
          dash: s.dashed ? [6, 4] : undefined,
          points: { show: false },
          value: (_u, v) => (v == null ? '—' : fy(v)),
        })),
      ],
      cursor: { drag: { x: false, y: false }, points: { size: 6 } },
      legend: { live: true },
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            const { left, top, width, height: h } = u.bbox;
            const ratio = uPlot.pxRatio;
            const inside = (px: number) => px >= left - 1 && px <= left + width + 1;
            ctx.save();
            ctx.font = `${11 * ratio}px 'JetBrains Mono', monospace`;
            ctx.textAlign = 'center';
            for (const m of extras.current.markers ?? []) {
              const px = u.valToPos(m.x, 'x', true);
              if (!inside(px)) continue;
              ctx.strokeStyle = muted;
              ctx.fillStyle = muted;
              ctx.lineWidth = ratio;
              ctx.setLineDash([4 * ratio, 4 * ratio]);
              ctx.beginPath();
              ctx.moveTo(px, top + 14 * ratio);
              ctx.lineTo(px, top + h);
              ctx.stroke();
              ctx.fillText(m.label, px, top + 10 * ratio);
            }
            const c = extras.current.cursor;
            if (c != null) {
              const px = u.valToPos(c, 'x', true);
              if (inside(px)) {
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.5 * ratio;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(px, top);
                ctx.lineTo(px, top + h);
                ctx.stroke();
              }
            }
            ctx.restore();
          },
        ],
      },
    };
    const data = [x0, ...s0.map((s) => s.data)] as unknown as uPlot.AlignedData;
    const u = new uPlot(opts, data, el);
    plot.current = u;
    const ro = new ResizeObserver(() => {
      const w = Math.max(160, el.clientWidth);
      if (w !== u.width) u.setSize({ width: w, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [shape, theme, logX, xUnit, yUnit, height]);

  // Actualiza los datos solo si cambió alguno de los arreglos (no en cada render).
  const lastData = useRef<ArrayLike<number>[]>([]);
  useEffect(() => {
    const arrays = [x, ...series.map((s) => s.data)];
    const prev = lastData.current;
    if (arrays.length === prev.length && arrays.every((a, i) => a === prev[i])) return;
    lastData.current = arrays;
    plot.current?.setData(arrays as unknown as uPlot.AlignedData);
  });

  useEffect(() => {
    plot.current?.redraw(false);
  }, [markers, cursor]);

  return <div ref={host} className="plot" role="img" aria-label={ariaLabel} />;
}
