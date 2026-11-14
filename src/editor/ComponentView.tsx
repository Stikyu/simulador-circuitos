import { defOf } from '../components/registry';
import type { ComponentInstance } from '../engine/circuit';
import { GRID } from './grid';
import { ComponentSymbol, hitBox } from './symbols';

interface ComponentViewProps {
  c: ComponentInstance;
  selected: boolean;
  error: boolean;
  /** Texto de resultado (corriente o lectura). */
  extra?: string;
  /** Sentido real de la corriente: +1 de a hacia b, −1 al revés, 0 sin flecha. */
  dir?: number;
  /** Estado del interruptor en el instante mostrado. */
  closed?: boolean;
  onSelect: () => void;
}

export function ComponentView({
  c,
  selected,
  error,
  extra,
  dir = 0,
  closed,
  onSelect,
}: ComponentViewProps) {
  const def = defOf(c.type);
  const hb = hitBox(c.type);
  const vertical = c.rot % 2 === 1;
  const summary = def.summary(c.props);
  const showLabels = c.type !== 'ground';
  const lines = [summary, extra].filter((s): s is string => !!s);
  const lineClass = (text: string) => (text === extra ? 'label-extra' : 'label-val');
  return (
    <g
      data-id={c.id}
      className={`comp ${selected ? 'selected' : ''} ${error ? 'error' : ''}`}
      transform={`translate(${c.x * GRID} ${c.y * GRID})`}
      tabIndex={0}
      role="button"
      aria-label={[`${def.name} ${c.id}`, summary, extra].filter(Boolean).join(', ')}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <g transform={`rotate(${c.rot * 90})`}>
        <rect className="comp-hit" x={hb.x} y={hb.y} width={hb.w} height={hb.h} rx="6" />
        <ComponentSymbol type={c.type} rot={c.rot} props={c.props} closed={closed} />
        {dir !== 0 && (
          <path
            className="flow-arrow"
            d="M-34-4.5L-26 0l-8 4.5z"
            transform={dir < 0 ? 'scale(-1 1)' : undefined}
          />
        )}
      </g>
      {showLabels &&
        (vertical ? (
          <>
            <text className="label-id" x="20" y={lines.length > 1 ? -9 : -3}>
              {c.id}
            </text>
            {lines.map((t, i) => (
              <text
                key={i}
                className={lineClass(t)}
                x="20"
                y={(lines.length > 1 ? 5 : 12) + i * 14}
              >
                {t}
              </text>
            ))}
          </>
        ) : (
          <>
            <text className="label-id" x="0" y="-20" textAnchor="middle">
              {c.id}
            </text>
            {lines.map((t, i) => (
              <text key={i} className={lineClass(t)} x="0" y={30 + i * 14} textAnchor="middle">
                {t}
              </text>
            ))}
          </>
        ))}
    </g>
  );
}
