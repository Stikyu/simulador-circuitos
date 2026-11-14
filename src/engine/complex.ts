/** Aritmética mínima de números complejos (forma binómica). */
export interface Complex {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const ZERO: Complex = { re: 0, im: 0 };

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

export function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
/** Argumento en radianes, en (−π, π]. */
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);
export const argDeg = (a: Complex): number => (arg(a) * 180) / Math.PI;

export const fromPolar = (mag: number, phaseRad: number): Complex => ({
  re: mag * Math.cos(phaseRad),
  im: mag * Math.sin(phaseRad),
});
