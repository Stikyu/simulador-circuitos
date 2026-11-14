import { describe, expect, it } from 'vitest';
import {
  simulateTransientNetlist,
  stateMatrix,
  type TransientOptions,
} from '../src/engine/transient';
import { el, net, relErr } from './helpers';

const opts = (
  tStop: number,
  dt: number,
  extra: Partial<TransientOptions> = {},
): TransientOptions => ({
  tStop,
  dt,
  method: 'trap',
  initial: 'props',
  ...extra,
});

/** Máximo error absoluto entre la simulación y una función analítica. */
function maxError(time: Float64Array, data: Float64Array, exact: (t: number) => number): number {
  let worst = 0;
  for (let k = 0; k < time.length; k++) worst = Math.max(worst, Math.abs(data[k] - exact(time[k])));
  return worst;
}

describe('transitorio RC', () => {
  const R = 1000;
  const C = 1e-6;
  const tau = R * C;
  const rc = net(
    el('V1', 'vdc', [1, 0], { V: 5 }),
    el('R1', 'resistor', [1, 2], { R }),
    el('C1', 'capacitor', [2, 0], { C, v0: 0 }),
  );

  it('carga: v(t) = V·(1 − e^(−t/τ)) con τ = RC', () => {
    const r = simulateTransientNetlist(rc, opts(5 * tau, tau / 500));
    const vC = r.voltages.get('C1')!;
    expect(maxError(r.time, vC, (t) => 5 * (1 - Math.exp(-t / tau)))).toBeLessThan(5e-6);
  });

  it('en t = τ el capacitor llegó al 63,2 % del valor final', () => {
    const r = simulateTransientNetlist(rc, opts(2 * tau, tau / 500));
    const k = 500; // t = τ exacto
    expect(relErr(r.time[k], tau)).toBeLessThan(1e-12);
    expect(relErr(r.voltages.get('C1')![k], 5 * (1 - Math.exp(-1)))).toBeLessThan(1e-6);
  });

  it('la corriente arranca en V/R y decae con la misma τ', () => {
    const r = simulateTransientNetlist(rc, opts(5 * tau, tau / 500));
    const i = r.currents.get('C1')!;
    expect(relErr(i[0], 5 / R)).toBeLessThan(1e-9);
    expect(maxError(r.time, i, (t) => (5 / R) * Math.exp(-t / tau))).toBeLessThan(5e-9);
  });

  it('descarga desde una tensión inicial', () => {
    const nl = net(
      el('R1', 'resistor', [1, 0], { R }),
      el('C1', 'capacitor', [1, 0], { C, v0: 12 }),
    );
    const r = simulateTransientNetlist(nl, opts(5 * tau, tau / 500));
    expect(maxError(r.time, r.voltages.get('C1')!, (t) => 12 * Math.exp(-t / tau))).toBeLessThan(
      2e-5,
    );
  });

  it('la constante de tiempo usa la resistencia de Thevenin', () => {
    // Divisor 2 kΩ / 2 kΩ cargando el capacitor: Rth = 1 kΩ, V∞ = 5 V
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('R1', 'resistor', [1, 2], { R: 2000 }),
      el('R2', 'resistor', [2, 0], { R: 2000 }),
      el('C1', 'capacitor', [2, 0], { C }),
    );
    const r = simulateTransientNetlist(nl, opts(5 * tau, tau / 500));
    expect(
      maxError(r.time, r.voltages.get('C1')!, (t) => 5 * (1 - Math.exp(-t / tau))),
    ).toBeLessThan(5e-6);
  });

  it('Euler hacia atrás también converge (con más error que la trapezoidal)', () => {
    const exact = (t: number) => 5 * (1 - Math.exp(-t / tau));
    const trap = simulateTransientNetlist(rc, opts(5 * tau, tau / 100));
    const be = simulateTransientNetlist(rc, opts(5 * tau, tau / 100, { method: 'be' }));
    const eTrap = maxError(trap.time, trap.voltages.get('C1')!, exact);
    const eBe = maxError(be.time, be.voltages.get('C1')!, exact);
    expect(eBe).toBeLessThan(0.02);
    expect(eTrap).toBeLessThan(eBe / 20);
  });
});

