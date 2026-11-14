import { useRef, type ReactNode } from 'react';
import { emptyCircuit } from '../engine/circuit';
import { circuitFromJson, downloadJson } from '../editor/persistence';
import type { EditorStore } from '../editor/store';
import { useEditor } from '../editor/useEditor';

interface TopBarProps {
  store: EditorStore;
  onLoaded: () => void;
  onMessage: (text: string) => void;
  /** Controles extra a la izquierda (pestañas) y a la derecha (tema, compartir). */
  left?: ReactNode;
  right?: ReactNode;
  showFileActions?: boolean;
}

export function TopBar({
  store,
  onLoaded,
  onMessage,
  left,
  right,
  showFileActions = true,
}: TopBarProps) {
  const { circuit, canUndo, canRedo } = useEditor(store);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = async (file: File) => {
    try {
      store.load(circuitFromJson(await file.text()));
      onLoaded();
      onMessage(`Se abrió "${file.name}".`);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'No se pudo abrir el archivo.');
    }
  };

  return (
    <header className="topbar">
      <div className="brand" aria-label="Nodal">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" className="brand-bg" />
          <path d="M3 16h6l2-6 4 12 4-12 2 6h8" className="brand-line" />
        </svg>
        <div>
          <span className="brand-name">Nodal</span>
          <span className="brand-sub">circuitos y campos</span>
        </div>
      </div>

      {left}

      <div className="topbar-spacer" />

      {showFileActions && (
        <div className="topbar-actions" role="toolbar" aria-label="Archivo y edición">
          <button
            type="button"
            className="btn ghost"
            onClick={() => store.undo()}
            disabled={!canUndo}
            title="Deshacer (Ctrl+Z)"
          >
            Deshacer
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => store.redo()}
            disabled={!canRedo}
            title="Rehacer (Ctrl+Y)"
          >
            Rehacer
          </button>
          <span className="sep" aria-hidden="true" />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              store.load(emptyCircuit());
              onLoaded();
            }}
            title="Empezar un circuito vacío"
          >
            Nuevo
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => fileRef.current?.click()}
            title="Abrir un circuito guardado (.json)"
          >
            Abrir
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => downloadJson(circuit)}
            title="Descargar el circuito como JSON"
          >
            Guardar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openFile(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {right}
    </header>
  );
}
