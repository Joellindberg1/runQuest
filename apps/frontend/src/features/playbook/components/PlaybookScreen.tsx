import { useMemo, useState } from 'react';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import type { XpRules } from '@/features/log/xpPreviewModel';
import { RQIcon } from '@/shared/components/icons';
import { TrackLoader } from '@/shared/components/loaders/TrackLoader';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useXpConfig } from '@/shared/hooks/useXpConfig';
import { CHAPTER_IDS, DEFAULT_CHAPTER, buildChapters, neighbours, type ChapterId } from '../playbookModel';
import '../playbook.css';
import { ChapterAccordion } from './ChapterAccordion';
import { ChapterTable, ChapterText, TitleList } from './ChapterParts';

const ID_PREFIX = 'playbook';
const LOADER_SIZE = 64;
const PAGER_ICON_SIZE = 15;

/** Reserv när GET /config/xp inte svarar: shareds standardvärden (ADR 004/007) — samma som backend faller tillbaka på. */
const FALLBACK_RULES: XpRules = { settings: DEFAULT_ADMIN_SETTINGS, streak_multipliers: DEFAULT_STREAK_MULTIPLIERS };

/**
 * /playbook: spelets regler som nio kapitel. Desktop = kapitelflikar (`?view=`) med kapitlet bredvid sin tabell och
 * "← förra / nästa →" (Web Prototypen), mobil = dragspel (App Prototypens mPlaybook). Siffrorna (bas-XP, XP/km, distansbonusar,
 * streak-trappan) läses ur `GET /config/xp`; går den inte att läsa visas shareds standardvärden och sidan säger det.
 */
export function PlaybookScreen() {
  const isDesktop = useIsDesktop();
  const [view, setView] = useViewParam(CHAPTER_IDS, DEFAULT_CHAPTER);
  const [collapsed, setCollapsed] = useState(false);
  const configQuery = useXpConfig();

  const usingDefaults = !configQuery.data && configQuery.isError;
  const rules: XpRules | undefined = configQuery.data ?? (usingDefaults ? FALLBACK_RULES : undefined);
  const chapters = useMemo(() => (rules ? buildChapters(rules) : null), [rules]);

  if (isDesktop === undefined) return null;

  const tabs: readonly ViewTab<ChapterId>[] = (chapters ?? []).map((chapter) => ({ key: chapter.id, label: chapter.label, icon: chapter.icon }));

  const toggle = (id: ChapterId) => {
    if (id === view && !collapsed) {
      setCollapsed(true);
      return;
    }
    setView(id);
    setCollapsed(false);
  };

  let body;
  if (!chapters) {
    body = (
      <section className="rq-card rq-playbook-pending">
        <TrackLoader size={LOADER_SIZE} label="Loading the rules" />
      </section>
    );
  } else if (isDesktop) {
    const chapter = chapters.find((candidate) => candidate.id === view) ?? chapters[0];
    const { prev, next, position } = neighbours(chapters, chapter.id);
    body = (
      <>
        <ViewTabs label="Playbook chapters" tabs={tabs} value={chapter.id} onChange={setView} idPrefix={ID_PREFIX} className="rq-playbook__tabs" />
        <div key={chapter.id} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, chapter.id)} className="rq-playbook__panel rq-rise">
          <div className="rq-playbook-split" data-split={chapter.table ? 'true' : 'false'}>
            <article className="rq-playbook-chapter">
              <h2 className="rq-display-xl rq-playbook-chapter__title">{chapter.title}</h2>
              <div className="rq-playbook-rule" aria-hidden="true" />
              <ChapterText chapter={chapter} />
              {chapter.showsTitleList && <TitleList />}
            </article>
            {chapter.table && <ChapterTable table={chapter.table} />}
          </div>
        </div>
        <nav className="rq-playbook-pager" aria-label="Chapter navigation">
          <button type="button" className="rq-playbook-pager__button" onClick={() => setView(prev.id)}>
            <RQIcon name="chevron" size={PAGER_ICON_SIZE} className="rq-playbook-pager__arrow rq-playbook-pager__arrow--prev" />
            <span className="sr-only">Previous chapter: </span>
            {prev.label}
          </button>
          <span className="rq-playbook-pager__position" aria-label={`Chapter ${position.replace('/', 'of')}`}>
            {position}
          </span>
          <button type="button" className="rq-playbook-pager__button" onClick={() => setView(next.id)}>
            <span className="sr-only">Next chapter: </span>
            {next.label}
            <RQIcon name="chevron" size={PAGER_ICON_SIZE} className="rq-playbook-pager__arrow rq-playbook-pager__arrow--next" />
          </button>
        </nav>
      </>
    );
  } else {
    body = <ChapterAccordion chapters={chapters} openId={collapsed ? null : view} onToggle={toggle} />;
  }

  return (
    <div className="rq-playbook">
      <header className="rq-playbook__head">
        <div>
          <h1 className="rq-display rq-playbook__title">Playbook</h1>
          <p className="rq-playbook__sub">{isDesktop ? 'Every rule in the game, in one place' : 'Every rule in the game'}</p>
        </div>
        {!isDesktop && <span className="rq-playbook__count">{CHAPTER_IDS.length} ch</span>}
      </header>

      {/* Permanent live region: texten monteras först när live-siffrorna saknas. */}
      <div role="status" aria-label="Playbook numbers" className="rq-playbook__notice">
        {usingDefaults && (
          <p className="rq-playbook-note">
            Showing the standard numbers — the live settings could not be loaded.{' '}
            <button type="button" className="rq-btn rq-btn--link rq-playbook-note__retry" onClick={() => void configQuery.refetch()} disabled={configQuery.isFetching}>
              {configQuery.isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </p>
        )}
      </div>

      {body}
    </div>
  );
}
