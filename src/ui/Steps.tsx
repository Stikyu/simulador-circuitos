import type { Explanation } from '../explain/types';

/** Lista numerada de pasos de una explicación. */
export function Steps({ explanation }: { explanation: Explanation }) {
  return (
    <div className="steps">
      <p className="steps-method">
        <span className="chip">{explanation.method}</span>
      </p>
      <p className="steps-summary">{explanation.summary}</p>
      <ol>
        {explanation.steps.map((step, i) => (
          <li key={i}>
            <h4>{step.title}</h4>
            {step.lines.map((line, j) =>
              line.startsWith('$ ') ? (
                <pre key={j} className="formula">
                  {line.slice(2)}
                </pre>
              ) : (
                <p key={j}>{line}</p>
              ),
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Sección plegable del panel de análisis. */
export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
