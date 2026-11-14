import { describe, expect, it } from 'vitest';
import { addComponent, addWires } from '../src/editor/ops';
import { emptyCircuit, type Circuit, type Point } from '../src/engine/circuit';
import { solveDC, solveDCNetlist } from '../src/engine/dc';
import { CircuitError } from '../src/engine/errors';
import { buildNetlist } from '../src/engine/netlist';
import { theveninAt } from '../src/engine/thevenin';
import { computeFlows } from '../src/engine/wireCurrents';
import { el, net, relErr } from './helpers';

const TOL = 1e-9;

function expectError(fn: () => unknown, code: string): CircuitError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CircuitError);
    expect((err as CircuitError).code).toBe(code);
    return err as CircuitError;
  }
  throw new Error(`Se esperaba un error "${code}" y no hubo ninguno`);
}

describe('DC: resultados analíticos', () => {
  it('divisor de tensión', () => {
    // 10 V sobre R1 = 1 kΩ en serie con R2 = 2 kΩ → Vout = 10·2/3
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V: 10 }),
        el('R1', 'resistor', [1, 2], { R: 1000 }),
        el('R2', 'resistor', [2, 0], { R: 2000 }),
      ),
    );
    expect(relErr(s.nodeVoltages[2], 20 / 3)).toBeLessThan(TOL);
    expect(relErr(s.byId.get('R1')!.current, 10 / 3000)).toBeLessThan(TOL);
    // La fuente entrega: su corriente a→b (de + a − por dentro) es negativa.
    expect(relErr(s.byId.get('V1')!.current, -10 / 3000)).toBeLessThan(TOL);
    expect(relErr(s.byId.get('R2')!.power, (20 / 3) ** 2 / 2000)).toBeLessThan(TOL);
  });

  it('serie y paralelo: R1 + (R2 ‖ R3)', () => {
    const R1 = 100;
    const R2 = 220;
    const R3 = 330;
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V: 12 }),
        el('R1', 'resistor', [1, 2], { R: R1 }),
        el('R2', 'resistor', [2, 0], { R: R2 }),
        el('R3', 'resistor', [2, 0], { R: R3 }),
      ),
    );
    const Rp = (R2 * R3) / (R2 + R3);
    const I = 12 / (R1 + Rp);
    expect(relErr(s.byId.get('R1')!.current, I)).toBeLessThan(TOL);
    expect(relErr(s.nodeVoltages[2], I * Rp)).toBeLessThan(TOL);
    expect(relErr(s.byId.get('R2')!.current, (I * Rp) / R2)).toBeLessThan(TOL);
    expect(relErr(s.byId.get('R3')!.current, (I * Rp) / R3)).toBeLessThan(TOL);
  });

  it('se conserva la energía: la suma de potencias es cero', () => {
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V: 9 }),
        el('I1', 'idc', [2, 0], { I: 0.002 }),
        el('R1', 'resistor', [1, 2], { R: 470 }),
        el('R2', 'resistor', [2, 0], { R: 1500 }),
        el('R3', 'resistor', [2, 3], { R: 820 }),
        el('R4', 'resistor', [3, 0], { R: 100 }),
      ),
    );
    const total = s.elements.reduce((acc, e) => acc + e.power, 0);
    expect(Math.abs(total)).toBeLessThan(1e-12);
  });

  it('puente de Wheatstone equilibrado: el detector no lleva corriente', () => {
    // R1/R2 = R3/R4 → V(2) = V(3)
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V: 10 }),
        el('R1', 'resistor', [1, 2], { R: 1000 }),
        el('R2', 'resistor', [2, 0], { R: 2000 }),
        el('R3', 'resistor', [1, 3], { R: 1500 }),
        el('R4', 'resistor', [3, 0], { R: 3000 }),
        el('R5', 'resistor', [2, 3], { R: 500 }),
      ),
    );
    expect(Math.abs(s.byId.get('R5')!.current)).toBeLessThan(1e-12);
    expect(relErr(s.nodeVoltages[2], 20 / 3)).toBeLessThan(TOL);
  });

  it('puente de Wheatstone desequilibrado: coincide con Thevenin a mano', () => {
    const [V, R1, R2, R3, R4, R5] = [10, 1000, 2000, 3000, 4000, 500];
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V }),
        el('R1', 'resistor', [1, 2], { R: R1 }),
        el('R2', 'resistor', [2, 0], { R: R2 }),
        el('R3', 'resistor', [1, 3], { R: R3 }),
        el('R4', 'resistor', [3, 0], { R: R4 }),
        el('R5', 'resistor', [2, 3], { R: R5 }),
      ),
    );
    const vth = V * (R2 / (R1 + R2) - R4 / (R3 + R4));
    const rth = (R1 * R2) / (R1 + R2) + (R3 * R4) / (R3 + R4);
    expect(relErr(s.byId.get('R5')!.current, vth / (rth + R5))).toBeLessThan(TOL);
  });

  it('fuente de corriente sobre una resistencia', () => {
    // La flecha apunta al terminal 0 (nodo 1): entra 1 mA al nodo 1.
    const s = solveDCNetlist(
      net(el('I1', 'idc', [1, 0], { I: 0.001 }), el('R1', 'resistor', [1, 0], { R: 1000 })),
    );
    expect(relErr(s.nodeVoltages[1], 1)).toBeLessThan(TOL);
    expect(relErr(s.byId.get('I1')!.power, -0.001)).toBeLessThan(TOL);
  });

  it('amperímetro en serie y voltímetro en paralelo', () => {
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V: 5 }),
        el('A1', 'ammeter', [1, 2]),
        el('R1', 'resistor', [2, 0], { R: 250 }),
        el('VM1', 'voltmeter', [2, 0]),
      ),
    );
    expect(relErr(s.byId.get('A1')!.current, 0.02)).toBeLessThan(1e-6);
    expect(relErr(s.byId.get('VM1')!.voltage, 5)).toBeLessThan(TOL);
    expect(Math.abs(s.byId.get('A1')!.voltage)).toBeLessThan(1e-12);
  });

  it('en DC la bobina es un corto y el capacitor un abierto', () => {
    const s = solveDCNetlist(
      net(
        el('V1', 'vdc', [1, 0], { V: 10 }),
        el('R1', 'resistor', [1, 2], { R: 100 }),
        el('L1', 'inductor', [2, 3], { L: 0.01 }),
        el('R2', 'resistor', [3, 0], { R: 400 }),
        el('C1', 'capacitor', [3, 0], { C: 1e-6 }),
      ),
    );
    expect(relErr(s.byId.get('L1')!.current, 0.02)).toBeLessThan(TOL);
    expect(Math.abs(s.byId.get('L1')!.voltage)).toBeLessThan(1e-12);
    expect(s.byId.get('C1')!.current).toBe(0);
    expect(relErr(s.byId.get('C1')!.voltage, 8)).toBeLessThan(TOL);
  });
});

