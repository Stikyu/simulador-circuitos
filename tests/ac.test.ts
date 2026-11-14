import { describe, expect, it } from 'vitest';
import { analyzeResponse, solveACNetlist, sweepAC } from '../src/engine/ac';
import { abs, argDeg } from '../src/engine/complex';
import { CircuitError } from '../src/engine/errors';
import { el, net, relErr } from './helpers';

const TOL = 1e-9;

describe('AC: impedancia y fase', () => {
  it('RL serie: |Z| = √(R² + (ωL)²), fase = atan(ωL/R)', () => {
    const R = 100;
    const L = 0.1;
    const f = 50;
    const w = 2 * Math.PI * f;
    const s = solveACNetlist(
      net(
        el('V1', 'vac', [1, 0], { A: 10, f, phase: 0 }),
        el('R1', 'resistor', [1, 2], { R }),
        el('L1', 'inductor', [2, 0], { L }),
      ),
    );
    const z = s.source!.impedance!;
    expect(relErr(abs(z), Math.hypot(R, w * L))).toBeLessThan(TOL);
    expect(relErr(argDeg(z), (Math.atan2(w * L, R) * 180) / Math.PI)).toBeLessThan(TOL);
    // La corriente atrasa a la tensión en un circuito inductivo.
    expect(argDeg(s.source!.current)).toBeLessThan(0);
    expect(s.source!.character).toBe('inductivo');
    // La impedancia de la bobina es jωL: +90°.
    expect(relErr(abs(s.byId.get('L1')!.impedance!), w * L)).toBeLessThan(TOL);
    expect(relErr(argDeg(s.byId.get('L1')!.impedance!), 90)).toBeLessThan(TOL);
  });

  it('RC serie: fase negativa, |Xc| = 1/(ωC)', () => {
    const R = 1000;
    const C = 1e-6;
    const f = 159.154943;
    const w = 2 * Math.PI * f;
    const s = solveACNetlist(
      net(
        el('V1', 'vac', [1, 0], { A: 5, f, phase: 0 }),
        el('R1', 'resistor', [1, 2], { R }),
        el('C1', 'capacitor', [2, 0], { C }),
      ),
    );
    const zc = s.byId.get('C1')!.impedance!;
    expect(relErr(abs(zc), 1 / (w * C))).toBeLessThan(TOL);
    expect(relErr(argDeg(zc), -90)).toBeLessThan(TOL);
    const z = s.source!.impedance!;
    expect(relErr(abs(z), Math.hypot(R, 1 / (w * C)))).toBeLessThan(TOL);
    expect(relErr(argDeg(z), (-Math.atan(1 / (w * R * C)) * 180) / Math.PI)).toBeLessThan(TOL);
    expect(s.source!.character).toBe('capacitivo');
    // En la frecuencia de corte, R = Xc: la tensión sobre C es A/√2 a −45°.
    expect(relErr(abs(s.byId.get('C1')!.voltage), 5 / Math.SQRT2)).toBeLessThan(1e-6);
    expect(relErr(argDeg(s.byId.get('C1')!.voltage), -45)).toBeLessThan(1e-6);
  });

  it('la fase de la fuente se traslada a todos los fasores', () => {
    const s = solveACNetlist(
      net(
        el('V1', 'vac', [1, 0], { A: 10, f: 60, phase: 30 }),
        el('R1', 'resistor', [1, 0], { R: 5 }),
      ),
    );
    expect(relErr(argDeg(s.byId.get('R1')!.current), 30)).toBeLessThan(TOL);
    expect(relErr(abs(s.byId.get('R1')!.current), 2)).toBeLessThan(TOL);
  });

  it('potencias: P = ½·I²·R, Q = ½·I²·X, S² = P² + Q²', () => {
    const R = 30;
    const L = 0.1;
    const f = 50;
    const X = 2 * Math.PI * f * L;
    const s = solveACNetlist(
      net(
        el('V1', 'vac', [1, 0], { A: 100, f, phase: 0 }),
        el('R1', 'resistor', [1, 2], { R }),
        el('L1', 'inductor', [2, 0], { L }),
      ),
    );
    const I = 100 / Math.hypot(R, X);
    const src = s.source!;
    expect(relErr(src.power.re, 0.5 * I * I * R)).toBeLessThan(TOL);
    expect(relErr(src.power.im, 0.5 * I * I * X)).toBeLessThan(TOL);
    expect(relErr(abs(src.power), 0.5 * 100 * I)).toBeLessThan(TOL);
    expect(relErr(src.powerFactor, R / Math.hypot(R, X))).toBeLessThan(TOL);
    // La resistencia solo consume P; la bobina solo intercambia Q.
    expect(Math.abs(s.byId.get('R1')!.power.im)).toBeLessThan(1e-9);
    expect(Math.abs(s.byId.get('L1')!.power.re)).toBeLessThan(1e-9);
  });

  it('una fuente continua se anula en el análisis de alterna', () => {
    const s = solveACNetlist(
      net(
        el('V1', 'vac', [1, 0], { A: 2, f: 100, phase: 0 }),
        el('V2', 'vdc', [2, 1], { V: 9 }),
        el('R1', 'resistor', [2, 0], { R: 4 }),
      ),
    );
    expect(relErr(abs(s.byId.get('R1')!.current), 0.5)).toBeLessThan(TOL);
  });
});

