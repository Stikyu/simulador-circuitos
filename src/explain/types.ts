/**
 * Una explicación es una lista de pasos. Cada paso tiene un título y líneas;
 * las líneas que empiezan con "$ " son fórmulas (se muestran en monoespaciado).
 */
export interface Step {
  title: string;
  lines: string[];
}

export interface Explanation {
  /** Nombre del método usado (por ejemplo "Reducción serie/paralelo"). */
  method: string;
  /** Una frase que resume el enfoque. */
  summary: string;
  steps: Step[];
}

export const formula = (text: string): string => `$ ${text}`;
