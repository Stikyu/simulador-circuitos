/**
 * Circuitos de ejemplo precargados. Se construyen con las mismas operaciones
 * puras del editor, así que siempre son circuitos válidos.
 */
import { addComponent, addWires } from '../editor/ops';
import {
  emptyCircuit,
  type Circuit,
  type ComponentType,
  type Point,
  type PropValue,
  type Rotation,
} from '../engine/circuit';

export interface Example {
  id: string;
  title: string;
  description: string;
  /** Análisis con el que conviene abrirlo. */
  mode: 'dc' | 'tran' | 'ac';
  tags: string[];
  build: () => Circuit;
}

type Part = [
  type: ComponentType,
  x: number,
  y: number,
  rot: Rotation,
  props?: Record<string, PropValue>,
];
type Seg = [ax: number, ay: number, bx: number, by: number];

function make(parts: Part[], wires: Seg[]): Circuit {
  let c = emptyCircuit();
  for (const [type, x, y, rot, props] of parts) {
    c = addComponent(c, type, { x, y }, rot, props).circuit;
  }
  return addWires(
    c,
    wires.map(([ax, ay, bx, by]): [Point, Point] => [
      { x: ax, y: ay },
      { x: bx, y: by },
    ]),
  );
}

/** Malla típica: fuente vertical a la izquierda, serie arriba, retorno abajo, tierra abajo a la izquierda. */
const loop = (right: number): Seg[] => [
  [0, 2, 2, 2],
  [right, 6, 0, 6],
];