describe('Thevenin y Norton', () => {
  const circuit = net(
    el('V1', 'vdc', [1, 0], { V: 12 }),
    el('R1', 'resistor', [1, 2], { R: 4000 }),
    el('R2', 'resistor', [2, 0], { R: 12000 }),
    el('RL', 'resistor', [2, 0], { R: 6000 }),
  );

  it('Vth, Rth e In vistos desde la carga', () => {
    const th = theveninAt(circuit, 'RL');
    expect(relErr(th.vth, 9)).toBeLessThan(TOL);
    expect(relErr(th.rth, 3000)).toBeLessThan(TOL);
    expect(relErr(th.inorton, 0.003)).toBeLessThan(1e-6);
    // Norton y Thevenin son el mismo equivalente: In = Vth / Rth
    expect(relErr(th.inorton, th.vth / th.rth)).toBeLessThan(1e-6);
  });

  it('el equivalente predice la corriente real por la carga', () => {
    const th = theveninAt(circuit, 'RL');
    const real = solveDCNetlist(circuit).byId.get('RL')!.current;
    expect(relErr(real, th.vth / (th.rth + 6000))).toBeLessThan(TOL);
  });

  it('funciona con fuentes de tensión y de corriente mezcladas', () => {
    // V = 10 V con R1 = 2 kΩ a nodo 2; fuente de 1 mA entrando al nodo 2.
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('R1', 'resistor', [1, 2], { R: 2000 }),
      el('I1', 'idc', [2, 0], { I: 0.001 }),
      el('RL', 'resistor', [2, 0], { R: 1000 }),
    );
    const th = theveninAt(nl, 'RL');
    expect(relErr(th.vth, 12)).toBeLessThan(TOL); // superposición: 10 + 1 mA · 2 kΩ
    expect(relErr(th.rth, 2000)).toBeLessThan(TOL);
  });
});

