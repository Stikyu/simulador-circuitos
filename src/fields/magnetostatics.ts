/**
 * Magnetostática: ley de Biot-Savart.
 *    dB = (μ0·I / 4π) · dl × r / |r|³
 * Se integra numéricamente sumando tramos rectos cortos (regla del punto medio).
 * Distancias en metros, corrientes en amperes, campo en teslas.
 */
import type { Vec2 } from './electrostatics';

export const MU0 = 4 * Math.PI * 1e-7; // [T·m/A]

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Segment {
  a: Vec3;
  b: Vec3;
}

/** Campo B en el punto p producido por una poligonal que lleva corriente I. */
export function biotSavart(segments: Segment[], I: number, p: Vec3): Vec3 {
  let bx = 0;
  let by = 0;
  let bz = 0;
  const k = (MU0 * I) / (4 * Math.PI);
  for (const s of segments) {
    const dlx = s.b.x - s.a.x;
    const dly = s.b.y - s.a.y;
    const dlz = s.b.z - s.a.z;
    const rx = p.x - (s.a.x + s.b.x) / 2;
    const ry = p.y - (s.a.y + s.b.y) / 2;
    const rz = p.z - (s.a.z + s.b.z) / 2;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-12) continue;
    const f = k / (r2 * Math.sqrt(r2));
    bx += f * (dly * rz - dlz * ry);
    by += f * (dlz * rx - dlx * rz);
    bz += f * (dlx * ry - dly * rx);
  }
  return { x: bx, y: by, z: bz };
}

/** Tramo recto sobre el eje z, de −length/2 a +length/2, partido en n segmentos. */
export function straightWire(length: number, n = 2000): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      a: { x: 0, y: 0, z: -length / 2 + (length * i) / n },
      b: { x: 0, y: 0, z: -length / 2 + (length * (i + 1)) / n },
    });
  }
  return out;
}

/**
 * Espira circular de radio R con eje en x, centrada en x = x0.
 * Vista desde +x la corriente positiva gira en sentido antihorario,
 * así que en el centro B apunta hacia +x (regla de la mano derecha).
 */
export function loop(R: number, x0 = 0, n = 96): Segment[] {
  const out: Segment[] = [];
  const pt = (k: number): Vec3 => {
    const a = (2 * Math.PI * k) / n;
    return { x: x0, y: R * Math.cos(a), z: R * Math.sin(a) };
  };
  for (let k = 0; k < n; k++) out.push({ a: pt(k), b: pt(k + 1) });
  return out;
}

/** Solenoide: `turns` espiras iguales repartidas a lo largo de `length` sobre el eje x. */
export function solenoid(R: number, length: number, turns: number, n = 64): Segment[] {
  const out: Segment[] = [];
  for (let t = 0; t < turns; t++) {
    const x0 = turns === 1 ? 0 : -length / 2 + (length * t) / (turns - 1);
    out.push(...loop(R, x0, n));
  }
  return out;
}

/** Cable recto infinito perpendicular a la pantalla. I > 0: sale hacia el observador. */
export interface WireOut {
  x: number;
  y: number;
  i: number;
}

/** B en el plano por superposición de cables infinitos: |B| = μ0·I / (2π·r). */
export function wiresField(wires: WireOut[], x: number, y: number): Vec2 {
  let bx = 0;
  let by = 0;
  for (const w of wires) {
    const dx = x - w.x;
    const dy = y - w.y;
    const r2 = Math.max(dx * dx + dy * dy, 1e-8);
    const f = (MU0 * w.i) / (2 * Math.PI * r2);
    // Dirección tangencial (antihoraria para corriente saliente): ẑ × r
    bx += -f * dy;
    by += f * dx;
  }
  return { x: bx, y: by };
}

/** Fórmulas cerradas para comparar. */
export const infiniteWireB = (I: number, r: number): number => (MU0 * I) / (2 * Math.PI * r);
export const loopAxisB = (I: number, R: number, x: number): number =>
  (MU0 * I * R * R) / (2 * Math.pow(R * R + x * x, 1.5));
export const idealSolenoidB = (I: number, turns: number, length: number): number =>
  (MU0 * turns * I) / length;

/** Campo muestreado en una grilla regular del plano z = 0, con interpolación bilineal. */
export interface FieldGrid {
  nx: number;
  ny: number;
  xMin: number;
  yMin: number;
  dx: number;
  dy: number;
  bx: Float64Array;
  by: Float64Array;
}

export function sampleGrid(
  field: (x: number, y: number) => Vec2,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  nx: number,
  ny: number,
): FieldGrid {
  const dx = (xMax - xMin) / (nx - 1);
  const dy = (yMax - yMin) / (ny - 1);
  const bx = new Float64Array(nx * ny);
  const by = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = field(xMin + i * dx, yMin + j * dy);
      bx[j * nx + i] = v.x;
      by[j * nx + i] = v.y;
    }
  }
  return { nx, ny, xMin, yMin, dx, dy, bx, by };
}

export function interpolate(g: FieldGrid, x: number, y: number): Vec2 {
  const fx = Math.min(Math.max((x - g.xMin) / g.dx, 0), g.nx - 1.001);
  const fy = Math.min(Math.max((y - g.yMin) / g.dy, 0), g.ny - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const k = j * g.nx + i;
  const mix = (a: Float64Array) =>
    (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) +
    (a[k + g.nx] * (1 - tx) + a[k + g.nx + 1] * tx) * ty;
  return { x: mix(g.bx), y: mix(g.by) };
}

/** Línea de campo de B a partir de un punto, hacia adelante y hacia atrás (RK2 sobre la grilla). */
export function streamline(g: FieldGrid, start: Vec2, step: number, maxSteps = 900): Vec2[] {
  const xMax = g.xMin + g.dx * (g.nx - 1);
  const yMax = g.yMin + g.dy * (g.ny - 1);
  const run = (dir: 1 | -1): Vec2[] => {
    const pts: Vec2[] = [];
    let { x, y } = start;
    for (let i = 0; i < maxSteps; i++) {
      const b1 = interpolate(g, x, y);
      const m1 = Math.hypot(b1.x, b1.y);
      if (m1 === 0) break;
      const mx = x + ((dir * step) / 2) * (b1.x / m1);
      const my = y + ((dir * step) / 2) * (b1.y / m1);
      const b2 = interpolate(g, mx, my);
      const m2 = Math.hypot(b2.x, b2.y);
      if (m2 === 0) break;
      x += dir * step * (b2.x / m2);
      y += dir * step * (b2.y / m2);
      if (x < g.xMin || x > xMax || y < g.yMin || y > yMax) break;
      pts.push({ x, y });
      // Línea cerrada: volvió al punto de partida.
      if (i > 20 && Math.hypot(x - start.x, y - start.y) < step * 1.2) break;
    }
    return pts;
  };
  const fwd = run(1);
  const closed =
    fwd.length > 20 &&
    Math.hypot(fwd[fwd.length - 1].x - start.x, fwd[fwd.length - 1].y - start.y) < step * 1.5;
  if (closed) return [start, ...fwd, start];
  return [...run(-1).reverse(), start, ...fwd];
}
