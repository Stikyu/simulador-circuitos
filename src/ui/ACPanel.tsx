import { useMemo, useState } from 'react';
import { analyzeResponse, sweepAC, type ACSolution, type ResponseAnalysis } from '../engine/ac';
import { abs } from '../engine/complex';
import { formatNumber, formatResult, formatValue } from '../engine/units';
import { explainAC, polar } from '../explain/ac';
import { classifyTransient } from '../explain/transient';
import { PhasorDiagram, PowerTriangle, type Phasor } from './acFigures';
import { attempt } from './outcome';
import { Plot, type PlotMarker } from './Plot';
import { Section, Steps } from './Steps';
import { ValueInput } from './ValueInput';

interface ACPanelProps {
  sol: ACSolution;
  selection: string[];
  /** Cambia la frecuencia de todas las fuentes senoidales. */
  onFrequency: (f: number) => void;
}

const KIND_LABEL: Record<ResponseAnalysis['kind'], string> = {
  'pasa-bajos': 'Filtro pasa bajos',
  'pasa-altos': 'Filtro pasa altos',
  'pasa-banda': 'Filtro pasa banda',
  'elimina-banda': 'Filtro elimina banda',
  plana: 'Respuesta plana',
  otro: 'Respuesta sin clasificar',
};

const hz = (f: number) => formatValue(f, 'Hz', 4);

