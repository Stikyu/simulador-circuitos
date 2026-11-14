import { describe, expect, it } from 'vitest';
import { formatValue, parseValue } from '../src/engine/units';

describe('parseValue', () => {
  it('lee números simples con punto o coma', () => {
    expect(parseValue('100')).toBe(100);
    expect(parseValue('4.7')).toBe(4.7);
    expect(parseValue('4,7')).toBe(4.7);
    expect(parseValue('-12')).toBe(-12);
    expect(parseValue('1e-3')).toBe(1e-3);
  });

  it('aplica prefijos SI', () => {
    expect(parseValue('4,7k')).toBeCloseTo(4700, 9);
    expect(parseValue('2.2M')).toBeCloseTo(2.2e6, 3);
    expect(parseValue('10m')).toBeCloseTo(0.01, 12);
    expect(parseValue('100µ')).toBeCloseTo(100e-6, 15);
    expect(parseValue('100u')).toBeCloseTo(100e-6, 15);
    expect(parseValue('47n')).toBeCloseTo(47e-9, 18);
    expect(parseValue('22p')).toBeCloseTo(22e-12, 20);
    expect(parseValue('3meg')).toBeCloseTo(3e6, 3);
  });

  it('ignora la unidad que sigue al prefijo', () => {
    expect(parseValue('1 kΩ')).toBe(1000);
    expect(parseValue('100 nF')).toBeCloseTo(100e-9, 18);
    expect(parseValue('5 V')).toBe(5);
    expect(parseValue('50 Hz')).toBe(50);
    expect(parseValue('10 mH')).toBeCloseTo(0.01, 12);
  });

  it('rechaza texto que no es un valor', () => {
    expect(parseValue('')).toBeNull();
    expect(parseValue('abc')).toBeNull();
    expect(parseValue('1.2.3')).toBeNull();
  });
});

describe('formatValue', () => {
  it('elige el prefijo adecuado', () => {
    expect(formatValue(4700, 'Ω')).toBe('4,7 kΩ');
    expect(formatValue(1e-6, 'F')).toBe('1 µF');
    expect(formatValue(0.012, 'A')).toBe('12 mA');
    expect(formatValue(10, 'V')).toBe('10 V');
    expect(formatValue(0, 'V')).toBe('0 V');
    expect(formatValue(2.2e6, 'Ω')).toBe('2,2 MΩ');
  });

  it('redondea sin saltearse el cambio de prefijo', () => {
    expect(formatValue(999.96, 'Ω')).toBe('1 kΩ');
    expect(formatValue(-0.0333333, 'A')).toBe('−33,3 mA');
  });

  it('ida y vuelta: lo que se muestra se puede volver a leer', () => {
    for (const v of [4700, 1e-6, 0.012, 2.2e6, 47e-9, 330]) {
      expect(parseValue(formatValue(v, 'Ω'))).toBeCloseTo(v, 12);
    }
  });
});
