import { useCallback, useMemo, useRef, useState } from 'react';
import { formatNumber, formatValue } from '../engine/units';
import { cssVar } from '../ui/theme';
import { Section } from '../ui/Steps';
import { ValueInput } from '../ui/ValueInput';
import {
  contourSegments,
  EPS0,
  fieldAt,
  fieldLines,
  K,
  parallelPlates,
  platesCenterField,
  potentialAt,
  type Charge,
  type Kernel,
  type Vec2,
} from './electrostatics';
import { drawArrow, drawPolyline, FieldCanvas, logAlpha, type View } from './FieldCanvas';

interface PointCharge extends Charge {
  id: number;
}

const WORLD = 0.6; // ancho visible: 60 cm

const PRESETS: Record<string, { label: string; charges: Charge[] }> = {
  sola: { label: 'Carga sola', charges: [{ x: 0, y: 0, q: 2e-9 }] },
  dipolo: {
    label: 'Dipolo',
    charges: [
      { x: -0.08, y: 0, q: 2e-9 },
      { x: 0.08, y: 0, q: -2e-9 },
    ],
  },
  iguales: {
    label: 'Dos iguales',
    charges: [
      { x: -0.08, y: 0, q: 2e-9 },
      { x: 0.08, y: 0, q: 2e-9 },
    ],
  },
  cuadrupolo: {
    label: 'Cuadrupolo',
    charges: [
      { x: -0.07, y: 0.07, q: 2e-9 },
      { x: 0.07, y: 0.07, q: -2e-9 },
      { x: 0.07, y: -0.07, q: 2e-9 },
      { x: -0.07, y: -0.07, q: -2e-9 },
    ],
  },
};

let nextId = 1;
const withIds = (cs: Charge[]): PointCharge[] => cs.map((c) => ({ ...c, id: nextId++ }));

