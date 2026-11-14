import { describe, expect, it } from 'vitest';
import {
  contourSegments,
  EPS0,
  fieldAt,
  fieldLines,
  K,
  parallelPlates,
  platesCenterField,
  potentialAt,
  traceFieldLine,
  type Charge,
} from '../src/fields/electrostatics';
import { emf, flux, fluxGradient, magnetState, peakEmfPosition } from '../src/fields/induction';
import {
  biotSavart,
  idealSolenoidB,
  infiniteWireB,
  interpolate,
  loop,
  loopAxisB,
  MU0,
  sampleGrid,
  solenoid,
  straightWire,
  streamline,
  wiresField,
} from '../src/fields/magnetostatics';
import { relErr } from './helpers';

describe('electrostática', () => {
  it('campo de una carga puntual: E = k·q/r², radial', () => {
    const q = 2e-9;
    const e = fieldAt([{ x: 0, y: 0, q }], 0.03, 0.04);
    const r = 0.05;
    expect(relErr(Math.hypot(e.x, e.y), (K * q) / (r * r))).toBeLessThan(1e-12);
    // Apunta hacia afuera, en la dirección de r.
    expect(relErr(e.x / e.y, 0.03 / 0.04)).toBeLessThan(1e-12);
    expect(e.x).toBeGreaterThan(0);
  });

  it('una carga negativa atrae: el campo apunta hacia ella', () => {
    const e = fieldAt([{ x: 0, y: 0, q: -1e-9 }], 0.1, 0);
    expect(e.x).toBeLessThan(0);
    expect(Math.abs(e.y)).toBeLessThan(1e-12);
  });

  it('potencial de una carga puntual: V = k·q/r', () => {
    const v = potentialAt([{ x: 0.01, y: 0, q: 1e-9 }], 0.01, 0.2);
    expect(relErr(v, (K * 1e-9) / 0.2)).toBeLessThan(1e-12);
  });

  it('el campo es menos el gradiente del potencial', () => {
    const charges: Charge[] = [
      { x: -0.05, y: 0, q: 1e-9 },
      { x: 0.05, y: 0.02, q: -2e-9 },
    ];
    const h = 1e-6;
    const [x, y] = [0.01, 0.07];
    const e = fieldAt(charges, x, y);
    const dVdx = (potentialAt(charges, x + h, y) - potentialAt(charges, x - h, y)) / (2 * h);
    const dVdy = (potentialAt(charges, x, y + h) - potentialAt(charges, x, y - h)) / (2 * h);
    expect(relErr(e.x, -dVdx)).toBeLessThan(1e-6);
    expect(relErr(e.y, -dVdy)).toBeLessThan(1e-6);
  });

  it('dipolo: en el plano medio el campo es paralelo al eje del dipolo', () => {
    const d = 0.04;
    const q = 1e-9;
    const charges: Charge[] = [
      { x: -d / 2, y: 0, q },
      { x: d / 2, y: 0, q: -q },
    ];
    const y = 0.1;
    const e = fieldAt(charges, 0, y);
    expect(Math.abs(e.y)).toBeLessThan(1e-9);
    expect(relErr(e.x, (K * q * d) / Math.pow(y * y + (d / 2) ** 2, 1.5))).toBeLessThan(1e-12);
    expect(Math.abs(potentialAt(charges, 0, y))).toBeLessThan(1e-9);
  });

  it('línea de carga infinita: E = λ/(2π·ε0·r)', () => {
    const lambda = 1e-9;
    const e = fieldAt([{ x: 0, y: 0, q: lambda }], 0.05, 0, 'linea');
    expect(relErr(e.x, lambda / (2 * Math.PI * EPS0 * 0.05))).toBeLessThan(1e-8);
  });

  it('las líneas de campo de un dipolo salen de la positiva y llegan a la negativa', () => {
    const charges: Charge[] = [
      { x: -0.05, y: 0, q: 1e-9 },
      { x: 0.05, y: 0, q: -1e-9 },
    ];
    const bounds = { xMin: -0.3, xMax: 0.3, yMin: -0.2, yMax: 0.2 };
    const t = traceFieldLine(charges, { x: -0.048, y: 0.002 }, 1, bounds, 0.001);
    expect(t.endedAt).toBe(1);
    const lines = fieldLines(charges, bounds, 12);
    expect(lines.length).toBeGreaterThanOrEqual(12);
  });

  it('una equipotencial de una carga puntual es una circunferencia', () => {
    const q = 1e-9;
    const nx = 81;
    const ny = 81;
    const size = 0.2;
    const toWorld = (i: number, j: number) => ({
      x: -size / 2 + (size * i) / (nx - 1),
      y: -size / 2 + (size * j) / (ny - 1),
    });
    const values = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const p = toWorld(i, j);
        values[j * nx + i] = potentialAt([{ x: 0, y: 0, q }], p.x, p.y);
      }
    }
    const r = 0.06;
    const segs = contourSegments(values, nx, ny, (K * q) / r, toWorld);
    expect(segs.length).toBeGreaterThan(40);
    for (const [a, b] of segs) {
      expect(relErr(Math.hypot(a.x, a.y), r)).toBeLessThan(0.01);
      expect(relErr(Math.hypot(b.x, b.y), r)).toBeLessThan(0.01);
    }
  });

  it('placas paralelas: en el centro E coincide con la fórmula de tiras finitas y tiende a V/d', () => {
    const [width, d, V] = [0.2, 0.02, 100];
    const charges = parallelPlates(width, d, V, 400);
    const e = fieldAt(charges, 0, 0, 'linea');
    expect(Math.abs(e.x)).toBeLessThan(1e-6);
    // Va de la placa positiva (arriba) a la negativa (abajo).
    expect(e.y).toBeLessThan(0);
    expect(relErr(-e.y, platesCenterField(width, d, V))).toBeLessThan(1e-3);
    // Con placas 10 veces más anchas que la separación, queda a ~6 % del ideal V/d.
    expect(relErr(-e.y, V / d)).toBeLessThan(0.07);
    // Con placas muy anchas tiende al capacitor ideal.
    expect(relErr(platesCenterField(100, d, V), V / d)).toBeLessThan(1e-3);
  });
});

