import { RQIcon } from '@/shared/components/icons';
import { CHANGE_KIND, RELEASE_TYPE_LABEL, releasePanelId } from '../changelogModel';
import type { Release } from '../changelogTypes';

const ICON_CHANGE = 15;

interface ReleaseListProps {
  releases: readonly Release[];
  /** Versionen som är öppen just nu (en åt gången, som prototypen). */
  openVersion: string | null;
  onToggle: (version: string) => void;
}

/**
 * Fliken Releases: ett kort per release, nyaste först. Kantens styrka följer typen (major guld · minor/patch tystare). Rubrikraden är en
 * knapp (`aria-expanded`); den öppna releasen listar sina ändringar i en hårlinjegrid: ikon · typ · text.
 */
export function ReleaseList({ releases, openVersion, onToggle }: ReleaseListProps) {
  return (
    <ul className="rq-changelog-releases">
      {releases.map((release) => {
        const open = release.version === openVersion;
        const panelId = releasePanelId(release.version);
        return (
          <li key={release.version} className="rq-card rq-card--edge rq-changelog-release" data-release={release.type}>
            <button
              type="button"
              className="rq-changelog-release__head"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={() => onToggle(release.version)}
            >
              <span className="rq-changelog-tag">{RELEASE_TYPE_LABEL[release.type]}</span>
              <span className="rq-changelog-release__version">v{release.version}</span>
              <span className="rq-changelog-release__title">{release.title}</span>
              <span className="rq-changelog-release__date">{release.date}</span>
              <span className="rq-changelog-release__toggle" aria-hidden="true">{open ? '−' : '+'}</span>
            </button>
            {open && (
              <div className="rq-changelog-release__body">
                <ul id={panelId} className="rq-hairgrid rq-changelog-changes" aria-label={`Changes in version ${release.version}`}>
                  {release.changes.map((change, index) => (
                    <li key={`${index}-${change.description}`} className="rq-changelog-change" data-kind={change.type}>
                      <span className="rq-changelog-change__icon"><RQIcon name={CHANGE_KIND[change.type].icon} size={ICON_CHANGE} /></span>
                      <span className="rq-changelog-change__kind">{CHANGE_KIND[change.type].label}</span>
                      <span className="rq-changelog-change__text">{change.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
