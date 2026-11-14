import { describe, expect, it } from 'vitest';
import { abs, add, cx, div, mul, sub } from '../src/engine/complex';
import { SingularMatrixError, solveComplex, solveReal } from '../src/engine/linear';

describe('solveReal', () => {
  it('resuelve un sistema 3×3 conocido', () => {
    const A = [
      [2, 1, -1],
      [-3, -1, 2],
      [-2, 1, 2],
    ];
    const x = solveReal(A, [8, -11, -3]);
    expect(x[0]).toBeCloseTo(2, 12);
    expect(x[1]).toBeCloseTo(3, 12);
    expect(x[2]).toBeCloseTo(-1, 12);
  });

  it('necesita pivoteo cuando el primer pivote es cero', () => {
    const x = solveReal(
      [
        [0, 1],
        [1, 0],
      ],
      [3, 7],
    );
    expect(x).toEqual([7, 3]);
  });

  it('tolera filas con escalas muy distintas', () => {
    const x = solveReal(
      [
        [1e-9, 1e-9],
        [1e6, -1e6],
      ],
      [3e-9, 1e6],
    );
    expect(x[0]).toBeCloseTo(2, 9);
    expect(x[1]).toBeCloseTo(1, 9);
  });

  it('no modifica sus argumentos', () => {
    const A = [
      [4, 1],
      [2, 3],
    ];
    const b = [1, 2];
    solveReal(A, b);
    expect(A).toEqual([
      [4, 1],
      [2, 3],
    ]);
    expect(b).toEqual([1, 2]);
  });

  it('detecta matrices singulares', () => {
    expect(() =>
      solveReal(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(SingularMatrixError);
    expect(() =>
      solveReal(
        [
          [0, 0],
          [1, 1],
        ],
        [0, 1],
      ),
    ).toThrow(SingularMatrixError);
  });
});

describe('solveComplex', () => {
  it('resuelve un sistema complejo y verifica el residuo', () => {
    const A = [
      [cx(1, 1), cx(2, -1)],
      [cx(0, 3), cx(4, 0)],
    ];
    const b = [cx(5, 0), cx(1, 2)];
    const x = solveComplex(
      A.map((r) => r.map((z) => z.re)),
      A.map((r) => r.map((z) => z.im)),
      b.map((z) => z.re),
      b.map((z) => z.im),
    );
    for (let i = 0; i < 2; i++) {
      let acc = cx(0);
      for (let j = 0; j < 2; j++) acc = add(acc, mul(A[i][j], cx(x.re[j], x.im[j])));
      expect(abs(sub(acc, b[i]))).toBeLessThan(1e-12);
    }
  });

  it('la división compleja es la inversa del producto', () => {
    const a = cx(3, -2);
    const b = cx(-1, 4);
    const back = mul(div(a, b), b);
    expect(back.re).toBeCloseTo(a.re, 12);
    expect(back.im).toBeCloseTo(a.im, 12);
  });
});
