import { Suspense, lazy, useMemo, useRef, type SyntheticEvent } from 'react';
import { POSITION_WEEKS_DEFAULT, zoneDay } from '@runquest/shared';
import type { User } from '@runquest/types';
import { ErrorState } from '@/shared/components/ErrorState';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { usePositionHistory } from '@/features/leaderboard/hooks/usePositionHistory';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { useTabRowFade } from '../hooks/useTabRowFade';
import { buildDistanceRows, buildFunRows, buildStreakRows, type StatRow, type StatView } from '../statsModel';
import { Heatmap } from './Heatmap';
import { PanelLoading } from './ProfileParts';
import { loadPositionPanel } from './positionPanelLoader';

const ID_PREFIX = 'profile-stats';

// Position-panelen (hook, vymodell, texter, grafen) är egna chunkar och väger inte i profilens ingångsbunt. Panelens chunk förladdas när användaren är på väg till fliken (se onHeadingForPosition).
const PositionPanel = lazy(loadPositionPanel);

const STAT_TABS: readonly ViewTab<StatView>[] = [
  { key: 'distance', label: 'Distance', icon: 'list' },
  { key: 'streak', label: 'Streak', icon: 'flame' },
  { key: 'fun', label: 'Fun facts', icon: 'zap' },
  { key: 'consistency', label: 'Consistency', icon: 'calendar' },
];
// Prototypens trendikon (trending) finns inte i ikonsetet än; trofén är närmast (placering). Byts när ikonen läggs till.
const POSITION_TAB: ViewTab<StatView> = { key: 'position', label: 'Position', icon: 'trophy' };
const STAT_TABS_WITH_POSITION: readonly ViewTab<StatView>[] = [...STAT_TABS, POSITION_TAB];

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
  /** Vald flik. Värden äger tillståndet (profilen: `?view=`, popupen: lokalt tillstånd); panelen läser aldrig adressen. */
  view: StatView;
  onChange: (view: StatView) => void;
  /** Regionens och flikradens namn: "Your stats" på profilen, "Runner stats" när en annan löpares panel visas. */
  label: string;
  /** Ankaret för sidoturen (`data-tour`); utelämnas där ingen tur pekar på panelen. */
  dataTour?: string;
  /**
   * Om fliken Position visas (den femte). Värden avgör det ur gruppens storlek (`showPositionTab`) och låter `?view=position` falla tillbaka när den är dold;
   * panelen ritar aldrig positionsinnehåll för en flik som inte finns. Utelämnad = fyra flikar.
   */
  showPosition?: boolean;
}

/** Statflikarna Distance · Streak · Fun facts · Consistency · Position, kontrollerade av värden (ADR 006 addendum 2026-10-26, punkt 3). */
export function StatsPanel({ user, now, isDesktop, view, onChange, label, dataTour, showPosition = false }: StatsPanelProps) {
  const distanceRows = useMemo(() => buildDistanceRows(user, now), [user, now]);
  const funRows = useMemo(() => buildFunRows(user, now), [user, now]);
  const tabRowRef = useRef<HTMLDivElement>(null);
  const fade = useTabRowFade(tabRowRef, view);
  // Positionssvaret begärs här, så att det hämtas samtidigt med panelens chunk och inte efter den. Panelen läser samma fråga ur cachen (en begäran), och på övriga flikar är den avstängd.
  usePositionHistory(POSITION_WEEKS_DEFAULT, view === 'position');

  // Pekare över fliken eller tangentbordsfokus på den: chunken hämtas redan nu, så den är på plats när fliken väljs. Händelserna bubblar från flikknappen (ViewTabs har ingen egen krok per flik).
  const onHeadingForPosition = (event: SyntheticEvent) => {
    const tab = (event.target as HTMLElement).closest('[role="tab"]');
    if (tab?.id === tabId(ID_PREFIX, 'position')) void loadPositionPanel();
  };

  return (
    <section className="rq-card rq-profile-statcard" aria-label={label} data-tour={dataTour}>
      <div
        ref={tabRowRef}
        className="rq-profile-tabs-wrap"
        data-fade-start={String(fade.start)}
        data-fade-end={String(fade.end)}
        onPointerOver={onHeadingForPosition}
        onFocus={onHeadingForPosition}
      >
        <ViewTabs
          label={label}
          tabs={showPosition ? STAT_TABS_WITH_POSITION : STAT_TABS}
          value={view}
          onChange={onChange}
          idPrefix={ID_PREFIX}
          variant="underline"
          className="rq-profile-tabs"
        />
      </div>
      <div role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-profile-panel">
        {view === 'distance' && <Rows rows={distanceRows} label="Distance" />}
        {view === 'streak' && <StreakRows user={user} now={now} />}
        {view === 'fun' && <Rows rows={funRows} label="Fun facts" />}
        {view === 'consistency' && <Heatmap user={user} today={zoneDay(now)} now={now} isDesktop={isDesktop} />}
        {view === 'position' && (
          <Suspense fallback={<PanelLoading label="Loading position" />}>
            <PositionPanel userId={user.id} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
