/**
 * Explicación paso a paso del régimen senoidal: impedancias, impedancia total,
 * corriente, caídas de tensión, potencias y resonancia.
 */
import { switchClosed } from '../components/switch';
import { num } from '../components/types';
import type { ACSolution } from '../engine/ac';
import { abs, argDeg, type Complex } from '../engine/complex';
import type { NetElement, Netlist } from '../engine/netlist';
import { formatNumber, formatValue } from '../engine/units';
import { formula, type Explanation, type Step } from './types';

export const polar = (z: Complex, unit: string): string =>
  `${formatValue(abs(z), unit)} ∠ ${formatNumber(Number(argDeg(z).toFixed(2)) + 0, 3)}°`;

export const rect = (z: Complex, unit: string): string => {
  const tiny = 1e-9 * Math.max(abs(z), 1e-30);
  if (Math.abs(z.im) < tiny) return formatValue(z.re, unit);
  const im = `j·${formatValue(Math.abs(z.im), unit)}`;
  if (Math.abs(z.re) < tiny) return z.im < 0 ? `−${im}` : im;
  return `${formatValue(z.re, unit)} ${z.im < 0 ? '−' : '+'} ${im}`;
};

const PASSIVE = new Set(['resistor', 'capacitor', 'inductor']);

/** ¿Los elementos forman una única malla (serie) o cuelgan de los mismos dos nodos (paralelo)? */
export function acTopology(nl: Netlist): 'serie' | 'paralelo' | 'general' {
  const parent = Array.from({ length: nl.nodeCount }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const active: NetElement[] = [];
  for (const el of nl.elements) {
    const short =
      el.type === 'ammeter' ||
      el.type === 'vdc' ||
      (el.type === 'switch' && switchClosed(el.props, 'ac', 0));
    if (short) parent[find(el.nodes[0])] = find(el.nodes[1]);
    else if (el.type === 'vac' || PASSIVE.has(el.type)) active.push(el);
    else if (el.type !== 'voltmeter' && el.type !== 'switch') return 'general';
  }
  if (active.filter((el) => el.type === 'vac').length !== 1 || active.length < 2) return 'general';
  const degree = new Map<number, number>();
  const pairs = new Set<string>();
  for (const el of active) {
    const a = find(el.nodes[0]);
    const b = find(el.nodes[1]);
    if (a === b) return 'general';
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
    pairs.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
  }
  if (pairs.size === 1) return active.length === 2 ? 'serie' : 'paralelo';
  if ([...degree.values()].every((d) => d === 2)) return 'serie';
  return 'general';
}

export function explainAC(sol: ACSolution): Explanation {
  const nl = sol.netlist;
  const steps: Step[] = [];
  const src = sol.source;
  const passives = sol.elements.filter((e) => PASSIVE.has(e.type));
  const topology = src ? acTopology(nl) : 'general';
  const w = sol.omega;

  // 1. Dominio de la frecuencia
  const sources = nl.elements.filter((el) => el.type === 'vac');
  steps.push({
    title: 'Pasar al dominio de la frecuencia',
    lines: [
      'En régimen permanente todas las tensiones y corrientes son senoidales de la misma frecuencia. Cada una se representa con un fasor: un número complejo con su amplitud y su fase.',
      formula(`ω = 2π·f = 2π · ${formatValue(sol.freq, 'Hz')} = ${formatNumber(w, 4)} rad/s`),
      ...sources.map((el) =>
        formula(
          `${el.id}:  v(t) = ${formatValue(num(el.props, 'A'), 'V')} · sen(ωt ${num(el.props, 'phase') < 0 ? '−' : '+'} ${formatNumber(Math.abs(num(el.props, 'phase')), 3)}°)   →   ${polar(sol.byId.get(el.id)!.voltage, 'V')}`,
        ),
      ),
      'Se trabaja con amplitudes pico. El valor eficaz es el pico dividido por √2.',
    ],
  });

  // 2. Impedancias
  const zLines: string[] = [];
  const zOf = new Map<string, Complex>();
  for (const el of nl.elements) {
    if (el.type === 'resistor') {
      const R = num(el.props, 'R');
      zOf.set(el.id, { re: R, im: 0 });
      zLines.push(formula(`Z(${el.id}) = R = ${formatValue(R, 'Ω')}`));
    } else if (el.type === 'inductor') {
      const X = w * num(el.props, 'L');
      zOf.set(el.id, { re: 0, im: X });
      zLines.push(
        formula(
          `Z(${el.id}) = jωL = j · ${formatNumber(w, 4)} · ${formatValue(num(el.props, 'L'), 'H')} = j·${formatValue(X, 'Ω')}   (${polar({ re: 0, im: X }, 'Ω')})`,
        ),
      );
    } else if (el.type === 'capacitor') {
      const X = 1 / (w * num(el.props, 'C'));
      zOf.set(el.id, { re: 0, im: -X });
      zLines.push(
        formula(
          `Z(${el.id}) = 1/(jωC) = −j / (${formatNumber(w, 4)} · ${formatValue(num(el.props, 'C'), 'F')}) = −j·${formatValue(X, 'Ω')}   (${polar({ re: 0, im: -X }, 'Ω')})`,
        ),
      );
    }
  }
  if (zLines.length > 0) {
    steps.push({
      title: 'Impedancia de cada componente',
      lines: [
        'La resistencia no depende de la frecuencia. La bobina "frena" más cuanto mayor es la frecuencia (+90°) y el capacitor, cuanto menor (−90°).',
        ...zLines,
      ],
    });
  }

  if (src) {
    // 3. Impedancia total
    const total: string[] = [];
    const ids = passives.map((e) => e.id);
    if (topology === 'serie') {
      total.push(
        'Todos los componentes están en una única malla (serie): las impedancias se suman como números complejos.',
        formula(`Z = ${ids.map((id) => `Z(${id})`).join(' + ')}`),
      );
    } else if (topology === 'paralelo') {
      total.push(
        'Todos los componentes están entre los mismos dos nodos (paralelo): se suman las admitancias.',
        formula(`1/Z = ${ids.map((id) => `1/Z(${id})`).join(' + ')}`),
      );
    } else {
      total.push(
        'El circuito no es una serie ni un paralelo simple: se resuelve el mismo sistema nodal que en continua, pero con admitancias complejas. La impedancia vista por la fuente sale de Z = V / I.',
      );
    }
    if (src.impedance) {
      total.push(formula(`Z = ${rect(src.impedance, 'Ω')} = ${polar(src.impedance, 'Ω')}`));
    } else {
      total.push('No circula corriente por la fuente: la impedancia vista es infinita.');
    }
    steps.push({ title: `Impedancia total vista por ${src.id}`, lines: total });

    // 4. Corriente
    if (src.impedance) {
      const phi = argDeg(src.impedance);
      const lag =
        Math.abs(phi) < 1e-6
          ? 'La corriente está en fase con la tensión (carga resistiva).'
          : phi > 0
            ? `La corriente atrasa ${formatNumber(phi, 3)}° respecto de la tensión (carga inductiva).`
            : `La corriente adelanta ${formatNumber(-phi, 3)}° respecto de la tensión (carga capacitiva).`;
      steps.push({
        title: 'Corriente entregada por la fuente',
        lines: [
          'Ley de Ohm con fasores: se dividen los módulos y se restan las fases.',
          formula(
            `I = V / Z = ${polar(src.voltage, 'V')} / ${polar(src.impedance, 'Ω')} = ${polar(src.current, 'A')}`,
          ),
          lag,
        ],
      });
    }
  }

  // 5. Tensiones y corrientes en cada componente
  if (passives.length > 0) {
    const lines: string[] = [];
    if (topology === 'serie') {
      lines.push('En serie la corriente es la misma en todos; cada caída es V = I·Z:');
      for (const e of passives) {
        lines.push(formula(`V(${e.id}) = I · Z(${e.id}) = ${polar(e.voltage, 'V')}`));
      }
      lines.push(
        'Ojo: los módulos no se suman directamente. La suma que da la tensión de la fuente es la de los fasores (con sus fases).',
      );
    } else if (topology === 'paralelo') {
      lines.push('En paralelo la tensión es la misma en todos; cada corriente es I = V/Z:');
      for (const e of passives) {
        lines.push(formula(`I(${e.id}) = V / Z(${e.id}) = ${polar(e.current, 'A')}`));
      }
    } else {
      for (const e of passives) {
        lines.push(
          formula(`${e.id}:  V = ${polar(e.voltage, 'V')}   I = ${polar(e.current, 'A')}`),
        );
      }
    }
    steps.push({ title: 'Tensión y corriente en cada componente', lines });
  }

  // 6. Potencias
  if (src) {
    const P = src.power.re;
    const Q = src.power.im;
    steps.push({
      title: 'Potencias',
      lines: [
        'Con fasores de amplitud pico, la potencia compleja es S = ½·V·I* = P + jQ.',
        formula(`P = ${formatValue(P, 'W')}   (activa: la que se disipa en las resistencias)`),
        formula(
          `Q = ${formatValue(Q, 'var')}   (reactiva: ${Q >= 0 ? 'inductiva' : 'capacitiva'}, va y vuelve entre la fuente y ${Q >= 0 ? 'las bobinas' : 'los capacitores'})`,
        ),
        formula(`|S| = √(P² + Q²) = ${formatValue(abs(src.power), 'VA')}   (aparente)`),
        formula(`fp = cos φ = P / |S| = ${formatNumber(src.powerFactor, 3)}   (${src.character})`),
      ],
    });
  }

  // 7. Resonancia
  const ls = nl.elements.filter((el) => el.type === 'inductor');
  const cs = nl.elements.filter((el) => el.type === 'capacitor');
  if (ls.length === 1 && cs.length === 1) {
    const L = num(ls[0].props, 'L');
    const C = num(cs[0].props, 'C');
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const ratio = sol.freq / f0;
    steps.push({
      title: 'Resonancia',
      lines: [
        'Hay una frecuencia a la que la reactancia de la bobina y la del capacitor son iguales y se cancelan:',
        formula(
          `f0 = 1 / (2π·√(L·C)) = 1 / (2π·√(${formatValue(L, 'H')} · ${formatValue(C, 'F')})) = ${formatValue(f0, 'Hz')}`,
        ),
        Math.abs(ratio - 1) < 0.01
          ? 'La fuente está trabajando en resonancia: el conjunto L–C se comporta como si no estuviera y la impedancia es puramente resistiva.'
          : ratio < 1
            ? `La fuente trabaja por debajo de f0 (${formatNumber(ratio, 3)}·f0): pesa más la reactancia del capacitor.`
            : `La fuente trabaja por encima de f0 (${formatNumber(ratio, 3)}·f0): pesa más la reactancia de la bobina.`,
      ],
    });
  }

  const method =
    topology === 'serie'
      ? 'Fasores: impedancias en serie'
      : topology === 'paralelo'
        ? 'Fasores: admitancias en paralelo'
        : 'Fasores: análisis nodal complejo';
  return {
    method,
    summary: `Régimen senoidal permanente a ${formatValue(sol.freq, 'Hz')}. Cada componente se reemplaza por su impedancia y se opera con números complejos.`,
    steps,
  };
}