describe('transitorio RL', () => {
  const R = 100;
  const L = 0.05;
  const tau = L / R;

  it('la corriente crece como (V/R)·(1 − e^(−t/τ)) con τ = L/R', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('R1', 'resistor', [1, 2], { R }),
      el('L1', 'inductor', [2, 0], { L }),
    );
    const r = simulateTransientNetlist(nl, opts(5 * tau, tau / 500));
    const i = r.currents.get('L1')!;
    expect(maxError(r.time, i, (t) => 0.1 * (1 - Math.exp(-t / tau)))).toBeLessThan(2e-7);
    expect(relErr(i[500], 0.1 * (1 - Math.exp(-1)))).toBeLessThan(1e-6);
    // En t = 0⁺ toda la tensión cae en la bobina.
    expect(relErr(r.voltages.get('L1')![0], 10)).toBeLessThan(1e-9);
  });

  it('con régimen DC previo, al abrir el interruptor la corriente decae desde V/R', () => {
    // V1 — S1 (cerrado, abre en t = 1 ms) — nodo 2 — L1 — nodo 3 — R1 — tierra; R2 de nodo 2 a tierra
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('S1', 'switch', [1, 2], { closed: true, conmuta: true, tSwitch: 1e-3 }),
      el('L1', 'inductor', [2, 3], { L }),
      el('R1', 'resistor', [3, 0], { R }),
      el('R2', 'resistor', [2, 0], { R: 300 }),
    );
    const dt = 1e-6;
    const r = simulateTransientNetlist(nl, opts(4e-3, dt, { initial: 'dcop' }));
    const i = r.currents.get('L1')!;
    expect(relErr(i[0], 0.1)).toBeLessThan(1e-9);
    expect(relErr(i[900], 0.1)).toBeLessThan(1e-6); // sigue en régimen antes de abrir
    expect(r.switchTimes).toHaveLength(1);
    // Después de abrir: descarga por R1 + R2 = 400 Ω → τ = L/400
    const tau2 = L / 400;
    const k = 1000 + Math.round(tau2 / dt);
    expect(relErr(i[k], 0.1 * Math.exp(-1))).toBeLessThan(5e-3);
  });
});

describe('interruptores', () => {
  it('el capacitor no se carga hasta que el interruptor cierra', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 5 }),
      el('S1', 'switch', [1, 2], { closed: false, conmuta: true, tSwitch: 1e-3 }),
      el('R1', 'resistor', [2, 3], { R: 1000 }),
      el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
    );
    const dt = 2e-6;
    const r = simulateTransientNetlist(nl, opts(6e-3, dt));
    const v = r.voltages.get('C1')!;
    expect(Math.abs(v[400])).toBeLessThan(1e-4); // t = 0,8 ms: todavía abierto
    const k = Math.round(2e-3 / dt); // una τ después de cerrar
    expect(relErr(v[k], 5 * (1 - Math.exp(-1)))).toBeLessThan(5e-3);
    expect(relErr(v[v.length - 1], 5)).toBeLessThan(1e-2);
  });

  it('la conmutación no deja oscilaciones numéricas en la corriente', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 5 }),
      el('S1', 'switch', [1, 2], { closed: false, conmuta: true, tSwitch: 1e-3 }),
      el('R1', 'resistor', [2, 3], { R: 1000 }),
      el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
    );
    const r = simulateTransientNetlist(nl, opts(3e-3, 1e-5));
    const i = r.currents.get('C1')!;
    // Después de cerrar, la corriente tiene que decaer de forma monótona.
    for (let k = 102; k < i.length; k++) expect(i[k]).toBeLessThanOrEqual(i[k - 1] + 1e-12);
  });
});

