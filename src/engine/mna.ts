/**
 * Análisis nodal modificado (MNA).
 *
 * Incógnitas: la tensión de cada nodo (menos tierra) y, además, la corriente
 * de cada rama que impone una tensión (fuentes, cables ideales, bobinas en DC).
 * Cada componente "estampa" su aporte con dos primitivas:
 *
 *   stampAdmittance  →  rama con  i = Y·(va − vb) + Ieq      (R, C, L, fuente de corriente)
 *   stampVoltage     →  rama con  va − vb − r·i = V          (fuentes de tensión, cortos)
 *
 * La misma matriz sirve para DC y transitorio (reales) y para AC (complejos):
 * los coeficientes se guardan con parte real e imaginaria.
 */
import type { Complex } from './complex';
import { solveComplex, solveReal } from './linear';
import type { NetElement } from './netlist';

export type AnalysisMode = 'dc' | 'ac' | 'tran' | 'ic';

/** Estado de un elemento con memoria (C o L) en el paso anterior. */
export interface ElementState {
  v: number;
  i: number;
}

/** Contexto que recibe cada componente al estampar. */
export interface StampCtx {
  mode: AnalysisMode;
  sys: MnaSystem;
  /** Pulsación ω = 2πf (solo AC). */
  omega: number;
  /** Tiempo del paso que se está resolviendo (transitorio). */
  t: number;
  /** Paso de tiempo h (transitorio). */
  h: number;
  /** Método de integración de este paso. */
  method: 'trap' | 'be';
  /** Tensión y corriente de cada C/L en el paso anterior. */
  state: Map<string, ElementState>;
}

type CurrentRule =
  | { kind: 'adm'; yRe: number; yIm: number; iRe: number; iIm: number }
  | { kind: 'branch'; index: number }
  | { kind: 'none' };

export class MnaSystem {
  /** Cantidad de nodos contando tierra. */
  readonly nodeCount: number;
  private rows: number[] = [];
  private cols: number[] = [];
  private valRe: number[] = [];
  private valIm: number[] = [];
  private rhs = new Map<number, Complex>();
  private rules = new Map<string, CurrentRule>();
  /** Id del elemento dueño de cada incógnita de corriente. */
  readonly branchOwners: string[] = [];

  constructor(nodeCount: number) {
    this.nodeCount = nodeCount;
  }

  get size(): number {
    return this.nodeCount - 1 + this.branchOwners.length;
  }

  /** Fila/columna de la tensión del nodo n (−1 para tierra: no es incógnita). */
  private nodeIndex(n: number): number {
    return n - 1;
  }

  private add(r: number, c: number, re: number, im = 0) {
    if (r < 0 || c < 0) return;
    this.rows.push(r);
    this.cols.push(c);
    this.valRe.push(re);
    this.valIm.push(im);
  }

  private addRhs(r: number, re: number, im = 0) {
    if (r < 0) return;
    const cur = this.rhs.get(r);
    if (cur) {
      cur.re += re;
      cur.im += im;
    } else {
      this.rhs.set(r, { re, im });
    }
  }

  /**
   * Rama tipo admitancia entre los terminales a y b del elemento:
   *   i(a→b) = Y·(va − vb) + Ieq
   * Y va a la matriz (el "sello" clásico +Y, +Y, −Y, −Y) e Ieq al término independiente.
   */
  stampAdmittance(el: NetElement, yRe: number, yIm = 0, iRe = 0, iIm = 0) {
    const a = this.nodeIndex(el.nodes[0]);
    const b = this.nodeIndex(el.nodes[1]);
    this.rules.set(el.id, { kind: 'adm', yRe, yIm, iRe, iIm });
    if (a === b) return; // los dos terminales en el mismo nodo: no aporta nada
    if (yRe !== 0 || yIm !== 0) {
      this.add(a, a, yRe, yIm);
      this.add(b, b, yRe, yIm);
      this.add(a, b, -yRe, -yIm);
      this.add(b, a, -yRe, -yIm);
    }
    if (iRe !== 0 || iIm !== 0) {
      // Ieq sale del nodo a y entra al nodo b.
      this.addRhs(a, -iRe, -iIm);
      this.addRhs(b, iRe, iIm);
    }
  }

