import { useEffect, useRef, useState } from 'react';
import { Canvas } from './editor/Canvas';
import { loadLocal, saveLocal } from './editor/persistence';
import { EditorStore } from './editor/store';
import { useEditor } from './editor/useEditor';
import { Inspector } from './ui/Inspector';
import { Palette } from './ui/Palette';
import { TopBar } from './ui/TopBar';

const store = new EditorStore(loadLocal() ?? undefined);

export function App() {
  const { circuit } = useEditor(store);
  const [fitKey, setFitKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
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

  return (
    <div className="app">
      <TopBar store={store} onLoaded={() => setFitKey((k) => k + 1)} onMessage={notify} />
      <main className="workspace">
        <aside className="sidebar">
          <Palette store={store} />
          <Inspector store={store} />
        </aside>
        <Canvas store={store} fitKey={fitKey} />
      </main>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
