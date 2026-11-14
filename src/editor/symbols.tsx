import type { ComponentType, Rotation } from '../engine/circuit';
import type { Props } from '../components/types';

interface SymbolProps {
  type: ComponentType;
  rot?: Rotation;
  props?: Props;
}

/**
 * Símbolo de un componente en coordenadas locales (píxeles), sin rotar:
 * los terminales de dos patas quedan en (−40, 0) y (40, 0).
 * `rot` solo se usa para mantener derechos los signos y letras.
 */
export function ComponentSymbol({ type, rot = 0 }: SymbolProps) {
  const upright = `rotate(${-rot * 90})`;
  switch (type) {
    case 'resistor':
      return <path className="sym" d="M-40 0H-18l3-7 6 14 6-14 6 14 6-14 6 14 3-7H40" />;
    case 'vdc':
      return (
        <>
          <path className="sym" d="M-40 0H-13M13 0H40" />
          <circle className="sym body" r="13" />
          <g transform={`translate(-6 0) ${upright}`}>
            <path className="sym thin pos" d="M-3 0H3M0-3V3" />
          </g>
          <g transform={`translate(6 0) ${upright}`}>
            <path className="sym thin neg" d="M-3 0H3" />
          </g>
        </>
      );
    case 'ground':
      return <path className="sym" d="M0 0V8M-10 8H10M-6 12.5H6M-2.5 17H2.5" />;
  }
}

/** Área (en píxeles locales) que responde al clic para cada tipo. */
export function hitBox(type: ComponentType): { x: number; y: number; w: number; h: number } {
  if (type === 'ground') return { x: -12, y: -4, w: 24, h: 24 };
  return { x: -40, y: -15, w: 80, h: 30 };
}
