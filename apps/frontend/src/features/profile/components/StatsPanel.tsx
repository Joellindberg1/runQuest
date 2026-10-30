import { Suspense, lazy, useRef, type SyntheticEvent } from 'react';
import { POSITION_WEEKS_DEFAULT } from '@runquest/shared';
import type { User } from '@runquest/types';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { usePositionHistory } from '@/features/leaderboard/hooks/usePositionHistory';
import { useTabRowFade } from '@/shared/hooks/useTabRowFade';
import type { ProfileStatView } from '../statsModel';
import { PanelLoading } from './ProfileParts';
import { StatsContent } from './StatsContent';
import { loadPositionPanel } from './positionPanelLoader';

const ID_PREFIX = 'profile-stats';

// Position-panelen (hook, vymodell, texter, grafen) är egna chunkar och väger inte i profilens ingångsbunt. Panelens chunk förladdas när användaren är på väg till fliken (se onHeadingForPosition).
const PositionPanel = lazy(loadPositionPanel);

const STAT_TABS: readonly ViewTab<ProfileStatView>[] = [
  { key: 'distance', label: 'Distance', icon: 'list' },
  { key: 'streak', label: 'Streak', icon: 'flame' },
  { key: 'fun', label: 'Fun facts', icon: 'zap' },
  { key: 'consistency', label: 'Consistency', icon: 'calendar' },
];
// Prototypens trendikon (trending) finns inte i ikonsetet än; trofén är närmast (placering). Byts när ikonen läggs till.
const POSITION_TAB: ViewTab<ProfileStatView> = { key: 'position', label: 'Position', icon: 'trophy' };
const STAT_TABS_WITH_POSITION: readonly ViewTab<ProfileStatView>[] = [...STAT_TABS, POSITION_TAB];

interface StatsPanelProps {
  user: User;
  now: Date;
  isDesktop: boolean;
  /** Vald flik. Värden äger tillståndet (profilen: `?view=`); panelen läser aldrig adressen. Popupens Overview delar `StatsContent`, inte den här panelen. */
  view: ProfileStatView;
  onChange: (view: ProfileStatView) => void;
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

/** Statflikarna Distance · Streak · Fun facts · Consistency · Position, kontrollerade av värden (ADR 006 addendum 2026-10-26, punkt 3). Skalet: flikraden och Position; övriga vyer ritas av `StatsContent`. */
export function StatsPanel({ user, now, isDesktop, view, onChange, label, dataTour, showPosition = false }: StatsPanelProps) {
  const tabRowRef = useRef<HTMLDivElement>(null);
  const tabs = showPosition ? STAT_TABS_WITH_POSITION : STAT_TABS;
  const fade = useTabRowFade(tabRowRef, view, tabs.length);
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
          tabs={tabs}
          value={view}
          onChange={onChange}
          idPrefix={ID_PREFIX}
          variant="underline"
          className="rq-profile-tabs"
        />
      </div>
      <div role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-profile-panel">
        {view === 'position' ? (
          <Suspense fallback={<PanelLoading label="Loading position" />}>
            <PositionPanel userId={user.id} />
          </Suspense>
        ) : (
          <StatsContent user={user} now={now} isDesktop={isDesktop} view={view} />
        )}
      </div>
    </section>
  );
}