export function ACPanel({ sol, selection, onFrequency }: ACPanelProps) {
  const nl = sol.netlist;
  const explanation = useMemo(() => explainAC(sol), [sol]);
  const candidates = sol.elements.filter((e) => e.type !== 'vac' && e.type !== 'ammeter');

  // --- Diagrama fasorial ---------------------------------------------------------
  const [picked, setPicked] = useState<string[] | null>(null);
  const ids = useMemo(() => {
    const valid = new Set(sol.elements.map((e) => e.id));
    const base =
      picked ??
      sol.elements
        .filter((e) => ['vac', 'resistor', 'capacitor', 'inductor'].includes(e.type))
        .slice(0, 4)
        .map((e) => e.id);
    const out = base.filter((id) => valid.has(id));
    for (const id of selection) if (valid.has(id) && !out.includes(id)) out.push(id);
    return out;
  }, [picked, selection, sol.elements]);
  const colorOf = (id: string) => sol.elements.findIndex((e) => e.id === id);
  const phasors: Phasor[] = ids.flatMap((id) => {
    const e = sol.byId.get(id)!;
    const color = colorOf(id);
    const out: Phasor[] = [{ label: `V(${id})`, z: e.voltage, kind: 'v', color }];
    // La corriente se dibuja una sola vez por fuente y para los pasivos.
    if (e.type === 'vac' && sol.source) {
      out.push({ label: 'I', z: sol.source.current, kind: 'i', color });
    } else if (e.type !== 'vac' && e.type !== 'voltmeter') {
      out.push({ label: `I(${id})`, z: e.current, kind: 'i', color });
    }
    return out;
  });

  // --- Bode ------------------------------------------------------------------------
  const model = useMemo(() => classifyTransient(nl), [nl]);
  const [outputPick, setOutputPick] = useState<string | null>(null);
  const defaultOutput =
    candidates.find((e) => e.type === 'voltmeter')?.id ??
    (model.w0 ? candidates.find((e) => e.type === 'resistor')?.id : undefined) ??
    candidates.find((e) => e.type === 'capacitor')?.id ??
    candidates[candidates.length - 1]?.id ??
    '';
  const outputId = candidates.some((e) => e.id === outputPick) ? outputPick! : defaultOutput;
  const [auto, setAuto] = useState(true);
  const [range, setRange] = useState({ fStart: 10, fStop: 100e3 });
  const autoRange = useMemo(() => {
    const fChar = model.tau
      ? 1 / (2 * Math.PI * model.tau)
      : model.w0
        ? model.w0 / (2 * Math.PI)
        : sol.freq;
    const center = Number.isFinite(fChar) && fChar > 0 ? fChar : sol.freq;
    return {
      fStart: 10 ** Math.floor(Math.log10(center) - 1.6),
      fStop: 10 ** Math.ceil(Math.log10(center) + 1.6),
    };
  }, [model, sol.freq]);
  const { fStart, fStop } = auto ? autoRange : range;
  const sweep = useMemo(
    () =>
      outputId
        ? attempt(() => {
            const s = sweepAC(nl, { outputId, fStart, fStop, points: 700 });
            return { s, a: analyzeResponse(s) };
          })
        : null,
    [nl, outputId, fStart, fStop],
  );

  const markers: PlotMarker[] = [];
  let target: number | undefined;
  if (sweep?.ok) {
    const a = sweep.value.a;
    if (a.fc) markers.push({ x: a.fc, label: 'fc' });
    if (a.f0) markers.push({ x: a.f0, label: 'f0' });
    if (a.fLow) markers.push({ x: a.fLow, label: 'f1' });
    if (a.fHigh) markers.push({ x: a.fHigh, label: 'f2' });
    target = model.w0 ? model.w0 / (2 * Math.PI) : (a.f0 ?? a.fc);
  }

  const src = sol.source;

  return (
    <>
      <Section title="Fuente y frecuencia">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="ac-freq">Frecuencia</label>
            <ValueInput id="ac-freq" value={sol.freq} unit="Hz" positive onChange={onFrequency} />
          </div>
          <dl className="kv compact">
            <dt>ω</dt>
            <dd>{formatNumber(sol.omega, 4)} rad/s</dd>
            <dt>T</dt>
            <dd>{formatValue(1 / sol.freq, 's')}</dd>
          </dl>
        </div>
        {target && Math.abs(target / sol.freq - 1) > 0.005 && (
          <button type="button" className="btn small-btn" onClick={() => onFrequency(target!)}>
            Llevar la fuente a {model.w0 || (sweep?.ok && sweep.value.a.f0) ? 'f0' : 'fc'} ={' '}
            {hz(target)}
          </button>
        )}
      </Section>

      <Section title="Fasores e impedancias">
        <div className="table-wrap">
          <table className="results">
            <thead>
              <tr>
                <th scope="col">Comp.</th>
                <th scope="col">Z</th>
                <th scope="col">V (pico)</th>
                <th scope="col">I (pico)</th>
              </tr>
            </thead>
            <tbody>
              {sol.elements.map((e) => (
                <tr key={e.id} className={selection.includes(e.id) ? 'row-selected' : ''}>
                  <th scope="row">{e.id}</th>
                  <td>{e.type === 'vac' || !e.impedance ? '—' : polar(e.impedance, 'Ω')}</td>
                  <td>{polar(e.voltage, 'V')}</td>
                  <td>{abs(e.current) < 1e-15 ? '0 A' : polar(e.current, 'A')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {src?.impedance && (
          <p className="small">
            Impedancia total vista por {src.id}: <b className="mono">{polar(src.impedance, 'Ω')}</b>
          </p>
        )}
        <div className="chips" role="group" aria-label="Fasores a dibujar">
          {sol.elements.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`chip-btn ${ids.includes(e.id) ? 'on' : ''}`}
              aria-pressed={ids.includes(e.id)}
              onClick={() =>
                setPicked(ids.includes(e.id) ? ids.filter((x) => x !== e.id) : [...ids, e.id])
              }
              style={{ ['--chip' as string]: `var(--s${(colorOf(e.id) % 6) + 1})` }}
            >
              {e.id}
            </button>
          ))}
        </div>
        <PhasorDiagram phasors={phasors} />
      </Section>

      {src && (
        <Section title="Potencias">
          <dl className="kv">
            <dt>P (activa)</dt>
            <dd>{formatValue(src.power.re, 'W')}</dd>
            <dt>Q (reactiva)</dt>
            <dd>{formatResult(src.power.im, 'var', abs(src.power) * 1e-4)}</dd>
            <dt>S (aparente)</dt>
            <dd>{formatValue(abs(src.power), 'VA')}</dd>
            <dt>Factor de potencia</dt>
            <dd>
              {formatNumber(src.powerFactor, 3)} <span className="tag tag-in">{src.character}</span>
            </dd>
          </dl>
          <PowerTriangle
            p={src.power.re}
            q={Math.abs(src.power.im) < abs(src.power) * 1e-4 ? 0 : src.power.im}
          />
        </Section>
      )}

      <Section title="Respuesta en frecuencia (Bode)">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="bode-out">Salida: tensión sobre</label>
            <select
              id="bode-out"
              className="select"
              value={outputId}
              onChange={(e) => setOutputPick(e.target.value)}
            >
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setRange(autoRange);
                setAuto(e.target.checked);
              }}
            />
            Rango automático
          </label>
          {!auto && (
            <>
              <div className="field">
                <label htmlFor="bode-f1">Desde</label>
                <ValueInput
                  id="bode-f1"
                  value={range.fStart}
                  unit="Hz"
                  positive
                  onChange={(v) => setRange({ ...range, fStart: v })}
                />
              </div>
              <div className="field">
                <label htmlFor="bode-f2">Hasta</label>
                <ValueInput
                  id="bode-f2"
                  value={range.fStop}
                  unit="Hz"
                  positive
                  onChange={(v) => setRange({ ...range, fStop: v })}
                />
              </div>
            </>
          )}
        </div>

        {sweep && !sweep.ok && <p className="muted small">{sweep.error.message}</p>}
        {sweep?.ok && (
          <>
            <ResponseSummary a={sweep.value.a} tau={model.tau} w0={model.w0} />
            <h4 className="plot-title">
              Módulo |V({outputId}) / V({sweep.value.s.inputId})|
            </h4>
            <Plot
              x={sweep.value.s.freqs}
              series={[{ label: '|H|', data: sweep.value.s.magDb, color: 0 }]}
              xUnit="Hz"
              yUnit="dB"
              yFormat={(v) => `${formatNumber(v, 3)} dB`}
              logX
              markers={markers}
              cursor={sol.freq}
              height={190}
              ariaLabel="Diagrama de Bode: módulo en decibeles"
            />
            <h4 className="plot-title">Fase</h4>
            <Plot
              x={sweep.value.s.freqs}
              series={[{ label: 'fase', data: sweep.value.s.phaseDeg, color: 1 }]}
              xUnit="Hz"
              yUnit="°"
              yFormat={(v) => `${formatNumber(v, 3)}°`}
              logX
              markers={markers}
              cursor={sol.freq}
              height={170}
              ariaLabel="Diagrama de Bode: fase en grados"
            />
            <p className="muted small">
              La línea vertical llena marca la frecuencia actual de la fuente ({hz(sol.freq)}).
            </p>
          </>
        )}
      </Section>

      <Section title="Paso a paso">
        <Steps explanation={explanation} />
      </Section>
    </>
  );
}

