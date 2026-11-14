import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  pointKey,
  pointOnSegment,
  samePoint,
  type Circuit,
  type Point,
  type Rotation,
} from '../engine/circuit';
import { defOf, terminalPositions } from '../components/registry';
import {
  addComponent,
  addWires,
  boundingBox,
  deleteItems,
  duplicateItems,
  moveItems,
  rotateItems,
  routeWire,
} from './ops';
import { ComponentView } from './ComponentView';
import { GRID } from './grid';
import type { Overlay } from './overlay';
import type { EditorStore } from './store';
import { ComponentSymbol } from './symbols';
import { useEditor } from './useEditor';

export { GRID };

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'move'; start: Point; base: Circuit; ids: string[] }
  | { kind: 'box'; x0: number; y0: number; additive: boolean }
  | { kind: 'wire' };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface CanvasProps {
  store: EditorStore;
  /** Cambiar este número vuelve a encuadrar el circuito. */
  fitKey: number;
  /** Resultados a dibujar encima del circuito. */
  overlay?: Overlay | null;
  /** Componentes a resaltar como problemáticos. */
  errorIds?: ReadonlySet<string>;
  /** Aviso flotante sobre el lienzo (por ejemplo, un error del circuito). */
  banner?: ReactNode;
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function Canvas({ store, fitKey, overlay, errorIds, banner }: CanvasProps) {
  const { circuit, selection, tool } = useEditor(store);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 200, y: 160, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [wireStart, setWireStart] = useState<Point | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const selected = useMemo(() => new Set(selection), [selection]);

  // --- Conversión de coordenadas -------------------------------------------------
  const toWorld = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k };
  }, []);

  const toGrid = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const w = toWorld(e);
      return { x: Math.round(w.x / GRID), y: Math.round(w.y / GRID) };
    },
    [toWorld],
  );

  // --- Encuadre -------------------------------------------------------------------
  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const bb = boundingBox(store.getState().circuit);
    if (!bb || rect.width === 0) {
      setView({ x: rect.width / 2, y: rect.height / 2, k: 1 });
      return;
    }
    const w = (bb.max.x - bb.min.x + 6) * GRID;
    const h = (bb.max.y - bb.min.y + 6) * GRID;
    const k = Math.max(0.4, Math.min(1.6, rect.width / w, rect.height / h));
    const cx = ((bb.min.x + bb.max.x) / 2) * GRID;
    const cy = ((bb.min.y + bb.max.y) / 2) * GRID;
    setView({ x: rect.width / 2 - cx * k, y: rect.height / 2 - cy * k, k });
  }, [store]);

  useEffect(() => {
    fit();
  }, [fit, fitKey]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const px = cx ?? rect.width / 2;
      const py = cy ?? rect.height / 2;
      const k = Math.max(0.3, Math.min(3, v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // --- Teclado --------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = store.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        spaceDown.current = true;
        return;
      }
      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        store.redo();
      } else if (ctrl && key === 'd') {
        e.preventDefault();
        const r = duplicateItems(st.circuit, st.selection);
        store.commit(r.circuit, r.ids);
      } else if (ctrl && key === 'a') {
        e.preventDefault();
        store.select([
          ...st.circuit.components.map((c) => c.id),
          ...st.circuit.wires.map((w) => w.id),
        ]);
      } else if (ctrl) {
        return;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selection.length > 0) {
          e.preventDefault();
          store.commit(deleteItems(st.circuit, st.selection), []);
        }
      } else if (e.key === 'Enter' && st.tool.kind === 'place' && svgRef.current) {
        // Accesible sin mouse: coloca en el centro de lo que se está viendo.
        e.preventDefault();
        const rect = svgRef.current.getBoundingClientRect();
        const v = viewRef.current;
        const at = {
          x: Math.round((rect.width / 2 - v.x) / v.k / GRID),
          y: Math.round((rect.height / 2 - v.y) / v.k / GRID),
        };
        while (st.circuit.components.some((k) => k.x === at.x && k.y === at.y)) at.y += 2;
        const r = addComponent(st.circuit, st.tool.type, at, st.tool.rot);
        store.commit(r.circuit);
        store.setTool({ kind: 'select' });
        store.select([r.id]);
      } else if (key === 'r') {
        if (st.tool.kind === 'place') {
          store.setTool({ ...st.tool, rot: ((st.tool.rot + 1) % 4) as Rotation });
        } else {
          store.commit(rotateItems(st.circuit, st.selection));
        }
      } else if (e.key === 'Escape') {
        setWireStart(null);
        drag.current = null;
        setBox(null);
        if (st.tool.kind !== 'select') store.setTool({ kind: 'select' });
        else store.select([]);
      } else if (key === 'w') {
        store.setTool({ kind: 'wire' });
      } else if (key === 'v') {
        store.setTool({ kind: 'select' });
      } else if (e.key.startsWith('Arrow') && st.selection.length > 0) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        store.commit(moveItems(st.circuit, st.selection, dx, dy));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [store]);

  // Al salir de la herramienta de cable se descarta el tramo a medio dibujar.
  useEffect(() => {
    if (tool.kind !== 'wire') setWireStart(null);
  }, [tool.kind]);

  // --- Puntero --------------------------------------------------------------------
  const isConnectionPoint = (p: Point): boolean =>
    circuit.components.some((c) => terminalPositions(c).some((t) => samePoint(t, p))) ||
    circuit.wires.some((w) => pointOnSegment(p, w.a, w.b));

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    const target = e.target as Element;
    const termEl = target.closest('[data-term]');
    const itemEl = target.closest('[data-id]');
    const g = toGrid(e);
    svg.setPointerCapture(e.pointerId);

    const wantsPan =
      e.button === 1 ||
      e.button === 2 ||
      spaceDown.current ||
      (e.pointerType === 'touch' && tool.kind === 'select' && !termEl && !itemEl);
    if (wantsPan) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: viewRef.current };
      return;
    }
    if (e.button !== 0) return;

    if (tool.kind === 'place') {
      const r = addComponent(circuit, tool.type, g, tool.rot);
      store.commit(r.circuit);
      return;
    }

    if (tool.kind === 'wire') {
      if (!wireStart) {
        setWireStart(g);
      } else {
        const endsOnSomething = isConnectionPoint(g);
        store.commit(addWires(circuit, routeWire(wireStart, g)));
        setWireStart(endsOnSomething || samePoint(wireStart, g) ? null : g);
      }
      return;
    }

    // Herramienta de selección
    if (termEl) {
      const [x, y] = termEl.getAttribute('data-term')!.split(',').map(Number);
      setWireStart({ x, y });
      setCursor({ x, y });
      drag.current = { kind: 'wire' };
      return;
    }
    if (itemEl) {
      const id = itemEl.getAttribute('data-id')!;
      let ids: string[];
      if (e.shiftKey) {
        ids = selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id];
      } else {
        ids = selected.has(id) ? selection : [id];
      }
      store.select(ids);
      if (ids.includes(id)) {
        store.beginGesture();
        drag.current = { kind: 'move', start: g, base: circuit, ids };
      }
      return;
    }
    const w = toWorld(e);
    drag.current = { kind: 'box', x0: w.x, y0: w.y, additive: e.shiftKey };
    if (!e.shiftKey) store.select([]);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = toGrid(e);
    setCursor((c) => (c && samePoint(c, g) ? c : g));
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView({ ...d.view, x: d.view.x + e.clientX - d.sx, y: d.view.y + e.clientY - d.sy });
    } else if (d.kind === 'move') {
      store.preview(moveItems(d.base, d.ids, g.x - d.start.x, g.y - d.start.y));
    } else if (d.kind === 'box') {
      const w = toWorld(e);
      setBox({ x0: d.x0, y0: d.y0, x1: w.x, y1: w.y });
    }
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'move') {
      store.endGesture();
    } else if (d.kind === 'wire') {
      const g = toGrid(e);
      if (wireStart && !samePoint(wireStart, g)) {
        store.commit(addWires(circuit, routeWire(wireStart, g)));
      }
      setWireStart(null);
    } else if (d.kind === 'box') {
      if (box) {
        const minX = Math.min(box.x0, box.x1) / GRID;
        const maxX = Math.max(box.x0, box.x1) / GRID;
        const minY = Math.min(box.y0, box.y1) / GRID;
        const maxY = Math.max(box.y0, box.y1) / GRID;
        const inside = (p: Point) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        const ids = [
          ...circuit.components.filter((c) => inside(c)).map((c) => c.id),
          ...circuit.wires.filter((w) => inside(w.a) && inside(w.b)).map((w) => w.id),
        ];
        store.select(d.additive ? [...new Set([...selection, ...ids])] : ids);
      }
      setBox(null);
    }
  };

  // --- Puntos de unión (tres o más conexiones en un mismo punto) ------------------
  const junctions = useMemo(() => {
    const count = new Map<string, { p: Point; n: number }>();
    const bump = (p: Point, n = 1) => {
      const k = pointKey(p);
      const e = count.get(k);
      if (e) e.n += n;
      else count.set(k, { p, n });
    };
    for (const c of circuit.components) terminalPositions(c).forEach((p) => bump(p));
    for (const w of circuit.wires) {
      bump(w.a);
      bump(w.b);
    }
    for (const entry of count.values()) {
      for (const w of circuit.wires) {
        if (
          !samePoint(entry.p, w.a) &&
          !samePoint(entry.p, w.b) &&
          pointOnSegment(entry.p, w.a, w.b)
        ) {
          entry.n += 2;
        }
      }
    }
    return [...count.values()].filter((e) => e.n >= 3).map((e) => e.p);
  }, [circuit]);

  const ghostWire = wireStart && cursor ? routeWire(wireStart, cursor) : [];
  const cursorClass =
    tool.kind === 'place' ? 'tool-place' : tool.kind === 'wire' ? 'tool-wire' : 'tool-select';

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={`canvas ${cursorClass}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => !drag.current && setCursor(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (tool.kind !== 'select') store.setTool({ kind: 'select' });
        }}
        role="application"
        aria-label="Editor de circuitos. Usá Tab para recorrer los componentes."
      >
        <defs>
          <pattern
            id="grid-dots"
            width={GRID}
            height={GRID}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}
          >
            <circle cx="0" cy="0" r="1.1" className="grid-dot" />
            <circle cx={GRID} cy="0" r="1.1" className="grid-dot" />
            <circle cx="0" cy={GRID} r="1.1" className="grid-dot" />
            <circle cx={GRID} cy={GRID} r="1.1" className="grid-dot" />
          </pattern>
          <pattern
            id="grid-major"
            width={GRID * 5}
            height={GRID * 5}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}
          >
            <path d={`M0 0H${GRID * 5}M0 0V${GRID * 5}`} className="grid-line" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-major)" />
        <rect width="100%" height="100%" fill="url(#grid-dots)" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {circuit.wires.map((w) => (
            <g key={w.id} data-id={w.id} className={`wire ${selected.has(w.id) ? 'selected' : ''}`}>
              <line
                className="wire-hit"
                x1={w.a.x * GRID}
                y1={w.a.y * GRID}
                x2={w.b.x * GRID}
                y2={w.b.y * GRID}
              />
              <line
                className="wire-line"
                x1={w.a.x * GRID}
                y1={w.a.y * GRID}
                x2={w.b.x * GRID}
                y2={w.b.y * GRID}
              />
            </g>
          ))}

          {overlay?.flows.map((f, i) => {
            const fwd = f.current >= 0;
            const a = fwd ? f.a : f.b;
            const b = fwd ? f.b : f.a;
            const speed = 22 + 70 * Math.sqrt(Math.abs(f.current) / (overlay.maxCurrent || 1));
            return (
              <line
                key={`flow${i}`}
                className="flow"
                x1={a.x * GRID}
                y1={a.y * GRID}
                x2={b.x * GRID}
                y2={b.y * GRID}
                style={{ animationDuration: `${(14 / speed).toFixed(3)}s` }}
              />
            );
          })}

          {circuit.components.map((c) => (
            <ComponentView
              key={c.id}
              c={c}
              selected={selected.has(c.id)}
              error={errorIds?.has(c.id) ?? false}
              extra={overlay?.compText.get(c.id)}
              dir={overlay?.compDir.get(c.id)}
              closed={overlay?.switchStates.get(c.id)}
              onSelect={() => store.select([c.id])}
            />
          ))}

          {junctions.map((p) => (
            <circle
              key={pointKey(p)}
              className="junction"
              cx={p.x * GRID}
              cy={p.y * GRID}
              r="3.4"
            />
          ))}

          {circuit.components.flatMap((c) =>
            terminalPositions(c).map((p, i) => (
              <g key={`${c.id}:${i}`} data-term={pointKey(p)} className="terminal">
                <circle cx={p.x * GRID} cy={p.y * GRID} r="7" className="terminal-hit" />
                <circle cx={p.x * GRID} cy={p.y * GRID} r="2.6" className="terminal-dot" />
              </g>
            )),
          )}

          {overlay?.nodeTags.map((t, i) => (
            <text
              key={`tag${i}`}
              className="node-tag"
              x={t.at.x * GRID + (t.vertical ? 7 : 0)}
              y={t.at.y * GRID + (t.vertical ? 4 : -7)}
              textAnchor={t.vertical ? 'start' : 'middle'}
            >
              {t.text}
            </text>
          ))}

          {ghostWire.map(([a, b], i) => (
            <line
              key={i}
              className="ghost-wire"
              x1={a.x * GRID}
              y1={a.y * GRID}
              x2={b.x * GRID}
              y2={b.y * GRID}
            />
          ))}

          {tool.kind === 'wire' && cursor && (
            <circle className="ghost-point" cx={cursor.x * GRID} cy={cursor.y * GRID} r="4" />
          )}

          {tool.kind === 'place' && cursor && (
            <g
              className="comp ghost"
              transform={`translate(${cursor.x * GRID} ${cursor.y * GRID}) rotate(${tool.rot * 90})`}
            >
              <ComponentSymbol type={tool.type} rot={tool.rot} />
            </g>
          )}

          {box && (
            <rect
              className="select-box"
              x={Math.min(box.x0, box.x1)}
              y={Math.min(box.y0, box.y1)}
              width={Math.abs(box.x1 - box.x0)}
              height={Math.abs(box.y1 - box.y0)}
            />
          )}
        </g>
      </svg>

      {banner}

      <div className="canvas-tools" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomAt(1.25)} aria-label="Acercar" title="Acercar">
          +
        </button>
        <button type="button" onClick={() => zoomAt(0.8)} aria-label="Alejar" title="Alejar">
          −
        </button>
        <button type="button" onClick={fit} aria-label="Encuadrar circuito" title="Encuadrar">
          ⤢
        </button>
      </div>

      <div className="canvas-hint" aria-live="polite">
        {tool.kind === 'place' &&
          `Clic para colocar: ${defOf(tool.type).name} · Enter lo pone al centro · R rota · Esc termina`}
        {tool.kind === 'wire' &&
          (wireStart ? 'Clic para fijar el tramo · Esc termina' : 'Clic para empezar un cable')}
        {tool.kind === 'select' &&
          (circuit.components.length === 0
            ? 'Elegí un componente de la paleta para empezar'
            : 'Arrastrá desde un terminal para cablear · R rota · Supr borra')}
      </div>
    </div>
  );
}
