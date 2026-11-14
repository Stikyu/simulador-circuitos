import {
  rotatePoint,
  type ComponentInstance,
  type ComponentType,
  type Point,
} from '../engine/circuit';
import { ground } from './ground';
import { resistor } from './resistor';
import type { ComponentDef, Props } from './types';
import { vdc } from './vdc';

export const COMPONENTS: Record<ComponentType, ComponentDef> = {
  resistor,
  vdc,
  ground,
};

/** Orden en que aparecen en la paleta. */
export const PALETTE: ComponentType[] = ['resistor', 'vdc', 'ground'];

export const KNOWN_TYPES = Object.keys(COMPONENTS);

export const defOf = (type: ComponentType): ComponentDef => COMPONENTS[type];

export function defaultProps(type: ComponentType): Props {
  const props: Props = {};
  for (const p of COMPONENTS[type].props) props[p.key] = p.default;
  return props;
}

/** Posiciones absolutas (en grilla) de los terminales de un componente. */
export function terminalPositions(c: ComponentInstance): Point[] {
  return COMPONENTS[c.type].terminals.map((t) => {
    const r = rotatePoint(t, c.rot);
    return { x: c.x + r.x, y: c.y + r.y };
  });
}
