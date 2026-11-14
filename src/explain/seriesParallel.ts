/**
 * Reducción serie/paralelo: intenta colapsar la red resistiva vista por la
 * única fuente hasta una sola resistencia equivalente, anotando cada paso con
 * los valores reales, y después "desanda" el camino para repartir tensiones
 * y corrientes. Si la red no es reducible (un puente, por ejemplo) devuelve null.
 */
import { switchClosed } from '../components/switch';
import { num } from '../components/types';
import type { NetElement, Netlist } from '../engine/netlist';
import { formatValue } from '../engine/units';
import { formula, type Step } from './types';

interface Branch {
  name: string;
  r: number;
  a: number;
  b: number;
  kind: 'hoja' | 'serie' | 'paralelo';
  children: Branch[];
}

export interface SeriesParallelResult {
  steps: Step[];
  sourceId: string;
  req: number;
  /** Módulo de tensión y corriente de cada resistencia original. */
  results: Map<string, { v: number; i: number }>;
}

const ohm = (r: number) => formatValue(r, 'Ω');
const volt = (v: number) => formatValue(v, 'V');
const amp = (i: number) => formatValue(i, 'A');
const names = (bs: Branch[]) =>
  bs.length === 2
    ? `${bs[0].name} y ${bs[1].name}`
    : `${bs
        .slice(0, -1)
        .map((b) => b.name)
        .join(', ')} y ${bs[bs.length - 1].name}`;

