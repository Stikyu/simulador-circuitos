/**
 * Régimen senoidal permanente (AC) con fasores.
 *
 * Es el mismo MNA que en continua, pero con números complejos: cada R, L y C
 * estampa su admitancia (1/R, 1/(jωL), jωC) y las fuentes senoidales su fasor.
 * Los fasores usan amplitud PICO y referencia seno, igual que v(t) = A·sen(ωt + φ).
 */
import { num } from '../components/types';
import { validateTopology } from './checks';
import type { Circuit, ComponentType } from './circuit';
import { abs, arg, conj, div, mul, scale, sub, type Complex } from './complex';
import { buildSystem, explainSingular } from './dc';
import { CircuitError } from './errors';
import { buildNetlist, type NetElement, type Netlist } from './netlist';

export interface ACElement {
  id: string;
  type: ComponentType;
  nodes: number[];
  /** Fasor de tensión v(a) − v(b), amplitud pico. */
  voltage: Complex;
  /** Fasor de corriente a→b, amplitud pico. */
  current: Complex;
  /** Z = V/I; null si no circula corriente. */
  impedance: Complex | null;
  /** Potencia compleja absorbida S = ½·V·I* = P + jQ. */
  power: Complex;
}

export interface ACSourceSummary {
  id: string;
  voltage: Complex;
  /** Corriente que la fuente entrega al circuito (sale por su terminal +). */
  current: Complex;
  /** Impedancia total vista por la fuente. */
  impedance: Complex | null;
  /** Potencia compleja entregada: P (W), Q (var), |S| (VA). */
  power: Complex;
  /** cos φ, con φ el ángulo de la impedancia. */
  powerFactor: number;
  /** Carácter de la carga según el signo de Q. */
  character: 'inductivo' | 'capacitivo' | 'resistivo';
}

export interface ACSolution {
  netlist: Netlist;
  freq: number;
  omega: number;
  nodeVoltages: Complex[];
  elements: ACElement[];
  byId: Map<string, ACElement>;
  /** Resumen visto desde la fuente, si hay exactamente una. */
  source: ACSourceSummary | null;
}

const isAcSource = (el: NetElement) => el.type === 'vac';

/** Frecuencia de trabajo: la de las fuentes senoidales, que deben coincidir. */
export function acFrequency(nl: Netlist): number {
  const sources = nl.elements.filter(isAcSource);
  if (sources.length === 0) {
    throw new CircuitError(
      'sin-fuente-ac',
      'No hay ninguna fuente senoidal en el circuito.',
      [],
      'El análisis en alterna necesita al menos una fuente senoidal. Agregala desde la paleta.',
    );
  }
  const f = num(sources[0].props, 'f', 50);
  const other = sources.find((s) => Math.abs(num(s.props, 'f', 50) - f) > 1e-9 * f);
  if (other) {
    throw new CircuitError(
      'frecuencias',
      `Las fuentes ${sources[0].id} y ${other.id} tienen frecuencias distintas.`,
      [sources[0].id, other.id],
      'Los fasores solo valen para una única frecuencia. Con frecuencias distintas hay que aplicar superposición (una fuente por vez) o usar el análisis transitorio.',
    );
  }
  return f;
}

/** Resuelve el sistema complejo a una frecuencia dada. */
function solveAt(nl: Netlist, omega: number) {
  const sys = buildSystem(nl, { mode: 'ac', omega });
  try {
    return { sys, x: sys.solveComplex() };
  } catch (err) {
    explainSingular(err, sys, nl);
  }
}

export function solveACNetlist(nl: Netlist, freq?: number): ACSolution {
  validateTopology(nl, 'ac');
  const f = freq ?? acFrequency(nl);
  const omega = 2 * Math.PI * f;
  const { sys, x } = solveAt(nl, omega);

  const nodeVoltages = Array.from({ length: nl.nodeCount }, (_, n) => sys.nodeVoltageC(x, n));
  const elements: ACElement[] = nl.elements.map((el) => {
    const voltage = sub(nodeVoltages[el.nodes[0]], nodeVoltages[el.nodes[1]]);
    const current = sys.elementCurrentC(x, el);
    const negligible = abs(current) < 1e-15;
    return {
      id: el.id,
      type: el.type,
      nodes: el.nodes,
      voltage,
      current,
      impedance: negligible ? null : div(voltage, current),
      power: scale(mul(voltage, conj(current)), 0.5),
    };
  });
  const byId = new Map(elements.map((e) => [e.id, e]));

  let source: ACSourceSummary | null = null;
  const sources = nl.elements.filter(isAcSource);
  if (sources.length === 1) {
    const s = byId.get(sources[0].id)!;
    const current = scale(s.current, -1);
    const power = scale(s.power, -1);
    const impedance = abs(current) < 1e-15 ? null : div(s.voltage, current);
    const sMag = abs(power);
    const tol = 1e-4 * Math.max(sMag, 1e-30); // por debajo de 0,01 % se considera resistivo
    source = {
      id: s.id,
      voltage: s.voltage,
      current,
      impedance,
      power,
      powerFactor: sMag > 0 ? power.re / sMag : 1,
      character: power.im > tol ? 'inductivo' : power.im < -tol ? 'capacitivo' : 'resistivo',
    };
  }
  return { netlist: nl, freq: f, omega, nodeVoltages, elements, byId, source };
}

