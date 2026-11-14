/**
 * Análisis transitorio con paso fijo.
 *
 * En cada paso, capacitores y bobinas se reemplazan por su modelo equivalente
 * (una conductancia y una fuente de corriente que resume el paso anterior), de
 * modo que el circuito vuelve a ser resistivo y se resuelve con el mismo MNA.
 *
 * Integración: regla trapezoidal (orden 2, sin amortiguamiento numérico). Como
 * la trapezoidal "rebota" ante discontinuidades, el paso en que conmuta un
 * interruptor se hace con Euler hacia atrás, que las absorbe.
 */
import { intervalStart, switchClosed } from '../components/switch';
import { num } from '../components/types';
import { validateTopology } from './checks';
import type { Circuit } from './circuit';
import { buildSystem, explainSingular, solveDCNetlist } from './dc';
import { CircuitError } from './errors';
import type { ElementState, MnaSystem } from './mna';
import { buildNetlist, type NetElement, type Netlist } from './netlist';

export interface TransientOptions {
  /** Duración total de la simulación, en segundos. */
  tStop: number;
  /** Paso de tiempo, en segundos. */
  dt: number;
  method: 'trap' | 'be';
  /**
   * De dónde salen v(0) de los capacitores e i(0) de las bobinas:
   *  - 'props': de los valores iniciales cargados en cada componente.
   *  - 'dcop':  del régimen permanente DC previo a t = 0.
   */
  initial: 'props' | 'dcop';
}

export interface TransientResult {
  netlist: Netlist;
  time: Float64Array;
  /** nodeVoltages[n][k]: tensión del nodo n en el instante k. */
  nodeVoltages: Float64Array[];
  /** Tensión v(a) − v(b) de cada elemento a lo largo del tiempo. */
  voltages: Map<string, Float64Array>;
  /** Corriente a→b de cada elemento a lo largo del tiempo. */
  currents: Map<string, Float64Array>;
  /** Instantes en que conmutó algún interruptor. */
  switchTimes: number[];
  options: TransientOptions;
}

export const MAX_STEPS = 50000;

const hasMemory = (el: NetElement) => el.type === 'capacitor' || el.type === 'inductor';

/** Estado de todos los interruptores en el instante t. */
export function switchStatesAt(nl: Netlist, t: number): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const el of nl.elements) {
    if (el.type === 'switch') out.set(el.id, switchClosed(el.props, 'tran', t));
  }
  return out;
}

