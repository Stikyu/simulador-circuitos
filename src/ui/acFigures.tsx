import { useEffect, useRef, useState } from 'react';
import { abs, arg, type Complex } from '../engine/complex';
import { formatValue } from '../engine/units';

export interface Phasor {
  label: string;
  z: Complex;
  kind: 'v' | 'i';
  color: number;
}

const R = 104;
const TURN_SECONDS = 6;

/** Diagrama fasorial giratorio. La proyección vertical es el valor instantáneo. */
export function PhasorDiagram({ phasors }: { phasors: Phasor[] }) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [spinning, setSpinning] = useState(!reduced);
  const [angle, setAngle] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setAngle((a) => (a + (2 * Math.PI * dt) / TURN_SECONDS) % (2 * Math.PI));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const vMax = Math.max(1e-30, ...phasors.filter((p) => p.kind === 'v').map((p) => abs(p.z)));
  const iMax = Math.max(1e-30, ...phasors.filter((p) => p.kind === 'i').map((p) => abs(p.z)));

  return (
    <div className="phasor">
      <svg viewBox="-150 -132 300 264" role="img" aria-label="Diagrama fasorial">
        <circle r={R} className="ph-grid" />
        <circle r={R / 2} className="ph-grid" />
        <path d={`M${-R - 14} 0H${R + 14}M0 ${-R - 14}V${R + 14}`} className="ph-axis" />
        <text x={R + 16} y="-5" className="ph-axis-label">
          Re
        </text>
        <text x="6" y={-R - 16} className="ph-axis-label">
          Im
        </text>
        {phasors.map((p) => {
          const mag = abs(p.z);
          const r = (R * mag) / (p.kind === 'v' ? vMax : iMax);
          if (!(r > 0.5)) return null;
          const th = arg(p.z) + angle;
          const x = r * Math.cos(th);
          const y = -r * Math.sin(th);
          const deg = (-th * 180) / Math.PI;
          const lx = (r + 13) * Math.cos(th);
          const ly = -(r + 13) * Math.sin(th);
          const style = { ['--c' as string]: `var(--s${(p.color % 6) + 1})` };
          return (
            <g key={p.label} style={style} className={`ph ${p.kind}`}>
              <line x1="0" y1="0" x2={x} y2={y} />
              <path d="M0 0L-9-4.2V4.2z" transform={`translate(${x} ${y}) rotate(${deg})`} />
              <text x={lx} y={ly + 3.5} textAnchor="middle">
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="phasor-side">
        <button type="button" className="btn" onClick={() => setSpinning(!spinning)}>
          {spinning ? 'Pausar giro' : 'Girar'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setSpinning(false);
            setAngle(0);
          }}
        >
          t = 0
        </button>
        <p className="muted small">
          Línea llena: tensiones (escala {formatValue(vMax, 'V')}). Punteada: corrientes (escala{' '}
          {formatValue(iMax, 'A')}). Todos giran juntos a ω: lo que importa es el ángulo entre
          ellos.
        </p>
      </div>
    </div>
  );
}

/** Triángulo de potencias: P horizontal, Q vertical, S la hipotenusa. */
export function PowerTriangle({ p, q }: { p: number; q: number }) {
  const W = 200;
  const H = 84;
  const scale = Math.min(W / Math.max(Math.abs(p), 1e-30), H / Math.max(Math.abs(q), 1e-30));
  const px = Math.max(Math.abs(p) * scale, 2);
  const qy = Math.abs(q) * scale;
  const up = q >= 0;
  const flat = qy < 6;
  const y0 = up ? H + 22 : 22;
  const yq = up ? y0 - qy : y0 + qy;
  const s = Math.hypot(p, q);
  const phi = (Math.atan2(q, p) * 180) / Math.PI;
  return (
    <svg
      viewBox={flat ? `0 ${y0 - 26} ${W + 96} 48` : `0 0 ${W + 96} ${H + 46}`}
      className="triangle"
      role="img"
      aria-label={`Triángulo de potencias: P ${formatValue(p, 'W')}, Q ${formatValue(q, 'var')}, S ${formatValue(s, 'VA')}`}
    >
      <path d={`M20 ${y0}H${20 + px}V${yq}z`} className="tri-fill" />
      <line x1="20" y1={y0} x2={20 + px} y2={y0} className="tri-p" />
      <line x1={20 + px} y1={y0} x2={20 + px} y2={yq} className="tri-q" />
      <line x1="20" y1={y0} x2={20 + px} y2={yq} className="tri-s" />
      <text x={20 + px / 2} y={up ? y0 + 14 : y0 - 6} textAnchor="middle" className="tri-label">
        P = {formatValue(p, 'W')}
      </text>
      {!flat && (
        <text x={26 + px} y={(y0 + yq) / 2 + 4} className="tri-label">
          Q = {formatValue(q, 'var')}
        </text>
      )}
      <text
        x={flat ? 20 + px / 2 : 20 + px / 2 - 8}
        y={flat ? y0 - 8 : (y0 + yq) / 2 + (up ? -8 : 16)}
        textAnchor={flat ? 'middle' : 'end'}
        className="tri-label strong"
      >
        S = {formatValue(s, 'VA')}
      </text>
      {!flat && (
        <text x="46" y={up ? y0 - 4 : y0 + 12} className="tri-label muted-fill">
          φ = {phi.toFixed(1).replace('.', ',').replace('-', '−')}°
        </text>
      )}
    </svg>
  );
}
