import type { ComponentDef } from './types';

/** Tierra: fija el nodo de referencia (0 V). No estampa nada: define qué nodo es el 0. */
export const ground: ComponentDef = {
  type: 'ground',
  name: 'Tierra',
  prefix: 'GND',
  terminals: [{ x: 0, y: 0 }],
  props: [],
  summary: () => '',
  stamp: () => {},
  role: () => 'open',
};
