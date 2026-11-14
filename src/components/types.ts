import type { ComponentType, Point, PropValue } from '../engine/circuit';
import type { AnalysisMode, StampCtx } from '../engine/mna';
import type { NetElement } from '../engine/netlist';

export interface PropDef {
  key: string;
  label: string;
  unit: string;
  kind: 'number' | 'boolean';
  default: PropValue;
  /** Si es true, el valor debe ser estrictamente positivo. */
  positive?: boolean;
  help?: string;
}

export type Props = Record<string, PropValue>;

/**
 * Papel topológico de un componente en un tipo de análisis:
 *  - 'voltage': impone la tensión entre sus terminales (fuente, cable ideal).
 *  - 'path': deja pasar corriente (ata el potencial de sus nodos entre sí).
 *  - 'open': no une eléctricamente sus nodos (capacitor en DC, fuente de corriente).
 * Se usa para detectar nodos flotantes y lazos de fuentes ANTES de resolver.
 */
export type Role = 'voltage' | 'path' | 'open';

/**
 * Definición de un tipo de componente: geometría de terminales, propiedades
 * editables y cómo aporta ("estampa") a la matriz MNA.
 */
export interface ComponentDef {
  type: ComponentType;
  /** Nombre visible en español. */
  name: string;
  /** Prefijo de la etiqueta automática: R → R1, R2... */
  prefix: string;
  /** Terminales en coordenadas locales de grilla, sin rotar. */
  terminals: Point[];
  props: PropDef[];
  /** Texto corto que acompaña al símbolo (por ejemplo "4,7 kΩ"). */
  summary: (props: Props) => string;
  /** Aporte del componente al sistema MNA según el tipo de análisis. */
  stamp: (el: NetElement, ctx: StampCtx) => void;
  role: (mode: AnalysisMode, props: Props, t: number) => Role;
}

export const num = (props: Props, key: string, fallback = 0): number => {
  const v = props[key];
  return typeof v === 'number' ? v : fallback;
};

export const bool = (props: Props, key: string, fallback = false): boolean => {
  const v = props[key];
  return typeof v === 'boolean' ? v : fallback;
};

/** Terminales estándar de un componente de dos patas (4 celdas de largo). */
export const TWO_TERMINALS: Point[] = [
  { x: -2, y: 0 },
  { x: 2, y: 0 },
];

/** Resistencia de un voltímetro y de un interruptor abierto: "casi" infinita. */
export const R_OPEN = 1e9;
