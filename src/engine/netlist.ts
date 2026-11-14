/**
 * Del dibujo al grafo eléctrico: agrupa en un mismo NODO todos los puntos
 * unidos por cables (union-find) y devuelve la lista de elementos con los
 * nodos a los que se conecta cada terminal. El nodo 0 es tierra.
 */
import { terminalPositions } from '../components/registry';
import {
  pointKey,
  pointOnSegment,
  type Circuit,
  type ComponentType,
  type Point,
  type PropValue,
} from './circuit';

export interface NetElement {
  id: string;
  type: ComponentType;
  /** Nodo de cada terminal, en el mismo orden que la definición del componente. */
  nodes: number[];
  props: Record<string, PropValue>;
}

export interface Netlist {
  /** Cantidad de nodos, contando tierra (nodo 0). */
  nodeCount: number;
  elements: NetElement[];
  hasGround: boolean;
  /** Puntos de grilla que pertenecen a cada nodo (para rotular el dibujo). */
  nodePoints: Point[][];
}

class UnionFind {
  private parent: number[] = [];
  make(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

export function buildNetlist(circuit: Circuit): Netlist {
  const uf = new UnionFind();
  const index = new Map<string, number>();
  const points: Point[] = [];
  const idOf = (p: Point): number => {
    const k = pointKey(p);
    let i = index.get(k);
    if (i === undefined) {
      i = uf.make();
      index.set(k, i);
      points.push(p);
    }
    return i;
  };

  const terminals = circuit.components.map((c) => terminalPositions(c).map(idOf));
  for (const w of circuit.wires) {
    idOf(w.a);
    idOf(w.b);
  }
  // Un cable une sus extremos y también todo punto que caiga sobre él (uniones en T).
  for (const w of circuit.wires) {
    const a = idOf(w.a);
    uf.union(a, idOf(w.b));
    points.forEach((p, i) => {
      if (pointOnSegment(p, w.a, w.b)) uf.union(a, i);
    });
  }

  // Todas las tierras son el mismo nodo de referencia.
  let groundRoot = -1;
  circuit.components.forEach((c, ci) => {
    if (c.type !== 'ground') return;
    if (groundRoot < 0) groundRoot = uf.find(terminals[ci][0]);
    else {
      uf.union(terminals[ci][0], groundRoot);
      groundRoot = uf.find(groundRoot);
    }
  });
  const hasGround = groundRoot >= 0;
  if (hasGround) groundRoot = uf.find(groundRoot);

  const nodeOfRoot = new Map<number, number>();
  if (hasGround) nodeOfRoot.set(groundRoot, 0);
  let nodeCount = 1;
  const nodeOf = (pointId: number): number => {
    const root = uf.find(pointId);
    let n = nodeOfRoot.get(root);
    if (n === undefined) {
      n = nodeCount++;
      nodeOfRoot.set(root, n);
    }
    return n;
  };

  const elements: NetElement[] = [];
  circuit.components.forEach((c, ci) => {
    if (c.type === 'ground') return;
    elements.push({ id: c.id, type: c.type, nodes: terminals[ci].map(nodeOf), props: c.props });
  });

  const nodePoints: Point[][] = Array.from({ length: nodeCount }, () => []);
  points.forEach((p, i) => {
    const n = nodeOfRoot.get(uf.find(i));
    if (n !== undefined) nodePoints[n].push(p);
  });

  return { nodeCount, elements, hasGround, nodePoints };
}

/** Arma una netlist a mano (sin dibujo). Útil para tests y para análisis derivados. */
export function netlistFromElements(elements: NetElement[]): Netlist {
  const nodeCount = Math.max(0, ...elements.flatMap((e) => e.nodes)) + 1;
  return {
    nodeCount,
    elements,
    hasGround: true,
    nodePoints: Array.from({ length: nodeCount }, () => []),
  };
}
