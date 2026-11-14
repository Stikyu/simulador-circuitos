import { describe, expect, it } from 'vitest';
import { simulateTransientNetlist } from '../src/engine/transient';
import { classifyTransient, explainTransient, suggestTimes } from '../src/explain/transient';
import type { Netlist } from '../src/engine/netlist';
import { el, net, relErr } from './helpers';

/** Simula con los tiempos sugeridos y compara contra la solución analítica explicada. */
function analyticError(nl: Netlist): number {
  const model = classifyTransient(nl);
  const { tStop, dt } = suggestTimes(model);
  const result = simulateTransientNetlist(nl, { tStop, dt, method: 'trap', initial: 'props' });
  const ex = explainTransient(nl, model, result);
  expect(ex.analytic).toBeDefined();
  const { id, quantity, fn } = ex.analytic!;
  const data = (quantity === 'v' ? result.voltages : result.currents).get(id)!;
  let worst = 0;
  let scale = 0;
  for (let k = 0; k < data.length; k++) {
    worst = Math.max(worst, Math.abs(data[k] - fn(result.time[k])));
    scale = Math.max(scale, Math.abs(data[k]));
  }
  return worst / scale;
}

describe('clasificación del transitorio', () => {
  it('RC: τ = Rth·C', () => {
    const m = classifyTransient(
      net(
        el('V1', 'vdc', [1, 0], { V: 10 }),
        el('R1', 'resistor', [1, 2], { R: 2000 }),
        el('R2', 'resistor', [2, 0], { R: 2000 }),
        el('C1', 'capacitor', [2, 0], { C: 1e-6 }),
      ),
    );
    expect(m.kind).toBe('primer-orden');
    expect(relErr(m.rth!, 1000)).toBeLessThan(1e-6);
    expect(relErr(m.tau!, 1e-3)).toBeLessThan(1e-6);
  });

  it('RL: τ = L/R', () => {
    const m = classifyTransient(
      net(
        el('V1', 'vdc', [1, 0], { V: 10 }),
        el('R1', 'resistor', [1, 2], { R: 100 }),
        el('L1', 'inductor', [2, 0], { L: 0.05 }),
      ),
    );
    expect(m.kind).toBe('primer-orden');
    expect(relErr(m.tau!, 5e-4)).toBeLessThan(1e-9);
  });

  const rlc = (R: number) =>
    net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('R1', 'resistor', [1, 2], { R }),
      el('L1', 'inductor', [2, 3], { L: 0.01 }),
      el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
    );

  it('RLC serie: reconoce los tres regímenes', () => {
    const sub = classifyTransient(rlc(40));
    expect(sub.damping).toBe('sub');
    expect(sub.form).toBe('serie');
    expect(relErr(sub.rEq!, 40)).toBeLessThan(1e-9);
    expect(relErr(sub.w0!, 10000)).toBeLessThan(1e-9);
    expect(relErr(sub.wd!, Math.sqrt(1e8 - 2000 ** 2))).toBeLessThan(1e-9);
    expect(classifyTransient(rlc(200)).damping).toBe('critico');
    const over = classifyTransient(rlc(500));
    expect(over.damping).toBe('sobre');
    expect(over.s1!).toBeLessThan(0);
    expect(over.s2!).toBeLessThan(over.s1!);
  });

  it('RLC paralelo: α = 1/(2RC)', () => {
    const m = classifyTransient(
      net(
        el('I1', 'idc', [1, 0], { I: 0.01 }),
        el('R1', 'resistor', [1, 0], { R: 500 }),
        el('L1', 'inductor', [1, 0], { L: 0.01 }),
        el('C1', 'capacitor', [1, 0], { C: 1e-6 }),
      ),
    );
    expect(m.form).toBe('paralelo');
    expect(relErr(m.alpha!, 1 / (2 * 500 * 1e-6))).toBeLessThan(1e-9);
    expect(relErr(m.rEq!, 500)).toBeLessThan(1e-9);
  });

  it('toma como origen la última conmutación', () => {
    const m = classifyTransient(
      net(
        el('V1', 'vdc', [1, 0], { V: 5 }),
        el('S1', 'switch', [1, 2], { closed: false, conmuta: true, tSwitch: 2e-3 }),
        el('R1', 'resistor', [2, 3], { R: 1000 }),
        el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
      ),
    );
    expect(m.t0).toBe(2e-3);
    expect(relErr(m.tau!, 1e-3)).toBeLessThan(1e-3);
  });
});

describe('la solución analítica explicada coincide con la simulación', () => {
  it('carga RC', () => {
    expect(
      analyticError(
        net(
          el('V1', 'vdc', [1, 0], { V: 5 }),
          el('R1', 'resistor', [1, 2], { R: 1000 }),
          el('C1', 'capacitor', [2, 0], { C: 1e-6 }),
        ),
      ),
    ).toBeLessThan(1e-4);
  });

  it('RC con interruptor que cierra en t₀ > 0', () => {
    expect(
      analyticError(
        net(
          el('V1', 'vdc', [1, 0], { V: 5 }),
          el('S1', 'switch', [1, 2], { closed: false, conmuta: true, tSwitch: 1e-3 }),
          el('R1', 'resistor', [2, 3], { R: 1000 }),
          el('C1', 'capacitor', [3, 0], { C: 1e-6, v0: 1 }),
        ),
      ),
    ).toBeLessThan(5e-3);
  });

  it('RL', () => {
    expect(
      analyticError(
        net(
          el('V1', 'vdc', [1, 0], { V: 10 }),
          el('R1', 'resistor', [1, 2], { R: 100 }),
          el('L1', 'inductor', [2, 0], { L: 0.05 }),
        ),
      ),
    ).toBeLessThan(1e-4);
  });

  for (const [name, R] of [
    ['subamortiguado', 40],
    ['crítico', 200],
    ['sobreamortiguado', 500],
  ] as const) {
    it(`RLC serie ${name}`, () => {
      expect(
        analyticError(
          net(
            el('V1', 'vdc', [1, 0], { V: 10 }),
            el('R1', 'resistor', [1, 2], { R }),
            el('L1', 'inductor', [2, 3], { L: 0.01 }),
            el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
          ),
        ),
      ).toBeLessThan(2e-3);
    });
  }

  it('segundo orden no canónico (R en paralelo con C)', () => {
    expect(
      analyticError(
        net(
          el('V1', 'vdc', [1, 0], { V: 10 }),
          el('R1', 'resistor', [1, 2], { R: 50 }),
          el('L1', 'inductor', [2, 3], { L: 0.01 }),
          el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
          el('R2', 'resistor', [3, 0], { R: 400 }),
        ),
      ),
    ).toBeLessThan(2e-3);
  });
});
