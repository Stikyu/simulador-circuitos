import { describe, expect, it } from 'vitest';
import { solveDCNetlist } from '../src/engine/dc';
import { explainDC } from '../src/explain/dc';
import { reduceSeriesParallel } from '../src/explain/seriesParallel';
import { el, net, relErr } from './helpers';

describe('paso a paso: serie / paralelo', () => {
  it('reduce R1 + (R2 ‖ R3) y coincide con el motor', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 12 }),
      el('R1', 'resistor', [1, 2], { R: 100 }),
      el('R2', 'resistor', [2, 0], { R: 220 }),
      el('R3', 'resistor', [2, 0], { R: 330 }),
    );
    const sp = reduceSeriesParallel(nl)!;
    expect(sp).not.toBeNull();
    expect(relErr(sp.req, 100 + (220 * 330) / 550)).toBeLessThan(1e-12);
    const sol = solveDCNetlist(nl);
    for (const [id, r] of sp.results) {
      expect(relErr(r.i, Math.abs(sol.byId.get(id)!.current))).toBeLessThan(1e-9);
      expect(relErr(r.v, Math.abs(sol.byId.get(id)!.voltage))).toBeLessThan(1e-9);
    }
  });

  it('una escalera de varios niveles se reduce por completo', () => {
    // V — R1 — n2 — R3 — n3 — R5 — 0 ; R2 de n2 a 0 ; R4 de n3 a 0
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('R1', 'resistor', [1, 2], { R: 1000 }),
      el('R2', 'resistor', [2, 0], { R: 2000 }),
      el('R3', 'resistor', [2, 3], { R: 1000 }),
      el('R4', 'resistor', [3, 0], { R: 2000 }),
      el('R5', 'resistor', [3, 4], { R: 1000 }),
      el('R6', 'resistor', [4, 0], { R: 1000 }),
    );
    const sp = reduceSeriesParallel(nl)!;
    const sol = solveDCNetlist(nl);
    const iTotal = Math.abs(sol.byId.get('V1')!.current);
    expect(relErr(sp.req, 10 / iTotal)).toBeLessThan(1e-9);
    expect(sp.results.size).toBe(6);
    for (const [id, r] of sp.results) {
      expect(relErr(r.i, Math.abs(sol.byId.get(id)!.current))).toBeLessThan(1e-9);
    }
  });

  it('atraviesa amperímetros y resistencias a ambos lados de tierra', () => {
    const nl = net(
      el('V1', 'vdc', [1, 2], { V: 9 }),
      el('A1', 'ammeter', [1, 3]),
      el('R1', 'resistor', [3, 0], { R: 300 }),
      el('R2', 'resistor', [0, 2], { R: 600 }),
    );
    const sp = reduceSeriesParallel(nl)!;
    expect(relErr(sp.req, 900)).toBeLessThan(1e-12);
  });

  it('un puente de Wheatstone no es reducible: se usa el método nodal', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('R1', 'resistor', [1, 2], { R: 1000 }),
      el('R2', 'resistor', [2, 0], { R: 2000 }),
      el('R3', 'resistor', [1, 3], { R: 3000 }),
      el('R4', 'resistor', [3, 0], { R: 4000 }),
      el('R5', 'resistor', [2, 3], { R: 500 }),
    );
    expect(reduceSeriesParallel(nl)).toBeNull();
    const ex = explainDC(solveDCNetlist(nl));
    expect(ex.method).toMatch(/nodal/i);
    const text = ex.steps.flatMap((s) => s.lines).join('\n');
    expect(text).toContain('N1');
    expect(text).toContain('I(V1)');
    expect(text).toMatch(/N2:.*\(N2 − N1\)\/1 kΩ/);
  });

  it('con dos fuentes también va por nodal', () => {
    const nl = net(
      el('V1', 'vdc', [1, 0], { V: 10 }),
      el('V2', 'vdc', [2, 0], { V: 5 }),
      el('R1', 'resistor', [1, 2], { R: 1000 }),
    );
    expect(reduceSeriesParallel(nl)).toBeNull();
    expect(explainDC(solveDCNetlist(nl)).steps.length).toBeGreaterThan(3);
  });
});
