import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './editor/Canvas';
import { loadLocal, saveLocal } from './editor/persistence';
import { EditorStore } from './editor/store';
import { circuitFromHash, shareUrl } from './editor/share';
import { exampleById, type Example } from './examples';
import { useEditor } from './editor/useEditor';
import { FieldsTab } from './fields/FieldsTab';
import { setProp } from './editor/ops';
import { ACPanel } from './ui/ACPanel';
import { AnalysisPanel, type Mode } from './ui/AnalysisPanel';
import { DCPanel } from './ui/DCPanel';
import { Gallery } from './ui/Gallery';
import { Inspector } from './ui/Inspector';
import { Palette } from './ui/Palette';
import { setTheme, useTheme } from './ui/theme';
import { TopBar } from './ui/TopBar';
import { TransientPanel } from './ui/TransientPanel';
import { DEFAULT_TRANSIENT, suggestMode, useAnalysis } from './ui/useAnalysis';

/** Mensaje pendiente de mostrar al arrancar (por ejemplo, un link roto). */
let startupMessage: string | null = null;

/**
 * Circuito inicial, por orden de prioridad: el que viene en el link (#c=...),
 * un ejemplo pedido por URL (#ejemplo=id), el último autoguardado y, la primera
 * vez, el divisor de tensión para no arrancar con la pantalla vacía.
 */
function initialCircuit() {
  const hash = window.location.hash;
  try {
    const shared = circuitFromHash(hash);
    if (shared) {
      startupMessage = 'Se abrió el circuito compartido por link.';
      return shared;
    }
  } catch (err) {
    startupMessage = err instanceof Error ? err.message : 'El link no es válido.';
  }
  const m = /^#ejemplo=([\w-]+)/.exec(hash);
  const example = m ? exampleById(m[1]) : undefined;
  return example?.build() ?? loadLocal() ?? exampleById('divisor')!.build();
}

const store = new EditorStore(initialCircuit());

const MODES: Mode[] = ['dc', 'tran', 'ac'];

export function App() {
  const { circuit, selection } = useEditor(store);
  const [section, setSection] = useState<'circuitos' | 'campos'>(() =>
    window.location.hash.startsWith('#campos') ? 'campos' : 'circuitos',
  );
  const [fitKey, setFitKey] = useState(0);
  const [message, setMessage] = useState<string | null>(startupMessage);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const theme = useTheme();
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

  // El aviso de arranque también desaparece solo.
  useEffect(() => {
    if (!startupMessage) return;
    startupMessage = null;
    const id = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(id);
  }, []);

  /** Después de abrir un circuito: encuadrar y elegir el análisis más útil. */
  const onLoaded = useCallback(() => {
    setFitKey((k) => k + 1);
    setMode(suggestMode(store.getState().circuit, MODES));
    setTranSettings(DEFAULT_TRANSIENT);
    setCursorFrac(0.1);
  }, []);

  const pickExample = useCallback(
    (ex: Example) => {
      store.load(ex.build());
      setGalleryOpen(false);
      onLoaded();
      setMode(ex.mode);
      setSection('circuitos');
      notify('Ejemplo cargado: ' + ex.title + '. Podés volver atrás con Deshacer.');
    },
    [onLoaded, notify],
  );

  /** Copia al portapapeles un link que contiene el circuito completo. */
  const share = useCallback(async () => {
    const url = shareUrl(store.getState().circuit, window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      notify('Link copiado al portapapeles. Cualquiera que lo abra ve este mismo circuito.');
    } catch {
      // Sin permiso de portapapeles: se deja el link en la barra de direcciones.
      window.history.replaceState(null, '', url);
      notify('El link quedó en la barra de direcciones: copialo desde ahí.');
    }
  }, [notify]);

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
      <TopBar
        store={store}
        onLoaded={onLoaded}
        onMessage={notify}
        showFileActions={section === 'circuitos'}
        right={
          <div className="topbar-actions">
            <button type="button" className="btn" onClick={() => setGalleryOpen(true)}>
              Ejemplos
            </button>
            {section === 'circuitos' && (
              <button
                type="button"
                className="btn"
                onClick={() => void share()}
                title="Copiar un link con este circuito"
              >
                Compartir
              </button>
            )}
            <button
              type="button"
              className="btn icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        }
        left={
          <nav className="main-tabs" role="tablist" aria-label="Secciones">
            <button
              type="button"
              role="tab"
              aria-selected={section === 'circuitos'}
              className={section === 'circuitos' ? 'active' : ''}
              onClick={() => setSection('circuitos')}
            >
              Circuitos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'campos'}
              className={section === 'campos' ? 'active' : ''}
              onClick={() => setSection('campos')}
            >
              Campos
            </button>
          </nav>
        }
      />
      {section === 'campos' && <FieldsTab />}
      <main className="workspace with-panel" hidden={section !== 'circuitos'}>
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
      <Gallery open={galleryOpen} onClose={() => setGalleryOpen(false)} onPick={pickExample} />
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
