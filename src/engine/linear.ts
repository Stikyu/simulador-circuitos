/**
 * Resolución de sistemas lineales densos por eliminación gaussiana con
 * pivoteo parcial y escalado de filas. Versión real y versión compleja.
 *
 * Los circuitos didácticos tienen decenas de incógnitas como mucho, así que
 * una matriz densa O(n³) es más simple, más fácil de testear y sobra en velocidad.
 */

export class SingularMatrixError extends Error {
  /** Índice de la fila/columna donde no se encontró pivote. */
  readonly index: number;
  constructor(index: number) {
    super('Matriz singular');
    this.name = 'SingularMatrixError';
    this.index = index;
  }
}

/** Pivote relativo (después de escalar filas) por debajo del cual se considera singular. */
const EPS = 1e-13;

/** Resuelve A·x = b con números reales. No modifica los argumentos. */
export function solveReal(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row) => row.slice());
  const x = b.slice();

  // Escalado: cada fila se divide por su mayor elemento para que el pivoteo
  // compare magnitudes relativas (hay conductancias de 1e-9 S junto a unos).
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = Math.max(s, Math.abs(M[i][j]));
    if (s === 0) throw new SingularMatrixError(i);
    for (let j = 0; j < n; j++) M[i][j] /= s;
    x[i] /= s;
  }

  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (best < EPS) throw new SingularMatrixError(k);
    if (p !== k) {
      [M[k], M[p]] = [M[p], M[k]];
      [x[k], x[p]] = [x[p], x[k]];
    }
    const pivotRow = M[k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / pivotRow[k];
      if (f === 0) continue;
      const row = M[i];
      for (let j = k; j < n; j++) row[j] -= f * pivotRow[j];
      x[i] -= f * x[k];
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export interface ComplexVector {
  re: number[];
  im: number[];
}

/** Resuelve A·x = b con números complejos (partes real e imaginaria por separado). */
export function solveComplex(
  Are: number[][],
  Aim: number[][],
  bre: number[],
  bim: number[],
): ComplexVector {
  const n = bre.length;
  const R = Are.map((row) => row.slice());
  const I = Aim.map((row) => row.slice());
  const xr = bre.slice();
  const xi = bim.slice();

  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s = Math.max(s, Math.hypot(R[i][j], I[i][j]));
    if (s === 0) throw new SingularMatrixError(i);
    for (let j = 0; j < n; j++) {
      R[i][j] /= s;
      I[i][j] /= s;
    }
    xr[i] /= s;
    xi[i] /= s;
  }

  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.hypot(R[k][k], I[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.hypot(R[i][k], I[i][k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (best < EPS) throw new SingularMatrixError(k);
    if (p !== k) {
      [R[k], R[p]] = [R[p], R[k]];
      [I[k], I[p]] = [I[p], I[k]];
      [xr[k], xr[p]] = [xr[p], xr[k]];
      [xi[k], xi[p]] = [xi[p], xi[k]];
    }
    const pr = R[k][k];
    const pi = I[k][k];
    const pd = pr * pr + pi * pi;
    for (let i = k + 1; i < n; i++) {
      // f = M[i][k] / pivote
      const ar = R[i][k];
      const ai = I[i][k];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * pr + ai * pi) / pd;
      const fi = (ai * pr - ar * pi) / pd;
      for (let j = k; j < n; j++) {
        const br = R[k][j];
        const bi = I[k][j];
        R[i][j] -= fr * br - fi * bi;
        I[i][j] -= fr * bi + fi * br;
      }
      xr[i] -= fr * xr[k] - fi * xi[k];
      xi[i] -= fr * xi[k] + fi * xr[k];
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let sr = xr[i];
    let si = xi[i];
    for (let j = i + 1; j < n; j++) {
      sr -= R[i][j] * xr[j] - I[i][j] * xi[j];
      si -= R[i][j] * xi[j] + I[i][j] * xr[j];
    }
    const pr = R[i][i];
    const pi = I[i][i];
    const pd = pr * pr + pi * pi;
    xr[i] = (sr * pr + si * pi) / pd;
    xi[i] = (si * pr - sr * pi) / pd;
  }
  return { re: xr, im: xi };
}
