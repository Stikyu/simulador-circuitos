/**
 * Datos que se dibujan ENCIMA del circuito: tensiones de nodo, lecturas,
 * sentido de las corrientes y estado de los interruptores. El lienzo no sabe
 * de qué análisis vienen (DC, un instante del transitorio, módulos en AC).
 */
import { pointKey, type Circuit, type Point } from '../engine/circuit';
import type { Netlist } from '../engine/netlist';
import { formatResult } from '../engine/units';
import { computeFlows, type Flow } from '../engine/wireCurrents';

export interface NodeTag {
  at: Point;
  /** Si el rótulo va sobre un cable vertical se corre hacia el costado. */
  vertical: boolean;
  text: string;
}

export interface Overlay {
  nodeTags: NodeTag[];
  /** Texto extra bajo cada componente (corriente, lectura del medidor). */
  compText: Map<string, string>;
  /** +1: la corriente real va del terminal a al b; −1: al revés; 0: nula. */
  compDir: Map<string, number>;
  flows: Flow[];
  maxCurrent: number;
  /** Estado de cada interruptor en el instante mostrado. */
  switchStates: Map<string, boolean>;
}

export interface OverlayOptions {
  showVoltages: boolean;
  showCurrents: boolean;
  /** false para AC: los módulos no tienen "sentido" que animar. */
  animate: boolean;
  /** Estado de los interruptores en el instante mostrado (transitorio). */
  switchStates?: Map<string, boolean>;
}

/** Punto donde rotular un nodo: el medio de su cable más largo, o un terminal. */
function tagAnchor(circuit: Circuit, points: Point[]): { at: Point; vertical: boolean } | null {
  if (points.length === 0) return null;
  const keys = new Set(points.map(pointKey));
  let best: { at: Point; vertical: boolean } | null = null;
  let bestLen = 0;
  for (const w of circuit.wires) {
    if (!keys.has(pointKey(w.a))) continue;
    const len = Math.abs(w.a.x - w.b.x) + Math.abs(w.a.y - w.b.y);
    if (len > bestLen) {
      bestLen = len;
      best = {
        at: { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 },
        vertical: w.a.x === w.b.x,
      };
    }
  }
  return best ?? { at: points[0], vertical: false };
}

export function buildOverlay(
  circuit: Circuit,
  nl: Netlist,
  nodeVoltages: number[],
  currents: Map<string, number>,
  voltages: Map<string, number>,
  opts: OverlayOptions,
): Overlay {
  const nodeTags: NodeTag[] = [];
  if (opts.showVoltages) {
    for (let n = 1; n < nl.nodeCount; n++) {
      const anchor = tagAnchor(circuit, nl.nodePoints[n]);
      if (anchor) nodeTags.push({ ...anchor, text: `N${n} ${formatResult(nodeVoltages[n], 'V')}` });
    }
  }

  const compText = new Map<string, string>();
  const compDir = new Map<string, number>();
  let maxCurrent = 0;
  for (const c of circuit.components) {
    if (c.type === 'ground') continue;
    const i = currents.get(c.id) ?? 0;
    maxCurrent = Math.max(maxCurrent, Math.abs(i));
    if (c.type === 'voltmeter') {
      compText.set(c.id, formatResult(voltages.get(c.id) ?? 0, 'V'));
      continue;
    }
    if (c.type === 'ammeter') {
      compText.set(c.id, formatResult(opts.animate ? i : Math.abs(i), 'A'));
    } else if (opts.showCurrents) {
      compText.set(c.id, formatResult(Math.abs(i), 'A'));
    }
  }
  const threshold = Math.max(1e-9, maxCurrent * 1e-6);
  for (const c of circuit.components) {
    const i = currents.get(c.id) ?? 0;
    compDir.set(c.id, !opts.animate || Math.abs(i) < threshold ? 0 : Math.sign(i));
  }

  const flows =
    opts.animate && opts.showCurrents
      ? computeFlows(circuit, currents).filter((f) => Math.abs(f.current) >= threshold)
      : [];

  return {
    nodeTags,
    compText,
    compDir,
    flows,
    maxCurrent,
    switchStates: opts.switchStates ?? new Map(),
  };
}
