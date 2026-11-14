import { formatValue } from '../engine/units';
import { num, TWO_TERMINALS, type ComponentDef } from './types';

/** Fuente de tensión continua ideal. El terminal 0 es el positivo. */
export const vdc: ComponentDef = {
  type: 'vdc',
  name: 'Fuente de tensión DC',
  prefix: 'V',
  terminals: TWO_TERMINALS,
  props: [{ key: 'V', label: 'Tensión', unit: 'V', kind: 'number', default: 10 }],
  summary: (p) => formatValue(num(p, 'V'), 'V'),
};
