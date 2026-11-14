/**
 * Electrostática en el plano. Dos modelos de fuente:
 *  - 'punto': cargas puntuales (Coulomb, 1/r²). q en coulomb.
 *  - 'linea': líneas de carga infinitas perpendiculares a la pantalla (1/r).
 *             q es la densidad lineal λ en C/m. Sirve para modelar placas
 *             paralelas "largas" como una fila de líneas.
 * Distancias en metros.
 */
export const K = 8.9875517923e9; // 1/(4π·ε0)  [N·m²/C²]
export const EPS0 = 8.8541878128e-12; // [F/m]

export interface Charge {
  x: number;
  y: number;
  q: number;
}

export type Kernel = 'punto' | 'linea';

export interface Vec2 {
  x: number;
  y: number;
}

/** Distancia mínima usada en los cálculos, para no dividir por cero sobre una carga. */
const R_MIN = 1e-4;

/** Campo eléctrico E (V/m) en un punto, por superposición. */
export function fieldAt(charges: Charge[], x: number, y: number, kernel: Kernel = 'punto'): Vec2 {
  let ex = 0;
  let ey = 0;
  for (const c of charges) {
    const dx = x - c.x;
    const dy = y - c.y;
    const r2 = Math.max(dx * dx + dy * dy, R_MIN * R_MIN);
    if (kernel === 'punto') {
      const f = (K * c.q) / (r2 * Math.sqrt(r2)); // k·q / r³, por el vector r
      ex += f * dx;
      ey += f * dy;
    } else {
      const f = (2 * K * c.q) / r2; // λ / (2π·ε0·r²), por el vector r
      ex += f * dx;
      ey += f * dy;
    }
  }
  return { x: ex, y: ey };
}

/** Potencial V (voltios). Para líneas de carga la referencia es r = 1 m. */
export function potentialAt(
  charges: Charge[],
  x: number,
  y: number,
  kernel: Kernel = 'punto',
): number {
  let v = 0;
  for (const c of charges) {
    const r = Math.max(Math.hypot(x - c.x, y - c.y), R_MIN);
    v += kernel === 'punto' ? (K * c.q) / r : -2 * K * c.q * Math.log(r);
  }
  return v;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Sigue una línea de campo integrando el campo normalizado con Runge-Kutta 4.
 * dir = +1 avanza en el sentido de E (sale de las cargas positivas), −1 al revés.
 * Se detiene al salir del recuadro o al llegar a una carga.
 */
export function traceFieldLine(
  charges: Charge[],
  start: Vec2,
  dir: 1 | -1,
  bounds: Bounds,
  step: number,
  kernel: Kernel = 'punto',
  maxSteps = 1500,
  captureRadius = step * 1.5,
): { points: Vec2[]; endedAt: number } {
  const unit = (x: number, y: number): Vec2 => {
    const e = fieldAt(charges, x, y, kernel);
    const m = Math.hypot(e.x, e.y) || 1;
    return { x: (dir * e.x) / m, y: (dir * e.y) / m };
  };
  const points: Vec2[] = [start];
  let { x, y } = start;
  for (let i = 0; i < maxSteps; i++) {
    const k1 = unit(x, y);
    const k2 = unit(x + (step / 2) * k1.x, y + (step / 2) * k1.y);
    const k3 = unit(x + (step / 2) * k2.x, y + (step / 2) * k2.y);
    const k4 = unit(x + step * k3.x, y + step * k3.y);
    x += (step / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x);
    y += (step / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y);
    points.push({ x, y });
    if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) {
      return { points, endedAt: -1 };
    }
    if (i > 3) {
      for (let c = 0; c < charges.length; c++) {
        // Solo "atrapan" las cargas del signo hacia el que apunta la línea.
        if (Math.sign(charges[c].q) === dir) continue;
        if (Math.hypot(x - charges[c].x, y - charges[c].y) < captureRadius) {
          points.push({ x: charges[c].x, y: charges[c].y });
          return { points, endedAt: c };
        }
      }
    }
  }
  return { points, endedAt: -1 };
}

/**
 * Líneas de campo de un conjunto de cargas: salen de las positivas en cantidad
 * proporcional a |q|; a las negativas que queden "con hambre" se les agregan
 * líneas trazadas hacia atrás (vienen del infinito).
 */
