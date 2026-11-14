import type { AnalysisMode } from '../engine/mna';
import { formatValue } from '../engine/units';
import { bool, num, R_OPEN, TWO_TERMINALS, type ComponentDef, type Props } from './types';

/**
 * ¿Está cerrado el interruptor en el instante t?
 * En DC y AC se usa siempre el estado inicial. En el transitorio conmuta
 * (una sola vez) cuando t alcanza el instante configurado.
 */
export function switchClosed(props: Props, mode: AnalysisMode, t: number): boolean {
  const initial = bool(props, 'closed');
  const toggles = bool(props, 'conmuta', true);
  if ((mode === 'tran' || mode === 'ic') && toggles && t >= num(props, 'tSwitch')) return !initial;
  return initial;
}

/** Comienzo del paso que termina en t (con un margen contra el redondeo). */
export const intervalStart = (t: number, h: number): number => t - h * (1 - 1e-6);

/**
 * Interruptor ideal. Siempre es una rama con corriente incógnita:
 *    cerrado:  va − vb = 0
 *    abierto:  va − vb − R_OPEN·i = 0   (1 GΩ: prácticamente no circula nada)
 * Así la estructura de la matriz no cambia al conmutar.
 */
export const switchDef: ComponentDef = {
  type: 'switch',
  name: 'Interruptor',
  prefix: 'S',
  terminals: TWO_TERMINALS,
  props: [
    { key: 'closed', label: 'Cerrado al inicio', unit: '', kind: 'boolean', default: false },
    {
      key: 'conmuta',
      label: 'Conmuta en el transitorio',
      unit: '',
      kind: 'boolean',
      default: true,
    },
    {
      key: 'tSwitch',
      label: 'Instante de conmutación',
      unit: 's',
      kind: 'number',
      default: 0,
      help: 'En ese instante cambia de estado (solo en el análisis transitorio).',
    },
  ],
  summary: (p) =>
    bool(p, 'conmuta', true)
      ? `${bool(p, 'closed') ? 'abre' : 'cierra'} en ${formatValue(num(p, 'tSwitch'), 's')}`
      : bool(p, 'closed')
        ? 'cerrado'
        : 'abierto',
  // En el transitorio, el paso que termina en t resuelve el intervalo (t − h, t]:
  // el estado que vale es el del COMIENZO del intervalo. Así una conmutación
  // en t0 recién afecta al paso que arranca en t0.
  stamp: (el, ctx) => {
    const t = ctx.mode === 'tran' ? intervalStart(ctx.t, ctx.h) : ctx.t;
    ctx.sys.stampVoltage(el, 0, 0, switchClosed(el.props, ctx.mode, t) ? 0 : R_OPEN);
  },
  role: (mode, props, t) => (switchClosed(props, mode, t) ? 'voltage' : 'path'),
};
