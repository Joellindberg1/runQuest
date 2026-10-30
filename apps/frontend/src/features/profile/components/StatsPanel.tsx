import type { User } from '@runquest/types';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import type { StatView } from '../statsModel';
import { StatsContent } from './StatsContent';

const ID_PREFIX = 'profile-stats';

const STAT_TABS: readonly ViewTab<StatView>[] = [
  { key: 'distance', label: 'Distance', icon: 'list' },
  { key: 'streak', label: 'Streak', icon: 'flame' },
  { key: 'fun', label: 'Fun facts', icon: 'zap' },
  { key: 'consistency', label: 'Consistency', icon: 'calendar' },
];

interface StatsPanelProps {
  user: User;
  now: Date;
  isDesktop: boolean;
  /** Vald flik. Värden äger tillståndet (profilen: `?view=`); panelen läser aldrig adressen. Popupens Overview delar `StatsContent`, inte den här panelen. */
  view: StatView;
  onChange: (view: StatView) => void;
  /** Regionens och flikradens namn: "Your stats" på profilen, "Runner stats" när en annan löpares panel visas. */
  label: string;
  /** Ankaret för sidoturen (`data-tour`); utelämnas där ingen tur pekar på panelen. */
  dataTour?: string;
}

/** Statflikarna Distance · Streak · Fun facts · Consistency, kontrollerade av värden (ADR 006 addendum 2026-10-26, punkt 3). */
export function StatsPanel({ user, now, isDesktop, view, onChange, label, dataTour }: StatsPanelProps) {
  return (
    <section className="rq-card rq-profile-statcard" aria-label={label} data-tour={dataTour}>
      <ViewTabs label={label} tabs={STAT_TABS} value={view} onChange={onChange} idPrefix={ID_PREFIX} variant="underline" className="rq-profile-tabs" />
      <div role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-profile-panel">
        <StatsContent user={user} now={now} isDesktop={isDesktop} view={view} />
      </div>
    </section>
  );
}