export function ElectroScene() {
  const [mode, setMode] = useState<'cargas' | 'placas'>('cargas');
  const [charges, setCharges] = useState<PointCharge[]>(() => withIds(PRESETS.dipolo.charges));
  const [selected, setSelected] = useState<number | null>(null);
  const [show, setShow] = useState({ vectors: true, lines: true, equi: true });
  const [plates, setPlates] = useState({ d: 0.06, width: 0.3, V: 100 });
  const [probe, setProbe] = useState<Vec2 | null>(null);
  const dragId = useRef<number | null>(null);

  const kernel: Kernel = mode === 'placas' ? 'linea' : 'punto';
  const sources: Charge[] = useMemo(
    () => (mode === 'placas' ? parallelPlates(plates.width, plates.d, plates.V, 90) : charges),
    [mode, plates, charges],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, view: View) => {
      const ink = cssVar('--ink');
      const pos = cssVar('--pos');
      const neg = cssVar('--neg');
      const accent2 = cssVar('--accent-2');
      const bounds = view;

      // Equipotenciales
      if (show.equi && sources.length > 0) {
        const nx = 150;
        const ny = Math.max(20, Math.round((nx * view.height) / view.width));
        const toWorld = (i: number, j: number): Vec2 => ({
          x: view.xMin + ((view.xMax - view.xMin) * i) / (nx - 1),
          y: view.yMin + ((view.yMax - view.yMin) * j) / (ny - 1),
        });
        const values = new Float64Array(nx * ny);
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const p = toWorld(i, j);
            values[j * nx + i] = potentialAt(sources, p.x, p.y, kernel);
          }
        }
        let levels: number[];
        if (mode === 'placas') {
          levels = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => (plates.V * k) / 10);
        } else {
          const qRef = Math.max(...sources.map((c) => Math.abs(c.q)));
          const base = [0.03, 0.045, 0.065, 0.095, 0.14, 0.21].map((r) => (K * qRef) / r);
          levels = [...base, ...base.map((v) => -v)];
        }
        ctx.strokeStyle = accent2;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const level of levels) {
          for (const [a, b] of contourSegments(values, nx, ny, level, toWorld)) {
            const [x0, y0] = view.toScreen(a.x, a.y);
            const [x1, y1] = view.toScreen(b.x, b.y);
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Líneas de campo
      if (show.lines && sources.length > 0) {
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.75;
        if (mode === 'placas') {
          // Se siembran a lo largo de la placa positiva, apenas por debajo y por encima.
          const n = 15;
          for (let i = 0; i < n; i++) {
            const x = -plates.width / 2 + (plates.width * (i + 0.5)) / n;
            for (const side of [-1, 1]) {
              const start = { x, y: plates.d / 2 + side * 0.004 };
              const line = traceFrom(sources, start, bounds, kernel);
              drawPolyline(ctx, view, line);
            }
          }
        } else {
          for (const line of fieldLines(sources, bounds, 12, kernel)) drawPolyline(ctx, view, line);
        }
        ctx.globalAlpha = 1;
      }

      // Vectores de campo
      if (show.vectors && sources.length > 0) {
        const spacing = 34;
        const ref = mode === 'placas' ? plates.V / plates.d : 5000;
        ctx.strokeStyle = cssVar('--accent');
        ctx.fillStyle = cssVar('--accent');
        ctx.lineWidth = 1.3;
        for (let py = spacing / 2; py < view.height; py += spacing) {
          for (let px = spacing / 2; px < view.width; px += spacing) {
            const p = view.toWorld(px, py);
            const e = fieldAt(sources, p.x, p.y, kernel);
            const m = Math.hypot(e.x, e.y);
            if (!(m > 0)) continue;
            ctx.globalAlpha = logAlpha(m, ref / 100, ref * 3);
            drawArrow(ctx, px, py, e.x / m, -e.y / m, 15);
          }
        }
        ctx.globalAlpha = 1;
      }

      // Fuentes
      if (mode === 'placas') {
        for (const [y, color] of [
          [plates.d / 2, pos],
          [-plates.d / 2, neg],
        ] as const) {
          const [x0, y0] = view.toScreen(-plates.width / 2, y);
          const [x1] = view.toScreen(plates.width / 2, y);
          ctx.strokeStyle = color;
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y0);
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
      } else {
        for (const c of charges) {
          const [px, py] = view.toScreen(c.x, c.y);
          const r = 9 + 4 * Math.min(1, Math.abs(c.q) / 4e-9);
          ctx.beginPath();
          ctx.arc(px, py, r, 0, 2 * Math.PI);
          ctx.fillStyle = c.q >= 0 ? pos : neg;
          ctx.fill();
          if (c.id === selected) {
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = ink;
            ctx.stroke();
          }
          ctx.fillStyle = '#fff';
          ctx.font = "bold 14px 'JetBrains Mono', monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(c.q >= 0 ? '+' : '−', px, py + 0.5);
        }
      }

      // Punto de medición
      if (probe) {
        const [px, py] = view.toScreen(probe.x, probe.y);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.stroke();
      }
    },
    [sources, kernel, mode, plates, charges, selected, show, probe],
  );

  const hit = (p: Vec2, view: View): PointCharge | undefined =>
    charges.find((c) => Math.hypot(c.x - p.x, c.y - p.y) * view.scale < 16);

  const sel = charges.find((c) => c.id === selected) ?? null;
  const update = (id: number, patch: Partial<Charge>) =>
    setCharges((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = (q: number) => {
    const c: PointCharge = {
      id: nextId++,
      x: (Math.random() - 0.5) * 0.2,
      y: (Math.random() - 0.5) * 0.15,
      q,
    };
    setCharges((cs) => [...cs, c]);
    setSelected(c.id);
  };

  const probeE = probe ? fieldAt(sources, probe.x, probe.y, kernel) : null;
  const probeV = probe ? potentialAt(sources, probe.x, probe.y, kernel) : null;
  const centerE = mode === 'placas' ? Math.abs(fieldAt(sources, 0, 0, 'linea').y) : 0;

  return (
    <div className="fields-layout">
      <div className="field-stage">
        <FieldCanvas
          worldWidth={WORLD}
          draw={draw}
          ariaLabel="Campo eléctrico en el plano: vectores, líneas de campo y equipotenciales"
          onDown={(p, view) => {
            if (mode !== 'cargas') return;
            const c = hit(p, view);
            dragId.current = c?.id ?? null;
            setSelected(c?.id ?? null);
          }}
          onMove={(p, _view, dragging) => {
            setProbe(p);
            if (dragging && dragId.current !== null) update(dragId.current, { x: p.x, y: p.y });
          }}
          onUp={() => (dragId.current = null)}
          onLeave={() => setProbe(null)}
        />
        <div className="field-legend">
          <span className="lg lg-vec">vectores E</span>
          <span className="lg lg-line">líneas de campo</span>
          <span className="lg lg-equi">equipotenciales</span>
        </div>
      </div>

      <aside className="panel fields-panel" aria-label="Controles de electrostática">
        <div className="panel-body">
          <Section title="Escena">
            <div className="segmented" role="tablist" aria-label="Tipo de fuente">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'cargas'}
                className={mode === 'cargas' ? 'active' : ''}
                onClick={() => setMode('cargas')}
              >
                Cargas puntuales
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'placas'}
                className={mode === 'placas' ? 'active' : ''}
                onClick={() => setMode('placas')}
              >
                Placas paralelas
              </button>
            </div>
            <div className="toggles">
              {(
                [
                  ['vectors', 'Vectores'],
                  ['lines', 'Líneas de campo'],
                  ['equi', 'Equipotenciales'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={show[key]}
                    onChange={(e) => setShow({ ...show, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </Section>

          {mode === 'cargas' ? (
            <Section title="Cargas">
              <div className="btn-row wrap">
                <button type="button" className="btn" onClick={() => add(2e-9)}>
                  + Positiva
                </button>
                <button type="button" className="btn" onClick={() => add(-2e-9)}>
                  + Negativa
                </button>
                {sel && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      setCharges((cs) => cs.filter((c) => c.id !== sel.id));
                      setSelected(null);
                    }}
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="chips" role="group" aria-label="Elegir una carga">
                {charges.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip-btn ${c.id === selected ? 'on' : ''}`}
                    aria-pressed={c.id === selected}
                    onClick={() => setSelected(c.id)}
                    style={{ ['--chip' as string]: c.q >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                  >
                    q{i + 1} {formatValue(c.q, 'C')}
                  </button>
                ))}
              </div>
              {sel ? (
                <div className="grid-3">
                  <div className="field">
                    <label htmlFor="q-val">Carga</label>
                    <ValueInput
                      id="q-val"
                      value={sel.q}
                      unit="C"
                      onChange={(q) => update(sel.id, { q })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="q-x">x</label>
                    <ValueInput
                      id="q-x"
                      value={sel.x}
                      unit="m"
                      onChange={(x) => update(sel.id, { x })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="q-y">y</label>
                    <ValueInput
                      id="q-y"
                      value={sel.y}
                      unit="m"
                      onChange={(y) => update(sel.id, { y })}
                    />
                  </div>
                </div>
              ) : (
                <p className="muted small">
                  Arrastrá las cargas en el dibujo. Tocá una para editar su valor (por ejemplo{' '}
                  <code>-3n</code>).
                </p>
              )}
              <div className="chips">
                {Object.entries(PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setCharges(withIds(p.charges));
                      setSelected(null);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Section>
          ) : (
            <Section title="Placas">
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="pl-v">Tensión</label>
                  <ValueInput
                    id="pl-v"
                    value={plates.V}
                    unit="V"
                    onChange={(V) => setPlates({ ...plates, V })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pl-d">Separación</label>
                  <ValueInput
                    id="pl-d"
                    value={plates.d}
                    unit="m"
                    positive
                    onChange={(d) => setPlates({ ...plates, d: Math.min(0.3, Math.max(0.01, d)) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pl-w">Ancho</label>
                  <ValueInput
                    id="pl-w"
                    value={plates.width}
                    unit="m"
                    positive
                    onChange={(w) =>
                      setPlates({ ...plates, width: Math.min(0.55, Math.max(0.02, w)) })
                    }
                  />
                </div>
              </div>
            </Section>
          )}

          <Section title="Medición">
            {probe && probeE && probeV !== null ? (
              <dl className="kv">
                <dt>Punto</dt>
                <dd>
                  ({formatNumber(probe.x * 100, 3)}; {formatNumber(probe.y * 100, 3)}) cm
                </dd>
                <dt>|E|</dt>
                <dd>{formatValue(Math.hypot(probeE.x, probeE.y), 'V/m')}</dd>
                <dt>Dirección</dt>
                <dd>{formatNumber((Math.atan2(probeE.y, probeE.x) * 180) / Math.PI, 3)}°</dd>
                <dt>V</dt>
                <dd>{formatValue(probeV, 'V')}</dd>
              </dl>
            ) : (
              <p className="muted small">
                Pasá el cursor por el dibujo para medir E y V en un punto.
              </p>
            )}
          </Section>

          <Section title="Qué se está calculando">
            {mode === 'cargas' ? (
              <>
                <p className="small">
                  Cada carga puntual produce un campo radial (ley de Coulomb):
                </p>
                <pre className="formula">
                  {'E = k·q / r²      V = k·q / r\nk = 1/(4π·ε0) = 8,99·10^9 N·m²/C²'}
                </pre>
                <p className="small">
                  El campo total es la suma vectorial de los campos de todas las cargas
                  (superposición); el potencial, la suma escalar. Las líneas de campo salen de las
                  positivas y entran en las negativas; las equipotenciales las cortan siempre a 90°,
                  porque E = −∇V.
                </p>
                <pre className="formula">
                  {charges
                    .map(
                      (c, i) =>
                        `q${i + 1} = ${formatValue(c.q, 'C')} en (${formatNumber(c.x * 100, 3)}; ${formatNumber(c.y * 100, 3)}) cm`,
                    )
                    .join('\n') || 'Sin cargas'}
                </pre>
              </>
            ) : (
              <>
                <p className="small">
                  Capacitor ideal de placas infinitas: campo uniforme entre placas.
                </p>
                <pre className="formula">
                  {`E = V / d = ${formatValue(plates.V, 'V')} / ${formatValue(plates.d, 'm')} = ${formatValue(plates.V / plates.d, 'V/m')}\nσ = ε0·E = ${formatValue((EPS0 * plates.V) / plates.d, 'C/m²')}`}
                </pre>
                <p className="small">
                  Acá las placas tienen ancho finito (cada una es una fila de 90 líneas de carga),
                  así que el campo se "abre" en los bordes y en el centro es algo menor que el
                  ideal:
                </p>
                <pre className="formula">
                  {`E centro (modelo)  = ${formatValue(centerE, 'V/m')}\nE centro (teórico) = (2σ/π·ε0)·atan(ancho/d) = ${formatValue(platesCenterField(plates.width, plates.d, plates.V), 'V/m')}`}
                </pre>
                <p className="small">
                  Achicá la separación o ensanchá las placas: el campo se acerca a V/d.
                </p>
              </>
            )}
          </Section>
        </div>
      </aside>
    </div>
  );
}

/** Línea de campo desde un punto, hacia adelante y hacia atrás. */
function traceFrom(sources: Charge[], start: Vec2, bounds: View, kernel: Kernel): Vec2[] {
  const step = (bounds.xMax - bounds.xMin) / 400;
  const run = (dir: 1 | -1) => {
    const pts: Vec2[] = [];
    let { x, y } = start;
    for (let i = 0; i < 900; i++) {
      const e = fieldAt(sources, x, y, kernel);
      const m = Math.hypot(e.x, e.y);
      if (!(m > 0)) break;
      const mx = x + ((dir * step) / 2) * (e.x / m);
      const my = y + ((dir * step) / 2) * (e.y / m);
      const e2 = fieldAt(sources, mx, my, kernel);
      const m2 = Math.hypot(e2.x, e2.y);
      if (!(m2 > 0)) break;
      const nx = x + dir * step * (e2.x / m2);
      const ny = y + dir * step * (e2.y / m2);
      // Se corta al cruzar una placa (el campo cambia de sentido de golpe).
      if (i > 2 && e.x * e2.x + e.y * e2.y < 0) break;
      x = nx;
      y = ny;
      if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) break;
      pts.push({ x, y });
    }
    return pts;
  };
  return [...run(-1).reverse(), start, ...run(1)];
}