describe('magnetostática (Biot-Savart)', () => {
  it('cable recto largo: B = μ0·I/(2π·r)', () => {
    const I = 5;
    const r = 0.02;
    const b = biotSavart(straightWire(40, 40000), I, { x: r, y: 0, z: 0 });
    // Corriente hacia +z, punto sobre +x: B apunta hacia +y (mano derecha).
    expect(relErr(b.y, infiniteWireB(I, r))).toBeLessThan(1e-4);
    expect(Math.abs(b.x)).toBeLessThan(1e-12);
    expect(Math.abs(b.z)).toBeLessThan(1e-12);
  });

  it('cable recto: el campo cae como 1/r', () => {
    const wire = straightWire(40, 40000);
    const b1 = biotSavart(wire, 1, { x: 0.01, y: 0, z: 0 }).y;
    const b2 = biotSavart(wire, 1, { x: 0.03, y: 0, z: 0 }).y;
    expect(relErr(b1 / b2, 3)).toBeLessThan(1e-3);
  });

  it('cables infinitos en el plano: módulo y sentido de giro', () => {
    const b = wiresField([{ x: 0, y: 0, i: 2 }], 0.1, 0);
    expect(relErr(b.y, infiniteWireB(2, 0.1))).toBeLessThan(1e-12);
    expect(Math.abs(b.x)).toBeLessThan(1e-18);
    // Dos cables con corrientes opuestas: en el medio los campos se suman.
    const mid = wiresField(
      [
        { x: -0.05, y: 0, i: 1 },
        { x: 0.05, y: 0, i: -1 },
      ],
      0,
      0,
    );
    expect(relErr(mid.y, 2 * infiniteWireB(1, 0.05))).toBeLessThan(1e-12);
  });

  it('espira: en el centro B = μ0·I/(2R) y sobre el eje la fórmula conocida', () => {
    const [I, R] = [3, 0.05];
    const coil = loop(R, 0, 720);
    const center = biotSavart(coil, I, { x: 0, y: 0, z: 0 });
    expect(relErr(center.x, (MU0 * I) / (2 * R))).toBeLessThan(1e-4);
    expect(Math.abs(center.y) + Math.abs(center.z)).toBeLessThan(1e-12);
    for (const x of [0.02, 0.05, 0.12]) {
      const b = biotSavart(coil, I, { x, y: 0, z: 0 });
      expect(relErr(b.x, loopAxisB(I, R, x))).toBeLessThan(1e-4);
    }
  });

  it('solenoide largo: en el centro B ≈ μ0·n·I', () => {
    const [I, R, length, turns] = [2, 0.01, 0.4, 400];
    const b = biotSavart(solenoid(R, length, turns, 48), I, { x: 0, y: 0, z: 0 });
    expect(relErr(b.x, idealSolenoidB(I, turns, length))).toBeLessThan(5e-3);
    // Afuera, al costado, el campo es mucho más débil.
    const outside = biotSavart(solenoid(R, length, turns, 48), I, { x: 0, y: 0.05, z: 0 });
    expect(Math.abs(outside.x)).toBeLessThan(0.02 * b.x);
  });

  it('las líneas de B alrededor de un cable son circunferencias cerradas', () => {
    const g = sampleGrid(
      (x, y) => wiresField([{ x: 0, y: 0, i: 1 }], x, y),
      -0.1,
      0.1,
      -0.1,
      0.1,
      81,
      81,
    );
    const b = interpolate(g, 0.05, 0);
    expect(relErr(b.y, infiniteWireB(1, 0.05))).toBeLessThan(1e-9);
    const line = streamline(g, { x: 0.05, y: 0 }, 0.001);
    expect(line.length).toBeGreaterThan(200);
    for (const p of line) expect(relErr(Math.hypot(p.x, p.y), 0.05)).toBeLessThan(0.02);
  });
});

