import type { ComponentType, PropValue } from '../src/engine/circuit';
import { netlistFromElements, type NetElement, type Netlist } from '../src/engine/netlist';

/** Atajo para describir un elemento: el('R1', 'resistor', [1, 2], { R: 1000 }). */
export function el(
  id: string,
  type: ComponentType,
  nodes: [number, number],
  props: Record<string, PropValue> = {},
): NetElement {
  return { id, type, nodes, props };
}

export const net = (...elements: NetElement[]): Netlist => netlistFromElements(elements);

/** Error relativo, con piso absoluto para comparar contra cero. */
export function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
}
