import { useEffect, useState } from 'react';
import { formatValue, parseValue } from '../engine/units';

interface ValueInputProps {
  id?: string;
  value: number;
  unit: string;
  positive?: boolean;
  onChange: (value: number) => void;
  ariaLabel?: string;
}

/**
 * Campo numérico que entiende prefijos SI: se puede tipear "4,7k" o "100n".
 * Confirma con Enter o al perder el foco.
 */
export function ValueInput({ id, value, unit, positive, onChange, ariaLabel }: ValueInputProps) {
  const [text, setText] = useState(() => formatValue(value, unit));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatValue(value, unit));
    setInvalid(false);
  }, [value, unit]);

  const commit = () => {
    const parsed = parseValue(text);
    if (parsed === null || (positive && parsed <= 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatValue(parsed, unit));
    if (parsed !== value) onChange(parsed);
  };

  return (
    <input
      id={id}
      className={`value-input ${invalid ? 'invalid' : ''}`}
      type="text"
      inputMode="text"
      spellCheck={false}
      autoComplete="off"
      value={text}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      title={invalid ? 'Valor no válido. Ejemplos: 4,7k · 100n · 2.2M' : undefined}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).select();
        } else if (e.key === 'Escape') {
          setText(formatValue(value, unit));
          setInvalid(false);
        }
      }}
    />
  );
}
