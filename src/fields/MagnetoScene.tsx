import { useCallback, useMemo, useRef, useState } from 'react';
import { formatNumber, formatValue } from '../engine/units';
import { Section } from '../ui/Steps';
import { cssVar } from '../ui/theme';
import { ValueInput } from '../ui/ValueInput';
import type { Vec2 } from './electrostatics';
import { drawArrow, drawPolyline, FieldCanvas, logAlpha, makeView, type View } from './FieldCanvas';
import {
  biotSavart,
  idealSolenoidB,
  infiniteWireB,
  interpolate,
  loop,
  loopAxisB,
  MU0,
  sampleGrid,
  solenoid,
  streamline,
  wiresField,
  type FieldGrid,
  type WireOut,
} from './magnetostatics';

type Mode = 'cables' | 'espira' | 'solenoide';

interface Wire extends WireOut {
  id: number;
}

const WORLD = 0.4; // ancho visible: 40 cm
/** Alto máximo que se muestrea (cubre cualquier proporción razonable de pantalla). */
const HALF_H = 0.22;

let nextId = 1;

export function MagnetoScene() {
  const [mode, setMode] = useState<Mode>('cables');
  const [wires, setWires] = useState<Wire[]>([
    { id: nextId++, x: -0.06, y: 0, i: 5 },
    { id: nextId++, x: 0.06, y: 0, i: -5 },
  ]);
  const [selected, setSelected] = useState<number | null>(null);
  const [coil, setCoil] = useState({ I: 2, R: 0.05, length: 0.2, turns: 12 });
  const [show, setShow] = useState({ vectors: true, lines: true });
  const [probe, setProbe] = useState<Vec2 | null>(null);
  const dragId = useRef<number | null>(null);

  const turns = mode === 'espira' ? 1 : coil.turns;
  const segments = useMemo(
    () => (mode === 'espira' ? loop(coil.R, 0, 96) : solenoid(coil.R, coil.length, coil.turns, 48)),
    [mode, coil.R, coil.length, coil.turns],
  );

  /** Campo en el plano de la pantalla, muestreado una vez por configuración. */
  const grid: FieldGrid = useMemo(() => {
    const field =
      mode === 'cables'
        ? (x: number, y: number) => wiresField(wires, x, y)
        : (x: number, y: number) => {
            const b = biotSavart(segments, coil.I, { x, y, z: 0 });
            return { x: b.x, y: b.y };
          };
    return sampleGrid(field, -WORLD / 2, WORLD / 2, -HALF_H, HALF_H, 101, 111);
  }, [mode, wires, segments, coil.I]);

  /** Posiciones donde el bobinado corta el plano del dibujo. */
  const turnsX = useMemo(
    () =>
      mode === 'espira'
        ? [0]
        : Array.from({ length: coil.turns }, (_, t) =>
            coil.turns === 1 ? 0 : -coil.length / 2 + (coil.length * t) / (coil.turns - 1),
          ),
    [mode, coil.turns, coil.length],
  );

  const seeds = useMemo((): Vec2[] => {
    if (mode === 'cables') {
      return wires.flatMap((w) =>
        [0.012, 0.025, 0.045, 0.075, 0.115].map((r) => ({ x: w.x + r, y: w.y })),
      );
    }
    const out: Vec2[] = [];
    for (let k = -4; k <= 4; k++) out.push({ x: 0, y: (coil.R * k) / 5 });
    return out;
  }, [mode, wires, coil.R]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, view: View) => {
      const ink = cssVar('--ink');
      const accent = cssVar('--accent');
      const canvas = cssVar('--canvas');
      const pos = cssVar('--pos');
      const neg = cssVar('--neg');

      if (show.lines) {
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.7;
        for (const s of seeds) drawPolyline(ctx, view, streamline(grid, s, WORLD / 500, 2600));
        ctx.globalAlpha = 1;
      }

      if (show.vectors) {
        const spacing = 34;
        const ref =
          mode === 'cables'
            ? infiniteWireB(Math.max(...wires.map((w) => Math.abs(w.i)), 1e-9), 0.03)
            : (MU0 * Math.abs(coil.I) * turns) / Math.max(coil.length, 2 * coil.R) || 1e-9;
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        ctx.lineWidth = 1.3;
        for (let py = spacing / 2; py < view.height; py += spacing) {
          for (let px = spacing / 2; px < view.width; px += spacing) {
            const p = view.toWorld(px, py);
            const b = interpolate(grid, p.x, p.y);
            const m = Math.hypot(b.x, b.y);
            if (!(m > 0)) continue;
            ctx.globalAlpha = logAlpha(m, ref / 60, ref * 2);
            drawArrow(ctx, px, py, b.x / m, -b.y / m, 15);
          }
        }
        ctx.globalAlpha = 1;
      }

      /** Corte de un conductor: ⊙ si la corriente sale de la pantalla, ⊗ si entra. */
      const conductor = (x: number, y: number, out: boolean, r: number, ring = false) => {
        const [px, py] = view.toScreen(x, y);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 2 * Math.PI);
        ctx.fillStyle = canvas;
        ctx.fill();
        ctx.lineWidth = ring ? 3 : 2;
        ctx.strokeStyle = out ? pos : neg;
        ctx.stroke();
        ctx.fillStyle = out ? pos : neg;
        if (out) {
          ctx.beginPath();
          ctx.arc(px, py, r * 0.3, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          const d = r * 0.5;
          ctx.beginPath();
          ctx.moveTo(px - d, py - d);
          ctx.lineTo(px + d, py + d);
          ctx.moveTo(px + d, py - d);
          ctx.lineTo(px - d, py + d);
          ctx.stroke();
        }
      };

      if (mode === 'cables') {
        for (const w of wires) conductor(w.x, w.y, w.i >= 0, 11, w.id === selected);
      } else {
        const r = Math.max(
          3.5,
          Math.min(8, (view.scale * coil.length) / Math.max(turnsX.length, 1) / 2.4),
        );
        for (const x of turnsX) {
          conductor(x, coil.R, coil.I >= 0, mode === 'espira' ? 8 : r);
          conductor(x, -coil.R, coil.I < 0, mode === 'espira' ? 8 : r);
        }
      }

      if (probe) {
        const [px, py] = view.toScreen(probe.x, probe.y);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 2 * Math.PI);
        ctx.stroke();
      }
    },
    [grid, seeds, show, mode, wires, coil, turns, turnsX, selected, probe],
  );

  const sel = wires.find((w) => w.id === selected) ?? null;
  const update = (id: number, patch: Partial<WireOut>) =>
    setWires((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const add = (i: number) => {
    const w: Wire = {
      id: nextId++,
      x: (Math.random() - 0.5) * 0.16,
      y: (Math.random() - 0.5) * 0.12,
      i,
    };
    setWires((ws) => [...ws, w]);
    setSelected(w.id);
  };

  const probeB = probe ? interpolate(grid, probe.x, probe.y) : null;
  const centerB = mode === 'cables' ? 0 : biotSavart(segments, coil.I, { x: 0, y: 0, z: 0 }).x;
  // Vista de referencia solo para saber si el cursor cae sobre un cable.
  const refView = makeView(600, 400, WORLD);

  return (
    <div className="fields-layout">
      <div className="field-stage">
        <FieldCanvas
          worldWidth={WORLD}
          draw={draw}
          ariaLabel="Campo magnético en el plano: vectores y líneas de campo"
          onDown={(p, view) => {
            if (mode !== 'cables') return;
            const w = wires.find((k) => Math.hypot(k.x - p.x, k.y - p.y) * view.scale < 16);
            dragId.current = w?.id ?? null;
            setSelected(w?.id ?? null);
          }}
          onMove={(p, _v, dragging) => {
            setProbe(p);
            if (dragging && dragId.current !== null) {
              update(dragId.current, {
                x: Math.max(refView.xMin, Math.min(refView.xMax, p.x)),
                y: Math.max(-HALF_H, Math.min(HALF_H, p.y)),
              });
            }
          }}
          onUp={() => (dragId.current = null)}
          onLeave={() => setProbe(null)}
        />
        <div className="field-legend">
          <span className="lg lg-vec">vectores B</span>
          <span className="lg lg-line">líneas de campo</span>
          <span className="lg lg-out">⊙ sale</span>
          <span className="lg lg-in">⊗ entra</span>
        </div>
      </div>

      <aside className="panel fields-panel" aria-label="Controles de magnetostática">
        <div className="panel-body">
          <Section title="Escena">
            <div className="segmented" role="tablist" aria-label="Tipo de conductor">
              {(
                [
                  ['cables', 'Cable recto'],
                  ['espira', 'Espira'],
                  ['solenoide', 'Solenoide'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  className={mode === key ? 'active' : ''}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="toggles">
              <label>
                <input
                  type="checkbox"
                  checked={show.vectors}
                  onChange={(e) => setShow({ ...show, vectors: e.target.checked })}
                />
                Vectores
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={show.lines}
                  onChange={(e) => setShow({ ...show, lines: e.target.checked })}
                />
                Líneas de campo
              </label>
            </div>
          </Section>

          {mode === 'cables' ? (
            <Section title="Cables">
              <p className="muted small">
                Cada cable es recto, muy largo y perpendicular a la pantalla: se ve su corte.
              </p>
              <div className="btn-row wrap">
                <button type="button" className="btn" onClick={() => add(5)}>
                  + Saliente ⊙
                </button>
                <button type="button" className="btn" onClick={() => add(-5)}>
                  + Entrante ⊗
                </button>
                {sel && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      setWires((ws) => ws.filter((w) => w.id !== sel.id));
                      setSelected(null);
                    }}
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="chips" role="group" aria-label="Elegir un cable">
                {wires.map((w, k) => (
                  <button
                    key={w.id}
                    type="button"
                    className={`chip-btn ${w.id === selected ? 'on' : ''}`}
                    aria-pressed={w.id === selected}
                    onClick={() => setSelected(w.id)}
                    style={{ ['--chip' as string]: w.i >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                  >
                    I{k + 1} {formatValue(w.i, 'A')}
                  </button>
                ))}
              </div>
              {sel && (
                <div className="grid-3">
                  <div className="field">
                    <label htmlFor="w-i">Corriente</label>
                    <ValueInput
                      id="w-i"
                      value={sel.i}
                      unit="A"
                      onChange={(i) => update(sel.id, { i })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="w-x">x</label>
                    <ValueInput
                      id="w-x"
                      value={sel.x}
                      unit="m"
                      onChange={(x) => update(sel.id, { x })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="w-y">y</label>
                    <ValueInput
                      id="w-y"
                      value={sel.y}
                      unit="m"
                      onChange={(y) => update(sel.id, { y })}
                    />
                  </div>
                </div>
              )}
            </Section>
          ) : (
            <Section title={mode === 'espira' ? 'Espira' : 'Solenoide'}>
              <p className="muted small">
                Se ve un corte por el eje: arriba la corriente sale de la pantalla y abajo entra.
              </p>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="c-i">Corriente</label>
                  <ValueInput
                    id="c-i"
                    value={coil.I}
                    unit="A"
                    onChange={(I) => setCoil({ ...coil, I })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-r">Radio</label>
                  <ValueInput
                    id="c-r"
                    value={coil.R}
                    unit="m"
                    positive
                    onChange={(R) => setCoil({ ...coil, R: Math.min(0.15, Math.max(0.01, R)) })}
                  />
                </div>
                {mode === 'solenoide' && (
                  <>
                    <div className="field">
                      <label htmlFor="c-l">Largo</label>
                      <ValueInput
                        id="c-l"
                        value={coil.length}
                        unit="m"
                        positive
                        onChange={(length) =>
                          setCoil({ ...coil, length: Math.min(0.36, Math.max(0.02, length)) })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="c-n">Espiras: {coil.turns}</label>
                      <input
                        id="c-n"
                        type="range"
                        min={2}
                        max={40}
                        value={coil.turns}
                        onChange={(e) => setCoil({ ...coil, turns: Number(e.target.value) })}
                      />
                    </div>
                  </>
                )}
              </div>
            </Section>
          )}

          <Section title="Medición">
            {probe && probeB ? (
              <dl className="kv">
                <dt>Punto</dt>
                <dd>
                  ({formatNumber(probe.x * 100, 3)}; {formatNumber(probe.y * 100, 3)}) cm
                </dd>
                <dt>|B|</dt>
                <dd>{formatValue(Math.hypot(probeB.x, probeB.y), 'T')}</dd>
                <dt>Dirección</dt>
                <dd>{formatNumber((Math.atan2(probeB.y, probeB.x) * 180) / Math.PI, 3)}°</dd>
              </dl>
            ) : (
              <p className="muted small">Pasá el cursor por el dibujo para medir B en un punto.</p>
            )}
          </Section>

          <Section title="Qué se está calculando">
            <p className="small">
              Ley de Biot-Savart: cada tramito de conductor aporta un campo perpendicular al tramo y
              a la línea que lo une con el punto.
            </p>
            <pre className="formula">{'dB = (μ0·I / 4π) · dl × r / r³\nμ0 = 4π·10^-7 T·m/A'}</pre>
            {mode === 'cables' && (
              <>
                <p className="small">
                  Integrando sobre un cable recto infinito queda un campo que gira alrededor del
                  cable (regla de la mano derecha) y decae con la distancia:
                </p>
                <pre className="formula">
                  {`B = μ0·I / (2π·r)\n${wires
                    .map(
                      (w, k) =>
                        `I${k + 1} = ${formatValue(w.i, 'A')}  →  B a 5 cm = ${formatValue(infiniteWireB(Math.abs(w.i), 0.05), 'T')}`,
                    )
                    .join('\n')}`}
                </pre>
                <p className="small">Con varios cables, los campos se suman como vectores.</p>
              </>
            )}
            {mode === 'espira' && (
              <>
                <p className="small">
                  La espira se parte en 96 tramos rectos y se suman sus aportes. En el centro hay
                  fórmula cerrada para comparar:
                </p>
                <pre className="formula">
                  {`B centro (teórico) = μ0·I / (2R) = ${formatValue(loopAxisB(coil.I, coil.R, 0), 'T')}\nB centro (numérico) = ${formatValue(centerB, 'T')}`}
                </pre>
              </>
            )}
            {mode === 'solenoide' && (
              <>
                <p className="small">
                  {coil.turns} espiras × 48 tramos cada una. Un solenoide ideal (muy largo) tiene
                  campo uniforme adentro y casi nulo afuera:
                </p>
                <pre className="formula">
                  {`B ideal = μ0·N·I / L = ${formatValue(idealSolenoidB(coil.I, coil.turns, coil.length), 'T')}\nB centro (numérico) = ${formatValue(centerB, 'T')}`}
                </pre>
                <p className="small">
                  Cuanto más largo respecto del radio, más se parece el valor numérico al ideal.
                  Probá cambiar el largo y el radio.
                </p>
              </>
            )}
          </Section>
        </div>
      </aside>
    </div>
  );
}
