/**
 * Conecta el editor con el motor: a partir del circuito y del modo elegido
 * calcula el análisis correspondiente y lo que hay que dibujar sobre el lienzo.
 */
import { useMemo, useRef } from 'react';
import { buildOverlay, type Overlay } from '../editor/overlay';
import { solveACNetlist, type ACSolution } from '../engine/ac';
import type { Circuit } from '../engine/circuit';
import { abs } from '../engine/complex';
import { solveDCNetlist, type DCSolution } from '../engine/dc';
import type { CircuitError } from '../engine/errors';
import { buildNetlist, type Netlist } from '../engine/netlist';
import {
  simulateTransientNetlist,
  switchStatesAt,
  type TransientResult,
} from '../engine/transient';
import { classifyTransient, suggestTimes, type TransientModel } from '../explain/transient';
import type { Mode } from './AnalysisPanel';
import { attempt, type Outcome } from './outcome';

export interface TransientSettings {
  auto: boolean;
  tStop: number;
  dt: number;
  method: 'trap' | 'be';
  initial: 'props' | 'dcop';
}

export const DEFAULT_TRANSIENT: TransientSettings = {
  auto: true,
  tStop: 10e-3,
  dt: 10e-6,
  method: 'trap',
  initial: 'props',
};

export interface Show {
  voltages: boolean;
  currents: boolean;
}

export interface Analysis {
  netlist: Netlist;
  dc: Outcome<DCSolution> | null;
  tran: Outcome<TransientResult> | null;
  ac: Outcome<ACSolution> | null;
  tranModel: TransientModel | null;
  /** Tiempos efectivamente usados (los sugeridos si está en automático). */
  tranTimes: { tStop: number; dt: number };
  /** Índice de la muestra que se muestra sobre el circuito. */
  tranIndex: number;
  error: CircuitError | null;
  overlay: Overlay | null;
}

/**
 * Devuelve la misma netlist mientras no cambie la parte eléctrica (conexiones
 * y valores), aunque se muevan componentes. Así arrastrar algo por el lienzo
 * no vuelve a correr la simulación.
 */
function useStableNetlist(circuit: Circuit): { fresh: Netlist; stable: Netlist } {
  const fresh = useMemo(() => buildNetlist(circuit), [circuit]);
  const cache = useRef<{ key: string; nl: Netlist } | null>(null);
  const key = JSON.stringify([fresh.hasGround, fresh.nodeCount, fresh.elements]);
  if (!cache.current || cache.current.key !== key) cache.current = { key, nl: fresh };
  return { fresh, stable: cache.current.nl };
}

export function useAnalysis(
  circuit: Circuit,
  mode: Mode,
  show: Show,
  tranSettings: TransientSettings,
  cursorFrac: number,
): Analysis {
  const { fresh, stable } = useStableNetlist(circuit);

  const dc = useMemo(
    () => (mode === 'dc' ? attempt(() => solveDCNetlist(stable)) : null),
    [mode, stable],
  );

  const tranModel = useMemo(
    () => (mode === 'tran' ? classifyTransient(stable) : null),
    [mode, stable],
  );
  const suggested = useMemo(
    () => (tranModel ? suggestTimes(tranModel) : { tStop: 10e-3, dt: 10e-6 }),
    [tranModel],
  );
  const tStop = tranSettings.auto ? suggested.tStop : tranSettings.tStop;
  const dt = tranSettings.auto ? suggested.dt : tranSettings.dt;
  const { method, initial } = tranSettings;
  const tran = useMemo(
    () =>
      mode === 'tran'
        ? attempt(() => simulateTransientNetlist(stable, { tStop, dt, method, initial }))
        : null,
    [mode, stable, tStop, dt, method, initial],
  );
  const tranIndex = tran?.ok ? Math.round(cursorFrac * (tran.value.time.length - 1)) : 0;

  const ac = useMemo(
    () => (mode === 'ac' ? attempt(() => solveACNetlist(stable)) : null),
    [mode, stable],
  );

  const overlay = useMemo(() => {
    const base = { showVoltages: show.voltages, showCurrents: show.currents };
    if (mode === 'dc' && dc?.ok) {
      const sol = dc.value;
      return buildOverlay(
        circuit,
        fresh,
        sol.nodeVoltages,
        new Map(sol.elements.map((e) => [e.id, e.current])),
        new Map(sol.elements.map((e) => [e.id, e.voltage])),
        { ...base, animate: true },
      );
    }
    if (mode === 'tran' && tran?.ok) {
      const r = tran.value;
      const k = tranIndex;
      return buildOverlay(
        circuit,
        fresh,
        r.nodeVoltages.map((arr) => arr[k]),
        new Map([...r.currents].map(([id, arr]) => [id, arr[k]])),
        new Map([...r.voltages].map(([id, arr]) => [id, arr[k]])),
        { ...base, animate: true, switchStates: switchStatesAt(r.netlist, r.time[k]) },
      );
    }
    if (mode === 'ac' && ac?.ok) {
      // En alterna se muestran los módulos (amplitud pico): no hay un sentido que animar.
      const sol = ac.value;
      return buildOverlay(
        circuit,
        fresh,
        sol.nodeVoltages.map(abs),
        new Map(sol.elements.map((e) => [e.id, abs(e.current)])),
        new Map(sol.elements.map((e) => [e.id, abs(e.voltage)])),
        { ...base, animate: false },
      );
    }
    return null;
  }, [mode, dc, tran, ac, tranIndex, circuit, fresh, show.voltages, show.currents]);

  const active = mode === 'dc' ? dc : mode === 'tran' ? tran : ac;
  const error = active && !active.ok ? active.error : null;

  return {
    netlist: stable,
    dc,
    tran,
    ac,
    tranModel,
    tranTimes: { tStop, dt },
    tranIndex,
    error,
    overlay,
  };
}

/** Modo más útil para un circuito recién abierto. */
export function suggestMode(circuit: Circuit, available: Mode[]): Mode {
  const has = (...types: string[]) => circuit.components.some((c) => types.includes(c.type));
  if (has('vac') && available.includes('ac')) return 'ac';
  if (has('capacitor', 'inductor', 'switch') && available.includes('tran')) return 'tran';
  return 'dc';
}
