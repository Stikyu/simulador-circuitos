/**
 * Explicación del transitorio: clasifica el circuito (primer orden RC/RL,
 * segundo orden) a partir de su matriz de estado, arma la ecuación diferencial
 * y escribe la solución analítica con los valores del circuito.
 */
import { switchClosed } from '../components/switch';
import { bool, num, R_OPEN } from '../components/types';
import { solveDCNetlist } from '../engine/dc';
import type { NetElement, Netlist } from '../engine/netlist';
import { stateMatrix, type TransientResult } from '../engine/transient';
import { formatNumber, formatResult, formatValue } from '../engine/units';
import { formula, type Explanation, type Step } from './types';

export type Damping = 'sub' | 'critico' | 'sobre' | 'sin-perdidas';

export interface TransientModel {
  kind: 'resistivo' | 'primer-orden' | 'segundo-orden' | 'superior';
  /** Instante de la última conmutación (0 si no hay interruptores). */
  t0: number;
  /** Elementos con memoria, en el orden de las filas de A. */
  ids: string[];
  A: number[][] | null;
  // Primer orden
  tau?: number;
  rth?: number;
  // Segundo orden:  s² + 2α·s + ω0² = 0
  alpha?: number;
  w0?: number;
  damping?: Damping;
  wd?: number;
  s1?: number;
  s2?: number;
  form?: 'serie' | 'paralelo' | 'general';
  rEq?: number;
  /** Frecuencia de la fuente senoidal, si hay alguna. */
  acFreq?: number;
}

export interface Marker {
  x: number;
  label: string;
}

const byId = (nl: Netlist, id: string): NetElement => nl.elements.find((el) => el.id === id)!;

export function classifyTransient(nl: Netlist): TransientModel {
  const t0 = Math.max(
    0,
    ...nl.elements
      .filter((el) => el.type === 'switch' && bool(el.props, 'conmuta', true))
      .map((el) => num(el.props, 'tSwitch')),
  );
  const ac = nl.elements.find((el) => el.type === 'vac' && num(el.props, 'A') !== 0);
  const acFreq = ac ? num(ac.props, 'f', 50) : undefined;
  const reactive = nl.elements.filter((el) => el.type === 'capacitor' || el.type === 'inductor');
  const base = { t0, ids: reactive.map((el) => el.id), A: null, acFreq };
  if (reactive.length === 0) return { ...base, kind: 'resistivo' };

  let ids: string[];
  let A: number[][];
  try {
    ({ ids, A } = stateMatrix(nl, t0));
  } catch {
    return { ...base, kind: 'superior' };
  }

  if (ids.length === 1) {
    const a = A[0][0];
    if (!(a < 0)) return { ...base, ids, A, kind: 'superior' };
    const tau = -1 / a;
    const el = byId(nl, ids[0]);
    const rth = el.type === 'capacitor' ? tau / num(el.props, 'C') : num(el.props, 'L') / tau;
    return { ...base, ids, A, kind: 'primer-orden', tau, rth };
  }

  if (ids.length === 2) {
    const trace = A[0][0] + A[1][1];
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const alpha = -trace / 2;
    const disc = alpha * alpha - det;
    const model: TransientModel = { ...base, ids, A, kind: 'segundo-orden', alpha };
    if (det > 0) model.w0 = Math.sqrt(det);
    const scale = Math.max(alpha * alpha, Math.abs(det));
    if (Math.abs(disc) <= 1e-6 * scale) {
      model.damping = 'critico';
      model.s1 = model.s2 = -alpha;
    } else if (disc < 0) {
      model.wd = Math.sqrt(-disc);
      model.damping = Math.abs(alpha) < 1e-9 * model.wd ? 'sin-perdidas' : 'sub';
    } else {
      model.damping = 'sobre';
      model.s1 = -alpha + Math.sqrt(disc);
      model.s2 = -alpha - Math.sqrt(disc);
    }

    // ¿Es el RLC serie o paralelo de los libros?
    const els = ids.map((id) => byId(nl, id));
    const ic = els.findIndex((el) => el.type === 'capacitor');
    const il = els.findIndex((el) => el.type === 'inductor');
    model.form = 'general';
    if (ic >= 0 && il >= 0) {
      const L = num(els[il].props, 'L');
      const C = num(els[ic].props, 'C');
      const canonical = Math.abs(det * L * C - 1) < 1e-6;
      const tiny = 1e-9 * Math.max(Math.abs(alpha), Math.sqrt(Math.abs(det)));
      if (canonical && Math.abs(A[ic][ic]) <= tiny) {
        model.form = 'serie';
        model.rEq = -A[il][il] * L;
      } else if (canonical && Math.abs(A[il][il]) <= tiny) {
        model.form = 'paralelo';
        model.rEq = -1 / (A[ic][ic] * C);
      }
    }
    return model;
  }
  return { ...base, ids, A, kind: 'superior' };
}

