import type { BadgeShowcaseEntry } from '@runquest/shared';
import { BadgeMinis } from '@/features/badges/components/BadgeMinis';
import { formatInt } from '@/shared/utils/format';
import type { HeadToHeadSource } from '../hooks/useRunnerPanelData';
import { xpToNextText, type RunnerHero, type StatCell } from '../runnerModel';
import { HeadToHeadBanner } from './HeadToHeadBanner';
import { CellGrid, LevelRing } from './RunnerParts';

/** Popupens fyra statceller. CHALLENGES hör bara till sidans hjältekort: totalrekordet i popupen bor i Overviews Fun facts. */
const POPUP_CELL_KEYS: ReadonlySet<StatCell['key']> = new Set(['xp', 'km', 'runs', 'titles']);

interface PopupBannerProps {
  hero: RunnerHero;
  cells: StatCell[];
  /** De visade badges (högst tre, ur samma hämtning som BADGES-panelen). */
  showcase: readonly BadgeShowcaseEntry[];
  /** Head to head-panelen uppe till höger; null utan inloggad, och panelen utelämnas. */
  headToHead: HeadToHeadSource | null;
}

/**
 * Profil-popupens banner (ADR 006 punkt 4): nivåring, namn med högst tre badge-minis, "#1 in the group · 159 runs · 363 XP to level 25" på en rad, statraden
 * (TOTAL XP · TOTAL KM · RUNS · TITLES HELD) och Head to head i en egen panel uppe till höger. Mobilens och direktladdningens hjältekort är `HeroCard` och har kvar CHALLENGES;
 * den här filen ligger i popupens chunk, så ingångs-chunken inte växer med popupens egen layout.
 */
export function PopupBanner({ hero, cells, showcase, headToHead }: PopupBannerProps) {
  const standing = [
    hero.rank === null ? null : `#${hero.rank} in the group`,
    `${formatInt(hero.runs)} ${hero.runs === 1 ? 'run' : 'runs'}`,
    xpToNextText(hero),
  ].filter(Boolean).join(' · ');

  return (
    <section className="rq-card rq-card--hero rq-runner-hero rq-runner-hero--popup" aria-label="Runner">
      <LevelRing hero={hero} />
      <div className="rq-runner-hero__who">
        <div className="rq-runner-hero__nameline">
          <h1 className="rq-display rq-runner-hero__name">{hero.name}</h1>
          <BadgeMinis showcase={showcase} />
        </div>
        <p className="rq-runner-hero__meta">{standing}</p>
        <CellGrid cells={cells.filter((cell) => POPUP_CELL_KEYS.has(cell.key))} variant="cells" />
      </div>
      {headToHead && <HeadToHeadBanner {...headToHead} />}
    </section>
  );
}
