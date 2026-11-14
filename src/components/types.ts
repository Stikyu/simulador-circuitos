import type { ComponentType, Point, PropValue } from '../engine/circuit';

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
 * Definición de un tipo de componente: geometría de terminales, propiedades
 * editables y (desde la etapa 2) cómo aporta a la matriz MNA.
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