describe('inducción (Faraday-Lenz)', () => {
  const m = 1; // A·m²
  const coil = { a: 0.03, turns: 200, resistance: 10 };

  it('el flujo es máximo con el imán en el centro: Φ = μ0·m/(2a)', () => {
    expect(relErr(flux(m, coil.a, 0), (MU0 * m) / (2 * coil.a))).toBeLessThan(1e-12);
    expect(flux(m, coil.a, 0.05)).toBeLessThan(flux(m, coil.a, 0));
  });

  it('dΦ/dz analítica coincide con la derivada numérica', () => {
    const h = 1e-7;
    for (const z of [-0.04, -0.01, 0.02, 0.08]) {
      const numeric = (flux(m, coil.a, z + h) - flux(m, coil.a, z - h)) / (2 * h);
      expect(relErr(fluxGradient(m, coil.a, z), numeric)).toBeLessThan(1e-6);
    }
  });

  it('ε = −N·dΦ/dt: coincide con derivar el flujo en el tiempo', () => {
    const motion = { kind: 'oscila', amplitude: 0.08, frequency: 1.5 } as const;
    const dt = 1e-6;
    for (const t of [0.05, 0.21, 0.4]) {
      const s = magnetState(motion, t);
      const before = flux(m, coil.a, magnetState(motion, t - dt).z);
      const after = flux(m, coil.a, magnetState(motion, t + dt).z);
      const numeric = (-coil.turns * (after - before)) / (2 * dt);
      expect(relErr(emf(m, coil, s.z, s.v), numeric)).toBeLessThan(1e-5);
    }
  });

  it('Lenz: la fem cambia de signo cuando el imán atraviesa la bobina', () => {
    const approaching = emf(m, coil, -0.02, 0.5);
    const leaving = emf(m, coil, 0.02, 0.5);
    expect(Math.sign(approaching)).toBe(-Math.sign(leaving));
    expect(emf(m, coil, 0, 0.5)).toBeCloseTo(0, 12);
    // Imán quieto: no hay fem aunque haya flujo.
    expect(emf(m, coil, 0.01, 0)).toBeCloseTo(0, 12);
  });

  it('la fem es máxima cuando el imán está a a/2 del centro', () => {
    const z0 = peakEmfPosition(coil.a);
    const peak = Math.abs(emf(m, coil, z0, 1));
    expect(Math.abs(emf(m, coil, z0 * 0.9, 1))).toBeLessThan(peak);
    expect(Math.abs(emf(m, coil, z0 * 1.1, 1))).toBeLessThan(peak);
  });

  it('el movimiento de ida y vuelta es continuo y respeta la velocidad', () => {
    const motion = { kind: 'pasa', speed: 0.5, range: 0.15 } as const;
    expect(magnetState(motion, 0).z).toBeCloseTo(-0.15, 12);
    expect(magnetState(motion, 0.3).z).toBeCloseTo(0, 12);
    expect(magnetState(motion, 0.6).z).toBeCloseTo(0.15, 9);
    expect(magnetState(motion, 0.7).v).toBe(-0.5);
  });
});
