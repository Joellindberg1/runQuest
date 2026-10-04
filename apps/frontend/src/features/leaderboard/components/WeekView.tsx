import type { WeekLeaderboardResponse } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { useOpenRunner } from '@/shared/hooks/useOpenRunner';
import { paths } from '@/paths';
import { useWeekLeaderboard } from '../hooks/useBoardQueries';
import { buildMover, buildPackTotal, buildWeekRows, type DayBar, type WeekRow } from '../weekModel';
import { DeltaMark, RunnerName } from './BoardParts';
import { cssVars } from '../cssVars';

const BAR_STAGGER_SECONDS = 0.05;
const TOP_RANKS = 3;

function DayBars({ bars }: { bars: DayBar[] }) {
  return (
    <div className="rq-daybars" role="img" aria-label={`Kilometres per day, Monday to Sunday: ${bars.map((bar) => bar.km).join(', ')}`}>
      {bars.map((bar, index) => (
        <div key={bar.date} className="rq-daybar">
          <div className="rq-daybar__track">
            <div
              className="rq-daybar__fill"
              data-level={bar.level}
              style={cssVars({ '--h': `${bar.heightPct}%`, '--rq-delay': `${(index + 1) * BAR_STAGGER_SECONDS}s` })}
            />
          </div>
          <span className="rq-daybar__label" aria-hidden="true">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

const rankAttr = (rank: number) => (rank <= TOP_RANKS ? rank : undefined);

interface RowsProps {
  rows: WeekRow[];
  onOpen: (userId: string) => void;
}

function WeekRowsMobile({ rows, onOpen }: RowsProps) {
  return (
    <div className="rq-hairgrid rq-hairgrid--framed" role="table" aria-label="This week">
      <div role="row" className="rq-table-head rq-board-row rq-board-row--week">
        <span role="columnheader">#</span>
        <span role="columnheader">Mon — Sun</span>
        <span role="columnheader" className="rq-board-cell-right">Week XP</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} role="row" className="rq-row rq-board-row rq-board-row--week" data-clickable="true" onClick={() => onOpen(row.id)}>
          <span role="cell" className="rq-board-ranknum" data-rank={rankAttr(row.rank)}>{row.rank}</span>
          <div role="cell">
            <div className="rq-board-nameline">
              <RunnerName name={row.name} onOpen={() => onOpen(row.id)} />
              <DeltaMark delta={row.form} />
            </div>
            <DayBars bars={row.bars} />
            <div className="rq-board-lastrun">{row.km} km · {row.runsText}</div>
          </div>
          <span role="cell" className="rq-board-xp">{row.xp}</span>
        </div>
      ))}
    </div>
  );
}

function WeekRowsDesktop({ rows, onOpen }: RowsProps) {
  return (
    <div className="rq-hairgrid rq-hairgrid--framed" role="table" aria-label="This week">
      <div role="row" className="rq-table-head rq-board-row rq-board-row--week">
        <span role="columnheader" className="rq-board-cell-center">#</span>
        <span role="columnheader">Runner</span>
        <span role="columnheader">Mon — Sun</span>
        <span role="columnheader" className="rq-board-cell-right">Week XP</span>
        <span role="columnheader" className="rq-board-cell-right">Form</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} role="row" className="rq-row rq-board-row rq-board-row--week" data-clickable="true" onClick={() => onOpen(row.id)}>
          <span role="cell" className="rq-board-ranknum" data-rank={rankAttr(row.rank)}>{row.rank}</span>
          <div role="cell">
            <RunnerName name={row.name} onOpen={() => onOpen(row.id)} />
            <div className="rq-board-lastrun">{row.km} km · {row.runsText}</div>
          </div>
          <div role="cell"><DayBars bars={row.bars} /></div>
          <span role="cell" className="rq-board-xp">{row.xp}</span>
          <span role="cell" className="rq-board-cell-right"><DeltaMark delta={row.form} /></span>
        </div>
      ))}
    </div>
  );
}

function WeekSide({ week }: { week: WeekLeaderboardResponse }) {
  const mover = buildMover(week);
  const pack = buildPackTotal(week.totals);
  return (
    <>
      {mover && (
        <section className="rq-card rq-card--edge rq-board-mover" aria-label="Mover of the week">
          <p className="rq-label">Mover of the week</p>
          <h2 className="rq-heading rq-board-mover__name">{mover.name}</h2>
          <p className="rq-body rq-board-mover__text">{mover.summary}</p>
        </section>
      )}

      <section className="rq-card rq-board-pack" aria-label="Pack total this week">
        <p className="rq-label">Pack total this week</p>
        <div className="rq-number">{pack.km}</div>
        <p className="rq-meta rq-board-pack__summary">{pack.summary}</p>
        {pack.pctOfBest !== null && (
          <div className="rq-track">
            <div className="rq-fill rq-fill--pack" style={cssVars({ '--w': `${pack.pctOfBest}%` })} />
          </div>
        )}
        <p className="rq-label" data-caption="true">{pack.pctText}</p>
      </section>

      {week.week.is_current && (
        <p className="rq-board-note">
          Week resets Monday 00:00. All-time XP is untouched — this board is only about who showed up.
        </p>
      )}
    </>
  );
}

/** Week-vyn: dagstaplar per löpare, Mover of the week, pack-total (GET /api/leaderboard/week). */
export function WeekView() {
  const query = useWeekLeaderboard();
  const isDesktop = useIsDesktop();
  const openRunner = useOpenRunner();

  if (query.isPending) {
    return (
      <div className="rq-board__loading">
        <TrackLoader size={64} label="Loading the week" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState title="Couldn't load the week" onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }

  const week = query.data;
  if (week.users.length === 0) {
    return <EmptyState title="No runners yet" text="Once the pack logs runs, the week shows up here." actionLabel="Log a run" actionTo={paths.log} />;
  }

  const rows = buildWeekRows(week.users);
  if (isDesktop === undefined) return null;

  return isDesktop ? (
    <div className="rq-board__split">
      <WeekRowsDesktop rows={rows} onOpen={openRunner} />
      <div className="rq-board__side"><WeekSide week={week} /></div>
    </div>
  ) : (
    <>
      <WeekRowsMobile rows={rows} onOpen={openRunner} />
      <WeekSide week={week} />
    </>
  );
}
