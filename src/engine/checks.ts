/**
 * Validaciones topológicas previas a resolver. Detectan sobre el GRAFO los
 * casos que dejarían la matriz singular, para poder explicar el problema en
 * español y señalar los componentes culpables (un "pivote nulo" no le dice
 * nada a un estudiante).
 */
import { defOf } from '../components/registry';
import { CircuitError } from './errors';
import type { AnalysisMode } from './mna';
import type { NetElement, Netlist } from './netlist';

const list = (ids: string[]): string =>
  ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} y ${ids[ids.length - 1]}`;

const isSource = (el: NetElement) => el.type === 'vdc' || el.type === 'vac';

export function validateTopology(nl: Netlist, mode: AnalysisMode, t = 0): void {
  if (nl.elements.length === 0) {
    throw new CircuitError(
      'vacio',
      'El circuito está vacío.',
      [],
      'Colocá componentes desde la paleta.',
    );
  }
  if (!nl.hasGround) {
    throw new CircuitError(
      'sin-tierra',
      'Falta la tierra: el circuito no tiene nodo de referencia.',
      [],
      'Las tensiones se miden respecto de un punto. Agregá el símbolo de tierra en algún nodo (por ejemplo, el negativo de la fuente).',
    );
  }

  for (const el of nl.elements) {
    for (const p of defOf(el.type).props) {
      const v = el.props[p.key];
      if (p.positive && typeof v === 'number' && !(v > 0)) {
        throw new CircuitError(
          'parametro',
          `${el.id}: "${p.label}" tiene que ser mayor que cero.`,
          [el.id],
          'Editá el valor en el panel de propiedades.',
        );
      }
    }
  }

  const roleOf = (el: NetElement) => defOf(el.type).role(mode, el.props, t);

  // --- 1. Lazos formados solo por ramas que imponen tensión --------------------
  const parent = Array.from({ length: nl.nodeCount }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const accepted: NetElement[] = [];
  for (const el of nl.elements) {
    if (roleOf(el) !== 'voltage') continue;
    const [a, b] = el.nodes;
    if (a === b) {
      if (isSource(el)) {
        throw new CircuitError(
          'fuente-en-corto',
          `${el.id} está en cortocircuito: sus dos terminales quedaron unidos por un cable.`,
          [el.id],
          'Una fuente ideal en corto entregaría corriente infinita. Intercalá una resistencia o revisá el cableado.',
        );
      }
      continue;
    }
    if (find(a) === find(b)) {
      const loop = [...pathBetween(accepted, a, b), el];
      throw loopError(loop, mode);
    }
    parent[find(a)] = find(b);
    accepted.push(el);
  }

  // --- 2. Nodos sin camino conductor hacia tierra --------------------------------
  const adj: number[][] = Array.from({ length: nl.nodeCount }, () => []);
  for (const el of nl.elements) {
    if (roleOf(el) === 'open') continue;
    const [a, b] = el.nodes;
    adj[a].push(b);
    adj[b].push(a);
  }
  const seen = new Array<boolean>(nl.nodeCount).fill(false);
  const queue = [0];
  seen[0] = true;
  while (queue.length > 0) {
    const n = queue.pop()!;
    for (const m of adj[n]) {
      if (!seen[m]) {
        seen[m] = true;
        queue.push(m);
      }
    }
  }
  const floating = nl.elements.filter((el) => el.nodes.some((n) => !seen[n]));
  if (floating.length > 0) {
    const ids = floating.map((el) => el.id);
    const hasCap = floating.some((el) => el.type === 'capacitor');
    const hasI = floating.some((el) => el.type === 'idc');
    let hint =
      'Todo nodo necesita un camino conductor hasta la tierra. Revisá que no falte un cable.';
    if (mode === 'dc' && hasCap) {
      hint =
        'En DC un capacitor es un circuito abierto: el nodo que queda detrás de él no tiene camino a tierra. Probá el análisis transitorio o agregá una resistencia en paralelo.';
    } else if (hasI) {
      hint =
        'Una fuente de corriente ideal no fija la tensión de sus nodos: hace falta además un camino resistivo hasta tierra.';
    }
    throw new CircuitError(
      'nodo-flotante',
      `Nodo flotante: ${list(ids)} ${ids.length === 1 ? 'no tiene' : 'no tienen'} camino conductor hacia tierra.`,
      ids,
      hint,
    );
  }
}

/** Camino entre dos nodos usando solo las ramas dadas (BFS). */
function pathBetween(edges: NetElement[], from: number, to: number): NetElement[] {
  const prev = new Map<number, { node: number; el: NetElement }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n === to) break;
    for (const el of edges) {
      const [a, b] = el.nodes;
      const m = a === n ? b : b === n ? a : -1;
      if (m < 0 || seen.has(m)) continue;
      seen.add(m);
      prev.set(m, { node: n, el });
      queue.push(m);
    }
  }
  const path: NetElement[] = [];
  let cur = to;
  while (cur !== from) {
    const step = prev.get(cur);
    if (!step) break;
    path.push(step.el);
    cur = step.node;
  }
  return path;
}

function loopError(loop: NetElement[], mode: AnalysisMode): CircuitError {
  const ids = loop.map((el) => el.id);
  const sources = loop.filter(isSource);
  const hasInductor = loop.some((el) => el.type === 'inductor');
  const hasShort = loop.some((el) => el.type === 'ammeter' || el.type === 'switch');

  if (sources.length === loop.length) {
    return new CircuitError(
      'lazo-tension',
      `Fuentes de tensión en paralelo (o en lazo cerrado): ${list(ids)}.`,
      ids,
      'Dos fuentes ideales no pueden imponer tensiones sobre los mismos nodos: el sistema queda indeterminado. Agregá una resistencia en serie con alguna.',
    );
  }
  if (hasInductor && mode === 'dc') {
    return new CircuitError(
      'lazo-tension',
      `Lazo sin resistencia entre ${list(ids)}.`,
      ids,
      'En DC una bobina ideal se comporta como un cable: junto con las fuentes forma un lazo donde la corriente no queda definida. Agregá una resistencia en serie (toda bobina real tiene alguna).',
    );
  }
  if (hasShort) {
    return new CircuitError(
      'lazo-tension',
      `Cortocircuito ideal: ${list(ids)} forman un lazo sin resistencia.`,
      ids,
      'Un amperímetro ideal o un interruptor cerrado equivalen a un cable. Conectá el amperímetro en serie, no en paralelo.',
    );
  }
  return new CircuitError(
    'lazo-tension',
    `Lazo de fuentes de tensión: ${list(ids)}.`,
    ids,
    'Agregá una resistencia en algún punto del lazo.',
  );
}
