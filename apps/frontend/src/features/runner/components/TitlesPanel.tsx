import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { firstName } from '@/shared/utils/format';
import { useRunnerTitleRows } from '../hooks/useRunnerTitleRows';
import type { RunnerUpTitleRow } from '../runnerModel';
import { PanelHead, PanelLoading } from './RunnerParts';

/** Runner-up (position 2–3): titeln, vem som håller den och avståndet dit. Sidans och popupens panel ritar den lika; utan rader ritas ingenting. */
export function RunnerUpTitles({ rows }: { rows: readonly RunnerUpTitleRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="rq-label rq-runner-sub">Runner-up · {rows.length}</h3>
      <ul className="rq-runner-list" aria-label="Runner-up titles">
        {rows.map((title) => (
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
  );
}

/**
 * "TITLES HELD · N held" med value-rader, och Runner-up (position 2–3) med vem som håller titeln och
 * avståndet dit. Värdenas enhet kommer från titelmåttet i /titles/leaderboard. Sidans panel; popupens har typfilter och scrollande lista (`PopupTitlesPanel`).
 */
export function TitlesPanel({ user }: { user: User }) {
  const { rows, failed, loading, retrying, retry } = useRunnerTitleRows(user);

  let body;
  if (failed) {
    body = <ErrorState title="Couldn't load titles" retrying={retrying} onRetry={retry} />;
  } else if (!rows || loading) {
    body = <PanelLoading label="Loading titles" />;
  } else if (rows.held.length === 0 && rows.runnersUp.length === 0) {
    body = <p className="rq-runner-note">No titles yet — {firstName(user.name)} is still chasing the first one.</p>;
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

        <RunnerUpTitles rows={rows.runnersUp} />
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