/** Duración y paso razonables para que la curva muestre lo interesante. */
export function suggestTimes(model: TransientModel): { tStop: number; dt: number } {
  let span = 10e-3;
  let fastest = Infinity; // período o constante más rápida a resolver bien
  if (model.kind === 'primer-orden' && model.tau) {
    span = 6 * model.tau;
    fastest = model.tau;
  } else if (model.kind === 'segundo-orden') {
    const alpha = model.alpha ?? 0;
    if ((model.damping === 'sub' || model.damping === 'sin-perdidas') && model.wd) {
      const period = (2 * Math.PI) / model.wd;
      span = alpha > 0 ? Math.min(Math.max(6 / alpha, 4 * period), 40 * period) : 8 * period;
      fastest = period / 6;
    } else if (model.damping === 'critico' && alpha > 0) {
      span = 10 / alpha;
      fastest = 1 / alpha;
    } else if (model.s1 !== undefined && model.s2 !== undefined && model.s1 < 0) {
      span = 6 / Math.abs(model.s1);
      fastest = 1 / Math.abs(model.s2);
    }
  }
  if (model.acFreq) {
    span = Math.max(span, 4 / model.acFreq);
    fastest = Math.min(fastest, 1 / model.acFreq / 6);
  }
  if (!Number.isFinite(span) || span <= 0 || span > 1e6) span = 10e-3;
  const tStop = Number((model.t0 + span).toPrecision(2));
  let steps = 1200;
  if (Number.isFinite(fastest)) steps = Math.max(steps, Math.ceil(tStop / (fastest / 12)));
  steps = Math.min(steps, 20000);
  return { tStop, dt: tStop / steps };
}

/** Régimen permanente con los interruptores en su posición final. */
function finalValues(nl: Netlist, t0: number) {
  const frozen: Netlist = {
    ...nl,
    elements: nl.elements.map((el): NetElement => {
      if (el.type !== 'switch') return el;
      return switchClosed(el.props, 'tran', t0)
        ? { ...el, type: 'ammeter', props: {} }
        : { ...el, type: 'resistor', props: { R: R_OPEN } };
    }),
  };
  try {
    return solveDCNetlist(frozen);
  } catch {
    return null;
  }
}

export interface TransientExplanation {
  explanation: Explanation;
  markers: Marker[];
  /** Solución analítica de la variable principal, para comparar con la simulación. */
  analytic?: { id: string; quantity: 'v' | 'i'; fn: (t: number) => number };
}

const sec = (t: number) => formatValue(t, 's');
const volt = (v: number) => formatResult(v, 'V');
const amp = (i: number) => formatResult(i, 'A');
const n3 = (x: number) => formatNumber(x, 3);
const signed = (x: number, fmt: (v: number) => string) => (x < 0 ? `− ${fmt(-x)}` : `+ ${fmt(x)}`);

