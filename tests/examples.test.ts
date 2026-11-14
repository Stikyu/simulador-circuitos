import { describe, expect, it } from 'vitest';
import { KNOWN_TYPES } from '../src/components/registry';
import { parseCircuit } from '../src/engine/circuit';
import { solveDC } from '../src/engine/dc';
import { buildNetlist } from '../src/engine/netlist';
import { simulateTransientNetlist } from '../src/engine/transient';
import { EXAMPLES } from '../src/examples';
import { classifyTransient, suggestTimes } from '../src/explain/transient';

describe('ejemplos precargados', () => {
  it('tienen identificadores únicos', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
  });

  for (const ex of EXAMPLES) {
    it(`"${ex.title}" es un circuito válido y sobrevive a la serialización`, () => {
      const c = ex.build();
      expect(parseCircuit(JSON.parse(JSON.stringify(c)), KNOWN_TYPES)).toEqual(c);
      const nl = buildNetlist(c);
      expect(nl.hasGround).toBe(true);
      // Ningún componente quedó con los dos terminales en el mismo nodo.
      for (const el of nl.elements) expect(el.nodes[0]).not.toBe(el.nodes[1]);
    });

    if (ex.mode === 'dc') {
      it(`"${ex.title}" se resuelve en DC`, () => {
        const sol = solveDC(ex.build());
        expect(sol.elements.every((e) => Number.isFinite(e.current))).toBe(true);
      });
    }

    if (ex.mode === 'tran') {
      it(`"${ex.title}" se simula en el tiempo`, () => {
        const nl = buildNetlist(ex.build());
        const model = classifyTransient(nl);
        expect(model.kind).not.toBe('superior');
        const r = simulateTransientNetlist(nl, {
          ...suggestTimes(model),
          method: 'trap',
          initial: 'props',
        });
        for (const arr of r.nodeVoltages) expect(arr.every(Number.isFinite)).toBe(true);
      });
    }
  }
});
