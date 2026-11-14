import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './editor/Canvas';
import { buildOverlay } from './editor/overlay';
import { loadLocal, saveLocal } from './editor/persistence';
import { EditorStore } from './editor/store';
import { useEditor } from './editor/useEditor';
import { solveDC } from './engine/dc';
import { AnalysisPanel, type Mode } from './ui/AnalysisPanel';
import { DCPanel } from './ui/DCPanel';
import { Inspector } from './ui/Inspector';
import { attempt } from './ui/outcome';
import { Palette } from './ui/Palette';
import { TopBar } from './ui/TopBar';

const store = new EditorStore(loadLocal() ?? undefined);

const MODES: Mode[] = ['dc'];

export function App() {
  const { circuit, selection } = useEditor(store);
  const [fitKey, setFitKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('dc');
  const [show, setShow] = useState({ voltages: true, currents: true });
  const timer = useRef<number | undefined>(undefined);

  // Autoguardado con un pequeño retardo para no escribir en cada movimiento del mouse.
  useEffect(() => {
    const id = window.setTimeout(() => saveLocal(circuit), 300);
    return () => window.clearTimeout(id);
  }, [circuit]);

  const notify = (text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 4000);
  };

  const dc = useMemo(() => attempt(() => solveDC(circuit)), [circuit]);

  const overlay = useMemo(() => {
    if (!dc.ok) return null;
    const sol = dc.value;
    return buildOverlay(
      circuit,
      sol.netlist,
      sol.nodeVoltages,
      new Map(sol.elements.map((e) => [e.id, e.current])),
      new Map(sol.elements.map((e) => [e.id, e.voltage])),
      { showVoltages: show.voltages, showCurrents: show.currents, animate: true },
    );
  }, [dc, circuit, show]);

  const error = dc.ok ? null : dc.error;
  const errorIds = useMemo(() => new Set(error?.componentIds ?? []), [error]);

  return (
    <div className="app">
      <TopBar store={store} onLoaded={() => setFitKey((k) => k + 1)} onMessage={notify} />
      <main className="workspace with-panel">
        <aside className="sidebar">
          <Palette store={store} />
          <Inspector store={store} />
        </aside>
        <Canvas
          store={store}
          fitKey={fitKey}
          overlay={overlay}
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
          {dc.ok && <DCPanel sol={dc.value} selection={selection} />}
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