export function reduceSeriesParallel(nl: Netlist): SeriesParallelResult | null {
  const sources = nl.elements.filter(
    (el) => el.type === 'vdc' || el.type === 'idc' || el.type === 'vac',
  );
  if (sources.length !== 1 || sources[0].type === 'vac') return null;
  const source = sources[0];

  // Componentes que en DC equivalen a un cable: se funden sus dos nodos.
  const parent = Array.from({ length: nl.nodeCount }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const notes: string[] = [];
  const isShort = (el: NetElement) =>
    el.type === 'ammeter' ||
    el.type === 'inductor' ||
    (el.type === 'switch' && switchClosed(el.props, 'dc', 0));
  for (const el of nl.elements) {
    if (isShort(el)) {
      parent[find(el.nodes[0])] = find(el.nodes[1]);
      notes.push(
        el.type === 'inductor'
          ? `${el.id}: en continua una bobina ideal se comporta como un cable.`
          : el.type === 'ammeter'
            ? `${el.id}: un amperímetro ideal es un cable (no altera el circuito).`
            : `${el.id}: interruptor cerrado, equivale a un cable.`,
      );
    } else if (el.type === 'capacitor') {
      notes.push(`${el.id}: en continua un capacitor es un circuito abierto; se quita.`);
    } else if (el.type === 'voltmeter') {
      notes.push(`${el.id}: un voltímetro ideal no toma corriente; se quita.`);
    } else if (el.type === 'switch') {
      notes.push(`${el.id}: interruptor abierto; esa rama se quita.`);
    }
  }

  const sa = find(source.nodes[0]);
  const sb = find(source.nodes[1]);
  if (sa === sb) return null;

  let branches: Branch[] = nl.elements
    .filter((el) => el.type === 'resistor')
    .map((el) => ({
      name: el.id,
      r: num(el.props, 'R', 1000),
      a: find(el.nodes[0]),
      b: find(el.nodes[1]),
      kind: 'hoja' as const,
      children: [],
    }));
  if (branches.length === 0) return null;

  const steps: Step[] = [];
  if (notes.length > 0) steps.push({ title: 'Simplificaciones para continua', lines: notes });

  const results = new Map<string, { v: number; i: number }>();
  const zero = (b: Branch) => {
    if (b.kind === 'hoja') results.set(b.name, { v: 0, i: 0 });
    b.children.forEach(zero);
  };

  let ns = 0;
  let np = 0;
  for (let guard = 0; guard < 1000; guard++) {
    // a) resistencias con los dos extremos en el mismo nodo
    const shorted = branches.find((b) => b.a === b.b);
    if (shorted) {
      steps.push({
        title: `${shorted.name} queda en cortocircuito`,
        lines: [
          `Los dos extremos de ${shorted.name} están unidos por un cable: su tensión es 0 V y no circula corriente por ella.`,
        ],
      });
      zero(shorted);
      branches = branches.filter((b) => b !== shorted);
      continue;
    }

    const degree = new Map<number, number>();
    const bump = (n: number) => degree.set(n, (degree.get(n) ?? 0) + 1);
    bump(sa);
    bump(sb);
    for (const b of branches) {
      bump(b.a);
      bump(b.b);
    }

    // b) ramas colgando: un extremo no se conecta con nada más
    const dangling = branches.find((b) => degree.get(b.a) === 1 || degree.get(b.b) === 1);
    if (dangling) {
      steps.push({
        title: `${dangling.name} no forma un camino cerrado`,
        lines: [
          `Uno de los extremos de ${dangling.name} queda suelto, así que no circula corriente por ella (I = 0, V = 0).`,
        ],
      });
      zero(dangling);
      branches = branches.filter((b) => b !== dangling);
      continue;
    }

    // c) paralelo: varias ramas entre el mismo par de nodos
    const groups = new Map<string, Branch[]>();
    for (const b of branches) {
      const key = `${Math.min(b.a, b.b)}-${Math.max(b.a, b.b)}`;
      groups.set(key, [...(groups.get(key) ?? []), b]);
    }
    const par = [...groups.values()].find((g) => g.length >= 2);
    if (par) {
      const r = 1 / par.reduce((acc, b) => acc + 1 / b.r, 0);
      const name = `Rp${++np}`;
      const detail =
        par.length === 2
          ? `${name} = (${par[0].name}·${par[1].name}) / (${par[0].name} + ${par[1].name}) = (${ohm(par[0].r)} · ${ohm(par[1].r)}) / (${ohm(par[0].r)} + ${ohm(par[1].r)}) = ${ohm(r)}`
          : `${name} = 1 / (${par.map((b) => `1/${ohm(b.r)}`).join(' + ')}) = ${ohm(r)}`;
      steps.push({
        title: `Paralelo: ${names(par)}`,
        lines: [
          `${names(par)} están conectadas entre los mismos dos nodos: tienen la misma tensión, están en paralelo.`,
          formula(`1/${name} = ${par.map((b) => `1/${b.name}`).join(' + ')}`),
          formula(detail),
        ],
      });
      branches = [
        ...branches.filter((b) => !par.includes(b)),
        { name, r, a: par[0].a, b: par[0].b, kind: 'paralelo', children: par },
      ];
      continue;
    }

    // d) serie: un nodo interno donde se tocan exactamente dos ramas
    let merged = false;
    for (const [node, deg] of degree) {
      if (node === sa || node === sb || deg !== 2) continue;
      const pair = branches.filter((b) => b.a === node || b.b === node);
      if (pair.length !== 2) continue;
      const [p, q] = pair;
      const r = p.r + q.r;
      const name = `Rs${++ns}`;
      steps.push({
        title: `Serie: ${names(pair)}`,
        lines: [
          `Entre ${p.name} y ${q.name} no se deriva ninguna otra rama: por las dos circula la misma corriente, están en serie.`,
          formula(`${name} = ${p.name} + ${q.name} = ${ohm(p.r)} + ${ohm(q.r)} = ${ohm(r)}`),
        ],
      });
      const endP = p.a === node ? p.b : p.a;
      const endQ = q.a === node ? q.b : q.a;
      branches = [
        ...branches.filter((b) => b !== p && b !== q),
        { name, r, a: endP, b: endQ, kind: 'serie', children: pair },
      ];
      merged = true;
      break;
    }
    if (!merged) break;
  }

  if (branches.length !== 1) return null;
  const top = branches[0];
  const connectsSource = (top.a === sa && top.b === sb) || (top.a === sb && top.b === sa);
  if (!connectsSource) return null;

  // --- Resistencia equivalente y magnitudes totales ------------------------------
  const req = top.r;
  let vTotal: number;
  let iTotal: number;
  if (source.type === 'vdc') {
    vTotal = Math.abs(num(source.props, 'V'));
    iTotal = vTotal / req;
    steps.push({
      title: 'Resistencia equivalente y corriente total',
      lines: [
        `Toda la red se redujo a una sola resistencia vista por ${source.id}:`,
        formula(`Req = ${ohm(req)}`),
        'Ley de Ohm sobre el circuito equivalente:',
        formula(`I = ${source.id} / Req = ${volt(vTotal)} / ${ohm(req)} = ${amp(iTotal)}`),
      ],
    });
  } else {
    iTotal = Math.abs(num(source.props, 'I'));
    vTotal = iTotal * req;
    steps.push({
      title: 'Resistencia equivalente y tensión total',
      lines: [
        `Toda la red se redujo a una sola resistencia vista por ${source.id}:`,
        formula(`Req = ${ohm(req)}`),
        'La fuente impone la corriente; la tensión sale de la ley de Ohm:',
        formula(`V = ${source.id} · Req = ${amp(iTotal)} · ${ohm(req)} = ${volt(vTotal)}`),
      ],
    });
  }

  // --- Camino de vuelta: repartir V e I --------------------------------------------
  const back: string[] = [];
  const assign = (b: Branch, v: number, i: number) => {
    if (b.kind === 'hoja') {
      results.set(b.name, { v, i });
      return;
    }
    if (b.kind === 'serie') {
      back.push(
        `${b.name} es la serie de ${names(b.children)}: comparten la corriente I = ${amp(i)} y la tensión se reparte (divisor de tensión).`,
      );
      for (const c of b.children) {
        back.push(
          formula(`V(${c.name}) = I · ${c.name} = ${amp(i)} · ${ohm(c.r)} = ${volt(i * c.r)}`),
        );
      }
      for (const c of b.children) assign(c, i * c.r, i);
    } else {
      back.push(
        `${b.name} es el paralelo de ${names(b.children)}: comparten la tensión V = ${volt(v)} y la corriente se reparte (divisor de corriente).`,
      );
      for (const c of b.children) {
        back.push(
          formula(`I(${c.name}) = V / ${c.name} = ${volt(v)} / ${ohm(c.r)} = ${amp(v / c.r)}`),
        );
      }
      for (const c of b.children) assign(c, v, v / c.r);
    }
  };
  assign(top, vTotal, iTotal);
  if (back.length > 0) steps.push({ title: 'Desandar la reducción', lines: back });

  const summary = [...results.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([id, r]) =>
      formula(`${id}:  V = ${volt(r.v)}   I = ${amp(r.i)}   P = ${formatValue(r.v * r.i, 'W')}`),
    );
  steps.push({ title: 'Resultado en cada resistencia', lines: summary });

  return { steps, sourceId: source.id, req, results };
}
