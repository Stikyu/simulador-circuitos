import { defOf } from '../components/registry';
import { deleteItems, rotateItems, setProp } from '../editor/ops';
import type { EditorStore } from '../editor/store';
import { useEditor } from '../editor/useEditor';
import { ValueInput } from './ValueInput';

/** Panel de propiedades de lo que está seleccionado. */
export function Inspector({ store }: { store: EditorStore }) {
  const { circuit, selection } = useEditor(store);
  const comps = circuit.components.filter((c) => selection.includes(c.id));
  const single = selection.length === 1 && comps.length === 1 ? comps[0] : null;

  return (
    <section className="inspector" aria-label="Propiedades">
      <h2 className="panel-title">Propiedades</h2>
      {selection.length === 0 && (
        <p className="muted small">
          Seleccioná un componente para editar su valor. Aceptá prefijos: <code>4,7k</code>,{' '}
          <code>100n</code>, <code>2.2M</code>.
        </p>
      )}

      {single && (
        <>
          <div className="inspector-head">
            <strong className="mono">{single.id}</strong>
            <span className="muted">{defOf(single.type).name}</span>
          </div>
          {defOf(single.type).props.map((p) => {
            const fieldId = `prop-${single.id}-${p.key}`;
            const value = single.props[p.key] ?? p.default;
            return (
              <div className="field" key={p.key}>
                <label htmlFor={fieldId}>{p.label}</label>
                {p.kind === 'number' ? (
                  <ValueInput
                    id={fieldId}
                    value={typeof value === 'number' ? value : 0}
                    unit={p.unit}
                    positive={p.positive}
                    onChange={(v) => store.commit(setProp(circuit, single.id, p.key, v))}
                  />
                ) : (
                  <input
                    id={fieldId}
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) =>
                      store.commit(setProp(circuit, single.id, p.key, e.target.checked))
                    }
                  />
                )}
                {p.help && <p className="field-help">{p.help}</p>}
              </div>
            );
          })}
        </>
      )}

      {selection.length > 1 && (
        <p className="muted small">{selection.length} elementos seleccionados.</p>
      )}

      {selection.length > 0 && (
        <div className="btn-row">
          {comps.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => store.commit(rotateItems(circuit, selection))}
              title="Rotar 90° (R)"
            >
              Rotar
            </button>
          )}
          <button
            type="button"
            className="btn danger"
            onClick={() => store.commit(deleteItems(circuit, selection), [])}
            title="Borrar (Supr)"
          >
            Borrar
          </button>
        </div>
      )}
    </section>
  );
}
