import { defOf, PALETTE } from '../components/registry';
import type { EditorStore } from '../editor/store';
import { ComponentSymbol } from '../editor/symbols';
import { useEditor } from '../editor/useEditor';

export function Palette({ store }: { store: EditorStore }) {
  const { tool } = useEditor(store);
  return (
    <section className="palette" aria-label="Herramientas y componentes">
      <h2 className="panel-title">Herramientas</h2>
      <div className="tool-row">
        <button
          type="button"
          className={`tool-btn ${tool.kind === 'select' ? 'active' : ''}`}
          aria-pressed={tool.kind === 'select'}
          onClick={() => store.setTool({ kind: 'select' })}
          title="Seleccionar y mover (V)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3l12 9-5.5 1.2L15.8 20l-2.6 1.2-3.2-6.7L6 18z" className="ico-fill" />
          </svg>
          Mover
        </button>
        <button
          type="button"
          className={`tool-btn ${tool.kind === 'wire' ? 'active' : ''}`}
          aria-pressed={tool.kind === 'wire'}
          onClick={() => store.setTool({ kind: 'wire' })}
          title="Dibujar cables (W)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 18h8V6h8" className="ico-line" />
            <circle cx="4" cy="18" r="2.2" className="ico-fill" />
            <circle cx="20" cy="6" r="2.2" className="ico-fill" />
          </svg>
          Cable
        </button>
      </div>

      <h2 className="panel-title">Componentes</h2>
      <div className="palette-grid">
        {PALETTE.map((type) => {
          const def = defOf(type);
          const active = tool.kind === 'place' && tool.type === type;
          return (
            <button
              key={type}
              type="button"
              className={`palette-item ${active ? 'active' : ''}`}
              aria-pressed={active}
              onClick={() => store.setTool({ kind: 'place', type, rot: 0 })}
              title={`Colocar: ${def.name}`}
            >
              <svg
                viewBox={type === 'ground' ? '-26 -8 52 34' : '-44 -18 88 36'}
                aria-hidden="true"
              >
                <g className="comp">
                  <ComponentSymbol type={type} />
                </g>
              </svg>
              <span>{def.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
