import type { BoardRow } from '../eventsModel';

interface CompetitionBoardProps {
  rows: readonly BoardRow[];
  note: string | null;
}

/** Veckotävlingens tabell: hårlinjegrid, jag i guldtint. Priserna (plats 1–3) kommer ur eventets mall. */
export function CompetitionBoard({ rows, note }: CompetitionBoardProps) {
  return (
    <>
      {rows.length === 0 ? (
        <p className="rq-events-note">Nobody has run yet this week. The first run puts you on the board.</p>
      ) : (
        <ol aria-label="Standings" className="rq-hairgrid rq-events-board">
          {rows.map((row) => (
            <li key={row.userId} className="rq-row rq-events-board__row" data-mine={row.mine} data-rank={row.rank}>
              <span className="rq-events-board__rank">{row.rank}</span>
              <span className="rq-events-board__name">{row.name}</span>
              <span className="rq-events-board__value">{row.value}</span>
              <span className="rq-events-board__prize">{row.prize ?? ''}</span>
            </li>
          ))}
        </ol>
      )}
      {note && <p className="rq-events-board__note">{note}</p>}
    </>
  );
}
