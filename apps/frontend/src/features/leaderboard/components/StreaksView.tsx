import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@runquest/types';
import type { XpConfigResponse } from '@runquest/shared';
import { useNow } from '@/app-shell/useNow';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useAuth } from '@/providers/authContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { EmptyState } from '@/shared/components/EmptyState';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { useOpenRunner } from '@/shared/hooks/useOpenRunner';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { paths } from '@/paths';
import { formatCountdown } from '../boardFormat';
import {
  buildLadderRows, buildStreakRow, buildStreakRows, formatMultiplier, nextRunXp, topMultiplier,
  type StreakRow, type StreakStatus,
} from '../streakModel';
import { RunnerName } from './BoardParts';
import { cssVars } from '../cssVars';

const ROW_STAGGER_SECONDS = 0.1;
const COUNTDOWN_TICK_MS = 1000;
const NEXT_RUN_KM = 10;

const STATUS_LABEL: Record<StreakStatus, string> = { safe: 'Safe', 'at-risk': 'At risk', broken: 'Broken' };

interface RowsProps {
  rows: StreakRow[];
  top: number;
  onOpen: (userId: string) => void;
}

function StatusLabel({ status }: { status: StreakStatus }) {
  return <span className="rq-board-status" data-status={status}>{STATUS_LABEL[status]}</span>;
}

function MultiplierBar({ row, top, index }: { row: StreakRow; top: number; index: number }) {
  return (
    <div>
      <div className="rq-track rq-board-streak__track">
        <div className="rq-fill" style={cssVars({ '--w': `${row.pct}%`, '--rq-delay': `${(index + 1) * ROW_STAGGER_SECONDS}s` })} />
      </div>
      <div className="rq-board-streak__scale">
        <span>{formatMultiplier(1)}</span>
        <span data-now="true">{formatMultiplier(row.multiplier)} now</span>
        <span>{formatMultiplier(top)}</span>
      </div>
    </div>
  );
}

