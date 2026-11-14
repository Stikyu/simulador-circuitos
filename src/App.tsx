import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './editor/Canvas';
import { loadLocal, saveLocal } from './editor/persistence';
import { EditorStore } from './editor/store';
import { exampleById } from './examples';
import { useEditor } from './editor/useEditor';
import { setProp } from './editor/ops';
import { ACPanel } from './ui/ACPanel';
import { AnalysisPanel, type Mode } from './ui/AnalysisPanel';
import { DCPanel } from './ui/DCPanel';
import { Inspector } from './ui/Inspector';
import { Palette } from './ui/Palette';
import { TopBar } from './ui/TopBar';
import { TransientPanel } from './ui/TransientPanel';
import { DEFAULT_TRANSIENT, suggestMode, useAnalysis } from './ui/useAnalysis';

/** Circuito inicial: un ejemplo pedido por URL (#ejemplo=id) o el último autoguardado. */
function initialCircuit() {
  const m = /^#ejemplo=([\w-]+)/.exec(window.location.hash);
  const example = m ? exampleById(m[1]) : undefined;
  return example ? example.build() : (loadLocal() ?? undefined);
}

const store = new EditorStore(initialCircuit());

const MODES: Mode[] = ['dc', 'tran', 'ac'];

export function App() {
  const { circuit, selection } = useEditor(store);
  const [fitKey, setFitKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => suggestMode(store.getState().circuit, MODES));
  const [show, setShow] = useState({ voltages: true, currents: true });
  const [tranSettings, setTranSettings] = useState(DEFAULT_TRANSIENT);
  const [cursorFrac, setCursorFrac] = useState(0.1);
  const timer = useRef<number | undefined>(undefined);

  // Autoguardado con un pequeño retardo para no escribir en cada movimiento del mouse.
  useEffect(() => {
    const id = window.setTimeout(() => saveLocal(circuit), 300);
    return () => window.clearTimeout(id);
  }, [circuit]);

  const notify = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4000);
  }, []);

  /** Después de abrir un circuito: encuadrar y elegir el análisis más útil. */
  const onLoaded = useCallback(() => {
    setFitKey((k) => k + 1);
    setMode(suggestMode(store.getState().circuit, MODES));
    setTranSettings(DEFAULT_TRANSIENT);
    setCursorFrac(0.1);
  }, []);

  /** Cambia la frecuencia de todas las fuentes senoidales (un solo paso de undo). */
  const setFrequency = useCallback((f: number) => {
    let next = store.getState().circuit;
    for (const c of next.components) if (c.type === 'vac') next = setProp(next, c.id, 'f', f);
    store.commit(next);
  }, []);

  const analysis = useAnalysis(circuit, mode, show, tranSettings, cursorFrac);
  const { error } = analysis;
  const errorIds = useMemo(() => new Set(error?.componentIds ?? []), [error]);

  return (
    <div className="app">
      <TopBar store={store} onLoaded={onLoaded} onMessage={notify} />
      <main className="workspace with-panel">
        <aside className="sidebar">
          <Palette store={store} />
          <Inspector store={store} />
        </aside>
        <Canvas
          store={store}
          fitKey={fitKey}
          overlay={analysis.overlay}
          errorIds={errorIds}
          banner={
            error && error.code !== 'vacio' ? (
              <div className="canvas-error" role="status">
                <strong>{error.message}</strong>
              </div>
            ) : null
          }
        />
        <AnalysisPanel
          mode={mode}
          modes={MODES}
          onMode={setMode}
          show={show}
          onShow={setShow}
          error={error}
        >
          {mode === 'dc' && analysis.dc?.ok && (
            <DCPanel sol={analysis.dc.value} selection={selection} />
          )}
          {mode === 'tran' && analysis.tran?.ok && analysis.tranModel && (
            <TransientPanel
              result={analysis.tran.value}
              model={analysis.tranModel}
              settings={tranSettings}
              onSettings={setTranSettings}
              times={analysis.tranTimes}
              selection={selection}
              cursorFrac={cursorFrac}
              onCursor={setCursorFrac}
            />
          )}
          {mode === 'ac' && analysis.ac?.ok && (
            <ACPanel sol={analysis.ac.value} selection={selection} onFrequency={setFrequency} />
          )}
        </AnalysisPanel>
      </main>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
