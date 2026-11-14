import { useState } from 'react';
import { ElectroScene } from './ElectroScene';
import { InductionScene } from './InductionScene';
import { MagnetoScene } from './MagnetoScene';

type Scene = 'electro' | 'magneto' | 'induccion';

const SCENES: { id: Scene; label: string; hint: string }[] = [
  { id: 'electro', label: 'Electrostática', hint: 'Cargas, líneas de campo y equipotenciales' },
  { id: 'magneto', label: 'Magnetostática', hint: 'Biot-Savart: cable, espira y solenoide' },
  { id: 'induccion', label: 'Inducción', hint: 'Faraday-Lenz: imán y bobina' },
];

/** Pestaña "Campos": tres escenas independientes del editor de circuitos. */
export function FieldsTab() {
  const [scene, setScene] = useState<Scene>(() => {
    const m = /^#campos=(\w+)/.exec(window.location.hash);
    return SCENES.some((s) => s.id === m?.[1]) ? (m![1] as Scene) : 'electro';
  });
  return (
    <main className="fields">
      <nav className="scene-tabs" role="tablist" aria-label="Escenas de campos">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={scene === s.id}
            className={scene === s.id ? 'active' : ''}
            onClick={() => setScene(s.id)}
          >
            <strong>{s.label}</strong>
            <span>{s.hint}</span>
          </button>
        ))}
      </nav>
      {scene === 'electro' && <ElectroScene />}
      {scene === 'magneto' && <MagnetoScene />}
      {scene === 'induccion' && <InductionScene />}
    </main>
  );
}
