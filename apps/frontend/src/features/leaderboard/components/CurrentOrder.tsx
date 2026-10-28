import { useId } from 'react';
import type { OrderEntry } from '../positionChartModel';
import { placementText, spokenPlacementText } from '../positionTexts';
import '../positionBoard.css';
import { PositionAvatar } from './PositionAvatar';

// "Current order" och legenden i EN komponent (en lista i DOM:en): webben har den bredvid grafen, mobilen under den, och bara CSS avgör var. En ordnad
// lista med en knapp per löpare i Standings ordning (modellens `order`); knappen väljer löparen i grafen (aria-pressed) och ett nytt klick avmarkerar.
// Komponenten är kontrollerad: valtillståndet bor i föräldern (PositionView), som också ger grafen samma val. Läget syns utan färg: aria-pressed, texten
// "Shown" och ramen. Den inloggades rad har en "You"-tagg i text.
//
// Komponenten laddas lazy av fliken (React.lazy, dynamisk import) och ligger därför aldrig i landningens eller ingångens bunt. Stilfilen följer med.

interface CurrentOrderProps {
  entries: OrderEntry[];
  /** Klick eller Enter/Space på en rad. Föräldern avgör om det väljer eller avmarkerar. */
  onSelect: (id: string) => void;
}

export function CurrentOrder({ entries, onSelect }: CurrentOrderProps) {
  const titleId = useId();
  if (entries.length === 0) return null;

  return (
    <section className="rq-board-position-order" aria-labelledby={titleId}>
      <h3 id={titleId} className="rq-board-position-order__title">
        Current order
      </h3>
      <p className="rq-board-position-order__hint">Pick a runner to lift their line.</p>
      <ol className="rq-board-position-order__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="rq-board-position-order__row"
              aria-pressed={entry.selected}
              data-me={String(entry.isMe)}
              data-selected={String(entry.selected)}
              onClick={() => onSelect(entry.id)}
            >
              <span className="rq-board-position-order__place">
                {entry.position === null ? (
                  <>
                    <span aria-hidden="true">{placementText(null)}</span>
                    <span className="sr-only">{spokenPlacementText(null)}</span>
                  </>
                ) : (
                  placementText(entry.position)
                )}
              </span>
              <PositionAvatar initials={entry.initials} pictureUrl={entry.pictureUrl} />
              <span className="rq-board-position-order__who">
                <span className="rq-board-position-order__name">{entry.name}</span>
                {entry.firstPlacedWeek && <span className="rq-board-position-order__joined">Joined {entry.firstPlacedWeek}</span>}
              </span>
              {entry.isMe && <span className="rq-board-position-order__tag">You</span>}
              {entry.selected && <span className="rq-board-position-order__shown">Shown</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
