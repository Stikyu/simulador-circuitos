/**
 * Corriente por cada tramo de cable, para animar el sentido real de circulación.
 *
 * MNA no la calcula: todos los cables de un nodo son "el mismo punto". Pero si
 * se conoce la corriente que entra o sale por cada terminal, la de cada tramo
 * sale por conservación: sobre un árbol de cables, la corriente de un tramo es
 * la suma de lo que inyectan los terminales que cuelgan de él.
 */
import { terminalPositions } from '../components/registry';
import { pointKey, pointOnSegment, type Circuit, type Point } from './circuit';

export interface Flow {
  a: Point;
  b: Point;
  /** Corriente que circula de a hacia b (puede ser negativa). */
  current: number;
  /** Id del componente si el tramo es el cuerpo de uno; undefined si es cable. */
  componentId?: string;
}

export function computeFlows(circuit: Circuit, currents: Map<string, number>): Flow[] {
  const flows: Flow[] = [];

  // Vértices: extremos de cable y terminales.
  const index = new Map<string, number>();
  const pts: Point[] = [];
  const idOf = (p: Point): number => {
    const k = pointKey(p);
    let i = index.get(k);
    if (i === undefined) {
      i = pts.length;
      index.set(k, i);
      pts.push(p);
    }
    return i;
  };
  for (const w of circuit.wires) {
    idOf(w.a);
    idOf(w.b);
  }

  // Inyección de corriente de cada terminal hacia la red de cables.
  const injection: number[] = [];
  const isGround: boolean[] = [];
  for (const c of circuit.components) {
    const terms = terminalPositions(c);
    if (c.type === 'ground') {
      isGround[idOf(terms[0])] = true;
      continue;
    }
    const i = currents.get(c.id) ?? 0;
    const a = idOf(terms[0]);
    const b = idOf(terms[1]);
    // La corriente entra al componente por a (sale de la red) y vuelve por b.
    injection[a] = (injection[a] ?? 0) - i;
    injection[b] = (injection[b] ?? 0) + i;
    flows.push({ a: terms[0], b: terms[1], current: i, componentId: c.id });
  }

  // Aristas: cada cable partido en los vértices que caen sobre él.
  const adj: { to: number }[][] = pts.map(() => []);
  for (const w of circuit.wires) {
    const on = pts
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => pointOnSegment(p, w.a, w.b))
      .sort(
        (u, v) =>
          Math.hypot(u.p.x - w.a.x, u.p.y - w.a.y) - Math.hypot(v.p.x - w.a.x, v.p.y - w.a.y),
      );
    for (let k = 0; k + 1 < on.length; k++) {
      adj[on[k].i].push({ to: on[k + 1].i });
      adj[on[k + 1].i].push({ to: on[k].i });
    }
  }

  // Árbol generador por componente conexa, con raíz en tierra si la hay.
  const visited = new Array<boolean>(pts.length).fill(false);
  const order = [...pts.keys()].sort((u, v) => Number(!!isGround[v]) - Number(!!isGround[u]));
  for (const root of order) {
    if (visited[root] || adj[root].length === 0) continue;
    const parent = new Map<number, number>();
    const bfs: number[] = [root];
    visited[root] = true;
    for (let q = 0; q < bfs.length; q++) {
      for (const { to } of adj[bfs[q]]) {
        if (visited[to]) continue;
        visited[to] = true;
        parent.set(to, bfs[q]);
        bfs.push(to);
      }
    }
    // De las hojas a la raíz: cada vértice empuja hacia su padre lo que acumula.
    const acc = new Map<number, number>();
    for (let q = bfs.length - 1; q > 0; q--) {
      const v = bfs[q];
      const total = (acc.get(v) ?? 0) + (injection[v] ?? 0);
      const p = parent.get(v)!;
      acc.set(p, (acc.get(p) ?? 0) + total);
      flows.push({ a: pts[v], b: pts[p], current: total });
    }
  }
  return flows;
}