describe('errores con mensajes claros', () => {
  it('falta la tierra', () => {
    const { circuit } = addComponent(emptyCircuit(), 'resistor', { x: 0, y: 0 });
    const err = expectError(() => solveDC(circuit), 'sin-tierra');
    expect(err.message).toMatch(/tierra/i);
  });

  it('nodo flotante', () => {
    const err = expectError(
      () =>
        solveDCNetlist(
          net(
            el('V1', 'vdc', [1, 0], { V: 10 }),
            el('R1', 'resistor', [1, 0], { R: 1000 }),
            el('R2', 'resistor', [2, 3], { R: 1000 }),
          ),
        ),
      'nodo-flotante',
    );
    expect(err.componentIds).toEqual(['R2']);
  });

  it('capacitor en serie en DC deja un nodo flotante y lo explica', () => {
    const err = expectError(
      () =>
        solveDCNetlist(
          net(
            el('V1', 'vdc', [1, 0], { V: 10 }),
            el('C1', 'capacitor', [1, 2], { C: 1e-6 }),
            el('C2', 'capacitor', [2, 0], { C: 1e-6 }),
          ),
        ),
      'nodo-flotante',
    );
    expect(err.hint).toMatch(/capacitor/i);
  });

  it('fuentes de tensión en paralelo', () => {
    const err = expectError(
      () =>
        solveDCNetlist(
          net(
            el('V1', 'vdc', [1, 0], { V: 10 }),
            el('V2', 'vdc', [1, 0], { V: 5 }),
            el('R1', 'resistor', [1, 0], { R: 1000 }),
          ),
        ),
      'lazo-tension',
    );
    expect(err.componentIds.sort()).toEqual(['V1', 'V2']);
    expect(err.message).toMatch(/paralelo/i);
  });

  it('lazo de fuente y bobina en DC', () => {
    const err = expectError(
      () =>
        solveDCNetlist(
          net(el('V1', 'vdc', [1, 0], { V: 10 }), el('L1', 'inductor', [1, 0], { L: 0.01 })),
        ),
      'lazo-tension',
    );
    expect(err.componentIds.sort()).toEqual(['L1', 'V1']);
    expect(err.hint).toMatch(/bobina/i);
  });

  it('lazo de tres ramas: informa el camino completo', () => {
    const err = expectError(
      () =>
        solveDCNetlist(
          net(
            el('V1', 'vdc', [1, 0], { V: 10 }),
            el('V2', 'vdc', [2, 1], { V: 5 }),
            el('A1', 'ammeter', [2, 0]),
          ),
        ),
      'lazo-tension',
    );
    expect(err.componentIds.sort()).toEqual(['A1', 'V1', 'V2']);
  });

  it('fuente en cortocircuito', () => {
    expectError(
      () =>
        solveDCNetlist(
          net(el('V1', 'vdc', [0, 0], { V: 10 }), el('R1', 'resistor', [1, 0], { R: 1 })),
        ),
      'fuente-en-corto',
    );
  });

  it('resistencia nula o negativa', () => {
    expectError(
      () =>
        solveDCNetlist(
          net(el('V1', 'vdc', [1, 0], { V: 10 }), el('R1', 'resistor', [1, 0], { R: 0 })),
        ),
      'parametro',
    );
  });
});

describe('del dibujo a la netlist', () => {
  const seg = (ax: number, ay: number, bx: number, by: number): [Point, Point] => [
    { x: ax, y: ay },
    { x: bx, y: by },
  ];

  /** Divisor dibujado: V1 vertical a la izquierda, R1 arriba, R2 vertical a la derecha. */
  function drawDivider(): Circuit {
    let c = emptyCircuit();
    c = addComponent(c, 'vdc', { x: 0, y: 4 }, 1, { V: 10 }).circuit; // + arriba (0,2)
    c = addComponent(c, 'resistor', { x: 4, y: 2 }, 0, { R: 1000 }).circuit;
    c = addComponent(c, 'resistor', { x: 8, y: 4 }, 1, { R: 2000 }).circuit;
    c = addComponent(c, 'ground', { x: 0, y: 8 }).circuit;
    return addWires(c, [
      seg(0, 2, 2, 2),
      seg(6, 2, 8, 2),
      seg(8, 6, 0, 6),
      seg(0, 6, 0, 8), // pasa por el terminal de V1 en (0,6)
    ]);
  }

  it('reconoce los nodos y resuelve igual que a mano', () => {
    const c = drawDivider();
    const nl = buildNetlist(c);
    expect(nl.hasGround).toBe(true);
    expect(nl.nodeCount).toBe(3);
    const s = solveDC(c);
    expect(relErr(s.byId.get('R2')!.voltage, 20 / 3)).toBeLessThan(TOL);
  });

  it('una unión en T conecta el punto medio de un cable', () => {
    let c = drawDivider();
    // R3 en paralelo con R2, colgada del medio del cable inferior y del superior.
    c = addComponent(c, 'resistor', { x: 12, y: 4 }, 1, { R: 2000 }).circuit;
    c = addWires(c, [seg(8, 2, 12, 2), seg(12, 6, 12, 7), seg(12, 7, 4, 7), seg(4, 7, 4, 6)]);
    const s = solveDC(c);
    // R2 ‖ R3 = 1 kΩ → divisor a la mitad
    expect(relErr(s.byId.get('R2')!.voltage, 5)).toBeLessThan(TOL);
    expect(relErr(s.byId.get('R3')!.current, 0.0025)).toBeLessThan(TOL);
  });

  it('corriente por los cables: en una malla única todos llevan la misma', () => {
    const c = drawDivider();
    const s = solveDC(c);
    const currents = new Map(s.elements.map((e) => [e.id, e.current]));
    const flows = computeFlows(c, currents).filter((f) => !f.componentId);
    const I = 10 / 3000;
    const carrying = flows.filter((f) => Math.abs(f.current) > 1e-9);
    expect(carrying.length).toBeGreaterThanOrEqual(3);
    for (const f of carrying) expect(relErr(Math.abs(f.current), I)).toBeLessThan(1e-9);
    // El tramo que solo baja a la tierra no lleva corriente.
    const stub = flows.find((f) => (f.a.y === 8 && f.b.y === 6) || (f.a.y === 6 && f.b.y === 8));
    expect(Math.abs(stub!.current)).toBeLessThan(1e-12);
  });
});