describe('AC: RLC serie y resonancia', () => {
  const R = 50;
  const L = 0.01;
  const C = 1e-6;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const circuit = (f: number) =>
    net(
      el('V1', 'vac', [1, 0], { A: 10, f, phase: 0 }),
      el('R1', 'resistor', [1, 2], { R }),
      el('L1', 'inductor', [2, 3], { L }),
      el('C1', 'capacitor', [3, 0], { C }),
    );

  it('en resonancia Z = R, la corriente es máxima y está en fase', () => {
    const s = solveACNetlist(circuit(f0));
    expect(relErr(abs(s.source!.impedance!), R)).toBeLessThan(1e-9);
    expect(Math.abs(argDeg(s.source!.impedance!))).toBeLessThan(1e-6);
    expect(relErr(abs(s.source!.current), 10 / R)).toBeLessThan(1e-9);
    // Las tensiones en L y C son iguales y opuestas, y Q veces la de la fuente.
    const q = (2 * Math.PI * f0 * L) / R;
    expect(relErr(abs(s.byId.get('L1')!.voltage), 10 * q)).toBeLessThan(1e-9);
    expect(relErr(abs(s.byId.get('C1')!.voltage), 10 * q)).toBeLessThan(1e-9);
  });

  it('el barrido encuentra f0 = 1/(2π√LC) y el ancho de banda R/(2πL)', () => {
    const sweep = sweepAC(circuit(f0), { outputId: 'R1', fStart: 20, fStop: 200e3, points: 800 });
    const a = analyzeResponse(sweep);
    expect(a.kind).toBe('pasa-banda');
    expect(relErr(a.f0!, f0)).toBeLessThan(2e-3);
    expect(relErr(a.bandwidth!, R / (2 * Math.PI * L))).toBeLessThan(5e-3);
    expect(relErr(a.q!, (2 * Math.PI * f0 * L) / R)).toBeLessThan(5e-3);
    expect(relErr(a.peak, 1)).toBeLessThan(1e-3);
  });

  it('por debajo de f0 es capacitivo y por encima inductivo', () => {
    expect(solveACNetlist(circuit(f0 / 3)).source!.character).toBe('capacitivo');
    expect(solveACNetlist(circuit(f0 * 3)).source!.character).toBe('inductivo');
  });
});

