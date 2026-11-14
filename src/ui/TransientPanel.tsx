import { useEffect, useMemo, useRef, useState } from 'react';
import type { TransientResult } from '../engine/transient';
import { formatResult, formatValue } from '../engine/units';
import { explainTransient, type TransientModel } from '../explain/transient';
import { Plot, type PlotSeries } from './Plot';
import { Section, Steps } from './Steps';
import type { TransientSettings } from './useAnalysis';
import { ValueInput } from './ValueInput';

interface TransientPanelProps {
  result: TransientResult;
  model: TransientModel;
  settings: TransientSettings;
  onSettings: (s: TransientSettings) => void;
  times: { tStop: number; dt: number };
  selection: string[];
  cursorFrac: number;
  onCursor: (frac: number) => void;
}

const PLAY_SECONDS = 7;

export function TransientPanel({
  result,
  model,
  settings,
  onSettings,
  times,
  selection,
  cursorFrac,
  onCursor,
}: TransientPanelProps) {
  const elements = result.netlist.elements;
  const [picked, setPicked] = useState<string[] | null>(null);
  const [compare, setCompare] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Señales por defecto: capacitores y bobinas; si no hay, las primeras resistencias.
  const defaults = useMemo(() => {
    const reactive = elements.filter((e) => e.type === 'capacitor' || e.type === 'inductor');
    const base = reactive.length > 0 ? reactive : elements.filter((e) => e.type === 'resistor');
    return base.slice(0, 3).map((e) => e.id);
  }, [elements]);
  const ids = useMemo(() => {
    const valid = new Set(elements.map((e) => e.id));
    const chosen = (picked ?? defaults).filter((id) => valid.has(id));
    // Lo que está seleccionado en el circuito se grafica siempre.
    for (const id of selection) if (valid.has(id) && !chosen.includes(id)) chosen.push(id);
    return chosen;
  }, [picked, defaults, selection, elements]);

  const toggle = (id: string) =>
    setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const { explanation, markers, analytic } = useMemo(
    () => explainTransient(result.netlist, model, result),
    [result, model],
  );

  const colorOf = (id: string) => elements.findIndex((e) => e.id === id);
  const analyticData = useMemo(
    () => (analytic && compare ? Float64Array.from(result.time, analytic.fn) : null),
    [analytic, compare, result.time],
  );
  const seriesFor = (quantity: 'v' | 'i'): PlotSeries[] => {
    const src = quantity === 'v' ? result.voltages : result.currents;
    const out: PlotSeries[] = ids.map((id) => ({
      label: `${quantity}(${id})`,
      data: src.get(id)!,
      color: colorOf(id),
    }));
    if (analyticData && analytic && analytic.quantity === quantity) {
      out.push({
        label: `${quantity}(${analytic.id}) analítica`,
        data: analyticData,
        dashed: true,
        color: 5,
      });
    }
    return out;
  };
  const vSeries = seriesFor('v');
  const iSeries = seriesFor('i');

  // Reproducción: recorre el tiempo de punta a punta.
  const frac = useRef(cursorFrac);
  frac.current = cursorFrac;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = frac.current + (now - last) / 1000 / PLAY_SECONDS;
      last = now;
      if (next >= 1) {
        onCursor(1);
        setPlaying(false);
        return;
      }
      onCursor(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onCursor]);

  const n = result.time.length;
  const k = Math.round(cursorFrac * (n - 1));
  const tNow = result.time[k];

  return (
    <>
      <Section title="Simulación">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.auto}
            onChange={(e) => onSettings({ ...settings, ...times, auto: e.target.checked })}
          />
          Elegir duración y paso automáticamente
        </label>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="tran-tstop">Duración</label>
            {settings.auto ? (
              <output id="tran-tstop" className="value-input readonly">
                {formatValue(times.tStop, 's')}
              </output>
            ) : (
              <ValueInput
                id="tran-tstop"
                value={settings.tStop}
                unit="s"
                positive
                onChange={(v) => onSettings({ ...settings, tStop: v })}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="tran-dt">Paso h</label>
            {settings.auto ? (
              <output id="tran-dt" className="value-input readonly">
                {formatValue(times.dt, 's')}
              </output>
            ) : (
              <ValueInput
                id="tran-dt"
                value={settings.dt}
                unit="s"
                positive
                onChange={(v) => onSettings({ ...settings, dt: v })}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="tran-method">Método</label>
            <select
              id="tran-method"
              className="select"
              value={settings.method}
              onChange={(e) => onSettings({ ...settings, method: e.target.value as 'trap' | 'be' })}
            >
              <option value="trap">Trapezoidal</option>
              <option value="be">Euler hacia atrás</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tran-initial">Condiciones iniciales</label>
            <select
              id="tran-initial"
              className="select"
              value={settings.initial}
              onChange={(e) =>
                onSettings({ ...settings, initial: e.target.value as 'props' | 'dcop' })
              }
            >
              <option value="props">Valores de cada C y L</option>
              <option value="dcop">Régimen DC previo</option>
            </select>
          </div>
        </div>
        <p className="muted small">
          {n.toLocaleString('es')} muestras.{' '}
          {settings.initial === 'props'
            ? 'v(0) e i(0) se editan en las propiedades de cada capacitor y bobina.'
            : 'Se parte del régimen permanente con los interruptores en su estado inicial.'}
        </p>
      </Section>

      <Section title="Señales">
        <div className="chips" role="group" aria-label="Componentes a graficar">
          {elements.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`chip-btn ${ids.includes(e.id) ? 'on' : ''}`}
              aria-pressed={ids.includes(e.id)}
              onClick={() => toggle(e.id)}
              style={{ ['--chip' as string]: `var(--s${(colorOf(e.id) % 6) + 1})` }}
            >
              {e.id}
            </button>
          ))}
        </div>
        {ids.length === 0 ? (
          <p className="muted small">Elegí al menos un componente para graficar.</p>
        ) : (
          <>
            <h4 className="plot-title">Tensión v(t)</h4>
            <Plot
              x={result.time}
              series={vSeries}
              xUnit="s"
              yUnit="V"
              markers={markers}
              cursor={tNow}
              ariaLabel="Tensión en función del tiempo"
            />
            <h4 className="plot-title">Corriente i(t)</h4>
            <Plot
              x={result.time}
              series={iSeries}
              xUnit="s"
              yUnit="A"
              markers={markers}
              cursor={tNow}
              ariaLabel="Corriente en función del tiempo"
            />
          </>
        )}
        {analytic && (
          <label className="check">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Superponer la solución analítica de {analytic.id}
          </label>
        )}

        <div className="scrub">
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!playing && cursorFrac >= 1) onCursor(0);
              setPlaying(!playing);
            }}
            aria-label={playing ? 'Pausar' : 'Reproducir en el circuito'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={n - 1}
            value={k}
            onChange={(e) => {
              setPlaying(false);
              onCursor(Number(e.target.value) / (n - 1));
            }}
            aria-label="Instante mostrado en el circuito"
          />
          <output className="mono">t = {formatValue(tNow, 's')}</output>
        </div>
        <p className="muted small">
          El circuito muestra las tensiones y corrientes en el instante elegido.
          {ids.length > 0 &&
            ` ${ids
              .slice(0, 2)
              .map(
                (id) =>
                  `${id}: ${formatResult(result.voltages.get(id)![k], 'V')}, ${formatResult(result.currents.get(id)![k], 'A')}`,
              )
              .join(' · ')}`}
        </p>
      </Section>

      <Section title="Paso a paso">
        <Steps explanation={explanation} />
      </Section>
    </>
  );
}
