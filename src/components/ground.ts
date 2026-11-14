import type { ComponentDef } from './types';

/** Tierra: fija el nodo de referencia (0 V). */
export const ground: ComponentDef = {
  type: 'ground',
  name: 'Tierra',
  prefix: 'GND',
  terminals: [{ x: 0, y: 0 }],
  props: [],
  summary: () => '',
};