export function fieldLines(
  charges: Charge[],
  bounds: Bounds,
  linesForLargest = 12,
  kernel: Kernel = 'punto',
): Vec2[][] {
  const qMax = Math.max(0, ...charges.map((c) => Math.abs(c.q)));
  if (qMax === 0) return [];
  const size = Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin);
  const step = size / 400;
  const r0 = step * 3;
  const count = (c: Charge) => Math.max(3, Math.round((linesForLargest * Math.abs(c.q)) / qMax));
  const lines: Vec2[][] = [];
  const arrived = charges.map(() => 0);
  const seed = (c: Charge, n: number, dir: 1 | -1, phase: number) => {
    for (let i = 0; i < n; i++) {
      const a = phase + (2 * Math.PI * i) / n;
      const t = traceFieldLine(
        charges,
        { x: c.x + r0 * Math.cos(a), y: c.y + r0 * Math.sin(a) },
        dir,
        bounds,
        step,
        kernel,
      );
      const pts = dir === 1 ? t.points : t.points.slice().reverse();
      lines.push(pts);
      if (t.endedAt >= 0) arrived[t.endedAt]++;
    }
  };
  charges.forEach((c) => {
    if (c.q > 0) seed(c, count(c), 1, 0.13);
  });
  charges.forEach((c, i) => {
    if (c.q < 0) {
      const missing = count(c) - arrived[i];
      if (missing > 0) seed(c, missing, -1, 0.13 + Math.PI / Math.max(missing, 1));
    }
  });
  return lines;
}

/**
 * Curvas de nivel por "marching squares": devuelve segmentos donde el campo
 * escalar `values` (muestreado en una grilla nx×ny) cruza el valor `level`.
 */
export function contourSegments(
  values: Float64Array,
  nx: number,
  ny: number,
  level: number,
  toWorld: (i: number, j: number) => Vec2,
): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  const at = (i: number, j: number) => values[j * nx + i];
  const lerp = (i0: number, j0: number, i1: number, j1: number): Vec2 => {
    const a = at(i0, j0);
    const b = at(i1, j1);
    const t = b === a ? 0.5 : (level - a) / (b - a);
    return toWorld(i0 + (i1 - i0) * t, j0 + (j1 - j0) * t);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const code =
        (at(i, j) > level ? 1 : 0) |
        (at(i + 1, j) > level ? 2 : 0) |
        (at(i + 1, j + 1) > level ? 4 : 0) |
        (at(i, j + 1) > level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => lerp(i, j, i + 1, j);
      const right = () => lerp(i + 1, j, i + 1, j + 1);
      const bottom = () => lerp(i, j + 1, i + 1, j + 1);
      const left = () => lerp(i, j, i, j + 1);
      switch (code) {
        case 1:
        case 14:
          out.push([left(), top()]);
          break;
        case 2:
        case 13:
          out.push([top(), right()]);
          break;
        case 3:
        case 12:
          out.push([left(), right()]);
          break;
        case 4:
        case 11:
          out.push([right(), bottom()]);
          break;
        case 6:
        case 9:
          out.push([top(), bottom()]);
          break;
        case 7:
        case 8:
          out.push([left(), bottom()]);
          break;
        case 5:
          out.push([left(), top()], [right(), bottom()]);
          break;
        case 10:
          out.push([top(), right()], [left(), bottom()]);
          break;
      }
    }
  }
  return out;
}

/**
 * Placas paralelas de ancho `width` separadas `d`, con diferencia de potencial V.
 * Cada placa se discretiza en `n` líneas de carga. La densidad superficial es
 * la del capacitor ideal, σ = ε0·V/d.
 */
export function parallelPlates(width: number, d: number, V: number, n = 80): Charge[] {
  const sigma = (EPS0 * V) / d;
  const dx = width / n;
  const charges: Charge[] = [];
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (i + 0.5) * dx;
    charges.push({ x, y: d / 2, q: sigma * dx }, { x, y: -d / 2, q: -sigma * dx });
  }
  return charges;
}

/** Campo exacto en el centro entre dos tiras de ancho finito: (2σ/πε0)·atan(ancho/d). */
export function platesCenterField(width: number, d: number, V: number): number {
  const sigma = (EPS0 * V) / d;
  return ((2 * sigma) / (Math.PI * EPS0)) * Math.atan(width / d);
}
