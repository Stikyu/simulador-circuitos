import { formatValue } from '../engine/units';
import { num, TWO_TERMINALS, type ComponentDef } from './types';

export const resistor: ComponentDef = {
  type: 'resistor',
  name: 'Resistencia',
  prefix: 'R',
  terminals: TWO_TERMINALS,
  props: [
    { key: 'R', label: 'Resistencia', unit: 'Ω', kind: 'number', default: 1000, positive: true },
  ],
  summary: (p) => formatValue(num(p, 'R'), 'Ω'),
};
