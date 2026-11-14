/**
 * Operaciones puras sobre el circuito. Cada una devuelve un circuito nuevo,
 * lo que hace trivial el undo/redo (se guardan instantáneas inmutables).
 */
import {
  pointKey,
  samePoint,
  type Circuit,
  type ComponentInstance,
  type ComponentType,
  type Point,
  type PropValue,
  type Rotation,
  type Wire,
} from '../engine/circuit';
import { defaultProps, defOf, terminalPositions } from '../components/registry';

export function nextComponentId(circuit: Circuit, prefix: string): string {
  const ids = new Set(circuit.components.map((c) => c.id));
  let n = 1;
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function nextWireIds(circuit: Circuit, count: number): string[] {
  const ids = new Set(circuit.wires.map((w) => w.id));
  const out: string[] = [];
  let n = 1;
  while (out.length < count) {
    const id = `w${n++}`;
    if (!ids.has(id)) out.push(id);
  }
  return out;
}

export function addComponent(
  circuit: Circuit,
  type: ComponentType,
  at: Point,
  rot: Rotation = 0,
  props?: Record<string, PropValue>,
): { circuit: Circuit; id: string } {
  const id = nextComponentId(circuit, defOf(type).prefix);
  const comp: ComponentInstance = {
    id,
    type,
    x: at.x,
    y: at.y,
    rot,
    props: { ...defaultProps(type), ...props },
  };
  return { circuit: { ...circuit, components: [...circuit.components, comp] }, id };
}

/** Traza un cable ortogonal en "L": primero horizontal, después vertical. */
export function routeWire(a: Point, b: Point): [Point, Point][] {
  if (samePoint(a, b)) return [];
  if (a.x === b.x || a.y === b.y) return [[a, b]];
  const corner = { x: b.x, y: a.y };
  return [
    [a, corner],
    [corner, b],
  ];
}

export function addWires(circuit: Circuit, segments: [Point, Point][]): Circuit {
  const valid = segments.filter(([a, b]) => !samePoint(a, b));
  if (valid.length === 0) return circuit;
  const ids = nextWireIds(circuit, valid.length);
  const wires: Wire[] = valid.map(([a, b], i) => ({ id: ids[i], a: { ...a }, b: { ...b } }));
  return { ...circuit, wires: [...circuit.wires, ...wires] };
}

export function deleteItems(circuit: Circuit, ids: readonly string[]): Circuit {
  const set = new Set(ids);
  return {
    ...circuit,
    components: circuit.components.filter((c) => !set.has(c.id)),
    wires: circuit.wires.filter((w) => !set.has(w.id)),
  };
}

/**
 * Aplica una transformación a los componentes elegidos y arrastra los extremos
 * de cable que estaban enganchados a sus terminales ("efecto elástico"), para
 * que mover o rotar no rompa las conexiones.
 */
function transformItems(
  circuit: Circuit,
  ids: readonly string[],
  moveComp: (c: ComponentInstance) => ComponentInstance,
  moveWirePoint: (p: Point) => Point,
): Circuit {
  const set = new Set(ids);
  const remap = new Map<string, Point>();
  const components = circuit.components.map((c) => {
    if (!set.has(c.id)) return c;
    const moved = moveComp(c);
    const before = terminalPositions(c);
    const after = terminalPositions(moved);
    before.forEach((p, i) => remap.set(pointKey(p), after[i]));
    return moved;
  });
  const wires = circuit.wires
    .map((w) => {
      if (set.has(w.id)) return { ...w, a: moveWirePoint(w.a), b: moveWirePoint(w.b) };
      const a = remap.get(pointKey(w.a)) ?? w.a;
      const b = remap.get(pointKey(w.b)) ?? w.b;
      return a === w.a && b === w.b ? w : { ...w, a, b };
    })
    .filter((w) => !samePoint(w.a, w.b));
  return { ...circuit, components, wires };
}

export function moveItems(
  circuit: Circuit,
  ids: readonly string[],
  dx: number,
  dy: number,
): Circuit {
  if (dx === 0 && dy === 0) return circuit;
  return transformItems(
    circuit,
    ids,
    (c) => ({ ...c, x: c.x + dx, y: c.y + dy }),
    (p) => ({ x: p.x + dx, y: p.y + dy }),
  );
}

/** Rota 90° en sentido horario cada componente elegido sobre su propio centro. */
export function rotateItems(circuit: Circuit, ids: readonly string[]): Circuit {
  const compIds = ids.filter((id) => circuit.components.some((c) => c.id === id));
  if (compIds.length === 0) return circuit;
  return transformItems(
    circuit,
    compIds,
    (c) => ({ ...c, rot: ((c.rot + 1) % 4) as Rotation }),
    (p) => p,
  );
}

export function setProp(circuit: Circuit, id: string, key: string, value: PropValue): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((c) =>
      c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c,
    ),
  };
}

/** Duplica la selección desplazada una celda en diagonal. Devuelve los ids nuevos. */
export function duplicateItems(
  circuit: Circuit,
  ids: readonly string[],
  offset: Point = { x: 1, y: 1 },
): { circuit: Circuit; ids: string[] } {
  const set = new Set(ids);
  let next = circuit;
  const created: string[] = [];
  for (const c of circuit.components.filter((c) => set.has(c.id))) {
    const r = addComponent(next, c.type, { x: c.x + offset.x, y: c.y + offset.y }, c.rot, c.props);
    next = r.circuit;
    created.push(r.id);
  }
  const segs = circuit.wires
    .filter((w) => set.has(w.id))
    .map((w): [Point, Point] => [
      { x: w.a.x + offset.x, y: w.a.y + offset.y },
      { x: w.b.x + offset.x, y: w.b.y + offset.y },
    ]);
  const before = new Set(next.wires.map((w) => w.id));
  next = addWires(next, segs);
  for (const w of next.wires) if (!before.has(w.id)) created.push(w.id);
  return { circuit: next, ids: created };
}

/** Caja que contiene todo el circuito, en unidades de grilla. */
export function boundingBox(circuit: Circuit): { min: Point; max: Point } | null {
  const pts: Point[] = [];
  for (const c of circuit.components) pts.push(...terminalPositions(c), { x: c.x, y: c.y });
  for (const w of circuit.wires) pts.push(w.a, w.b);
  if (pts.length === 0) return null;
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}
