import { describe, expect, it } from 'vitest';
import { circuitFromHash, decodeCircuit, encodeCircuit, shareUrl } from '../src/editor/share';
import { emptyCircuit } from '../src/engine/circuit';
import { EXAMPLES } from '../src/examples';

describe('compartir por link', () => {
  it('ida y vuelta de todos los ejemplos', () => {
    for (const ex of EXAMPLES) {
      const c = ex.build();
      const back = decodeCircuit(encodeCircuit(c));
      expect(back.components).toEqual(c.components);
      expect(back.wires.map((w) => [w.a, w.b])).toEqual(c.wires.map((w) => [w.a, w.b]));
    }
  });

  it('el link es seguro para URL y razonablemente corto', () => {
    const code = encodeCircuit(EXAMPLES[0].build());
    expect(code).toMatch(/^[A-Za-z0-9+\-$]+$/);
    expect(code.length).toBeLessThan(JSON.stringify(EXAMPLES[0].build()).length / 2);
  });

  it('arma y lee la URL completa', () => {
    const c = EXAMPLES[1].build();
    const url = shareUrl(c, 'https://ejemplo.dev/app/#viejo');
    expect(url.startsWith('https://ejemplo.dev/app/#c=')).toBe(true);
    const back = circuitFromHash(url.slice(url.indexOf('#')));
    expect(back!.components).toEqual(c.components);
    expect(circuitFromHash('#otra-cosa')).toBeNull();
  });

  it('un circuito vacío también se puede compartir', () => {
    expect(decodeCircuit(encodeCircuit(emptyCircuit()))).toEqual(emptyCircuit());
  });

  it('rechaza links corruptos con un mensaje claro', () => {
    expect(() => decodeCircuit('esto-no-es-un-circuito')).toThrow(/link/);
    expect(() => circuitFromHash('#c=%%%')).toThrow(/link/);
  });
});
