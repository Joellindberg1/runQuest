import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { useTitleLeaderboard } from '@/shared/hooks/useTitleQueries';
import { useRunnerTitles } from '../hooks/useRunnerQueries';
import { buildTitleRows } from '../runnerModel';
import { PanelHead, PanelLoading } from './RunnerParts';

/**
 * "TITLES HELD · N held" med value-rader, och Runner-up (position 2–3) med vem som håller titeln och
 * avståndet dit. Värdenas enhet kommer från titelmåttet i /titles/leaderboard.
 */
export function TitlesPanel({ user }: { user: User }) {
  const titlesQuery = useRunnerTitles(user.id);
  const boardQuery = useTitleLeaderboard();
  const rows = useMemo(
    () => (titlesQuery.data ? buildTitleRows(titlesQuery.data, boardQuery.data ?? [], user.gender) : null),
    [titlesQuery.data, boardQuery.data, user.gender],
  );

  let body;
  if (titlesQuery.isError) {
    body = (
      <ErrorState
        title="Couldn't load titles"
        retrying={titlesQuery.isFetching}
        onRetry={() => void titlesQuery.refetch()}
      />
    );
  } else if (!rows || boardQuery.isLoading) {
    body = <PanelLoading label="Loading titles" />;
  } else if (rows.held.length === 0 && rows.runnersUp.length === 0) {
    body = <p className="rq-runner-note">No titles yet — {user.name.split(' ')[0]} is still chasing the first one.</p>;
  } else {
    body = (
      <>
        {rows.held.length === 0 ? (
          <p className="rq-runner-note">No titles held yet.</p>
        ) : (
          <ul className="rq-runner-list" aria-label="Titles held">
            {rows.held.map((title) => (
              <li key={title.id} className="rq-runner-title" data-kind="held">
                <span className="rq-runner-title__name">{title.name}</span>
                <span className="rq-runner-title__value">{title.value}</span>
              </li>
            ))}
          </ul>
        )}

        {rows.runnersUp.length > 0 && (
          <>
            <h3 className="rq-label rq-runner-sub">Runner-up · {rows.runnersUp.length}</h3>
            <ul className="rq-runner-list" aria-label="Runner-up titles">
              {rows.runnersUp.map((title) => (
                <li key={title.id} className="rq-runner-title" data-kind="runner-up">
                  <span className="rq-runner-title__main">
                    <span className="rq-runner-title__name">{title.name}</span>
                    {title.holder && <span className="rq-runner-title__holder">held by {title.holder}</span>}
                  </span>
                  <span className="rq-runner-title__value" data-tone={title.gap ? 'down' : 'muted'}>
                    {title.gap ?? title.value}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  return (
    <section className="rq-card rq-runner-titles" aria-label="Titles">
      <PanelHead icon="crown" title="TITLES HELD" aside={rows ? `${rows.held.length} held` : undefined} />
      {body}
    </section>
  );
}
