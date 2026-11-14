/**
 * Lectura y escritura de valores con prefijos SI (k, M, m, µ, n, p...).
 * Se muestra con coma decimal; al leer se aceptan coma o punto.
 */

const PREFIX_VALUE: Record<string, number> = {
  G: 1e9,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  m: 1e-3,
  u: 1e-6,
  µ: 1e-6, // signo micro
  μ: 1e-6, // mu griega
  n: 1e-9,
  p: 1e-12,
};

const NUMBER_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-ZµμΩ°]*)$/;

/**
 * Convierte "4,7k", "100 nF", "2.2 MΩ", "1e-3" en un número en unidades base.
 * Devuelve null si el texto no se entiende.
 */
export function parseValue(text: string): number | null {
  const clean = text.trim().replace(/\s+/g, ' ').replace(',', '.').replace(/^−/, '-');
  const m = NUMBER_RE.exec(clean);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = m[2];
  if (suffix.toLowerCase().startsWith('meg')) return base * 1e6;
  const mult = suffix.length > 0 ? (PREFIX_VALUE[suffix[0]] ?? 1) : 1;
  return base * mult;
}

const OUT_PREFIXES: [number, string][] = [
  [9, 'G'],
  [6, 'M'],
  [3, 'k'],
  [0, ''],
  [-3, 'm'],
  [-6, 'µ'],
  [-9, 'n'],
  [-12, 'p'],
];

/** Número con coma decimal y `digits` cifras significativas, sin ceros de relleno. */
export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s: string;
  if (abs >= 1e6 || abs < 1e-4) {
    const [mant, exp] = value.toExponential(digits - 1).split('e');
    s = `${Number(mant)}·10^${Number(exp)}`;
  } else {
    s = String(Number(value.toPrecision(digits)));
  }
  return s.replace('.', ',').replace(/-/g, '−');
}

/** Formatea 4700 → "4,7 kΩ", 1e-6 → "1 µF". */
export function formatValue(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `${formatNumber(value)} ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  let exp = Math.floor(Math.log10(abs) / 3) * 3;
  exp = Math.max(-12, Math.min(9, exp));
  let mant = Number((value / 10 ** exp).toPrecision(digits));
  if (Math.abs(mant) >= 1000 && exp < 9) {
    exp += 3;
    mant = Number((value / 10 ** exp).toPrecision(digits));
  }
  const prefix = OUT_PREFIXES.find(([e]) => e === exp)?.[1] ?? '';
  return `${formatNumber(mant, digits)} ${prefix}${unit}`.trim();
}

/** Como formatValue, pero trata como cero el ruido numérico por debajo de `floor`. */
export function formatResult(value: number, unit: string, floor = 1e-12, digits = 3): string {
  return formatValue(Math.abs(value) < floor ? 0 : value, unit, digits);
}
