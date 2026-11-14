/**
 * Explicación paso a paso del análisis en continua.
 *  - Si la red es reducible: serie/paralelo con resistencia equivalente.
 *  - Si no: ecuaciones nodales (MNA) planteadas y resueltas con los valores reales.
 */
import { switchClosed } from '../components/switch';
import { num, R_OPEN } from '../components/types';
import type { DCSolution } from '../engine/dc';
import type { NetElement } from '../engine/netlist';
import { formatNumber, formatResult, formatValue } from '../engine/units';
import { reduceSeriesParallel } from './seriesParallel';
import { formula, type Explanation, type Step } from './types';

const nodeName = (n: number) => (n === 0 ? '0' : `N${n}`);
const volt = (v: number) => formatResult(v, 'V');
const amp = (i: number) => formatResult(i, 'A');

const BRANCH_TYPES = new Set(['vdc', 'vac', 'inductor', 'ammeter', 'switch']);

export function explainDC(sol: DCSolution): Explanation {
  const sp = reduceSeriesParallel(sol.netlist);
  if (sp) {
    return {
      method: 'Reducción serie / paralelo',
      summary: `La red vista por ${sp.sourceId} se puede reducir a una sola resistencia equivalente de ${formatValue(sp.req, 'Ω')}.`,
      steps: sp.steps,
    };
  }
  return {
    method: 'Análisis nodal',
    summary:
      'La red no se reduce solo con serie y paralelo (o tiene más de una fuente), así que se plantean las ecuaciones de nodos.',
    steps: nodalSteps(sol),
  };
}

