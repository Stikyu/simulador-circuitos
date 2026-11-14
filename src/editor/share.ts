/**
 * Compartir un circuito por link: el estado viaja comprimido en el fragmento
 * de la URL (#c=...). No hay servidor: el link ES el circuito.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { KNOWN_TYPES } from '../components/registry';
import { parseCircuit, type Circuit } from '../engine/circuit';

/** Forma compacta: arreglos posicionales en lugar de objetos con claves repetidas. */
type Packed = {
  v: 1;
  c: [
    id: string,
    type: string,
    x: number,
    y: number,
    rot: number,
    props: Record<string, unknown>,
  ][];
  w: [ax: number, ay: number, bx: number, by: number][];
};

export function encodeCircuit(circuit: Circuit): string {
  const packed: Packed = {
    v: 1,
    c: circuit.components.map((k) => [k.id, k.type, k.x, k.y, k.rot, k.props]),
    w: circuit.wires.map((k) => [k.a.x, k.a.y, k.b.x, k.b.y]),
  };
  return compressToEncodedURIComponent(JSON.stringify(packed));
}

export function decodeCircuit(text: string): Circuit {
  const json = decompressFromEncodedURIComponent(text);
  if (!json) throw new Error('El link no contiene un circuito válido.');
  let packed: Packed;
  try {
    packed = JSON.parse(json) as Packed;
  } catch {
    throw new Error('El link no contiene un circuito válido.');
  }
  if (!packed || !Array.isArray(packed.c) || !Array.isArray(packed.w)) {
    throw new Error('El link no contiene un circuito válido.');
  }
  // Se reconstruye la forma larga y se valida igual que un archivo abierto.
  return parseCircuit(
    {
      components: packed.c.map(([id, type, x, y, rot, props]) => ({ id, type, x, y, rot, props })),
      wires: packed.w.map(([ax, ay, bx, by], i) => ({
        id: `w${i + 1}`,
        a: { x: ax, y: ay },
        b: { x: bx, y: by },
      })),
    },
    KNOWN_TYPES,
  );
}

export function shareUrl(circuit: Circuit, base: string): string {
  return `${base.split('#')[0]}#c=${encodeCircuit(circuit)}`;
}

/** Lee un circuito del fragmento de la URL, si lo hay. */
export function circuitFromHash(hash: string): Circuit | null {
  const m = /^#c=(.+)$/.exec(hash);
  return m ? decodeCircuit(m[1]) : null;
}