function ResponseSummary({ a, tau, w0 }: { a: ResponseAnalysis; tau?: number; w0?: number }) {
  return (
    <div className="response">
      <span className="chip">{KIND_LABEL[a.kind]}</span>
      <dl className="kv">
        {a.fc !== undefined && (
          <>
            <dt>Frecuencia de corte (−3 dB)</dt>
            <dd>{hz(a.fc)}</dd>
          </>
        )}
        {a.f0 !== undefined && (
          <>
            <dt>
              {a.kind === 'elimina-banda' ? 'Frecuencia rechazada' : 'Frecuencia de resonancia'}
            </dt>
            <dd>{hz(a.f0)}</dd>
          </>
        )}
        {a.bandwidth !== undefined && (
          <>
            <dt>Ancho de banda</dt>
            <dd>
              {hz(a.bandwidth)} ({hz(a.fLow!)} – {hz(a.fHigh!)})
            </dd>
            <dt>Factor de calidad Q</dt>
            <dd>{formatNumber(a.q!, 3)}</dd>
          </>
        )}
        <dt>Ganancia máxima</dt>
        <dd>
          {formatNumber(a.peak, 3)} ({formatNumber(a.peakDb, 3)} dB)
        </dd>
        {tau !== undefined && (
          <>
            <dt>Teórica: 1/(2πτ)</dt>
            <dd>{hz(1 / (2 * Math.PI * tau))}</dd>
          </>
        )}
        {w0 !== undefined && (
          <>
            <dt>Teórica: ω0/2π</dt>
            <dd>{hz(w0 / (2 * Math.PI))}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
