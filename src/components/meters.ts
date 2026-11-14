import { R_OPEN, TWO_TERMINALS, type ComponentDef } from './types';

/** Amperímetro ideal: un cable (0 V) cuya corriente de rama es la lectura. */
export const ammeter: ComponentDef = {
  type: 'ammeter',
  name: 'Amperímetro',
  prefix: 'A',
  terminals: TWO_TERMINALS,
  props: [],
  summary: () => '',
  stamp: (el, ctx) => ctx.sys.stampVoltage(el, 0),
  role: () => 'voltage',
};

/**
 * Voltímetro casi ideal: una resistencia de 1 GΩ. Se usa un valor enorme pero
 * finito para que un voltímetro mal conectado no deje la matriz singular.
 */
export const voltmeter: ComponentDef = {
  type: 'voltmeter',
  name: 'Voltímetro',
  prefix: 'VM',
  terminals: TWO_TERMINALS,
  props: [],
  summary: () => '',
  stamp: (el, ctx) => ctx.sys.stampAdmittance(el, 1 / R_OPEN),
  role: () => 'path',
};
