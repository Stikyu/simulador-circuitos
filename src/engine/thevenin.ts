/**
 * Equivalente de Thevenin / Norton visto desde los terminales de un componente.
 */
import { solveDCNetlist } from './dc';
import type { NetElement, Netlist } from './netlist';

export interface TheveninResult {
  /** Tensión a circuito abierto entre los terminales (a respecto de b). */
  vth: number;
  /** Resistencia vista con las fuentes independientes anuladas. */
  rth: number;
  /** Corriente de cortocircuito (Norton), de a hacia b por el corto. */
  inorton: number;
}

const withElements = (nl: Netlist, elements: NetElement[]): Netlist => ({ ...nl, elements });

/**
 * Calcula el equivalente visto desde el componente `loadId`, al que se quita
 * del circuito (es la "carga").
 *  1. Vth: tensión a circuito abierto.
 *  2. Rth: se anulan las fuentes (V → corto, I → abierta) y se inyecta 1 A de prueba.
 *  3. In:  se reemplaza la carga por un amperímetro ideal (un corto).
 */
export function theveninAt(nl: Netlist, loadId: string): TheveninResult {
  const load = nl.elements.find((el) => el.id === loadId);
  if (!load) throw new Error(`No existe el componente ${loadId}`);
  const rest = nl.elements.filter((el) => el.id !== loadId);
  const [a, b] = load.nodes;

  const open = solveDCNetlist(withElements(nl, rest));
  const vth = open.nodeVoltages[a] - open.nodeVoltages[b];

  const dead = rest.map((el): NetElement => {
    if (el.type === 'vdc') return { ...el, props: { ...el.props, V: 0 } };
    if (el.type === 'idc') return { ...el, props: { ...el.props, I: 0 } };
    return el;
  });
  // Fuente de prueba de 1 A que entra por el terminal a: la tensión resultante es Rth.
  const probe: NetElement = { id: '__prueba', type: 'idc', nodes: [a, b], props: { I: 1 } };
  const test = solveDCNetlist(withElements(nl, [...dead, probe]));
  const rth = test.nodeVoltages[a] - test.nodeVoltages[b];

  const short: NetElement = { id: '__corto', type: 'ammeter', nodes: [a, b], props: {} };
  let inorton: number;
  try {
    inorton = solveDCNetlist(withElements(nl, [...rest, short])).byId.get('__corto')!.current;
  } catch {
    inorton = rth !== 0 ? vth / rth : Infinity;
  }
  return { vth, rth, inorton };
}