export function simulateTransientNetlist(nl: Netlist, opts: TransientOptions): TransientResult {
  const { tStop, dt } = opts;
  if (!(tStop > 0) || !(dt > 0)) {
    throw new CircuitError('parametro', 'La duración y el paso de tiempo deben ser positivos.');
  }
  const steps = Math.ceil(tStop / dt - 1e-9);
  if (steps > MAX_STEPS) {
    throw new CircuitError(
      'parametro',
      `La simulación necesitaría ${steps.toLocaleString('es')} pasos (máximo ${MAX_STEPS.toLocaleString('es')}).`,
      [],
      'Aumentá el paso de tiempo o reducí la duración.',
    );
  }
  validateTopology(nl, 'tran', 0);

  const n = steps + 1;
  const time = new Float64Array(n);
  const nodeVoltages = Array.from({ length: nl.nodeCount }, () => new Float64Array(n));
  const voltages = new Map(nl.elements.map((el) => [el.id, new Float64Array(n)]));
  const currents = new Map(nl.elements.map((el) => [el.id, new Float64Array(n)]));

  // --- Condiciones iniciales de los elementos con memoria ------------------------
  const state = new Map<string, ElementState>();
  if (opts.initial === 'dcop') {
    const op = solveDCNetlist(nl);
    for (const el of nl.elements.filter(hasMemory)) {
      const r = op.byId.get(el.id)!;
      state.set(el.id, { v: r.voltage, i: r.current });
    }
  } else {
    for (const el of nl.elements.filter(hasMemory)) {
      state.set(
        el.id,
        el.type === 'capacitor'
          ? { v: num(el.props, 'v0'), i: 0 }
          : { v: 0, i: num(el.props, 'i0') },
      );
    }
  }

  const record = (k: number, sys: MnaSystem, x: number[]) => {
    for (let node = 0; node < nl.nodeCount; node++) {
      nodeVoltages[node][k] = sys.nodeVoltage(x, node);
    }
    for (const el of nl.elements) {
      const v = nodeVoltages[el.nodes[0]][k] - nodeVoltages[el.nodes[1]][k];
      const i = sys.elementCurrent(x, el);
      voltages.get(el.id)![k] = v;
      currents.get(el.id)![k] = i;
      if (hasMemory(el)) state.set(el.id, { v, i });
    }
  };

  // --- t = 0: solución consistente con las condiciones iniciales -----------------
  // Cada capacitor se reemplaza por una fuente de tensión v(0) y cada bobina por
  // una fuente de corriente i(0). De ahí salen i_C(0⁺) y v_L(0⁺), que la regla
  // trapezoidal necesita para arrancar.
  let startWithBE = false;
  try {
    const sys0 = buildSystem(nl, { mode: 'ic', t: 0, state });
    record(0, sys0, sys0.solveReal());
  } catch {
    // Sin solución en t = 0 (por ejemplo, un capacitor directo sobre una fuente):
    // se arranca con Euler hacia atrás, que solo necesita v_C(0) e i_L(0).
    startWithBE = true;
  }

  // --- Avance en el tiempo ----------------------------------------------------------
  const switches = nl.elements.filter((el) => el.type === 'switch');
  const switchTimes: number[] = [];
  let prevStates = switches.map((el) => switchClosed(el.props, 'tran', 0));
  for (let k = 1; k < n; k++) {
    const t = k * dt;
    time[k] = t;
    // Estado de los interruptores al comienzo del intervalo que se va a resolver.
    const t0 = intervalStart(t, dt);
    const states = switches.map((el) => switchClosed(el.props, 'tran', t0));
    const toggled = states.some((s, i) => s !== prevStates[i]);
    if (toggled) switchTimes.push((k - 1) * dt);
    prevStates = states;

    const method = toggled || (k === 1 && startWithBE) ? 'be' : opts.method;
    const sys = buildSystem(nl, { mode: 'tran', t, h: dt, method, state });
    let x: number[];
    try {
      x = sys.solveReal();
    } catch (err) {
      explainSingular(err, sys, nl);
    }
    record(k, sys, x);
  }

  if (startWithBE && n > 1) {
    // No hubo solución en t = 0: se copia la del primer paso, salvo el estado conocido.
    for (const arr of nodeVoltages) arr[0] = arr[1];
    for (const el of nl.elements) {
      voltages.get(el.id)![0] = voltages.get(el.id)![1];
      currents.get(el.id)![0] = currents.get(el.id)![1];
    }
  }

  return { netlist: nl, time, nodeVoltages, voltages, currents, switchTimes, options: opts };
}

export function simulateTransient(circuit: Circuit, opts: TransientOptions): TransientResult {
  return simulateTransientNetlist(buildNetlist(circuit), opts);
}

/**
 * Matriz de estado A del circuito "muerto" (fuentes anuladas) en el instante t:
 *     d/dt x = A·x,   x = [v de cada capacitor, i de cada bobina]
 * Se obtiene numéricamente: se excita una variable de estado por vez con valor 1
 * y se mide qué derivada produce en las demás (i_C/C para capacitores, v_L/L
 * para bobinas). Sus autovalores son las frecuencias naturales del circuito.
 */
export function stateMatrix(nl: Netlist, t: number): { ids: string[]; A: number[][] } {
  const dead: Netlist = {
    ...nl,
    elements: nl.elements.map((el): NetElement => {
      if (el.type === 'vdc') return { ...el, props: { ...el.props, V: 0 } };
      if (el.type === 'idc') return { ...el, props: { ...el.props, I: 0 } };
      if (el.type === 'vac') return { ...el, props: { ...el.props, A: 0 } };
      return el;
    }),
  };
  const reactive = dead.elements.filter(hasMemory);
  const A = reactive.map(() => new Array<number>(reactive.length).fill(0));
  reactive.forEach((src, j) => {
    const state = new Map<string, ElementState>();
    for (const el of reactive) state.set(el.id, { v: 0, i: 0 });
    state.set(src.id, { v: 1, i: 1 });
    const sys = buildSystem(dead, { mode: 'ic', t, state });
    const x = sys.solveReal();
    reactive.forEach((el, i) => {
      if (el.type === 'capacitor') {
        A[i][j] = sys.elementCurrent(x, el) / num(el.props, 'C', 1e-6);
      } else {
        const v = sys.nodeVoltage(x, el.nodes[0]) - sys.nodeVoltage(x, el.nodes[1]);
        A[i][j] = v / num(el.props, 'L', 1e-2);
      }
    });
  });
  return { ids: reactive.map((el) => el.id), A };
}