export function solveAC(circuit: Circuit, freq?: number): ACSolution {
  return solveACNetlist(buildNetlist(circuit), freq);
}

// --- Barrido en frecuencia -------------------------------------------------------------

export interface SweepOptions {
  /** Componente sobre el que se mide la salida (su tensión). */
  outputId: string;
  fStart: number;
  fStop: number;
  points: number;
}

export interface SweepResult {
  outputId: string;
  inputId: string;
  freqs: Float64Array;
  /** |H| = |Vsalida / Ventrada|. */
  mag: Float64Array;
  magDb: Float64Array;
  /** Fase de H en grados, desenrollada (sin saltos de 360°). */
  phaseDeg: Float64Array;
}

/** Función de transferencia H(f) = V(salida)/V(fuente), en una grilla logarítmica. */
export function sweepAC(nl: Netlist, opts: SweepOptions): SweepResult {
  validateTopology(nl, 'ac');
  acFrequency(nl); // valida que haya fuente
  const input = nl.elements.find(isAcSource)!;
  const output = nl.elements.find((el) => el.id === opts.outputId);
  if (!output) throw new CircuitError('parametro', `No existe el componente ${opts.outputId}.`);
  if (!(opts.fStart > 0) || !(opts.fStop > opts.fStart)) {
    throw new CircuitError('parametro', 'El rango de frecuencias no es válido.');
  }
  const n = Math.max(2, Math.floor(opts.points));
  const freqs = new Float64Array(n);
  const mag = new Float64Array(n);
  const magDb = new Float64Array(n);
  const phaseDeg = new Float64Array(n);
  const ratio = Math.log(opts.fStop / opts.fStart);
  let prevPhase = 0;
  for (let k = 0; k < n; k++) {
    const f = opts.fStart * Math.exp((ratio * k) / (n - 1));
    const { sys, x } = solveAt(nl, 2 * Math.PI * f);
    const vOut = sub(sys.nodeVoltageC(x, output.nodes[0]), sys.nodeVoltageC(x, output.nodes[1]));
    const vIn = sub(sys.nodeVoltageC(x, input.nodes[0]), sys.nodeVoltageC(x, input.nodes[1]));
    const h = div(vOut, vIn);
    freqs[k] = f;
    mag[k] = abs(h);
    magDb[k] = 20 * Math.log10(Math.max(mag[k], 1e-12));
    let ph = (arg(h) * 180) / Math.PI;
    if (k > 0) {
      while (ph - prevPhase > 180) ph -= 360;
      while (ph - prevPhase < -180) ph += 360;
    }
    phaseDeg[k] = ph;
    prevPhase = ph;
  }
  return { outputId: output.id, inputId: input.id, freqs, mag, magDb, phaseDeg };
}

export type FilterKind =
  'pasa-bajos' | 'pasa-altos' | 'pasa-banda' | 'elimina-banda' | 'plana' | 'otro';

export interface ResponseAnalysis {
  kind: FilterKind;
  /** Ganancia máxima |H| y su valor en dB. */
  peak: number;
  peakDb: number;
  /** Frecuencia de corte (−3 dB) en pasa bajos / pasa altos. */
  fc?: number;
  /** Frecuencia central: del pico (pasa banda) o del pozo (elimina banda). */
  f0?: number;
  fLow?: number;
  fHigh?: number;
  bandwidth?: number;
  /** Factor de calidad Q = f0 / ancho de banda. */
  q?: number;
}

/** Frecuencia donde la curva cruza `level` entre las muestras k y k+1 (interpolando en log f). */
function crossing(s: SweepResult, k: number, level: number): number {
  const m0 = s.mag[k];
  const m1 = s.mag[k + 1];
  const t = m1 === m0 ? 0 : (level - m0) / (m1 - m0);
  return s.freqs[k] * Math.pow(s.freqs[k + 1] / s.freqs[k], t);
}

