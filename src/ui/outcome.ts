import { CircuitError } from '../engine/errors';

/** Resultado de un análisis: o el valor, o un error para mostrar. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: CircuitError };

export function attempt<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof CircuitError) return { ok: false, error: err };
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: new CircuitError('singular', `No se pudo resolver el circuito (${detail}).`),
    };
  }
}
