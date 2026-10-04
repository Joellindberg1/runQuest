import { titleLine, type SeasonRow } from '../seasonModel';
import { ChallengeRibbons, DeltaMark, RunnerName } from './BoardParts';
import { cssVars } from '../cssVars';

const RANK_STAGGER_SECONDS = 0.1;
/** Från och med den här placeringen är vänsterkanten på sitt svagaste (hårlinjeskalan tar slut). */
const LAST_EDGE_STEP = 6;

interface RestProps {
  rows: SeasonRow[];
  onOpen: (userId: string) => void;
}

const rowVars = (row: SeasonRow) =>
  cssVars({ '--w': `${row.progress.pct}%`, '--rq-delay': `${row.rank * RANK_STAGGER_SECONDS}s` });

const edgeStep = (row: SeasonRow) => Math.min(row.rank, LAST_EDGE_STEP);

function etaText(row: SeasonRow, short: boolean): string {
  if (row.nextLevelDays !== null) return short ? `${row.nextLevelDays} d` : `${row.nextLevelDays} d to lvl`;
  return row.progress.atMax ? 'max level' : '—';
}

/** Mobil: placering 4+ som hårlinjelista (mRest-mönstret): rank · namn + nivåstapel · tempo + ETA. */
export function RestList({ rows, onOpen }: RestProps) {
  if (rows.length === 0) return null;
  return (
    <div className="rq-hairgrid rq-hairgrid--framed" role="table" aria-label="Rest of the pack">
      <div role="row" className="rq-table-head rq-board-row">
        <span role="columnheader">#</span>
        <span role="columnheader">Runner</span>
        <span role="columnheader" className="rq-board-cell-right">XP / day</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          role="row"
          className="rq-row rq-board-row rq-board-row--rest"
          data-pos={edgeStep(row)}
          data-clickable="true"
          onClick={() => onOpen(row.id)}
        >
          <span role="cell" className="rq-board-ranknum">{row.rank}</span>
          <div role="cell">
            <div className="rq-board-nameline">
              <RunnerName name={row.name} onOpen={() => onOpen(row.id)} />
              <DeltaMark delta={row.delta} />
            </div>
            <div className="rq-track rq-board-track--thin">
              <div className="rq-fill rq-fill--rest" style={rowVars(row)} />
            </div>
            <div className="rq-board-sub">
              <span>Lvl {row.level} · {row.kmTotal} km</span>
              <ChallengeRibbons tokens={row.tokens} />
            </div>
          </div>
          <div role="cell" className="rq-board-cell-right">
            <div className="rq-board-num" data-tone={row.pace.tone}>{row.pace.text}</div>
            <div className="rq-board-cell-sub">{etaText(row, false)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Desktop: Web-prototypens tabell — silvertint-rubrikrad, hårlinjegrid, sju kolumner. */
export function RestTable({ rows, onOpen }: RestProps) {
  if (rows.length === 0) return null;
  return (
    <div className="rq-hairgrid rq-hairgrid--framed" role="table" aria-label="Rest of the pack">
      <div role="row" className="rq-table-head rq-board-row">
        <span role="columnheader" className="rq-board-cell-center">#</span>
        <span role="columnheader">Runner</span>
        <span role="columnheader">Level progress</span>
        <span role="columnheader" className="rq-board-cell-right">Avg / run</span>
        <span role="columnheader" className="rq-board-cell-right">XP / day</span>
        <span role="columnheader" className="rq-board-cell-right">Next level</span>
        <span role="columnheader" className="rq-board-cell-right">Last run</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          role="row"
          className="rq-row rq-board-row rq-board-row--rest"
          data-pos={edgeStep(row)}
          data-clickable="true"
          onClick={() => onOpen(row.id)}
        >
          <span role="cell" className="rq-board-ranknum">{row.rank}</span>
          <div role="cell" className="rq-board-nameline rq-board-nameline--desktop">
            <DeltaMark delta={row.delta} />
            <div>
              <RunnerName name={row.name} onOpen={() => onOpen(row.id)} />
              <div className="rq-board-sub">
                <span>Lvl {row.level} · {row.kmTotal} km</span>
                <ChallengeRibbons tokens={row.tokens} />
              </div>
            </div>
          </div>
          <div role="cell">
            <div className="rq-board-titleline rq-board-titleline--row" data-empty={row.titleNames.length === 0}>
              {titleLine(row.titleNames, row.heldTitleCount)}
            </div>
            <div className="rq-track rq-board-track--thin">
              <div className="rq-fill rq-fill--rest" style={rowVars(row)} />
            </div>
            <div className="rq-label">{row.progress.into}</div>
          </div>
          <span role="cell" className="rq-board-num">{row.avgPerRun} km</span>
          <span role="cell" className="rq-board-num" data-tone={row.pace.tone}>{row.pace.text}</span>
          <span role="cell" className="rq-board-num rq-board-num--soft">{etaText(row, true)}</span>
          <span role="cell" className="rq-board-num rq-board-num--soft">
            {row.lastRun ? `${row.lastRun.age} · ${row.lastRun.km} km` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
