import { describe, expect, it } from 'vitest';
import { KNOWN_TYPES, terminalPositions } from '../src/components/registry';
import {
  addComponent,
  addWires,
  deleteItems,
  duplicateItems,
  moveItems,
  rotateItems,
  routeWire,
  setProp,
} from '../src/editor/ops';
import { EditorStore } from '../src/editor/store';
import { emptyCircuit, parseCircuit, rotatePoint } from '../src/engine/circuit';

describe('operaciones del editor', () => {
  it('numera los componentes por prefijo', () => {
    let c = emptyCircuit();
    c = addComponent(c, 'resistor', { x: 0, y: 0 }).circuit;
    c = addComponent(c, 'resistor', { x: 0, y: 4 }).circuit;
    c = addComponent(c, 'vdc', { x: 0, y: 8 }).circuit;
    expect(c.components.map((k) => k.id)).toEqual(['R1', 'R2', 'V1']);
    c = deleteItems(c, ['R1']);
    expect(addComponent(c, 'resistor', { x: 9, y: 9 }).id).toBe('R1');
  });

  it('rota los terminales en pasos de 90°', () => {
    expect(rotatePoint({ x: 2, y: 0 }, 1)).toEqual({ x: 0, y: 2 });
    expect(rotatePoint({ x: 2, y: 0 }, 2)).toEqual({ x: -2, y: 0 });
    const { circuit } = addComponent(emptyCircuit(), 'resistor', { x: 5, y: 5 }, 1);
    expect(terminalPositions(circuit.components[0])).toEqual([
      { x: 5, y: 3 },
      { x: 5, y: 7 },
    ]);
  });

  it('traza cables en L', () => {
    expect(routeWire({ x: 0, y: 0 }, { x: 4, y: 0 })).toHaveLength(1);
    expect(routeWire({ x: 0, y: 0 }, { x: 4, y: 3 })).toEqual([
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      [
        { x: 4, y: 0 },
        { x: 4, y: 3 },
      ],
    ]);
    expect(routeWire({ x: 1, y: 1 }, { x: 1, y: 1 })).toHaveLength(0);
  });

  it('al mover un componente arrastra los cables enganchados', () => {
    let c = addComponent(emptyCircuit(), 'resistor', { x: 0, y: 0 }).circuit;
    c = addWires(c, [
      [
        { x: 2, y: 0 },
        { x: 6, y: 0 },
      ],
    ]);
    const moved = moveItems(c, ['R1'], 0, 3);
    expect(moved.wires[0].a).toEqual({ x: 2, y: 3 });
    expect(moved.wires[0].b).toEqual({ x: 6, y: 0 });
  });

  it('al rotar mantiene la conexión con el cable', () => {
    let c = addComponent(emptyCircuit(), 'resistor', { x: 0, y: 0 }).circuit;
    c = addWires(c, [
      [
        { x: 2, y: 0 },
        { x: 6, y: 0 },
      ],
    ]);
    const r = rotateItems(c, ['R1']);
    expect(r.components[0].rot).toBe(1);
    expect(r.wires[0].a).toEqual({ x: 0, y: 2 });
  });

  it('duplica y edita propiedades', () => {
    let c = addComponent(emptyCircuit(), 'resistor', { x: 0, y: 0 }).circuit;
    c = setProp(c, 'R1', 'R', 220);
    const d = duplicateItems(c, ['R1']);
    expect(d.ids).toEqual(['R2']);
    expect(d.circuit.components[1].props.R).toBe(220);
  });
});

describe('historial (undo/redo)', () => {
  it('deshace y rehace cambios', () => {
    const store = new EditorStore();
    const a = addComponent(store.getState().circuit, 'resistor', { x: 0, y: 0 }).circuit;
    store.commit(a);
    const b = addComponent(a, 'vdc', { x: 0, y: 4 }).circuit;
    store.commit(b);
    expect(store.getState().circuit.components).toHaveLength(2);
    store.undo();
    expect(store.getState().circuit).toBe(a);
    expect(store.getState().canRedo).toBe(true);
    store.redo();
    expect(store.getState().circuit).toBe(b);
    store.undo();
    store.undo();
    expect(store.getState().circuit.components).toHaveLength(0);
    expect(store.getState().canUndo).toBe(false);
  });

  it('un arrastre completo cuenta como un solo paso', () => {
    const store = new EditorStore();
    const base = addComponent(emptyCircuit(), 'resistor', { x: 0, y: 0 }).circuit;
    store.commit(base);
    store.beginGesture();
    store.preview(moveItems(base, ['R1'], 1, 0));
    store.preview(moveItems(base, ['R1'], 2, 0));
    store.preview(moveItems(base, ['R1'], 3, 0));
    store.endGesture();
    expect(store.getState().circuit.components[0].x).toBe(3);
    store.undo();
    expect(store.getState().circuit.components[0].x).toBe(0);
  });

  it('un cambio nuevo descarta el futuro', () => {
    const store = new EditorStore();
    const a = addComponent(emptyCircuit(), 'resistor', { x: 0, y: 0 }).circuit;
    store.commit(a);
    store.undo();
    store.commit(addComponent(emptyCircuit(), 'vdc', { x: 0, y: 0 }).circuit);
    expect(store.getState().canRedo).toBe(false);
  });
});

describe('serialización', () => {
  it('ida y vuelta por JSON', () => {
    let c = addComponent(emptyCircuit(), 'resistor', { x: 1, y: 2 }, 1).circuit;
    c = addWires(c, [
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
    ]);
    const back = parseCircuit(JSON.parse(JSON.stringify(c)), KNOWN_TYPES);
    expect(back).toEqual(c);
  });

  it('rechaza archivos inválidos con un mensaje claro', () => {
    expect(() => parseCircuit({ foo: 1 }, KNOWN_TYPES)).toThrow(/no parece un circuito/);
    expect(() =>
      parseCircuit(
        { components: [{ id: 'X1', type: 'flux', x: 0, y: 0 }], wires: [] },
        KNOWN_TYPES,
      ),
    ).toThrow(/desconocido/);
  });
});