  /**
   * Rama tipo tensión: agrega la corriente i(a→b) como incógnita y la ecuación
   *   va − vb − r·i = V
   * Con r = 0 es una fuente ideal (o un cable si además V = 0).
   */
  stampVoltage(el: NetElement, vRe: number, vIm = 0, r = 0) {
    const a = this.nodeIndex(el.nodes[0]);
    const b = this.nodeIndex(el.nodes[1]);
    if (a === b && r === 0) {
      // Terminales unidos entre sí: la rama no define nada (se valida aparte).
      this.rules.set(el.id, { kind: 'none' });
      return;
    }
    const k = this.nodeCount - 1 + this.branchOwners.length;
    this.branchOwners.push(el.id);
    this.rules.set(el.id, { kind: 'branch', index: k });
    // KCL: la corriente de la rama sale de a y entra en b.
    this.add(a, k, 1);
    this.add(b, k, -1);
    // Ecuación de la rama.
    this.add(k, a, 1);
    this.add(k, b, -1);
    if (r !== 0) this.add(k, k, -r);
    this.addRhs(k, vRe, vIm);
  }

  /** Matriz y vector densos (parte real). */
  assembleReal(): { A: number[][]; b: number[] } {
    const n = this.size;
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    for (let i = 0; i < this.rows.length; i++) A[this.rows[i]][this.cols[i]] += this.valRe[i];
    for (const [r, v] of this.rhs) b[r] = v.re;
    return { A, b };
  }

  solveReal(): number[] {
    const { A, b } = this.assembleReal();
    return solveReal(A, b);
  }

  solveComplex(): { re: number[]; im: number[] } {
    const n = this.size;
    const Are = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const Aim = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const bre = new Array<number>(n).fill(0);
    const bim = new Array<number>(n).fill(0);
    for (let i = 0; i < this.rows.length; i++) {
      Are[this.rows[i]][this.cols[i]] += this.valRe[i];
      Aim[this.rows[i]][this.cols[i]] += this.valIm[i];
    }
    for (const [r, v] of this.rhs) {
      bre[r] = v.re;
      bim[r] = v.im;
    }
    return solveComplex(Are, Aim, bre, bim);
  }

  /** Tensión de un nodo a partir del vector solución real. */
  nodeVoltage(x: number[], node: number): number {
    return node === 0 ? 0 : x[node - 1];
  }

  /** Corriente a→b por un elemento, a partir de la solución real. */
  elementCurrent(x: number[], el: NetElement): number {
    const rule = this.rules.get(el.id);
    if (!rule || rule.kind === 'none') return 0;
    if (rule.kind === 'branch') return x[rule.index];
    const v = this.nodeVoltage(x, el.nodes[0]) - this.nodeVoltage(x, el.nodes[1]);
    return rule.yRe * v + rule.iRe;
  }

  nodeVoltageC(x: { re: number[]; im: number[] }, node: number): Complex {
    return node === 0 ? { re: 0, im: 0 } : { re: x.re[node - 1], im: x.im[node - 1] };
  }

  /** Corriente compleja (fasor) a→b por un elemento. */
  elementCurrentC(x: { re: number[]; im: number[] }, el: NetElement): Complex {
    const rule = this.rules.get(el.id);
    if (!rule || rule.kind === 'none') return { re: 0, im: 0 };
    if (rule.kind === 'branch') return { re: x.re[rule.index], im: x.im[rule.index] };
    const va = this.nodeVoltageC(x, el.nodes[0]);
    const vb = this.nodeVoltageC(x, el.nodes[1]);
    const vr = va.re - vb.re;
    const vi = va.im - vb.im;
    return {
      re: rule.yRe * vr - rule.yIm * vi + rule.iRe,
      im: rule.yRe * vi + rule.yIm * vr + rule.iIm,
    };
  }

  /** Nombre legible de cada incógnita: N1, N2..., I(V1)... */
  unknownLabels(): string[] {
    const labels: string[] = [];
    for (let n = 1; n < this.nodeCount; n++) labels.push(`N${n}`);
    for (const id of this.branchOwners) labels.push(`I(${id})`);
    return labels;
  }

  /** A qué corresponde una fila/columna: un nodo o la rama de un elemento. */
  describeIndex(index: number): { node: number } | { branch: string } {
    if (index < this.nodeCount - 1) return { node: index + 1 };
    return { branch: this.branchOwners[index - (this.nodeCount - 1)] };
  }
}

export function newCtx(
  sys: MnaSystem,
  mode: AnalysisMode,
  extra: Partial<StampCtx> = {},
): StampCtx {
  return { mode, sys, omega: 0, t: 0, h: 0, method: 'trap', state: new Map(), ...extra };
}
