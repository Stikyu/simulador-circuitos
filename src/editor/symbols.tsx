import type { ComponentType, Rotation } from '../engine/circuit';
import { bool, type Props } from '../components/types';

interface SymbolProps {
  type: ComponentType;
  rot?: Rotation;
  props?: Props;
  /** Estado a dibujar en un interruptor (si se omite, el inicial). */
  closed?: boolean;
}

/**
 * Símbolo de un componente en coordenadas locales (píxeles), sin rotar:
 * los terminales de dos patas quedan en (−40, 0) y (40, 0).
 * `rot` solo se usa para mantener derechos los signos y letras.
 */
export function ComponentSymbol({ type, rot = 0, props, closed }: SymbolProps) {
  const upright = `rotate(${-rot * 90})`;
  const leads = <path className="sym" d="M-40 0H-13M13 0H40" />;
  switch (type) {
    case 'resistor':
      return <path className="sym" d="M-40 0H-18l3-7 6 14 6-14 6 14 6-14 6 14 3-7H40" />;
    case 'vdc':
      return (
        <>
          {leads}
          <circle className="sym body" r="13" />
          <g transform={`translate(-6 0) ${upright}`}>
            <path className="sym thin pos" d="M-3 0H3M0-3V3" />
          </g>
          <g transform={`translate(6 0) ${upright}`}>
            <path className="sym thin neg" d="M-3 0H3" />
          </g>
        </>
      );
    case 'vac':
      return (
        <>
          {leads}
          <circle className="sym body" r="13" />
          <g transform={upright}>
            <path className="sym thin" d="M-7 0q3.5-9 7 0t7 0" />
          </g>
          <g transform={`translate(-19 -8) ${upright}`}>
            <path className="sym thin pos" d="M-3 0H3M0-3V3" />
          </g>
        </>
      );
    case 'idc':
      return (
        <>
          {leads}
          <circle className="sym body" r="13" />
          <path className="sym thin" d="M7 0H-7M-2.5-4.5L-7 0l4.5 4.5" />
        </>
      );
    case 'capacitor':
      return <path className="sym" d="M-40 0H-4M4 0H40M-4-12V12M4-12V12" />;
    case 'inductor':
      return (
        <path
          className="sym"
          d="M-40 0H-20a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0H40"
        />
      );
    case 'switch': {
      const isClosed = closed ?? bool(props ?? {}, 'closed');
      return (
        <>
          <path className="sym" d="M-40 0H-12M12 0H40" />
          <path className="sym" d={isClosed ? 'M-12 0H12' : 'M-12 0L10-11'} />
          <circle className="sym body" cx="-12" r="2.6" />
          <circle className="sym body" cx="12" r="2.6" />
        </>
      );
    }
    case 'ammeter':
    case 'voltmeter':
      return (
        <>
          {leads}
          <circle className="sym body meter" r="13" />
          <text className="sym-text" transform={upright}>
            {type === 'ammeter' ? 'A' : 'V'}
          </text>
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
