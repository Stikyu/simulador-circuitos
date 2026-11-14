import { parseCircuit, type Circuit } from '../engine/circuit';
import { KNOWN_TYPES } from '../components/registry';

const STORAGE_KEY = 'nodal:circuito';

/** Autoguardado. localStorage puede fallar (modo privado, cuota): nunca debe romper la app. */
export function saveLocal(circuit: Circuit): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(circuit));
  } catch {
    // Sin almacenamiento disponible: se sigue trabajando en memoria.
  }
}

export function loadLocal(): Circuit | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseCircuit(JSON.parse(raw), KNOWN_TYPES);
  } catch {
    return null;
  }
}

export function circuitFromJson(text: string): Circuit {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  return parseCircuit(data, KNOWN_TYPES);
}

export function downloadJson(circuit: Circuit, filename = 'circuito.json'): void {
  const blob = new Blob([JSON.stringify(circuit, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