/** Refina un extremo con una parábola por los tres puntos vecinos (en log f). */
function refineExtremum(s: SweepResult, k: number, data: Float64Array): number {
  if (k <= 0 || k >= data.length - 1) return s.freqs[k];
  const [a, b, c] = [data[k - 1], data[k], data[k + 1]];
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  return s.freqs[k] * Math.pow(s.freqs[k + 1] / s.freqs[k], shift);
}

/** Clasifica la respuesta en frecuencia y mide corte, resonancia y ancho de banda. */
export function analyzeResponse(s: SweepResult): ResponseAnalysis {
  const n = s.mag.length;
  let iMax = 0;
  let iMin = 0;
  for (let k = 1; k < n; k++) {
    if (s.mag[k] > s.mag[iMax]) iMax = k;
    if (s.mag[k] < s.mag[iMin]) iMin = k;
  }
  const peak = s.mag[iMax];
  const base: ResponseAnalysis = { kind: 'otro', peak, peakDb: s.magDb[iMax] };
  if (!(peak > 0)) return base;
  if (peak - s.mag[iMin] < 0.03 * peak) return { ...base, kind: 'plana' };

  const level = peak / Math.SQRT2;
  const low = s.mag[0];
  const high = s.mag[n - 1];
  const firstBelow = (from: number, dir: 1 | -1): number => {
    for (let k = from; k >= 0 && k < n; k += dir) if (s.mag[k] < level) return k;
    return -1;
  };

  if (low >= level && high < level) {
    const k = firstBelow(iMax, 1);
    return { ...base, kind: 'pasa-bajos', fc: crossing(s, k - 1, level) };
  }
  if (high >= level && low < level) {
    const k = firstBelow(iMax, -1);
    return { ...base, kind: 'pasa-altos', fc: crossing(s, k, level) };
  }
  // Pendiente (dB/década) en cada extremo: distingue un pasa banda de un pasa
  // bajos o pasa altos con pico de resonancia, que es plano en uno de sus extremos.
  const span = Math.max(2, Math.floor(n / 20));
  const slope = (i: number, j: number) =>
    (s.magDb[j] - s.magDb[i]) / Math.log10(s.freqs[j] / s.freqs[i]);
  const flatLow = Math.abs(slope(0, span)) < 3;
  const flatHigh = Math.abs(slope(n - 1 - span, n - 1)) < 3;
  if (low < level && high < level && flatLow && !flatHigh) {
    // Pasa bajos resonante: el corte se mide respecto de la ganancia en bajas frecuencias.
    const ref = low / Math.SQRT2;
    let k = iMax;
    while (k < n - 1 && s.mag[k] >= ref) k++;
    return {
      ...base,
      kind: 'pasa-bajos',
      fc: crossing(s, k - 1, ref),
      f0: refineExtremum(s, iMax, s.magDb),
    };
  }
  if (low < level && high < level && flatHigh && !flatLow) {
    const ref = high / Math.SQRT2;
    let k = iMax;
    while (k > 0 && s.mag[k] >= ref) k--;
    return {
      ...base,
      kind: 'pasa-altos',
      fc: crossing(s, k, ref),
      f0: refineExtremum(s, iMax, s.magDb),
    };
  }
  if (low < level && high < level) {
    const kl = firstBelow(iMax, -1);
    const kh = firstBelow(iMax, 1);
    const fLow = crossing(s, kl, level);
    const fHigh = crossing(s, kh - 1, level);
    const f0 = refineExtremum(s, iMax, s.magDb);
    const bandwidth = fHigh - fLow;
    return { ...base, kind: 'pasa-banda', f0, fLow, fHigh, bandwidth, q: f0 / bandwidth };
  }
  // Los dos extremos pasan: ¿hay un pozo en el medio?
  const edge = Math.min(low, high);
  if (s.mag[iMin] < edge / Math.SQRT2 && iMin > 0 && iMin < n - 1) {
    const notchLevel = edge / Math.SQRT2;
    let kl = iMin;
    while (kl > 0 && s.mag[kl] < notchLevel) kl--;
    let kh = iMin;
    while (kh < n - 1 && s.mag[kh] < notchLevel) kh++;
    const fLow = crossing(s, kl, notchLevel);
    const fHigh = crossing(s, kh - 1, notchLevel);
    const f0 = refineExtremum(s, iMin, s.magDb);
    const bandwidth = fHigh - fLow;
    return { ...base, kind: 'elimina-banda', f0, fLow, fHigh, bandwidth, q: f0 / bandwidth };
  }
  return base;
}
