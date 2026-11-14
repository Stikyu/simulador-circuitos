/**
 * Modelo de datos del circuito: un grafo serializable a JSON.
 * Las coordenadas están en unidades de grilla (enteros), no en píxeles.
 */

export interface Point {
  x: number;
  y: number;
}

/** Rotación en pasos de 90° en sentido horario (con el eje y hacia abajo). */
export type Rotation = 0 | 1 | 2 | 3;

export type ComponentType = 'resistor' | 'vdc' | 'ground';

export type PropValue = number | boolean;

export interface ComponentInstance {
  /** Identificador único y a la vez etiqueta visible (R1, V1, ...). */
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  rot: Rotation;
  props: Record<string, PropValue>;
}

export interface Wire {
  id: string;
  a: Point;
  b: Point;
}

export interface Circuit {
  version: 1;
  components: ComponentInstance[];
  wires: Wire[];
}

export function emptyCircuit(): Circuit {
  return { version: 1, components: [], wires: [] };
}

export const pointKey = (p: Point): string => `${p.x},${p.y}`;

export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Rota un punto local `steps` cuartos de vuelta en sentido horario (y hacia abajo). */
export function rotatePoint(p: Point, steps: Rotation): Point {
  let { x, y } = p;
  for (let i = 0; i < steps; i++) {
    [x, y] = [-y, x];
  }
  return { x: x + 0, y: y + 0 }; // "+ 0" evita el -0
}

/** ¿El punto p está sobre el segmento a–b (extremos incluidos)? Coordenadas enteras. */
export function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parsePoint(v: unknown, where: string): Point {
  if (!isObject(v) || !isNum(v.x) || !isNum(v.y)) {
    throw new Error(`Archivo inválido: punto mal formado en ${where}.`);
  }
  return { x: Math.round(v.x), y: Math.round(v.y) };
}

/**
 * Valida datos desconocidos (archivo, URL, localStorage) y devuelve un circuito sano.
 * `knownTypes` permite rechazar componentes que esta versión no conoce.
 */
export function parseCircuit(data: unknown, knownTypes: readonly string[]): Circuit {
  if (!isObject(data) || !Array.isArray(data.components) || !Array.isArray(data.wires)) {
    throw new Error('Archivo inválido: no parece un circuito de este simulador.');
  }
  const ids = new Set<string>();
  const components: ComponentInstance[] = data.components.map((raw: unknown, i: number) => {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string') {
      throw new Error(`Archivo inválido: componente #${i + 1} mal formado.`);
    }
    if (!knownTypes.includes(raw.type)) {
      throw new Error(`Archivo inválido: tipo de componente desconocido "${raw.type}".`);
    }
    if (ids.has(raw.id)) throw new Error(`Archivo inválido: identificador repetido "${raw.id}".`);
    ids.add(raw.id);
    const pos = parsePoint(raw, `el componente ${raw.id}`);
    const rot = (isNum(raw.rot) ? ((Math.round(raw.rot) % 4) + 4) % 4 : 0) as Rotation;
    const props: Record<string, PropValue> = {};
    if (isObject(raw.props)) {
      for (const [k, v] of Object.entries(raw.props)) {
        if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) props[k] = v;
      }
    }
    return { id: raw.id, type: raw.type as ComponentType, x: pos.x, y: pos.y, rot, props };
  });
  const wires: Wire[] = data.wires.map((raw: unknown, i: number) => {
    if (!isObject(raw)) throw new Error(`Archivo inválido: cable #${i + 1} mal formado.`);
    const id = typeof raw.id === 'string' ? raw.id : `w${i + 1}`;
    return { id, a: parsePoint(raw.a, `el cable ${id}`), b: parsePoint(raw.b, `el cable ${id}`) };
  });
  return { version: 1, components, wires };
}
