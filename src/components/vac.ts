import { formatValue } from '../engine/units';
import { num, TWO_TERMINALS, type ComponentDef } from './types';

/**
 * Fuente senoidal: v(t) = A·sen(2πf·t + φ). El terminal 0 es el de referencia positiva.
 *  - DC: vale su valor medio, 0 V.
 *  - AC: fasor A∠φ (amplitud pico, referencia seno).
 *  - Transitorio: el valor instantáneo en cada paso.
 */
export const vac: ComponentDef = {
  type: 'vac',
  name: 'Fuente senoidal',
  prefix: 'V',
  terminals: TWO_TERMINALS,
  props: [
    { key: 'A', label: 'Amplitud (pico)', unit: 'V', kind: 'number', default: 10 },
    { key: 'f', label: 'Frecuencia', unit: 'Hz', kind: 'number', default: 50, positive: true },
    { key: 'phase', label: 'Fase', unit: '°', kind: 'number', default: 0 },
  ],
  summary: (p) => `${formatValue(num(p, 'A'), 'V')} · ${formatValue(num(p, 'f'), 'Hz')}`,
  stamp: (el, ctx) => {
    const A = num(el.props, 'A');
    const phi = (num(el.props, 'phase') * Math.PI) / 180;
    switch (ctx.mode) {
      case 'dc':
        ctx.sys.stampVoltage(el, 0);
        break;
      case 'ac':
        ctx.sys.stampVoltage(el, A * Math.cos(phi), A * Math.sin(phi));
        break;
      default:
        ctx.sys.stampVoltage(el, A * Math.sin(2 * Math.PI * num(el.props, 'f', 50) * ctx.t + phi));
    }
  },
  role: () => 'voltage',
};
