import { formatValue } from '../engine/units';
import { num, TWO_TERMINALS, type ComponentDef } from './types';

/**
 * Capacitor: i = C·dv/dt.
 *  - DC: circuito abierto (dv/dt = 0).
 *  - AC: admitancia Y = jωC.
 *  - Transitorio: modelo equivalente (companion model) de Norton. Discretizando
 *    con la regla trapezoidal:
 *        i[n+1] = (2C/h)·v[n+1] − ( (2C/h)·v[n] + i[n] )
 *    o sea una conductancia Geq = 2C/h en paralelo con una fuente de corriente
 *    que resume el pasado. Con Euler hacia atrás: Geq = C/h, Ieq = −(C/h)·v[n].
 *  - Condición inicial (t = 0): fuente de tensión de valor v0.
 */
export const capacitor: ComponentDef = {
  type: 'capacitor',
  name: 'Capacitor',
  prefix: 'C',
  terminals: TWO_TERMINALS,
  props: [
    { key: 'C', label: 'Capacidad', unit: 'F', kind: 'number', default: 1e-6, positive: true },
    {
      key: 'v0',
      label: 'Tensión inicial',
      unit: 'V',
      kind: 'number',
      default: 0,
      help: 'Carga del capacitor en t = 0 (transitorio).',
    },
  ],
  summary: (p) => formatValue(num(p, 'C'), 'F'),
  stamp: (el, ctx) => {
    const C = num(el.props, 'C', 1e-6);
    switch (ctx.mode) {
      case 'dc':
        ctx.sys.stampAdmittance(el, 0);
        break;
      case 'ac':
        ctx.sys.stampAdmittance(el, 0, ctx.omega * C);
        break;
      case 'ic':
        ctx.sys.stampVoltage(el, num(el.props, 'v0'));
        break;
      case 'tran': {
        const prev = ctx.state.get(el.id) ?? { v: 0, i: 0 };
        if (ctx.method === 'trap') {
          const g = (2 * C) / ctx.h;
          ctx.sys.stampAdmittance(el, g, 0, -(g * prev.v + prev.i));
        } else {
          const g = C / ctx.h;
          ctx.sys.stampAdmittance(el, g, 0, -g * prev.v);
        }
        break;
      }
    }
  },
  role: (mode) => (mode === 'dc' ? 'open' : mode === 'ic' ? 'voltage' : 'path'),
};
