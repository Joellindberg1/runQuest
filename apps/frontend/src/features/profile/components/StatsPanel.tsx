import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { DEFAULT_STAT_VIEW, STAT_VIEWS, buildDistanceRows, buildFunRows, buildStreakRows, type StatRow, type StatView } from '../statsModel';
import { todayOf } from '@/features/log/logModel';
import { Heatmap } from './Heatmap';
import { PanelLoading } from './ProfileParts';

const ID_PREFIX = 'profile-stats';

const STAT_TABS: readonly ViewTab<StatView>[] = [
  { key: 'distance', label: 'Distance', icon: 'list' },
  { key: 'streak', label: 'Streak', icon: 'flame' },
  { key: 'fun', label: 'Fun facts', icon: 'zap' },
  { key: 'consistency', label: 'Consistency', icon: 'calendar' },
];

function Rows({ rows, label }: { rows: StatRow[]; label: string }) {
  return (
    <dl className="rq-hairgrid rq-profile-rows" aria-label={label}>
      {rows.map((row) => (
        <div key={row.label} className="rq-row rq-profile-row">
          <dt>{row.label}</dt>
          <dd data-tone={row.tone}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Streak-raden behöver trappan ur /api/config/xp, så den hämtas bara när fliken visas. */
function StreakRows({ user, now }: { user: User; now: Date }) {
  const configQuery = useXpConfig();

  if (configQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load streak tiers"
        retrying={configQuery.isFetching}
        onRetry={() => void configQuery.refetch()}
      />
    );
  }
  if (!configQuery.data) return <PanelLoading label="Loading streak" />;
  return <Rows rows={buildStreakRows(user, now, configQuery.data.streak_multipliers)} label="Streak" />;
}

interface StatsPanelProps {
  user: User;
  now: Date;
  isDesktop: boolean;
}

/** Statflikarna över `?view=` (ADR 006): distance (default) · streak · fun · consistency. */
export function StatsPanel({ user, now, isDesktop }: StatsPanelProps) {
  const [view, setView] = useViewParam(STAT_VIEWS, DEFAULT_STAT_VIEW);
  const distanceRows = useMemo(() => buildDistanceRows(user, now), [user, now]);
  const funRows = useMemo(() => buildFunRows(user, now), [user, now]);

  return (
    <section className="rq-card rq-profile-statcard" aria-label="Your stats" data-tour="profile-stats">
      <ViewTabs label="Your stats" tabs={STAT_TABS} value={view} onChange={setView} idPrefix={ID_PREFIX} variant="underline" className="rq-profile-tabs" />
      <div role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-profile-panel">
        {view === 'distance' && <Rows rows={distanceRows} label="Distance" />}
        {view === 'streak' && <StreakRows user={user} now={now} />}
        {view === 'fun' && <Rows rows={funRows} label="Fun facts" />}
        {view === 'consistency' && <Heatmap user={user} today={todayOf(now)} now={now} isDesktop={isDesktop} />}
      </div>
    </section>
  );
}
