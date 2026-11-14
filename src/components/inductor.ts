import { formatValue } from '../engine/units';
import { num, TWO_TERMINALS, type ComponentDef } from './types';

/**
 * Bobina: v = L·di/dt.
 *  - DC: cortocircuito (fuente de 0 V; su corriente es incógnita).
 *  - AC: admitancia Y = 1/(jωL) = −j/(ωL).
 *  - Transitorio: modelo equivalente de Norton. Con la regla trapezoidal:
 *        i[n+1] = (h/2L)·v[n+1] + ( i[n] + (h/2L)·v[n] )
 *    conductancia Geq = h/2L en paralelo con una fuente de corriente.
 *    Con Euler hacia atrás: Geq = h/L, Ieq = i[n].
 *  - Condición inicial (t = 0): fuente de corriente de valor i0.
 */
export const inductor: ComponentDef = {
  type: 'inductor',
  name: 'Bobina',
  prefix: 'L',
  terminals: TWO_TERMINALS,
  props: [
    { key: 'L', label: 'Inductancia', unit: 'H', kind: 'number', default: 10e-3, positive: true },
    {
      key: 'i0',
      label: 'Corriente inicial',
      unit: 'A',
      kind: 'number',
      default: 0,
      help: 'Corriente por la bobina en t = 0 (transitorio).',
    },
  ],
  summary: (p) => formatValue(num(p, 'L'), 'H'),
  stamp: (el, ctx) => {
    const L = num(el.props, 'L', 10e-3);
    switch (ctx.mode) {
      case 'dc':
        ctx.sys.stampVoltage(el, 0);
        break;
      case 'ac':
        ctx.sys.stampAdmittance(el, 0, -1 / (ctx.omega * L));
        break;
      case 'ic':
        ctx.sys.stampAdmittance(el, 0, 0, ctx.state.get(el.id)?.i ?? num(el.props, 'i0'));
        break;
      case 'tran': {
        const prev = ctx.state.get(el.id) ?? { v: 0, i: 0 };
        if (ctx.method === 'trap') {
          const g = ctx.h / (2 * L);
          ctx.sys.stampAdmittance(el, g, 0, prev.i + g * prev.v);
        } else {
          const g = ctx.h / L;
          ctx.sys.stampAdmittance(el, g, 0, prev.i);
        }
        break;
      }
    }
  },
  role: (mode) => (mode === 'dc' ? 'voltage' : mode === 'ic' ? 'open' : 'path'),
};
