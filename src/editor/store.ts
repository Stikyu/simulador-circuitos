/**
 * Estado del editor con historial de undo/redo. No depende de React: se
 * conecta con `useSyncExternalStore` y se puede testear solo.
 */
import { emptyCircuit, type Circuit, type ComponentType, type Rotation } from '../engine/circuit';

export type Tool =
  { kind: 'select' } | { kind: 'wire' } | { kind: 'place'; type: ComponentType; rot: Rotation };

export interface EditorState {
  circuit: Circuit;
  selection: string[];
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
}

const HISTORY_LIMIT = 200;

export class EditorStore {
  private state: EditorState;
  private past: Circuit[] = [];
  private future: Circuit[] = [];
  private listeners = new Set<() => void>();
  /** Instantánea tomada al empezar un arrastre; null si no hay gesto en curso. */
  private gestureBase: Circuit | null = null;

  constructor(initial: Circuit = emptyCircuit()) {
    this.state = {
      circuit: initial,
      selection: [],
      tool: { kind: 'select' },
      canUndo: false,
      canRedo: false,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<EditorState>) {
    this.state = {
      ...this.state,
      ...partial,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    };
    this.listeners.forEach((fn) => fn());
  }

  private pushPast(circuit: Circuit) {
    this.past.push(circuit);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  /** Aplica un cambio y lo registra en el historial. */
  commit(circuit: Circuit, selection?: string[]) {
    if (circuit === this.state.circuit) {
      if (selection) this.set({ selection });
      return;
    }
    this.pushPast(this.state.circuit);
    this.set({ circuit, selection: selection ?? this.pruneSelection(circuit) });
  }

  /** Inicio de un gesto continuo (arrastre): los cambios intermedios no van al historial. */
  beginGesture() {
    this.gestureBase = this.state.circuit;
  }

  /** Cambio intermedio de un gesto. */
  preview(circuit: Circuit) {
    this.set({ circuit });
  }

  /** Fin del gesto: todo el arrastre queda como un único paso de undo. */
  endGesture() {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.state.circuit) {
      this.pushPast(base);
      this.set({});
    }
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state.circuit);
    this.set({ circuit: prev, selection: this.pruneSelection(prev) });
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.circuit);
    this.set({ circuit: next, selection: this.pruneSelection(next) });
  }

  /** Reemplaza el circuito completo (abrir archivo, ejemplo). Se puede deshacer. */
  load(circuit: Circuit) {
    this.commit(circuit, []);
    this.set({ tool: { kind: 'select' }, selection: [] });
  }

  select(ids: string[]) {
    this.set({ selection: ids });
  }

  setTool(tool: Tool) {
    this.set({ tool, selection: tool.kind === 'select' ? this.state.selection : [] });
  }

  private pruneSelection(circuit: Circuit): string[] {
    const ids = new Set([
      ...circuit.components.map((c) => c.id),
      ...circuit.wires.map((w) => w.id),
    ]);
    return this.state.selection.filter((id) => ids.has(id));
  }
}
