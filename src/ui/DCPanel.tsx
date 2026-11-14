import { useMemo } from 'react';
import { defOf } from '../components/registry';
import type { DCSolution } from '../engine/dc';
import { theveninAt } from '../engine/thevenin';
import { formatResult, formatValue } from '../engine/units';
import { explainDC } from '../explain/dc';
import { attempt } from './outcome';
import { Section, Steps } from './Steps';

interface DCPanelProps {
  sol: DCSolution;
  selection: string[];
}

export function DCPanel({ sol, selection }: DCPanelProps) {
  const explanation = useMemo(() => explainDC(sol), [sol]);
  const selectedId = selection.length === 1 ? selection[0] : null;
  const load = selectedId ? sol.byId.get(selectedId) : undefined;
  const thevenin = useMemo(() => {
    if (!load || load.type !== 'resistor') return null;
    return attempt(() => theveninAt(sol.netlist, load.id));
  }, [sol, load]);

  const delivered = sol.elements.filter((e) => e.power < 0).reduce((s, e) => s - e.power, 0);
  const hasTimedSwitch = sol.elements.some((e) => e.type === 'switch');

  return (
    <>
      <Section title="Resultados">
        <div className="table-wrap">
          <table className="results">
            <thead>
              <tr>
                <th scope="col">Comp.</th>
                <th scope="col">Tensión</th>
                <th scope="col">Corriente</th>
                <th scope="col">Potencia</th>
              </tr>
            </thead>
            <tbody>
              {sol.elements.map((e) => (
                <tr key={e.id} className={selection.includes(e.id) ? 'row-selected' : ''}>
                  <th scope="row" title={defOf(e.type).name}>
                    {e.id}
                  </th>
                  <td>{formatResult(Math.abs(e.voltage), 'V')}</td>
                  <td>{formatResult(Math.abs(e.current), 'A')}</td>
                  <td>
                    {formatResult(Math.abs(e.power), 'W')}
                    {Math.abs(e.power) > 1e-12 && (
                      <span className={`tag ${e.power < 0 ? 'tag-out' : 'tag-in'}`}>
                        {e.power < 0 ? 'entrega' : 'consume'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Potencia total entregada por las fuentes: <b>{formatResult(delivered, 'W')}</b>. En el
          dibujo, la flecha de cada componente indica el sentido real de la corriente.
        </p>
        {hasTimedSwitch && (
          <p className="muted small">
            En DC los interruptores se toman en su estado inicial. Para ver la conmutación usá la
            pestaña Transitorio.
          </p>
        )}
      </Section>

      <Section title="Thevenin / Norton" defaultOpen={!!thevenin}>
        {!thevenin && (
          <p className="muted small">
            Seleccioná una resistencia en el circuito: se la toma como carga y se calcula el
            equivalente del resto visto desde sus terminales.
          </p>
        )}
        {thevenin && !thevenin.ok && (
          <p className="muted small">
            No se puede calcular el equivalente visto desde {load!.id}: {thevenin.error.message}
          </p>
        )}
        {thevenin && thevenin.ok && (
          <>
            <p className="small">
              Equivalente visto desde <b>{load!.id}</b> (quitándola del circuito):
            </p>
            <dl className="kv">
              <dt>
                V<sub>th</sub>
              </dt>
              <dd>{formatResult(thevenin.value.vth, 'V')}</dd>
              <dt>
                R<sub>th</sub>
              </dt>
              <dd>{formatValue(thevenin.value.rth, 'Ω')}</dd>
              <dt>
                I<sub>N</sub>
              </dt>
              <dd>{formatResult(thevenin.value.inorton, 'A')}</dd>
            </dl>
            <pre className="formula">
              {`I(${load!.id}) = Vth / (Rth + ${load!.id}) = ${formatResult(Math.abs(load!.current), 'A')}`}
            </pre>
            <p className="muted small">
              V<sub>th</sub>: tensión a circuito abierto. R<sub>th</sub>: resistencia vista con las
              fuentes anuladas (V → cable, I → abierta). I<sub>N</sub> = V<sub>th</sub>/R
              <sub>th</sub>: corriente de cortocircuito.
            </p>
          </>
        )}
      </Section>

      <Section title="Paso a paso">
        <Steps explanation={explanation} />
      </Section>
    </>
  );
}
