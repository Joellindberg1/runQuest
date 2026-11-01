import { useId, useState } from 'react';
import { cssVars } from '@/features/leaderboard/cssVars';
import { placementText } from '@/features/leaderboard/positionTexts';
import type { PositionGraphModel, PositionPoint, PositionProfileModel } from '../positionModel';
import '../positionChart.css';

// Profilens positionsgraf (Position-fliken, ADR 007 addendum 2026-10-26): en handritad SVG utan diagramlib. Allt som ska sägas och räknas
// kommer ur vymodellen (positionModel); här ritas bara. Linjen är en SVG som sträcks över ytan (viewBox 0–100, non-scaling-stroke) och
// dottarna är HTML ovanpå, så att de behåller sin storlek (24 px) i alla bredder. Raden ritas en gång och inget rör sig.
// Skärmläsaren får EN mening (role="img") och tabellen bakom "Show as table"; själva ytan och dottarnas siffror är aria-hidden.
//
// Komponenten laddas lazy av fliken (React.lazy, dynamisk import) och ligger därför aldrig i landningens eller profilens huvudbunt.

/** viewBox-sidan: x och y ritas i 0–100 och sträcks till fältet. */
const SVG_SIZE = 100;
const FRACTION_DIGITS = 4;

/** Andel 0–1 av fältets bredd/höjd; en axel med en enda punkt hamnar i början. */
function fraction(index: number, count: number): number {
  return count <= 1 ? 0 : Number((index / (count - 1)).toFixed(FRACTION_DIGITS));
}

const svgPoint = (point: PositionPoint, columns: number, rows: number, first: number) => ({
  x: fraction(point.column, columns) * SVG_SIZE,
  y: fraction(point.position - first, rows) * SVG_SIZE,
});

/** "Best #1 · 6 of 7 weeks" → ordet först (bleknat), resten efter (accenten), som i referensen. Texten är modellens, oförändrad. */
function Stat({ text, tone }: { text: string; tone: 'gold' | 'ink' }) {
  const at = text.indexOf(' ');
  return (
    <span className="rq-profile-position__stat" data-tone={tone}>
      <span className="rq-profile-position__stat-label">{text.slice(0, at)}</span>{' '}
      <span className="rq-profile-position__stat-value">{text.slice(at + 1)}</span>
    </span>
  );
}

function PositionTable({ model, id, open }: { model: PositionGraphModel; id: string; open: boolean }) {
  return (
    <div id={id} className="rq-profile-position__table-slot" hidden={!open}>
      <table className="rq-profile-position__table">
        <caption className="sr-only">{model.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Position</th>
          </tr>
        </thead>
        <tbody>
          {model.table.map((row) => (
            <tr key={row.week} data-current={row.current}>
              <th scope="row">
                <span aria-hidden="true">{row.week}</span>
                <span className="sr-only">{row.spoken}</span>
              </th>
              <td>
                {row.position === null ? (
                  <>
                    <span aria-hidden="true">{row.text}</span>
                    <span className="sr-only">{row.spokenText}</span>
                  </>
                ) : (
                  row.text
                )}
                {row.note && <span className="rq-profile-position__note"> · {row.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.tableFootnote && <p className="rq-profile-position__footnote">{model.tableFootnote}</p>}
    </div>
  );
}

function ReadyChart({ model }: { model: PositionGraphModel }) {
  const [open, setOpen] = useState(false);
  const tableId = useId();
  const columns = model.columns.length;
  const { rows, first } = model.axis;
  const { solid, dashed } = model.line;
  const dashedFrom = svgPoint(dashed.from, columns, rows, first);
  const dashedTo = svgPoint(dashed.to, columns, rows, first);
  const { best, lowest, now } = model.stats;

  return (
    <div className="rq-profile-position">
      <div className="rq-profile-position__head">
        <span className="rq-profile-position__now">{placementText(now.position)}</span>
        {/* Dold för skärmläsare: tankstrecket läses olika, och bildens aria-label bär redan perioden ("weeks 27 to 34"). */}
        <span className="rq-profile-position__period" aria-hidden="true">In the group · {model.range}</span>
      </div>

      <div className="rq-profile-position__chart" role="img" aria-label={model.summary}>
        <div className="rq-profile-position__plot" aria-hidden="true">
          <div className="rq-profile-position__field">
            {Array.from({ length: model.gridRows }, (_, index) => (
              <span key={index} className="rq-profile-position__grid" style={cssVars({ '--y': String(fraction(index, model.gridRows)) })} />
            ))}
            <svg className="rq-profile-position__svg" viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} preserveAspectRatio="none" focusable="false" aria-hidden="true">
              {solid.length > 1 && (
                <polyline
                  className="rq-profile-position__line"
                  points={solid.map((point) => {
                    const { x, y } = svgPoint(point, columns, rows, first);
                    return `${x},${y}`;
                  }).join(' ')}
                />
              )}
              <line className="rq-profile-position__dashed" x1={dashedFrom.x} y1={dashedFrom.y} x2={dashedTo.x} y2={dashedTo.y} />
            </svg>
            {model.dots.map((dot) => (
              <span
                key={dot.column}
                className="rq-profile-position__dot"
                data-filled={String(dot.filled)}
                data-hollow={String(dot.hollow)}
                data-ring={String(dot.ring)}
                style={cssVars({ '--x': String(fraction(dot.column, columns)), '--y': String(fraction(dot.row, rows)) })}
                aria-hidden="true"
              >
                {dot.position}
              </span>
            ))}
          </div>
        </div>
        <div className="rq-profile-position__weeks" aria-hidden="true">
          <div className="rq-profile-position__field">
            {model.columns.map((column, index) => (
              <span key={column.visual + index} className="rq-profile-position__week" data-current={String(column.current)} style={cssVars({ '--x': String(fraction(index, columns)) })}>
                {column.visual}
              </span>
            ))}
          </div>
        </div>
      </div>

      <p className="rq-profile-position__legend" aria-hidden="true">
        <span className="rq-profile-position__swatch" />
        <span>{model.legend}</span>
      </p>

      <div className="rq-profile-position__stats">
        <Stat text={best.text} tone="gold" />
        <Stat text={lowest.text} tone="ink" />
        <Stat text={now.text} tone="ink" />
      </div>

      <button
        type="button"
        className="rq-btn rq-btn--ghost rq-btn--compact rq-profile-position__toggle"
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((value) => !value)}
      >
        Show as table
      </button>
      <PositionTable model={model} id={tableId} open={open} />
    </div>
  );
}

/**
 * Profilens positionsgraf ur vymodellen. `hidden` ritar ingenting (fliken döljs av värden), `new-runner` och `no-finished-week` ger modellens text
 * i stället för graf, `ready` ritar grafen.
 */
export function PositionChart({ model }: { model: PositionProfileModel }) {
  if (model.mode === 'hidden') return null;
  if (model.mode !== 'ready') return <p className="rq-profile-note" data-mode={model.mode}>{model.message}</p>;
  return <ReadyChart model={model} />;
}
