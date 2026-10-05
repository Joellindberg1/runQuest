import { useState } from 'react';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { changelog } from '../changelogData';
import { CHANGELOG_VIEWS, DEFAULT_CHANGELOG_VIEW, initialOpenVersion, latestRelease, toggleOpenVersion, versionLine, type ChangelogView } from '../changelogModel';
import '../changelog.css';
import { FeatureCards } from './FeatureCards';
import { ReleaseList } from './ReleaseList';
import { WorkingOnCards } from './WorkingOnCards';

const ID_PREFIX = 'changelog';

const TABS: readonly ViewTab<ChangelogView>[] = [
  { key: 'features', label: 'Features', icon: 'sparkles' },
  { key: 'working', label: 'Working on', icon: 'settings' },
  { key: 'releases', label: 'Releases', icon: 'clock' },
];

/**
 * /features: versionsnumret och datumet (ur changelog.json — inget hårdkodat), flikarna Features · Working on · Releases (`?view=`)
 * och det valda panelen. Allt innehåll kommer ur changelog.json via changelogData; här finns bara vyvalet och vilken release som är öppen.
 * Mobil = Web Prototypens skärm i en kolumn (prototypen saknar mobilvy): flikarna under rubriken, korten staplade.
 */
export function ChangelogScreen() {
  const [view, setView] = useViewParam(CHANGELOG_VIEWS, DEFAULT_CHANGELOG_VIEW);
  const [openVersion, setOpenVersion] = useState<string | null>(() => initialOpenVersion(changelog.releases));

  return (
    <div className="rq-changelog">
      <header className="rq-changelog__head">
        <div>
          <h1 className="rq-display rq-changelog__title">Feature &amp; Version</h1>
          <p className="rq-changelog__sub">{versionLine(latestRelease(changelog.releases))}</p>
        </div>
        <ViewTabs label="Feature and version view" tabs={TABS} value={view} onChange={setView} idPrefix={ID_PREFIX} className="rq-changelog__tabs" />
      </header>

      <div key={view} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, view)} className="rq-changelog__panel rq-rise">
        {view === 'features' && <FeatureCards features={changelog.features} />}
        {view === 'working' && <WorkingOnCards items={changelog.workingOn} />}
        {view === 'releases' && (
          <ReleaseList releases={changelog.releases} openVersion={openVersion} onToggle={(version) => setOpenVersion((current) => toggleOpenVersion(current, version))} />
        )}
      </div>
    </div>
  );
}
