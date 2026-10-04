import { useMemo } from 'react';
import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { buildDistanceRows, buildFunRows, buildStreakRows, type StatRow } from '../runnerModel';
import { PanelLoading } from './RunnerParts';

// ?view= på Runner card (ADR 006): distance (default) · streak · fun. Consistency-heatmapen hör till egna
// profilen (inkrement 8) — runner-skärmen i prototypen faller tillbaka på Distance för den.
const STAT_VIEWS = ['distance', 'streak', 'fun'] as const;
type StatView = (typeof STAT_VIEWS)[number];

const STAT_TABS: readonly ViewTab<StatView>[] = [
  { key: 'distance', label: 'Distance', icon: 'list' },
  { key: 'streak', label: 'Streak', icon: 'flame' },
  { key: 'fun', label: 'Fun facts', icon: 'zap' },
];

const ID_PREFIX = 'runner-stats';

function Rows({ rows, label }: { rows: StatRow[]; label: string }) {
  return (
    <dl className="rq-hairgrid rq-runner-rows" aria-label={label}>
      {rows.map((row) => (
        <div key={row.label} className="rq-row rq-runner-row">
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

export function StatsPanel({ user, now }: { user: User; now: Date }) {
  const [view, setView] = useViewParam(STAT_VIEWS, 'distance');
  const distanceRows = useMemo(() => buildDistanceRows(user, now), [user, now]);
  const funRows = useMemo(() => buildFunRows(user, now), [user, now]);

  return (
    <section className="rq-card rq-runner-statcard" aria-label="Runner stats">
      <ViewTabs
        label="Runner stats"
        tabs={STAT_TABS}
        value={view}
        onChange={setView}
        idPrefix={ID_PREFIX}
        variant="underline"
        className="rq-runner-tabs"
      />
      <div role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-runner-panel">
        {view === 'distance' && <Rows rows={distanceRows} label="Distance" />}
        {view === 'streak' && <StreakRows user={user} now={now} />}
        {view === 'fun' && <Rows rows={funRows} label="Fun facts" />}
      </div>
    </section>
  );
}