export function nodalSteps(sol: DCSolution): Step[] {
  const nl = sol.netlist;
  const steps: Step[] = [];
  const branchEls = nl.elements.filter(
    (el) => BRANCH_TYPES.has(el.type) && el.nodes[0] !== el.nodes[1],
  );

  // 1. Incógnitas
  const unknowns: string[] = [
    'Se toma la tierra como referencia (0 V). Las incógnitas son:',
    formula(
      Array.from({ length: nl.nodeCount - 1 }, (_, i) => `N${i + 1}`).join(', ') +
        '  (tensiones de nodo)',
    ),
  ];
  if (branchEls.length > 0) {
    unknowns.push(
      'Las ramas que imponen una tensión no tienen ley de Ohm, así que su corriente se agrega como incógnita (por eso el método se llama nodal «modificado»):',
      formula(branchEls.map((el) => `I(${el.id})`).join(', ')),
    );
  }
  steps.push({ title: 'Incógnitas', lines: unknowns });

  // 2. KCL por nodo
  const kcl: string[] = [
    'En cada nodo, la suma de corrientes que salen es igual a la que inyectan las fuentes de corriente:',
  ];
  for (let n = 1; n < nl.nodeCount; n++) {
    const terms: string[] = [];
    let injected = 0;
    let hasInjection = false;
    for (const el of nl.elements) {
      const [a, b] = el.nodes;
      if (a === b || (a !== n && b !== n)) continue;
      const other = a === n ? b : a;
      if (el.type === 'resistor') {
        terms.push(`(N${n} − ${nodeName(other)})/${formatValue(num(el.props, 'R'), 'Ω')}`);
      } else if (el.type === 'idc') {
        // La flecha apunta al terminal a: inyecta corriente en a y la extrae de b.
        injected += a === n ? num(el.props, 'I') : -num(el.props, 'I');
        hasInjection = true;
      } else if (BRANCH_TYPES.has(el.type)) {
        terms.push(a === n ? `I(${el.id})` : `−I(${el.id})`);
      }
    }
    if (terms.length === 0) continue;
    const lhs = terms.join(' + ').replace(/\+ −/g, '− ');
    kcl.push(formula(`N${n}:  ${lhs} = ${hasInjection ? formatValue(injected, 'A') : '0'}`));
  }
  if (nl.elements.some((el) => el.type === 'voltmeter')) {
    kcl.push('Los voltímetros (1 GΩ) aportan una corriente despreciable y se omiten.');
  }
  if (nl.elements.some((el) => el.type === 'capacitor')) {
    kcl.push('Los capacitores no aparecen: en continua no conducen.');
  }
  steps.push({ title: 'Ley de corrientes de Kirchhoff', lines: kcl });

  // 3. Ecuaciones de rama
  if (branchEls.length > 0) {
    const lines = branchEls.map((el) => formula(branchEquation(el)));
    steps.push({ title: 'Ecuaciones de las ramas de tensión', lines });
  }

  // 4. Sistema matricial
  const { A, b, labels, x } = sol.matrix;
  if (labels.length <= 8) {
    const cells = A.map((row) => row.map((v) => (v === 0 ? '0' : formatNumber(v, 3))));
    const widths = labels.map((_, j) => Math.max(...cells.map((row) => row[j].length)));
    const rhs = b.map((v) => (v === 0 ? '0' : formatNumber(v, 3)));
    const labelW = Math.max(...labels.map((l) => l.length));
    const lines = [
      'Las mismas ecuaciones en forma G·x = b (conductancias en siemens):',
      ...cells.map((row, i) =>
        formula(
          `[ ${row.map((c, j) => c.padStart(widths[j])).join('  ')} ] · [ ${labels[i].padEnd(labelW)} ] = [ ${rhs[i]} ]`,
        ),
      ),
      'Se resuelve por eliminación gaussiana con pivoteo parcial.',
    ];
    steps.push({ title: 'Sistema matricial', lines });
  }

  // 5. Solución
  steps.push({
    title: 'Solución',
    lines: labels.map((l, i) => formula(`${l} = ${l.startsWith('I(') ? amp(x[i]) : volt(x[i])}`)),
  });

  // 6. Corrientes por resistencia
  const res = sol.elements.filter((e) => e.type === 'resistor');
  if (res.length > 0) {
    const lines = ['Con las tensiones de nodo, la ley de Ohm da la corriente de cada resistencia:'];
    for (const e of res) {
      const el = nl.elements.find((k) => k.id === e.id)!;
      const [a, b2] = e.nodes;
      lines.push(
        formula(
          `I(${e.id}) = (${nodeName(a)} − ${nodeName(b2)})/${e.id} = (${volt(sol.nodeVoltages[a])} − ${volt(sol.nodeVoltages[b2])})/${formatValue(num(el.props, 'R'), 'Ω')} = ${amp(e.current)}`,
        ),
      );
    }
    steps.push({ title: 'Corrientes de rama', lines });
  }

  // 7. Balance de potencias
  const delivered = sol.elements.filter((e) => e.power < 0).reduce((s, e) => s - e.power, 0);
  const absorbed = sol.elements.filter((e) => e.power > 0).reduce((s, e) => s + e.power, 0);
  steps.push({
    title: 'Verificación: balance de potencias',
    lines: [
      formula(`Entregada por las fuentes = ${formatResult(delivered, 'W')}`),
      formula(`Disipada o absorbida      = ${formatResult(absorbed, 'W')}`),
      'Coinciden: la energía se conserva (teorema de Tellegen).',
    ],
  });
  return steps;
}

function branchEquation(el: NetElement): string {
  const lhs = `${nodeName(el.nodes[0])} − ${nodeName(el.nodes[1])}`;
  switch (el.type) {
    case 'vdc':
      return `${el.id}:  ${lhs} = ${formatValue(num(el.props, 'V'), 'V')}`;
    case 'vac':
      return `${el.id}:  ${lhs} = 0   (una senoidal no tiene componente continua)`;
    case 'inductor':
      return `${el.id}:  ${lhs} = 0   (bobina en continua: un cable)`;
    case 'ammeter':
      return `${el.id}:  ${lhs} = 0   (amperímetro ideal)`;
    default:
      return switchClosed(el.props, 'dc', 0)
        ? `${el.id}:  ${lhs} = 0   (interruptor cerrado)`
        : `${el.id}:  ${lhs} = ${formatValue(R_OPEN, 'Ω')} · I(${el.id})   (interruptor abierto)`;
  }
}
