import { useMemo, useState } from 'react';
import { buildTitleRuleRows } from '@/features/playbook/titleRules';
import { useTitleBoard } from '@/features/titles/hooks/useTitlesQueries';
import { ErrorState } from '@/shared/components/ErrorState';
import { FormNotices } from '@/shared/components/form/FormNotices';
import { RQIcon } from '@/shared/components/icons';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useRefreshTitleLeaderboards } from '@/shared/hooks/useTitleQueries';

const SKELETON_ROWS = 4;
const ICON_SIZE = 15;

/**
 * Titlarna (namn, regel och låsgräns ur databasen) och Refresh title leaderboards. Listan var tidigare fyra hårdkodade
 * titlar med texten "hardcoded" — nu är det de verkliga raderna, samma som Titles och Playbook visar.
 */
export function TitlesPanel() {
  const board = useTitleBoard();
  const refresh = useRefreshTitleLeaderboards();
  const rows = useMemo(() => (board.data ? buildTitleRuleRows(board.data) : []), [board.data]);
  const [notice, setNotice] = useState<{ status?: string; error?: string }>({});

  const onRefresh = async () => {
    setNotice({});
    try {
      await refresh.mutateAsync();
      setNotice({ status: 'Title leaderboards refreshed.' });
    } catch {
      setNotice({ error: 'Could not refresh the title leaderboards. Nothing was changed.' });
    }
  };

  let list;
  if (board.data) {
    list = (
      <ul className="rq-hairgrid rq-admin-titles" aria-label="Titles">
        {rows.map((row) => (
          <li key={row.id} className="rq-admin-title">
            <span className="rq-name rq-admin-title__name">
              <RQIcon name={row.icon} size={ICON_SIZE} />
              {row.name}
            </span>
            <span className="rq-admin-title__rule">{row.rule}</span>
            {row.unlock && <span className="rq-admin-title__unlock">{row.unlock}</span>}
          </li>
        ))}
      </ul>
    );
  } else if (board.isError) {
    list = (
      <ErrorState
        title="Couldn't load the titles"
        message="Nothing was changed — we just could not read the list. Try again in a moment."
        retrying={board.isFetching}
        onRetry={() => void board.refetch()}
      />
    );
  } else {
    list = <SkeletonRows rows={SKELETON_ROWS} label="Loading titles" />;
  }

  return (
    <section className="rq-card rq-admin-card" aria-labelledby="admin-titles-title">
      <div className="rq-admin-card__head">
        <h2 id="admin-titles-title" className="rq-title rq-admin-card__title">Titles</h2>
        <div className="rq-admin-card__aside">
          <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact" onClick={() => void onRefresh()} disabled={refresh.isPending}>
            <RQIcon name="sync" size={ICON_SIZE} />
            {refresh.isPending ? 'Refreshing…' : 'Refresh title leaderboards'}
          </button>
        </div>
      </div>
      <p className="rq-admin-card__note">Who holds each title is recalculated after every synced run. Refresh to recalculate right now.</p>
      {list}
      <FormNotices name="Titles" status={notice.status} error={notice.error} />
    </section>
  );
}
