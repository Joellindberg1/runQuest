import { useId, useRef, useState } from 'react';
import { useScrollsSideways } from '../hooks/useScrollsSideways';
import type { PositionChartModel } from '../positionChartModel';
import '../positionBoard.css';
import { PackPositionChart } from './PackPositionChart';
import { PositionHistoryTable } from './PositionHistoryTable';

// Kortet runt positionsgrafen: rubrik, "Show as table", förklaringsraden (när grafen läses), grafen eller tabellen. Valtillståndet och "Current order"
// hör till PositionView. `hidden` ritar ingenting (fliken döljs av värden), `no-finished-week` ger modellens text i stället för graf.
// Både grafen och tabellen finns i DOM:en; den som inte visas är `hidden`, så knappens aria-controls alltid pekar på något.
//
// Komponenten laddas lazy av fliken (React.lazy, dynamisk import) och ligger därför aldrig i landningens eller ingångens bunt. Stilfilen följer med.

export function PositionChartCard({ model }: { model: PositionChartModel }) {
  const [tableOpen, setTableOpen] = useState(false);
  const tableId = useId();
  const headingId = useId();
  const captionId = useId();
  const slotRef = useRef<HTMLDivElement>(null);
  const drawn = model.mode === 'chart';
  const tableScrolls = useScrollsSideways(slotRef, drawn);
  if (model.mode === 'hidden') return null;

  return (
    <section className="rq-board-position__card" aria-labelledby={headingId}>
      <header className="rq-board-position__head">
        <h2 id={headingId} className="rq-title rq-board-position__title">
          Position over time
        </h2>
        {drawn && (
          <button type="button" className="rq-btn rq-btn--link rq-board-position__toggle" aria-controls={tableId} aria-expanded={tableOpen} onClick={() => setTableOpen((open) => !open)}>
            Show as table
          </button>
        )}
      </header>

      {drawn ? (
        <>
          {/* Perioden står redan i bildens text ("weeks 27 to 34"); tankstrecket läses olika av olika skärmläsare, så den synliga formen är dold. */}
          <p className="rq-board-position__eyebrow">
            {/* "Season rank" står bara på desktop (skissens webb); på mobil ryms inte raden annars på en rad. Varje skiljetecken hör till texten efter sig (en del bryts aldrig inuti),
                så en smal rad bryts före "·" och slutar aldrig på ett ensamt. */}
            <span className="rq-board-position__season">Season rank</span>
            <span className="rq-board-position__part">
              <span className="rq-board-position__sep rq-board-position__season" aria-hidden="true">·</span>
              <span aria-hidden="true">{model.range}</span>
            </span>
            <span className="rq-board-position__part">
              <span className="rq-board-position__sep" aria-hidden="true">·</span>
              <span>Read every Sunday midnight</span>
            </span>
          </p>
          <div hidden={tableOpen}>
            <PackPositionChart model={model} />
          </div>
          {/* Tabbstopp bara när tabellen faktiskt scrollar (en lång period på en smal skärm): en yta som ryms är inget att tabba till. */}
          <div id={tableId} ref={slotRef} className="rq-board-position__table-slot" role="region" aria-labelledby={captionId} tabIndex={tableScrolls ? 0 : undefined} hidden={!tableOpen}>
            {model.table && <PositionHistoryTable table={model.table} captionId={captionId} />}
          </div>
        </>
      ) : (
        <p className="rq-board-position__message">{model.message}</p>
      )}
    </section>
  );
}
