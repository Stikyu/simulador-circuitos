import { formatValue } from '../engine/units';
import { num, TWO_TERMINALS, type ComponentDef } from './types';

/**
 * Fuente de corriente continua ideal. La flecha apunta al terminal 0:
 * por dentro la corriente va del terminal 1 al 0, así que i(a→b) = −I.
 */
export const idc: ComponentDef = {
  type: 'idc',
  name: 'Fuente de corriente DC',
  prefix: 'I',
  terminals: TWO_TERMINALS,
  props: [{ key: 'I', label: 'Corriente', unit: 'A', kind: 'number', default: 0.01 }],
  summary: (p) => formatValue(num(p, 'I'), 'A'),
  // No aporta a la matriz: solo al vector de corrientes. En AC vale 0 (abierta).
  stamp: (el, ctx) =>
    ctx.sys.stampAdmittance(el, 0, 0, ctx.mode === 'ac' ? 0 : -num(el.props, 'I')),
  role: () => 'open',
};
