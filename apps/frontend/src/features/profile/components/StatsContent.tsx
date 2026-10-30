import { zoneDay } from '@runquest/shared';
import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { buildDistanceRows, buildFunRows, buildStreakRows, type StatRow, type StatView } from '../statsModel';
import { Heatmap } from './Heatmap';
import { PanelLoading } from './ProfileParts';

function Rows({ rows, label }: { rows: readonly StatRow[]; label: string }) {
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

interface StatsContentProps {
  user: User;
  now: Date;
  isDesktop: boolean;
  /** Vald vy. Skalet (profilens flikrad, popupens växling) äger valet och panelens roll; innehållet har varken flikar eller id:n. */
  view: StatView;
  /** Rader som en värd lägger sist i Fun facts (popupens utmaningsrekord). Profilens modell får aldrig dem. */
  extraFunRows?: readonly StatRow[];
}

/**
 * Det profilens statistikpanel visar för en vy, utan skal: samma rader, samma Consistency-karta och samma Streak-hämtning (trappan bara när Streak visas) för profilen
 * (`StatsPanel`, med flikrad) och popupens Overview (`OverviewPanel`, med segmentstyrd växling). Bara den valda vyn ritas och bara den bygger sina rader.
 */
export function StatsContent({ user, now, isDesktop, view, extraFunRows = [] }: StatsContentProps) {
  switch (view) {
    case 'distance':
      return <Rows rows={buildDistanceRows(user, now)} label="Distance" />;
    case 'streak':
      return <StreakRows user={user} now={now} />;
    case 'fun':
      return <Rows rows={[...buildFunRows(user, now), ...extraFunRows]} label="Fun facts" />;
    case 'consistency':
      return <Heatmap user={user} today={zoneDay(now)} now={now} isDesktop={isDesktop} />;
  }
}