export function explainTransient(
  nl: Netlist,
  model: TransientModel,
  result: TransientResult,
): TransientExplanation {
  const { t0 } = model;
  const dt = result.options.dt;
  const k0 = Math.min(result.time.length - 1, Math.round(t0 / dt));
  const tRef = t0 > 0 ? `(t − ${sec(t0)})` : 't';
  const after = t0 > 0 ? `Después de la conmutación (t ≥ ${sec(t0)})` : 'Para t ≥ 0';
  const markers: Marker[] = [];
  if (t0 > 0) markers.push({ x: t0, label: 't₀' });
  const steps: Step[] = [];
  const final = model.acFreq ? null : finalValues(nl, t0);
  let method: string;
  let summary: string;
  let analytic: TransientExplanation['analytic'];

  const integrator: Step = {
    title: 'Cómo lo calcula el simulador',
    lines: [
      result.options.method === 'trap'
        ? `Paso fijo h = ${sec(dt)} con la regla trapezoidal (Euler hacia atrás en el paso de cada conmutación).`
        : `Paso fijo h = ${sec(dt)} con Euler hacia atrás.`,
      'En cada paso, cada capacitor y bobina se reemplaza por una conductancia en paralelo con una fuente de corriente que resume el paso anterior; el circuito queda resistivo y se resuelve con las mismas ecuaciones nodales que en continua.',
    ],
  };
  const firstReactive = nl.elements.find((el) => el.type === 'capacitor' || el.type === 'inductor');
  if (firstReactive) {
    const trap = result.options.method === 'trap';
    if (firstReactive.type === 'capacitor') {
      const g = ((trap ? 2 : 1) * num(firstReactive.props, 'C')) / dt;
      integrator.lines.push(
        formula(`${firstReactive.id}:  Geq = ${trap ? '2C/h' : 'C/h'} = ${formatValue(g, 'S')}`),
      );
    } else {
      const g = dt / ((trap ? 2 : 1) * num(firstReactive.props, 'L'));
      integrator.lines.push(
        formula(`${firstReactive.id}:  Geq = ${trap ? 'h/2L' : 'h/L'} = ${formatValue(g, 'S')}`),
      );
    }
  }

  if (model.kind === 'resistivo') {
    method = 'Circuito sin memoria';
    summary =
      'No hay capacitores ni bobinas: el circuito responde al instante, sin transitorio. Cada instante es un problema de continua.';
  } else if (model.kind === 'primer-orden' && model.tau && model.rth) {
    const el = byId(nl, model.ids[0]);
    const isC = el.type === 'capacitor';
    const tau = model.tau;
    const rth = model.rth;
    method = isC ? 'Circuito RC de primer orden' : 'Circuito RL de primer orden';
    summary = `Un solo elemento que almacena energía (${el.id}): la respuesta es una exponencial con constante de tiempo τ = ${sec(tau)}.`;
    const x = isC ? 'v' : 'i';
    const unit = isC ? volt : amp;
    const x0 = isC ? result.voltages.get(el.id)![k0] : result.currents.get(el.id)![k0];
    const xInf = final
      ? isC
        ? final.byId.get(el.id)!.voltage
        : final.byId.get(el.id)!.current
      : null;

    steps.push({
      title: 'Identificar el circuito',
      lines: [
        `${after} queda un circuito con un único ${isC ? 'capacitor' : 'inductor'} (${el.id}) y una red de resistencias y fuentes. Todo lo que ${el.id} "ve" se puede reemplazar por su equivalente de Thevenin.`,
      ],
    });
    steps.push({
      title: `Resistencia vista por ${el.id}`,
      lines: [
        `Se anulan las fuentes (tensión → cable, corriente → abierta) y se mira la red desde los terminales de ${el.id}:`,
        formula(`Rth = ${formatValue(rth, 'Ω')}`),
      ],
    });
    steps.push({
      title: 'Ecuación diferencial',
      lines: isC
        ? [
            'Ley de tensiones en el equivalente: Vth = Rth·i + v, con i = C·dv/dt en el capacitor:',
            formula('Rth·C · dv/dt + v = Vth'),
          ]
        : [
            'Ley de tensiones en el equivalente: Vth = Rth·i + v, con v = L·di/dt en la bobina:',
            formula('(L/Rth) · di/dt + i = Vth/Rth'),
          ],
    });
    steps.push({
      title: 'Constante de tiempo',
      lines: [
        formula(
          isC
            ? `τ = Rth·C = ${formatValue(rth, 'Ω')} · ${formatValue(num(el.props, 'C'), 'F')} = ${sec(tau)}`
            : `τ = L/Rth = ${formatValue(num(el.props, 'L'), 'H')} / ${formatValue(rth, 'Ω')} = ${sec(tau)}`,
        ),
        'τ mide qué tan rápido responde el circuito: cuanto más grande, más lento.',
      ],
    });
    if (xInf !== null) {
      steps.push({
        title: 'Valores inicial y final',
        lines: [
          isC
            ? 'La tensión de un capacitor no puede saltar (haría falta corriente infinita): arranca donde estaba.'
            : 'La corriente de una bobina no puede saltar (haría falta tensión infinita): arranca donde estaba.',
          formula(`${x}(${t0 > 0 ? 't₀' : '0'}) = ${unit(x0)}`),
          isC
            ? 'En régimen permanente el capacitor es un circuito abierto (dv/dt = 0):'
            : 'En régimen permanente la bobina es un cable (di/dt = 0):',
          formula(`${x}(∞) = ${unit(xInf)}`),
        ],
      });
      const delta = x0 - xInf;
      steps.push({
        title: 'Solución',
        lines: [
          formula(`${x}(t) = ${x}(∞) + [${x}(0) − ${x}(∞)] · e^(−${tRef}/τ)`),
          formula(`${x}(t) = ${unit(xInf)} ${signed(delta, unit)} · e^(−${tRef}/${sec(tau)})`),
        ],
      });
      steps.push({
        title: 'Leer τ en la curva',
        lines: [
          `En t = τ ya se recorrió el 63,2 % del camino entre el valor inicial y el final:`,
          formula(`${x}(τ) = ${unit(xInf + delta * Math.exp(-1))}`),
          `Después de 5τ = ${sec(5 * tau)} falta menos del 1 %: en la práctica, el transitorio terminó.`,
        ],
      });
      analytic = {
        id: el.id,
        quantity: isC ? 'v' : 'i',
        fn: (t) => (t < t0 ? x0 : xInf + delta * Math.exp(-(t - t0) / tau)),
      };
    } else {
      steps.push({
        title: 'Respuesta con fuente senoidal',
        lines: [
          'La respuesta es la suma de un término transitorio que se apaga con e^(−t/τ) y un régimen permanente senoidal de la misma frecuencia que la fuente (se calcula en la pestaña Alterna).',
        ],
      });
    }
    markers.push({ x: t0 + tau, label: 'τ' }, { x: t0 + 5 * tau, label: '5τ' });
  } else if (model.kind === 'segundo-orden' && model.A && model.alpha !== undefined) {
    const A = model.A;
    const alpha = model.alpha;
    const els = model.ids.map((id) => byId(nl, id));
    const main = Math.max(
      0,
      els.findIndex((el) => el.type === 'capacitor'),
    );
    const mainEl = els[main];
    const isC = mainEl.type === 'capacitor';
    const x = isC ? 'v' : 'i';
    const unit = isC ? volt : amp;
    const names = els.map((el) => el.id).join(' y ');
    method =
      model.form === 'serie'
        ? 'Circuito RLC serie (segundo orden)'
        : model.form === 'paralelo'
          ? 'Circuito RLC paralelo (segundo orden)'
          : 'Circuito de segundo orden';
    const dampingText: Record<Damping, string> = {
      sub: 'subamortiguada: oscila mientras se apaga',
      critico: 'críticamente amortiguada: la más rápida sin oscilar',
      sobre: 'sobreamortiguada: lenta y sin oscilar',
      'sin-perdidas': 'sin pérdidas: oscila indefinidamente',
    };
    summary = `Dos elementos que almacenan energía (${names}): respuesta ${dampingText[model.damping!]}.`;

    steps.push({
      title: 'Identificar el circuito',
      lines: [
        `${after} hay dos variables de estado: ${els
          .map((el) =>
            el.type === 'capacitor' ? `la tensión de ${el.id}` : `la corriente de ${el.id}`,
          )
          .join(' y ')}. La ecuación que las gobierna es de segundo orden.`,
      ],
    });

    const eq: string[] = [];
    if (model.form === 'serie' && model.rEq !== undefined) {
      eq.push(
        'Ley de tensiones en la malla: v_R + v_L + v_C = Vs, con i = C·dv/dt:',
        formula("L·C · v'' + R·C · v' + v = Vs"),
        formula(
          `α = R/(2L) = ${formatValue(model.rEq, 'Ω')} / (2 · ${formatValue(num(els.find((e) => e.type === 'inductor')!.props, 'L'), 'H')}) = ${n3(alpha)} s⁻¹`,
        ),
        formula(
          `ω0 = 1/√(L·C) = ${n3(model.w0!)} rad/s   (f0 = ${formatValue(model.w0! / (2 * Math.PI), 'Hz')})`,
        ),
      );
    } else if (model.form === 'paralelo' && model.rEq !== undefined) {
      eq.push(
        'Ley de corrientes en el nodo común: i_R + i_L + i_C = Is, con v = L·di/dt:',
        formula("L·C · i'' + (L/R) · i' + i = Is"),
        formula(`α = 1/(2RC) = ${n3(alpha)} s⁻¹   (R = ${formatValue(model.rEq, 'Ω')})`),
        formula(
          `ω0 = 1/√(L·C) = ${n3(model.w0!)} rad/s   (f0 = ${formatValue(model.w0! / (2 * Math.PI), 'Hz')})`,
        ),
      );
    } else {
      eq.push(
        'Con las fuentes anuladas, las dos variables de estado cumplen dx/dt = A·x. La matriz A se obtiene excitando una variable por vez:',
        formula(`A = [ ${n3(A[0][0])}  ${n3(A[0][1])} ; ${n3(A[1][0])}  ${n3(A[1][1])} ]`),
        formula(`2α = −traza(A) → α = ${n3(alpha)} s⁻¹`),
        formula(`ω0² = det(A) → ω0 = ${model.w0 ? n3(model.w0) : '—'} rad/s`),
      );
    }
    eq.push('Ecuación característica:', formula('s² + 2α·s + ω0² = 0   →   s = −α ± √(α² − ω0²)'));
    steps.push({ title: 'Ecuación diferencial y parámetros', lines: eq });

    const type: string[] = [];
    if (model.w0) type.push(formula(`ζ = α/ω0 = ${n3(alpha / model.w0)}`));
    if (model.damping === 'sub' || model.damping === 'sin-perdidas') {
      const wd = model.wd!;
      type.push(
        'α < ω0: raíces complejas conjugadas → respuesta subamortiguada.',
        formula(`ωd = √(ω0² − α²) = ${n3(wd)} rad/s   (período ${sec((2 * Math.PI) / wd)})`),
        formula(`${x}(t) = ${x}(∞) + e^(−α·t) · [K1·cos(ωd·t) + K2·sen(ωd·t)]`),
      );
      if (alpha > 0) {
        type.push(`La envolvente e^(−α·t) cae al 36,8 % en 1/α = ${sec(1 / alpha)}.`);
        markers.push({ x: t0 + 1 / alpha, label: '1/α' });
      }
    } else if (model.damping === 'critico') {
      type.push(
        'α = ω0: raíz doble → amortiguamiento crítico.',
        formula(`${x}(t) = ${x}(∞) + (K1 + K2·t) · e^(−α·t)`),
      );
    } else {
      type.push(
        'α > ω0: dos raíces reales distintas → respuesta sobreamortiguada.',
        formula(`s1 = ${n3(model.s1!)} s⁻¹     s2 = ${n3(model.s2!)} s⁻¹`),
        formula(`${x}(t) = ${x}(∞) + K1·e^(s1·t) + K2·e^(s2·t)`),
        `Equivale a dos constantes de tiempo: ${sec(-1 / model.s1!)} y ${sec(-1 / model.s2!)}.`,
      );
    }
    steps.push({ title: 'Tipo de respuesta', lines: type });

    if (final) {
      const x0 = els.map((el) =>
        el.type === 'capacitor' ? result.voltages.get(el.id)![k0] : result.currents.get(el.id)![k0],
      );
      const xInf = els.map((el) =>
        el.type === 'capacitor' ? final.byId.get(el.id)!.voltage : final.byId.get(el.id)!.current,
      );
      const d = x0.map((v, i) => v - xInf[i]);
      const d0 = d[main];
      const dd0 = A[main][0] * d[0] + A[main][1] * d[1]; // derivada inicial de la variable principal
      let fn: (tt: number) => number;
      let closed: string;
      if (model.damping === 'sub' || model.damping === 'sin-perdidas') {
        const wd = model.wd!;
        const k2 = (dd0 + alpha * d0) / wd;
        fn = (tt) => Math.exp(-alpha * tt) * (d0 * Math.cos(wd * tt) + k2 * Math.sin(wd * tt));
        closed = `e^(−${n3(alpha)}·${tRef}) · [${unit(d0)} · cos(${n3(wd)}·${tRef}) ${signed(k2, unit)} · sen(${n3(wd)}·${tRef})]`;
      } else if (model.damping === 'critico') {
        const k2 = dd0 + alpha * d0;
        fn = (tt) => (d0 + k2 * tt) * Math.exp(-alpha * tt);
        closed = `(${unit(d0)} ${signed(k2, (v) => `${n3(v)} ${isC ? 'V' : 'A'}/s`)} · ${tRef}) · e^(−${n3(alpha)}·${tRef})`;
      } else {
        const s1 = model.s1!;
        const s2 = model.s2!;
        const k1 = (dd0 - s2 * d0) / (s1 - s2);
        const k2 = d0 - k1;
        fn = (tt) => k1 * Math.exp(s1 * tt) + k2 * Math.exp(s2 * tt);
        closed = `${unit(k1)} · e^(${n3(s1)}·${tRef}) ${signed(k2, unit)} · e^(${n3(s2)}·${tRef})`;
      }
      steps.push({
        title: 'Condiciones iniciales y solución',
        lines: [
          'Las constantes salen de que la tensión del capacitor y la corriente de la bobina no pueden saltar:',
          ...els.map((el, i) =>
            formula(
              `${el.type === 'capacitor' ? 'v' : 'i'}(${el.id}):  inicial ${el.type === 'capacitor' ? volt(x0[i]) : amp(x0[i])}   final ${el.type === 'capacitor' ? volt(xInf[i]) : amp(xInf[i])}`,
            ),
          ),
          `Para ${mainEl.id}:`,
          formula(`${x}(t) = ${unit(xInf[main])} + ${closed}`),
        ],
      });
      analytic = {
        id: mainEl.id,
        quantity: isC ? 'v' : 'i',
        fn: (t) => (t < t0 ? x0[main] : xInf[main] + fn(t - t0)),
      };
    }
  } else {
    method = 'Circuito de orden superior';
    summary = `Hay ${model.ids.length} elementos con memoria (${model.ids.join(', ')}): no tiene una forma cerrada sencilla, se integra numéricamente.`;
  }

  steps.push(integrator);
  return { explanation: { method, summary, steps }, markers, analytic };
}