export const EXAMPLES: Example[] = [
  {
    id: 'divisor',
    title: 'Divisor de tensión',
    description: 'Dos resistencias en serie reparten la tensión de la fuente. Vout = V·R2/(R1+R2).',
    mode: 'dc',
    tags: ['DC', 'serie'],
    build: () =>
      make(
        [
          ['vdc', 0, 4, 1, { V: 10 }],
          ['resistor', 4, 2, 0, { R: 1000 }],
          ['resistor', 8, 4, 1, { R: 2000 }],
          ['voltmeter', 12, 4, 1],
          ['ground', 0, 6, 0],
        ],
        [...loop(8), [6, 2, 8, 2], [8, 2, 12, 2], [8, 6, 12, 6]],
      ),
  },
  {
    id: 'wheatstone',
    title: 'Puente de Wheatstone',
    description:
      'Cuatro resistencias en puente con un detector en el medio. No se reduce por serie/paralelo: hay que plantear nodos.',
    mode: 'dc',
    tags: ['DC', 'nodal'],
    build: () =>
      make(
        [
          ['vdc', 0, 5, 1, { V: 10 }],
          ['resistor', 6, 3, 1, { R: 1000 }],
          ['resistor', 6, 7, 1, { R: 2000 }],
          ['resistor', 14, 3, 1, { R: 2000 }],
          ['resistor', 14, 7, 1, { R: 1000 }],
          ['resistor', 10, 5, 0, { R: 470 }],
          ['ground', 0, 9, 0],
        ],
        [
          [0, 3, 0, 1],
          [0, 1, 6, 1],
          [6, 1, 14, 1],
          [0, 7, 0, 9],
          [0, 9, 6, 9],
          [6, 9, 14, 9],
          [6, 5, 8, 5],
          [12, 5, 14, 5],
        ],
      ),
  },
  {
    id: 'thevenin',
    title: 'Equivalente de Thevenin',
    description:
      'Una fuente con dos resistencias alimenta una carga RL. Seleccioná RL para ver Vth, Rth e IN del resto del circuito.',
    mode: 'dc',
    tags: ['DC', 'Thevenin'],
    build: () =>
      make(
        [
          ['vdc', 0, 4, 1, { V: 12 }],
          ['resistor', 4, 2, 0, { R: 4000 }],
          ['resistor', 8, 4, 1, { R: 12000 }],
          ['ammeter', 11, 2, 0],
          ['resistor', 14, 4, 1, { R: 6000 }],
          ['ground', 0, 6, 0],
        ],
        [...loop(8), [6, 2, 8, 2], [8, 2, 9, 2], [13, 2, 14, 2], [8, 6, 14, 6]],
      ),
  },
  {
    id: 'carga-capacitor',
    title: 'Carga de un capacitor (RC)',
    description:
      'Al cerrar el interruptor, el capacitor se carga a través de R con constante de tiempo τ = RC = 1 ms.',
    mode: 'tran',
    tags: ['Transitorio', 'RC'],
    build: () =>
      make(
        [
          ['vdc', 0, 4, 1, { V: 5 }],
          ['switch', 4, 2, 0, { closed: false, conmuta: true, tSwitch: 0.001 }],
          ['resistor', 8, 2, 0, { R: 1000 }],
          ['capacitor', 12, 4, 1, { C: 1e-6, v0: 0 }],
          ['ground', 0, 6, 0],
        ],
        [...loop(12), [10, 2, 12, 2]],
      ),
  },
  {
    id: 'rl',
    title: 'Circuito RL',
    description:
      'La bobina se opone a los cambios de corriente: la corriente crece de a poco con τ = L/R = 0,5 ms.',
    mode: 'tran',
    tags: ['Transitorio', 'RL'],
    build: () =>
      make(
        [
          ['vdc', 0, 4, 1, { V: 10 }],
          ['switch', 4, 2, 0, { closed: false, conmuta: true, tSwitch: 0.0005 }],
          ['resistor', 8, 2, 0, { R: 100 }],
          ['inductor', 12, 4, 1, { L: 0.05, i0: 0 }],
          ['ground', 0, 6, 0],
        ],
        [...loop(12), [10, 2, 12, 2]],
      ),
  },
  {
    id: 'rlc-escalon',
    title: 'RLC serie: respuesta al escalón',
    description:
      'Con R = 40 Ω la respuesta es subamortiguada. Probá R = 200 Ω (crítico) y R = 500 Ω (sobreamortiguado).',
    mode: 'tran',
    tags: ['Transitorio', 'RLC'],
    build: () =>
      make(
        [
          ['vdc', 0, 4, 1, { V: 10 }],
          ['resistor', 4, 2, 0, { R: 40 }],
          ['inductor', 8, 2, 0, { L: 0.01, i0: 0 }],
          ['capacitor', 12, 4, 1, { C: 1e-6, v0: 0 }],
          ['ground', 0, 6, 0],
        ],
        [...loop(12), [10, 2, 12, 2]],
      ),
  },
  {
    id: 'rlc-resonante',
    title: 'RLC serie resonante',
    description:
      'En f0 = 1/(2π√LC) ≈ 1,59 kHz las reactancias se cancelan: la corriente es máxima y está en fase con la fuente.',
    mode: 'ac',
    tags: ['Alterna', 'resonancia'],
    build: () =>
      make(
        [
          ['vac', 0, 4, 1, { A: 10, f: 1591.55, phase: 0 }],
          ['resistor', 4, 2, 0, { R: 50 }],
          ['inductor', 8, 2, 0, { L: 0.01, i0: 0 }],
          ['capacitor', 12, 4, 1, { C: 1e-6, v0: 0 }],
          ['ground', 0, 6, 0],
        ],
        [...loop(12), [10, 2, 12, 2]],
      ),
  },
  {
    id: 'filtro-rc',
    title: 'Filtro RC pasa bajos',
    description:
      'La salida se toma sobre el capacitor. Por encima de fc = 1/(2πRC) ≈ 1 kHz la señal se atenúa 20 dB por década.',
    mode: 'ac',
    tags: ['Alterna', 'filtro', 'Bode'],
    build: () =>
      make(
        [
          ['vac', 0, 4, 1, { A: 1, f: 1000, phase: 0 }],
          ['resistor', 4, 2, 0, { R: 1600 }],
          ['capacitor', 8, 4, 1, { C: 100e-9, v0: 0 }],
          ['voltmeter', 12, 4, 1],
          ['ground', 0, 6, 0],
        ],
        [...loop(8), [6, 2, 8, 2], [8, 2, 12, 2], [8, 6, 12, 6]],
      ),
  },
  {
    id: 'filtro-pasa-altos',
    title: 'Filtro RC pasa altos',
    description:
      'Intercambiando R y C, la salida sobre la resistencia deja pasar las frecuencias altas y bloquea la continua.',
    mode: 'ac',
    tags: ['Alterna', 'filtro', 'Bode'],
    build: () =>
      make(
        [
          ['vac', 0, 4, 1, { A: 1, f: 1000, phase: 0 }],
          ['capacitor', 4, 2, 0, { C: 100e-9, v0: 0 }],
          ['resistor', 8, 4, 1, { R: 1600 }],
          ['voltmeter', 12, 4, 1],
          ['ground', 0, 6, 0],
        ],
        [...loop(8), [6, 2, 8, 2], [8, 2, 12, 2], [8, 6, 12, 6]],
      ),
  },
  {
    id: 'filtro-pasa-banda',
    title: 'Filtro RLC pasa banda',
    description:
      'RLC serie con la salida sobre R: solo pasan las frecuencias cercanas a la resonancia. El ancho de banda es R/(2πL).',
    mode: 'ac',
    tags: ['Alterna', 'filtro', 'resonancia'],
    build: () =>
      make(
        [
          ['vac', 0, 4, 1, { A: 1, f: 5033, phase: 0 }],
          ['inductor', 4, 2, 0, { L: 0.01, i0: 0 }],
          ['capacitor', 8, 2, 0, { C: 100e-9, v0: 0 }],
          ['resistor', 12, 4, 1, { R: 100 }],
          ['ground', 0, 6, 0],
        ],
        [...loop(12), [10, 2, 12, 2]],
      ),
  },
];

export const exampleById = (id: string): Example | undefined => EXAMPLES.find((e) => e.id === id);
