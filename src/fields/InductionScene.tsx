import { useCallback, useEffect, useRef, useState } from 'react';
import { formatValue } from '../engine/units';
import { Plot } from '../ui/Plot';
import { Section } from '../ui/Steps';
import { cssVar } from '../ui/theme';
import { ValueInput } from '../ui/ValueInput';
import type { Vec2 } from './electrostatics';
import { FieldCanvas, type View } from './FieldCanvas';
import { emf, flux, magnetState, peakEmfPosition, type Motion } from './induction';
import { MU0 } from './magnetostatics';

type Mode = 'pasa' | 'oscila' | 'mano';

const WORLD = 0.44;
const RANGE = 0.16;
const HISTORY = 360; // muestras que se grafican
const WINDOW = 6; // segundos de historia

interface Live {
  t: number;
  z: number;
  v: number;
  phi: number;
  emf: number;
}

export function InductionScene() {
  const [mode, setMode] = useState<Mode>('pasa');
  const [params, setParams] = useState({ m: 1, a: 0.04, turns: 200, resistance: 10 });
  const [speed, setSpeed] = useState(0.3);
  const [freq, setFreq] = useState(0.8);
  const [flipped, setFlipped] = useState(false);
  const [running, setRunning] = useState(true);
  const [live, setLive] = useState<Live>({ t: 0, z: -RANGE, v: 0, phi: 0, emf: 0 });
  const [series, setSeries] = useState(() => ({
    t: new Float64Array(0),
    phi: new Float64Array(0),
    emf: new Float64Array(0),
  }));

  // Estado de la animación fuera de React: se actualiza en cada cuadro.
  const sim = useRef({ t: 0, z: -RANGE, v: 0, lastZ: -RANGE, dragging: false });
  const hist = useRef<{ t: number; phi: number; emf: number }[]>([]);
  const cfg = useRef({ mode, params, speed, freq, flipped });
  cfg.current = { mode, params, speed, freq, flipped };

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = cfg.current;
      const s = sim.current;
      const m = c.flipped ? -c.params.m : c.params.m;
      const coil = { a: c.params.a, turns: c.params.turns, resistance: c.params.resistance };
      s.t += dt;
      if (c.mode === 'mano') {
        // La velocidad sale de cuánto se movió el imán desde el cuadro anterior (suavizada).
        const raw = dt > 0 ? (s.z - s.lastZ) / dt : 0;
        s.v = s.v * 0.6 + raw * 0.4;
        s.lastZ = s.z;
      } else {
        const motion: Motion =
          c.mode === 'pasa'
            ? { kind: 'pasa', speed: c.speed, range: RANGE }
            : { kind: 'oscila', amplitude: RANGE * 0.75, frequency: c.freq };
        const st = magnetState(motion, s.t);
        s.z = st.z;
        s.v = st.v;
      }
      const phi = coil.turns * flux(m, coil.a, s.z);
      const e = emf(m, coil, s.z, s.v);
      hist.current.push({ t: s.t, phi, emf: e });
      while (hist.current.length > 0 && hist.current[0].t < s.t - WINDOW) hist.current.shift();
      setLive({ t: s.t, z: s.z, v: s.v, phi, emf: e });
      if (frame++ % 3 === 0) {
        const h = hist.current.slice(-HISTORY * 3);
        setSeries({
          t: Float64Array.from(h, (p) => p.t),
          phi: Float64Array.from(h, (p) => p.phi),
          emf: Float64Array.from(h, (p) => p.emf),
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const current = live.emf / params.resistance;
  const emfScale =
    params.turns *
    Math.abs((3 * MU0 * params.m) / (2 * params.a * params.a)) *
    0.29 *
    Math.max(speed, 0.2);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, view: View) => {
      const ink = cssVar('--ink');
      const muted = cssVar('--muted');
      const pos = cssVar('--pos');
      const neg = cssVar('--neg');
      const coilColor = cssVar('--accent');
      const flow = cssVar('--current');
      const [cx, cy] = view.toScreen(0, 0);
      const a = params.a * view.scale;

      // Eje
      ctx.strokeStyle = muted;
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(view.width, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      const loops = 7;
      const spread = 5;
      const ellipse = (x: number, front: boolean) => {
        ctx.beginPath();
        ctx.ellipse(
          x,
          cy,
          a * 0.22,
          a,
          0,
          front ? -Math.PI / 2 : Math.PI / 2,
          front ? Math.PI / 2 : (3 * Math.PI) / 2,
        );
        ctx.stroke();
      };
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = coilColor;
      // Mitad de atrás de la bobina (queda detrás del imán)
      ctx.globalAlpha = 0.45;
      for (let k = 0; k < loops; k++) ellipse(cx + (k - (loops - 1) / 2) * spread, false);
      ctx.globalAlpha = 1;

      // Imán
      const [mx] = view.toScreen(live.z, 0);
      const mw = 0.07 * view.scale;
      const mh = Math.min(a * 0.9, 0.026 * view.scale);
      const northRight = !flipped;
      ctx.fillStyle = northRight ? neg : pos;
      ctx.fillRect(mx - mw / 2, cy - mh / 2, mw / 2, mh);
      ctx.fillStyle = northRight ? pos : neg;
      ctx.fillRect(mx, cy - mh / 2, mw / 2, mh);
      ctx.fillStyle = '#fff';
      ctx.font = "bold 13px 'JetBrains Mono', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(northRight ? 'S' : 'N', mx - mw / 4, cy + 0.5);
      ctx.fillText(northRight ? 'N' : 'S', mx + mw / 4, cy + 0.5);

      // Velocidad del imán
      if (Math.abs(live.v) > 0.01) {
        const dir = Math.sign(live.v);
        const len = Math.min(60, 18 + Math.abs(live.v) * 70);
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = 1.8;
        const y = cy - mh / 2 - 14;
        ctx.beginPath();
        ctx.moveTo(mx - (dir * len) / 2, y);
        ctx.lineTo(mx + (dir * len) / 2, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx + (dir * len) / 2 + dir * 6, y);
        ctx.lineTo(mx + (dir * len) / 2, y - 4);
        ctx.lineTo(mx + (dir * len) / 2, y + 4);
        ctx.closePath();
        ctx.fill();
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.fillText('v', mx, y - 9);
      }

      // Mitad de adelante de la bobina
      ctx.strokeStyle = coilColor;
      ctx.lineWidth = 2.4;
      for (let k = 0; k < loops; k++) ellipse(cx + (k - (loops - 1) / 2) * spread, true);

      // Corriente inducida: flecha sobre el frente de la bobina
      const strength = Math.min(1, Math.abs(live.emf) / (emfScale || 1));
      if (strength > 0.02) {
        const dir = Math.sign(live.emf); // + : sube por el frente
        ctx.strokeStyle = flow;
        ctx.fillStyle = flow;
        ctx.globalAlpha = 0.35 + 0.65 * strength;
        ctx.lineWidth = 3;
        const x = cx + ((loops - 1) / 2) * spread + a * 0.22 + 9;
        const len = a * 0.9 * (0.4 + 0.6 * strength);
        ctx.beginPath();
        ctx.moveTo(x, cy + (dir * len) / 2);
        ctx.lineTo(x, cy - (dir * len) / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, cy - (dir * len) / 2 - dir * 8);
        ctx.lineTo(x - 5, cy - (dir * len) / 2);
        ctx.lineTo(x + 5, cy - (dir * len) / 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.textAlign = 'left';
        ctx.fillText('I inducida', x + 9, cy - 14);
      }

      // Galvanómetro
      const gx = cx;
      const gy = Math.min(view.height - 26, cy + a + 62);
      ctx.strokeStyle = coilColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy + a);
      ctx.lineTo(cx - 12, gy);
      ctx.lineTo(gx - 26, gy);
      ctx.moveTo(cx + 12, cy + a);
      ctx.lineTo(cx + 12, gy);
      ctx.lineTo(gx + 26, gy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gx, gy, 24, 0, 2 * Math.PI);
      ctx.fillStyle = cssVar('--canvas');
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      const ang = (Math.max(-1, Math.min(1, live.emf / (emfScale || 1))) * Math.PI) / 3;
      ctx.strokeStyle = flow;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(gx, gy + 12);
      ctx.lineTo(gx + Math.sin(ang) * 26, gy + 12 - Math.cos(ang) * 26);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = 'center';
      ctx.fillText('−   0   +', gx, gy - 12);
    },
    [live, params.a, flipped, emfScale],
  );

  const onPointer = (p: Vec2) => {
    if (mode !== 'mano') return;
    sim.current.z = Math.max(-RANGE * 1.2, Math.min(RANGE * 1.2, p.x));
  };

  const fluxChange = live.z * live.v < 0 ? 'aumenta' : 'disminuye';
  const lenz =
    Math.abs(live.emf) < emfScale * 0.02
      ? 'El flujo casi no cambia: no hay fem inducida. Un imán quieto no induce nada, por más fuerte que sea.'
      : `El imán ${live.z * live.v < 0 ? 'se acerca' : 'se aleja'}: el flujo ${fluxChange}. La corriente inducida crea un campo que ${fluxChange === 'aumenta' ? 'se opone al imán (lo repele)' : 'intenta sostener el flujo (lo atrae)'}. Eso es la ley de Lenz: el signo menos de Faraday.`;

  return (
    <div className="fields-layout">
      <div className="field-stage induction">
        <div className="induction-canvas">
          <FieldCanvas
            worldWidth={WORLD}
            draw={draw}
            ariaLabel="Imán moviéndose a través de una bobina conectada a un galvanómetro"
            cursor={mode === 'mano' ? 'grab' : 'default'}
            onDown={onPointer}
            onMove={(p, _v, dragging) => dragging && onPointer(p)}
          />
        </div>
        <div className="induction-plots">
          <div>
            <h4 className="plot-title">Flujo concatenado N·Φ(t)</h4>
            <Plot
              x={series.t}
              series={[{ label: 'N·Φ', data: series.phi, color: 1 }]}
              xUnit="s"
              yUnit="Wb"
              height={150}
              ariaLabel="Flujo magnético en función del tiempo"
            />
          </div>
          <div>
            <h4 className="plot-title">fem inducida ε(t) = −N·dΦ/dt</h4>
            <Plot
              x={series.t}
              series={[{ label: 'ε', data: series.emf, color: 0 }]}
              xUnit="s"
              yUnit="V"
              height={150}
              ariaLabel="Fuerza electromotriz inducida en función del tiempo"
            />
          </div>
        </div>
      </div>

      <aside className="panel fields-panel" aria-label="Controles de inducción">
        <div className="panel-body">
          <Section title="Movimiento del imán">
            <div className="segmented" role="tablist" aria-label="Tipo de movimiento">
              {(
                [
                  ['pasa', 'Ida y vuelta'],
                  ['oscila', 'Oscila'],
                  ['mano', 'A mano'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  className={mode === key ? 'active' : ''}
                  onClick={() => {
                    sim.current.lastZ = sim.current.z;
                    setMode(key);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === 'pasa' && (
              <div className="field slider">
                <label htmlFor="ind-v">Velocidad: {formatValue(speed, 'm/s')}</label>
                <input
                  id="ind-v"
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                />
              </div>
            )}
            {mode === 'oscila' && (
              <div className="field slider">
                <label htmlFor="ind-f">Frecuencia: {formatValue(freq, 'Hz')}</label>
                <input
                  id="ind-f"
                  type="range"
                  min={0.2}
                  max={2.5}
                  step={0.1}
                  value={freq}
                  onChange={(e) => setFreq(Number(e.target.value))}
                />
              </div>
            )}
            {mode === 'mano' && (
              <p className="muted small">
                Arrastrá el imán sobre el dibujo. Cuanto más rápido lo muevas, mayor es la fem.
              </p>
            )}
            <div className="btn-row wrap">
              <button type="button" className="btn" onClick={() => setRunning(!running)}>
                {running ? 'Pausar' : 'Continuar'}
              </button>
              <button type="button" className="btn" onClick={() => setFlipped(!flipped)}>
                Invertir polos
              </button>
            </div>
          </Section>

          <Section title="Bobina e imán">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="ind-n">Espiras N</label>
                <ValueInput
                  id="ind-n"
                  value={params.turns}
                  unit=""
                  positive
                  onChange={(v) => setParams({ ...params, turns: Math.max(1, Math.round(v)) })}
                />
              </div>
              <div className="field">
                <label htmlFor="ind-a">Radio a</label>
                <ValueInput
                  id="ind-a"
                  value={params.a}
                  unit="m"
                  positive
                  onChange={(v) => setParams({ ...params, a: Math.min(0.09, Math.max(0.015, v)) })}
                />
              </div>
              <div className="field">
                <label htmlFor="ind-m">Momento del imán</label>
                <ValueInput
                  id="ind-m"
                  value={params.m}
                  unit="A·m²"
                  positive
                  onChange={(v) => setParams({ ...params, m: v })}
                />
              </div>
              <div className="field">
                <label htmlFor="ind-r">Resistencia</label>
                <ValueInput
                  id="ind-r"
                  value={params.resistance}
                  unit="Ω"
                  positive
                  onChange={(v) => setParams({ ...params, resistance: v })}
                />
              </div>
            </div>
          </Section>

          <Section title="Valores instantáneos">
            <dl className="kv">
              <dt>Posición z</dt>
              <dd>{formatValue(live.z, 'm')}</dd>
              <dt>Velocidad v</dt>
              <dd>{formatValue(Math.abs(live.v) < 1e-4 ? 0 : live.v, 'm/s')}</dd>
              <dt>Flujo N·Φ</dt>
              <dd>{formatValue(live.phi, 'Wb')}</dd>
              <dt>fem ε</dt>
              <dd>{formatValue(Math.abs(live.emf) < 1e-9 ? 0 : live.emf, 'V')}</dd>
              <dt>Corriente ε/R</dt>
              <dd>{formatValue(Math.abs(current) < 1e-10 ? 0 : current, 'A')}</dd>
            </dl>
            <p className="small">{lenz}</p>
          </Section>

          <Section title="Qué se está calculando">
            <p className="small">
              Ley de Faraday-Lenz: la fem es la rapidez con que cambia el flujo.
            </p>
            <pre className="formula">{'ε = −N · dΦ/dt = −N · (dΦ/dz) · v'}</pre>
            <p className="small">
              El imán se modela como un dipolo de momento m sobre el eje de la bobina. Su flujo a
              través de una espira de radio a, a distancia z:
            </p>
            <pre className="formula">
              {`Φ(z) = μ0·m·a² / (2·(a² + z²)^(3/2))\nΦ máx (z = 0) = μ0·m / (2a) = ${formatValue(flux(params.m, params.a, 0), 'Wb')} por espira`}
            </pre>
            <p className="small">
              El flujo es máximo con el imán en el centro, pero ahí la fem es cero: lo que cuenta es
              el cambio. La fem es máxima cuando el imán está a a/2 ={' '}
              {formatValue(peakEmfPosition(params.a), 'm')} del centro, y cambia de signo al
              atravesarlo.
            </p>
          </Section>
        </div>
      </aside>
    </div>
  );
}