describe('transitorio RLC serie (escalón de 10 V)', () => {
  const L = 0.01;
  const C = 1e-6;
  const w0 = 1 / Math.sqrt(L * C); // 10 000 rad/s
  const V = 10;
  const circuit = (R: number) =>
    net(
      el('V1', 'vdc', [1, 0], { V }),
      el('R1', 'resistor', [1, 2], { R }),
      el('L1', 'inductor', [2, 3], { L }),
      el('C1', 'capacitor', [3, 0], { C }),
    );

  it('subamortiguado: oscila a ωd = √(ω0² − α²) dentro de la envolvente e^(−αt)', () => {
    const R = 40; // α = 2000 < ω0
    const alpha = R / (2 * L);
    const wd = Math.sqrt(w0 * w0 - alpha * alpha);
    const r = simulateTransientNetlist(circuit(R), opts(4e-3, 1e-6));
    const exact = (t: number) =>
      V * (1 - Math.exp(-alpha * t) * (Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t)));
    expect(maxError(r.time, r.voltages.get('C1')!, exact)).toBeLessThan(2e-4);
    // Hay sobrepico: supera la tensión de la fuente.
    expect(Math.max(...r.voltages.get('C1')!)).toBeGreaterThan(V * 1.4);
  });

  it('amortiguamiento crítico: R = 2·√(L/C), sin sobrepico', () => {
    const R = 2 * Math.sqrt(L / C); // 200 Ω
    const alpha = R / (2 * L);
    const r = simulateTransientNetlist(circuit(R), opts(2e-3, 1e-6));
    const exact = (t: number) => V * (1 - (1 + alpha * t) * Math.exp(-alpha * t));
    expect(maxError(r.time, r.voltages.get('C1')!, exact)).toBeLessThan(2e-4);
    expect(Math.max(...r.voltages.get('C1')!)).toBeLessThanOrEqual(V + 1e-9);
  });

  it('sobreamortiguado: suma de dos exponenciales', () => {
    const R = 500;
    const alpha = R / (2 * L);
    const d = Math.sqrt(alpha * alpha - w0 * w0);
    const s1 = -alpha + d;
    const s2 = -alpha - d;
    const r = simulateTransientNetlist(circuit(R), opts(4e-3, 1e-6));
    const exact = (t: number) =>
      V * (1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1));
    expect(maxError(r.time, r.voltages.get('C1')!, exact)).toBeLessThan(2e-4);
  });

  it('la matriz de estado da α = R/2L y ω0² = 1/LC', () => {
    const R = 40;
    const { ids, A } = stateMatrix(circuit(R), 0);
    expect(ids.sort()).toEqual(['C1', 'L1']);
    const trace = A[0][0] + A[1][1];
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    expect(relErr(-trace / 2, R / (2 * L))).toBeLessThan(1e-9);
    expect(relErr(det, 1 / (L * C))).toBeLessThan(1e-9);
  });
});

describe('fuente senoidal en el tiempo', () => {
  it('en régimen permanente, la amplitud sobre C coincide con el divisor de impedancias', () => {
    const R = 1000;
    const C = 1e-6;
    const f = 159.154943; // ≈ frecuencia de corte 1/(2πRC)
    const nl = net(
      el('V1', 'vac', [1, 0], { A: 10, f, phase: 0 }),
      el('R1', 'resistor', [1, 2], { R }),
      el('C1', 'capacitor', [2, 0], { C }),
    );
    const period = 1 / f;
    const r = simulateTransientNetlist(nl, opts(12 * period, period / 400));
    const v = r.voltages.get('C1')!;
    let peak = 0;
    for (let k = v.length - 400; k < v.length; k++) peak = Math.max(peak, Math.abs(v[k]));
    const w = 2 * Math.PI * f;
    expect(relErr(peak, 10 / Math.sqrt(1 + (w * R * C) ** 2))).toBeLessThan(2e-3);
  });
});

describe('robustez', () => {
  it('un capacitor directo sobre la fuente no rompe la simulación', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 5 }),
      el('C1', 'capacitor', [1, 0], { C: 1e-6 }),
      el('R1', 'resistor', [1, 0], { R: 1000 }),
    );
    const r = simulateTransientNetlist(nl, opts(1e-3, 1e-5));
    expect(relErr(r.voltages.get('C1')![50], 5)).toBeLessThan(1e-9);
  });

  it('rechaza una cantidad absurda de pasos con un mensaje claro', () => {
    const nl = net(el('V1', 'vdc', [1, 0], { V: 5 }), el('R1', 'resistor', [1, 0], { R: 1 }));
    expect(() => simulateTransientNetlist(nl, opts(1, 1e-9))).toThrow(/pasos/);
  });
});
