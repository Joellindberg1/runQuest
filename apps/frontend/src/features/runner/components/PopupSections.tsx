import type { User } from '@runquest/types';
import { BadgePanel } from '@/features/badges/components/BadgePanel';
import type { StatView } from '@/features/profile/statsModel';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import type { RunnerPanelData } from '../hooks/useRunnerPanelData';
import type { PopupSection } from '../popupSections';
import { JourneyCard } from './JourneyCard';
import { OverviewPanel } from './OverviewPanel';
import { TitlesPanel } from './TitlesPanel';

const SECTION_TABS: readonly ViewTab<PopupSection>[] = [
  { key: 'overview', label: 'Overview', icon: 'user' },
  { key: 'journey', label: 'The Journey', icon: 'mountain' },
  { key: 'titles', label: 'Titles held', icon: 'crown' },
  { key: 'badges', label: 'Badges', icon: 'shield' },
];

// Eget prefix, skilt från sidans paneler (`runner-stats` i StatsPanel): flikarnas id:n får inte krocka med något id i panelerna. Overview delar profilens innehåll (`StatsContent`) och bär inga id:n.
const ID_PREFIX = 'runner-popup';

interface PopupSectionsProps {
  user: User;
  data: RunnerPanelData;
  section: PopupSection;
  onSectionChange: (section: PopupSection) => void;
  /** Overview-panelens vy. Värden (popupen) äger den, så att den nollställs med resten vid varje öppning. */
  statView: StatView;
  onStatViewChange: (view: StatView) => void;
}

/**
 * Popupens flikrad och panelyta (ADR 006 addendum 2026-10-26, beslut 3). Flikarna är `ViewTabs` (en tablist, ett tabbstopp, pilar och Home/End) över EN tabpanel vars innehåll byts:
 * bara den valda flikens panel ritas. Panelytan har fast höjd (`--rq-runner-popup-panel-h`) och scrollar för sig, så dialogen är lika hög på alla flikar. Flik och växling är
 * komponenttillstånd hos anroparen, aldrig `?view=`.
 */
export function PopupSections({ user, data, section, onSectionChange, statView, onStatViewChange }: PopupSectionsProps) {
  return (
    <div className="rq-runner-popup-sections">
      <ViewTabs
        label="Runner sections"
        tabs={SECTION_TABS}
        value={section}
        onChange={onSectionChange}
        idPrefix={ID_PREFIX}
        variant="underline"
        className="rq-runner-popup-tabs"
      />
      <div role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, section)} tabIndex={0} className="rq-runner-popup-panel">
        {section === 'overview' && <OverviewPanel user={user} now={data.now} cells={data.cells} view={statView} onChange={onStatViewChange} />}
        {section === 'journey' && <JourneyCard totalKm={user.total_km} />}
        {section === 'titles' && <TitlesPanel user={user} />}
        {section === 'badges' && <BadgePanel rows={data.badgeRows} loading={data.badgesLoading} error={data.badgeError} />}
      </div>
    </div>
  );
}
