import { useEffect, useMemo, useRef } from 'react';
import { GRID } from '../editor/grid';
import { boundingBox } from '../editor/ops';
import { ComponentSymbol } from '../editor/symbols';
import type { Circuit } from '../engine/circuit';
import { EXAMPLES, type Example } from '../examples';

/** Miniatura estática de un circuito, con los mismos símbolos que el editor. */
export function CircuitPreview({ circuit }: { circuit: Circuit }) {
  const bb = boundingBox(circuit);
  if (!bb) return null;
  const pad = 1.6;
  const x = (bb.min.x - pad) * GRID;
  const y = (bb.min.y - pad) * GRID;
  const w = (bb.max.x - bb.min.x + 2 * pad) * GRID;
  const h = (bb.max.y - bb.min.y + 2 * pad) * GRID;
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} className="preview" aria-hidden="true">
      {circuit.wires.map((wire) => (
        <line
          key={wire.id}
          className="wire-line"
          x1={wire.a.x * GRID}
          y1={wire.a.y * GRID}
          x2={wire.b.x * GRID}
          y2={wire.b.y * GRID}
        />
      ))}
      {circuit.components.map((c) => (
        <g
          key={c.id}
          className="comp"
          transform={`translate(${c.x * GRID} ${c.y * GRID}) rotate(${c.rot * 90})`}
        >
          <ComponentSymbol type={c.type} rot={c.rot} props={c.props} />
        </g>
      ))}
    </svg>
  );
}

interface GalleryProps {
  open: boolean;
  onClose: () => void;
  onPick: (example: Example) => void;
}

/** Galería de circuitos de ejemplo, en un diálogo modal nativo (foco atrapado, Esc cierra). */
export function Gallery({ open, onClose, onPick }: GalleryProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const circuits = useMemo(() => EXAMPLES.map((e) => e.build()), []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="gallery"
      aria-labelledby="gallery-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // clic en el fondo
      }}
    >
      <header>
        <div>
          <h2 id="gallery-title">Ejemplos</h2>
          <p className="muted">
            Circuitos listos para explorar. Se abren en el editor: podés cambiar valores, moverlos o
            romperlos sin miedo.
          </p>
        </div>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </header>
      <div className="gallery-grid">
        {EXAMPLES.map((ex, i) => (
          <button key={ex.id} type="button" className="card" onClick={() => onPick(ex)}>
            <CircuitPreview circuit={circuits[i]} />
            <span className="card-tags">
              {ex.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
            <strong>{ex.title}</strong>
            <span className="card-desc">{ex.description}</span>
          </button>
        ))}
      </div>
    </dialog>
  );
}
