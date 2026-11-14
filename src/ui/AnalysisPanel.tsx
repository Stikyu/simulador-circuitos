import type { ReactNode } from 'react';
import type { CircuitError } from '../engine/errors';

export type Mode = 'dc' | 'tran' | 'ac';

export const MODE_LABELS: Record<Mode, string> = {
  dc: 'Continua',
  tran: 'Transitorio',
  ac: 'Alterna',
};

interface AnalysisPanelProps {
  mode: Mode;
  modes: Mode[];
  onMode: (m: Mode) => void;
  show: { voltages: boolean; currents: boolean };
  onShow: (s: { voltages: boolean; currents: boolean }) => void;
  error: CircuitError | null;
  children: ReactNode;
}

/** Columna derecha: elige el tipo de análisis y muestra sus resultados. */
export function AnalysisPanel({
  mode,
  modes,
  onMode,
  show,
  onShow,
  error,
  children,
}: AnalysisPanelProps) {
  return (
    <aside className="panel" aria-label="Análisis del circuito">
      <div className="panel-head">
        <div className="segmented" role="tablist" aria-label="Tipo de análisis">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => onMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="toggles">
          <label>
            <input
              type="checkbox"
              checked={show.voltages}
              onChange={(e) => onShow({ ...show, voltages: e.target.checked })}
            />
            Tensiones de nodo
          </label>
          <label>
            <input
              type="checkbox"
              checked={show.currents}
              onChange={(e) => onShow({ ...show, currents: e.target.checked })}
            />
            Corrientes
          </label>
        </div>
      </div>
      <div className="panel-body">
        {error && error.code === 'vacio' && (
          <div className="empty">
            <h3>Armá tu primer circuito</h3>
            <ol>
              <li>Elegí componentes en la paleta y hacé clic en la grilla para colocarlos.</li>
              <li>Uní los terminales arrastrando desde un punto de conexión.</li>
              <li>
                Agregá una <b>tierra</b>: es la referencia de 0 V.
              </li>
            </ol>
            <p className="muted small">
              Los resultados aparecen acá a medida que dibujás. También podés abrir un ejemplo.
            </p>
          </div>
        )}
        {error && error.code !== 'vacio' && (
          <div className="error-card" role="alert">
            <h3>{error.message}</h3>
            {error.hint && <p>{error.hint}</p>}
          </div>
        )}
        {!error && children}
      </div>
    </aside>
  );
}
