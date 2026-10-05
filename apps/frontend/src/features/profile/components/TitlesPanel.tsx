import { useMemo, useState } from 'react';
import type { User, UserTitle } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { buildMyTitles } from '../profileModel';
import { PanelHead, PanelLoading } from './ProfileParts';

interface TitlesPanelProps {
  user: User;
  titles: { data: UserTitle[] | undefined; isError: boolean; isFetching: boolean; refetch: () => unknown };
  board: { data: TitleLeaderboard[] | undefined; isLoading: boolean };
  isDesktop: boolean;
}

/**
 * MY TITLES. Mobil: "5 held · 3 runner-up", tre titlar och "Show all 8" (App Prototype). Desktop: "Holding · 5" och
 * "Runner-up · 3" med vem som håller titeln och avståndet dit (Web Prototype). Värdenas enhet kommer ur titelmåttet.
 */
export function TitlesPanel({ user, titles, board, isDesktop }: TitlesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const view = useMemo(
    () => (titles.data ? buildMyTitles(titles.data, board.data ?? [], user.gender, !isDesktop, expanded) : null),
    [titles.data, board.data, user.gender, isDesktop, expanded],
  );

  let body;
  if (titles.isError) {
    body = <ErrorState title="Couldn't load your titles" retrying={titles.isFetching} onRetry={() => void titles.refetch()} />;
  } else if (!view || board.isLoading) {
    body = <PanelLoading label="Loading your titles" />;
  } else if (view.rows.held.length === 0 && view.rows.runnersUp.length === 0) {
    body = <p className="rq-profile-note">No titles yet — your first record is one good run away.</p>;
  } else {
    body = (
      <>
        {isDesktop && <h3 className="rq-label rq-profile-sub">Holding · {view.rows.held.length}</h3>}
        {view.held.length === 0 ? (
          <p className="rq-profile-note">No titles held yet.</p>
        ) : (
          <ul className="rq-profile-list" aria-label="Titles held">
            {view.held.map((title) => (
              <li key={title.id} className="rq-profile-title" data-kind="held">
                <span className="rq-profile-title__name">{title.name}</span>
                <span className="rq-profile-title__value">{title.value}</span>
              </li>
            ))}
          </ul>
        )}

        {view.runnersUp.length > 0 && (
          <>
            <h3 className="rq-label rq-profile-sub">Runner-up · {view.runnersUp.length}</h3>
            <ul className="rq-profile-list" aria-label="Runner-up titles">
              {view.runnersUp.map((title) => (
                <li key={title.id} className="rq-profile-title" data-kind="runner-up">
                  <span className="rq-profile-title__main">
                    <span className="rq-profile-title__name">{title.name}</span>
                    {title.holder && <span className="rq-profile-title__holder">held by {title.holder}</span>}
                  </span>
                  <span className="rq-profile-title__value" data-tone={title.gap ? 'down' : 'muted'}>
                    {title.gap ?? title.value}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {view.showAllLabel && (
          <button type="button" className="rq-btn rq-btn--ghost rq-btn--compact rq-profile-more" aria-expanded={expanded} onClick={() => setExpanded(true)}>
            {view.showAllLabel}
          </button>
        )}
      </>
    );
  }

  return (
    <section className="rq-card rq-profile-titles" aria-label="My titles" data-tour="profile-titles">
      <PanelHead icon="crown" title="MY TITLES" aside={!isDesktop && view ? view.summary : undefined} />
      {body}
    </section>
  );
}
