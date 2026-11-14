export type CircuitErrorCode =
  | 'vacio'
  | 'sin-tierra'
  | 'nodo-flotante'
  | 'lazo-tension'
  | 'fuente-en-corto'
  | 'singular'
  | 'parametro'
  | 'frecuencias'
  | 'sin-fuente-ac';

/**
 * Error de análisis pensado para mostrarse al estudiante: mensaje en español
 * y lista de componentes involucrados para resaltarlos en el editor.
 */
export class CircuitError extends Error {
  readonly code: CircuitErrorCode;
  readonly componentIds: string[];
  /** Sugerencia breve de cómo arreglarlo. */
  readonly hint: string;

  constructor(code: CircuitErrorCode, message: string, componentIds: string[] = [], hint = '') {
    super(message);
    this.name = 'CircuitError';
    this.code = code;
    this.componentIds = componentIds;
    this.hint = hint;
  }
}
