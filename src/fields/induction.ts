/**
 * Inducción electromagnética: un imán (dipolo magnético de momento m, alineado
 * con el eje) se mueve a lo largo del eje de una bobina circular de radio a y
 * N espiras. Ley de Faraday-Lenz:   ε = −N · dΦ/dt
 *
 * Flujo de un dipolo a través de una espira coaxial, a distancia z del centro:
 *     Φ(z) = μ0 · m · a² / ( 2 · (a² + z²)^(3/2) )
 */
import { MU0 } from './magnetostatics';

export interface Coil {
  /** Radio de la bobina [m]. */
  a: number;
  /** Número de espiras. */
  turns: number;
  /** Resistencia del circuito de la bobina [Ω]. */
  resistance: number;
}

/** Flujo por espira [Wb] cuando el imán está a distancia z del plano de la bobina. */
export function flux(m: number, a: number, z: number): number {
  return (MU0 * m * a * a) / (2 * Math.pow(a * a + z * z, 1.5));
}

/** dΦ/dz [Wb/m]. */
export function fluxGradient(m: number, a: number, z: number): number {
  return (-3 * MU0 * m * a * a * z) / (2 * Math.pow(a * a + z * z, 2.5));
}

/** fem inducida [V] para un imán en z que se mueve con velocidad v: ε = −N·(dΦ/dz)·v. */
export function emf(m: number, coil: Coil, z: number, v: number): number {
  return -coil.turns * fluxGradient(m, coil.a, z) * v;
}

/** Posición donde |dΦ/dz| es máximo: z = ±a/2. */
export const peakEmfPosition = (a: number): number => a / 2;

export type Motion =
  | { kind: 'pasa'; speed: number; range: number }
  | { kind: 'oscila'; amplitude: number; frequency: number };

/** Posición y velocidad del imán en el instante t para cada tipo de movimiento. */
export function magnetState(motion: Motion, t: number): { z: number; v: number } {
  if (motion.kind === 'oscila') {
    const w = 2 * Math.PI * motion.frequency;
    return { z: motion.amplitude * Math.sin(w * t), v: motion.amplitude * w * Math.cos(w * t) };
  }
  // Va y vuelve entre −range y +range a velocidad constante (onda triangular).
  const period = (4 * motion.range) / motion.speed;
  const phase = (((t % period) + period) % period) / period;
  if (phase < 0.5) return { z: -motion.range + 4 * motion.range * phase, v: motion.speed };
  return { z: motion.range - 4 * motion.range * (phase - 0.5), v: -motion.speed };
}
