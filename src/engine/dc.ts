/**
 * Análisis en continua (punto de operación): arma G·x = b y lo resuelve.
 */
import { defOf } from '../components/registry';
import { validateTopology } from './checks';
import type { Circuit, ComponentType } from './circuit';
import { CircuitError } from './errors';
import { SingularMatrixError } from './linear';
import { MnaSystem, newCtx, type StampCtx } from './mna';
import { buildNetlist, type Netlist } from './netlist';

export interface ElementResult {
  id: string;
  type: ComponentType;
  nodes: number[];
  /** Tensión entre terminales, v(a) − v(b). */
  voltage: number;
  /** Corriente que atraviesa el componente del terminal a al b. */
  current: number;
  /** Potencia absorbida, v·i (negativa si el componente entrega energía). */
  power: number;
}

export interface DCSolution {
  netlist: Netlist;
  /** Tensión de cada nodo; el índice 0 es tierra. */
  nodeVoltages: number[];
  elements: ElementResult[];
  byId: Map<string, ElementResult>;
  /** Sistema lineal tal como se resolvió, para poder mostrarlo paso a paso. */
  matrix: { A: number[][]; b: number[]; x: number[]; labels: string[] };
}

/** Recorre los elementos y deja que cada uno estampe su aporte. */
export function buildSystem(nl: Netlist, ctxInit: Partial<StampCtx> & Pick<StampCtx, 'mode'>) {
  const sys = new MnaSystem(nl.nodeCount);
  const ctx = newCtx(sys, ctxInit.mode, ctxInit);
  for (const el of nl.elements) defOf(el.type).stamp(el, ctx);
  return sys;
}

/** Traduce un pivote nulo a un mensaje con los componentes involucrados. */
export function explainSingular(err: unknown, sys: MnaSystem, nl: Netlist): never {
  if (!(err instanceof SingularMatrixError)) throw err;
  const where = sys.describeIndex(err.index);
  const ids =
    'node' in where
      ? nl.elements.filter((el) => el.nodes.includes(where.node)).map((el) => el.id)
      : [where.branch];
  throw new CircuitError(
    'singular',
    'El circuito no tiene solución única (matriz singular).',
    ids,
    'Suele deberse a un nodo sin referencia, a fuentes ideales en conflicto o a un lazo sin resistencia. Revisá los componentes resaltados.',
  );
}

export function solveDCNetlist(nl: Netlist): DCSolution {
  validateTopology(nl, 'dc');
  const sys = buildSystem(nl, { mode: 'dc' });
  const { A, b } = sys.assembleReal();
  let x: number[];
  try {
    x = sys.solveReal();
  } catch (err) {
    explainSingular(err, sys, nl);
  }

  const nodeVoltages = Array.from({ length: nl.nodeCount }, (_, n) => sys.nodeVoltage(x, n));
  const elements: ElementResult[] = nl.elements.map((el) => {
    const voltage = nodeVoltages[el.nodes[0]] - nodeVoltages[el.nodes[1]];
    const current = sys.elementCurrent(x, el);
    return {
      id: el.id,
      type: el.type,
      nodes: el.nodes,
      voltage,
      current,
      power: voltage * current,
    };
  });
  return {
    netlist: nl,
    nodeVoltages,
    elements,
    byId: new Map(elements.map((e) => [e.id, e])),
    matrix: { A, b, x, labels: sys.unknownLabels() },
  };
}

export function solveDC(circuit: Circuit): DCSolution {
  return solveDCNetlist(buildNetlist(circuit));
}