function StreakRowsMobile({ rows, top, onOpen }: RowsProps) {
  return (
    <div className="rq-hairgrid rq-hairgrid--framed" role="table" aria-label="Streaks">
      {rows.map((row, index) => (
        <div
          key={row.id}
          role="row"
          className="rq-row rq-board-row rq-board-row--streak rq-board-streak"
          data-accent={row.accent}
          data-clickable="true"
          onClick={() => onOpen(row.id)}
        >
          <div role="cell">
            <div className="rq-board-streak__top">
              <RunnerName name={row.name} onOpen={() => onOpen(row.id)} />
              <StatusLabel status={row.status} />
            </div>
            <div className="rq-board-streak__nums">
              <span className="rq-board-streak__days">{row.days}</span>
              <span className="rq-label">days · best {row.best}</span>
              <span className="rq-board-streak__detail">{row.detail}</span>
            </div>
            <MultiplierBar row={row} top={top} index={index} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StreakRowsDesktop({ rows, top, onOpen }: RowsProps) {
  return (
    <div className="rq-hairgrid rq-hairgrid--framed" role="table" aria-label="Streaks">
      <div role="row" className="rq-table-head rq-board-row rq-board-row--streak">
        <span role="columnheader">Runner</span>
        <span role="columnheader">Current</span>
        <span role="columnheader">Multiplier</span>
        <span role="columnheader" className="rq-board-cell-right">Status</span>
      </div>
      {rows.map((row, index) => (
        <div
          key={row.id}
          role="row"
          className="rq-row rq-board-row rq-board-row--streak rq-board-streak"
          data-accent={row.accent}
          data-clickable="true"
          onClick={() => onOpen(row.id)}
        >
          <div role="cell">
            <RunnerName name={row.name} onOpen={() => onOpen(row.id)} />
            <div className="rq-board-lastrun">Best {row.best} d</div>
          </div>
          <div role="cell" className="rq-board-streak__nums">
            <span className="rq-board-streak__days">{row.days}</span>
            <span className="rq-label">days</span>
          </div>
          <div role="cell"><MultiplierBar row={row} top={top} index={index} /></div>
          <div role="cell" className="rq-board-cell-right">
            <StatusLabel status={row.status} />
            <div className="rq-board-streak__detail">{row.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AlertProps {
  user: User;
  config: XpConfigResponse;
  meId: string;
}

/** Din egen streak: nedräkning mot deadline (tickar varje sekund), vad som står på spel, och vägen vidare. */
function StreakAlert({ user, config, meId }: AlertProps) {
  const now = useNow(COUNTDOWN_TICK_MS);
  const row = buildStreakRow(user, now, config.streak_multipliers, meId);
  const outcome = nextRunXp(row.days, config, NEXT_RUN_KM);
  const firstStep = config.streak_multipliers[0];

  return (
    <section className="rq-card rq-card--edge rq-board-alert" data-state={row.status} aria-label="Your streak">
      {row.status === 'at-risk' && row.msLeft !== null && (
        <>
          <p className="rq-board-alert__eyebrow"><span className="rq-dot rq-dot--alarm" aria-hidden="true" />Your streak dies in</p>
          <div className="rq-counter" role="timer">{formatCountdown(row.msLeft)}</div>
          <p className="rq-body rq-board-alert__text">
            {outcome.keep.xp > outcome.broken.xp
              ? `Your run today earns ${formatMultiplier(outcome.keep.multiplier)}. Miss it and your next ${NEXT_RUN_KM} km run drops from ${outcome.keep.xp} to ${outcome.broken.xp} XP.`
              : 'Any run today keeps your streak alive.'}
          </p>
          <Link to={paths.log} className="rq-btn rq-btn--primary rq-btn--block">Log a run</Link>
        </>
      )}
      {row.status === 'safe' && row.msLeft !== null && (
        <>
          <p className="rq-board-alert__eyebrow"><span className="rq-dot rq-dot--live" aria-hidden="true" />Your streak is safe</p>
          <div className="rq-counter" role="timer">{formatCountdown(row.msLeft)}</div>
          <p className="rq-body rq-board-alert__text">
            Run again before the clock hits zero and your streak reaches day {row.days + 1} at {formatMultiplier(outcome.keep.multiplier)}.
          </p>
        </>
      )}
      {row.status === 'broken' && (
        <>
          <p className="rq-board-alert__eyebrow">No streak running</p>
          <p className="rq-body rq-board-alert__text">
            {firstStep
              ? `Run today to start a new one. ${firstStep.days} days in a row starts the multiplier at ${formatMultiplier(firstStep.multiplier)}.`
              : 'Run today to start a new one.'}
          </p>
          <Link to={paths.log} className="rq-btn rq-btn--primary rq-btn--block">Log a run</Link>
        </>
      )}
    </section>
  );
}

/** "How the multiplier grows" — trappan kommer ur /api/config/xp, aldrig ur konstanter. */
function LadderCard({ config }: { config: XpConfigResponse }) {
  const rows = buildLadderRows(config.streak_multipliers);
  return (
    <section className="rq-card rq-board-ladder" aria-label="How the multiplier grows">
      <p className="rq-label rq-board-ladder__title">How the multiplier grows</p>
      <ul className="rq-hairgrid rq-board-ladder__grid">
        {rows.map((step) => (
          <li key={step.days} className="rq-board-ladder__row" data-accent={step.accent}>
            <span>{step.label}</span>
            <span className="rq-board-ladder__mult">{formatMultiplier(step.multiplier)}</span>
          </li>
        ))}
      </ul>
      <p className="rq-board-ladder__foot">One missed day resets to {formatMultiplier(1)}. No grace days.</p>
    </section>
  );
}

/** Streaks-vyn: status, multiplikator och nedräkning per löpare. */
export function StreaksView() {
  const { user: authUser } = useAuth();
  const usersQuery = useUsersWithRuns(!!authUser);
  const configQuery = useXpConfig();
  const now = useNow();
  const isDesktop = useIsDesktop();
  const openRunner = useOpenRunner();

  const users = usersQuery.data;
  const config = configQuery.data;
  const rows = useMemo(
    () => (users && config ? buildStreakRows(users, now, config.streak_multipliers, authUser?.id) : []),
    [users, config, now, authUser?.id],
  );

  if (usersQuery.isError || configQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load streaks"
        retrying={usersQuery.isFetching || configQuery.isFetching}
        onRetry={() => {
          void usersQuery.refetch();
          void configQuery.refetch();
        }}
      />
    );
  }
  if (!users || !config) {
    return (
      <div className="rq-board__loading">
        <TrackLoader size={64} label="Loading streaks" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title="No runners yet" text="Streaks start with the first run." actionLabel="Log a run" actionTo={paths.log} />;
  }
  if (isDesktop === undefined) return null;

  const top = topMultiplier(config.streak_multipliers);
  const me = users.find((candidate) => candidate.id === authUser?.id);
  const side = (
    <>
      {me && authUser && <StreakAlert user={me} config={config} meId={authUser.id} />}
      <LadderCard config={config} />
    </>
  );

  return isDesktop ? (
    <div className="rq-board__split">
      <StreakRowsDesktop rows={rows} top={top} onOpen={openRunner} />
      <div className="rq-board__side">{side}</div>
    </div>
  ) : (
    <>
      <StreakRowsMobile rows={rows} top={top} onOpen={openRunner} />
      {side}
    </>
  );
}