describe('AC: filtros y Bode', () => {
  const R = 1600;
  const C = 100e-9;
  const fc = 1 / (2 * Math.PI * R * C);

  it('pasa bajos RC: corte en 1/(2πRC), −3 dB y −45°', () => {
    const nl = net(
      el('V1', 'vac', [1, 0], { A: 1, f: 1000, phase: 0 }),
      el('R1', 'resistor', [1, 2], { R }),
      el('C1', 'capacitor', [2, 0], { C }),
    );
    const sweep = sweepAC(nl, { outputId: 'C1', fStart: fc / 100, fStop: fc * 100, points: 401 });
    const a = analyzeResponse(sweep);
    expect(a.kind).toBe('pasa-bajos');
    expect(relErr(a.fc!, fc)).toBeLessThan(2e-3);
    const mid = 200; // punto central de la grilla: f = fc
    expect(relErr(sweep.freqs[mid], fc)).toBeLessThan(1e-9);
    expect(sweep.magDb[mid]).toBeCloseTo(-3.0103, 3);
    expect(sweep.phaseDeg[mid]).toBeCloseTo(-45, 6);
    // Dos décadas arriba: −40 dB (pendiente de −20 dB/década).
    expect(sweep.magDb[400]).toBeCloseTo(-40, 1);
    expect(sweep.magDb[0]).toBeCloseTo(0, 2);
  });

  it('pasa altos CR: mismo corte, fase +45°', () => {
    const nl = net(
      el('V1', 'vac', [1, 0], { A: 1, f: 1000, phase: 0 }),
      el('C1', 'capacitor', [1, 2], { C }),
      el('R1', 'resistor', [2, 0], { R }),
    );
    const sweep = sweepAC(nl, { outputId: 'R1', fStart: fc / 100, fStop: fc * 100, points: 401 });
    const a = analyzeResponse(sweep);
    expect(a.kind).toBe('pasa-altos');
    expect(relErr(a.fc!, fc)).toBeLessThan(2e-3);
    expect(sweep.phaseDeg[200]).toBeCloseTo(45, 6);
  });

  it('elimina banda: salida sobre L y C en serie', () => {
    const L = 0.01;
    const Cn = 1e-6;
    const nl = net(
      el('V1', 'vac', [1, 0], { A: 1, f: 1000, phase: 0 }),
      el('R1', 'resistor', [1, 2], { R: 100 }),
      el('L1', 'inductor', [2, 3], { L }),
      el('C1', 'capacitor', [3, 0], { C: Cn }),
      el('VM1', 'voltmeter', [2, 0]),
    );
    const sweep = sweepAC(nl, { outputId: 'VM1', fStart: 20, fStop: 200e3, points: 800 });
    const a = analyzeResponse(sweep);
    expect(a.kind).toBe('elimina-banda');
    expect(relErr(a.f0!, 1 / (2 * Math.PI * Math.sqrt(L * Cn)))).toBeLessThan(5e-3);
  });

  it('un divisor resistivo tiene respuesta plana', () => {
    const nl = net(
      el('V1', 'vac', [1, 0], { A: 1, f: 1000, phase: 0 }),
      el('R1', 'resistor', [1, 2], { R: 1000 }),
      el('R2', 'resistor', [2, 0], { R: 1000 }),
    );
    const a = analyzeResponse(sweepAC(nl, { outputId: 'R2', fStart: 10, fStop: 1e5, points: 50 }));
    expect(a.kind).toBe('plana');
    expect(relErr(a.peak, 0.5)).toBeLessThan(1e-9);
  });
});

describe('AC: errores', () => {
  it('sin fuente senoidal', () => {
    expect(() =>
      solveACNetlist(
        net(el('V1', 'vdc', [1, 0], { V: 5 }), el('R1', 'resistor', [1, 0], { R: 1 })),
      ),
    ).toThrow(/senoidal/);
  });

  it('fuentes de distinta frecuencia', () => {
    try {
      solveACNetlist(
        net(
          el('V1', 'vac', [1, 0], { A: 1, f: 50, phase: 0 }),
          el('V2', 'vac', [2, 0], { A: 1, f: 60, phase: 0 }),
          el('R1', 'resistor', [1, 2], { R: 1 }),
        ),
      );
      throw new Error('debía fallar');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitError);
      expect((err as CircuitError).code).toBe('frecuencias');
      expect((err as CircuitError).componentIds).toEqual(['V1', 'V2']);
    }
  });
});

describe('AC: pasa bajos con pico de resonancia', () => {
  it('la salida sobre C de un RLC serie poco amortiguado sigue siendo un pasa bajos', () => {
    const nl = net(
      el('V1', 'vac', [1, 0], { A: 1, f: 1000, phase: 0 }),
      el('R1', 'resistor', [1, 2], { R: 50 }),
      el('L1', 'inductor', [2, 3], { L: 0.01 }),
      el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
    );
    const a = analyzeResponse(
      sweepAC(nl, { outputId: 'C1', fStart: 10, fStop: 100e3, points: 700 }),
    );
    expect(a.kind).toBe('pasa-bajos');
    expect(a.peak).toBeGreaterThan(2);
    expect(a.fc!).toBeGreaterThan(a.f0!);
  });
});
