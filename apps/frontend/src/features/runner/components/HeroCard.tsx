import type { BadgeShowcaseEntry } from '@runquest/shared';
import { BadgeMinis } from '@/features/badges/components/BadgeMinis';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { formatInt } from '@/shared/utils/format';
import type { RunnerHero, StatCell } from '../runnerModel';
import { xpToNextText } from '../runnerModel';
import { CellGrid, LevelRing } from './RunnerParts';

interface HeroCardProps {
  hero: RunnerHero;
  cells: StatCell[];
  /** De visade badges (max tre) — minis efter namnet. Tom/utelämnad: ingenting ritas. */
  showcase?: readonly BadgeShowcaseEntry[];
}

/**
 * Hjältekortet på sidan (`.rq-card--hero`): nivåring, namn (+ badge-minis) · rank · rundor · XP kvar, och statcellerna i hårlinjegrid.
 * Minisen är ett eget element efter h1:an, så rubriken förblir bara namnet; BadgeMinis bär själv role="img" och etiketten.
 * Popupen har en egen banner (`PopupBanner`) med Head to head i en panel; det här är mobilens och direktladdningens kort, med CHALLENGES kvar.
 */
export function HeroCard({ hero, cells, showcase = [] }: HeroCardProps) {
  // Web Prototype har fem celler, App Prototype tre: samma brytpunkt som skalet (ADR 006).
  const wide = useIsDesktop() === true;
  const visible = cells.filter((cell) => wide || !cell.wideOnly);
  const standing = [hero.rank === null ? null : `#${hero.rank} in the group`, `${formatInt(hero.runs)} ${hero.runs === 1 ? 'run' : 'runs'}`].filter(Boolean).join(' · ');

  return (
    <section className="rq-card rq-card--hero rq-runner-hero" aria-label="Runner">
      <div className="rq-runner-hero__id">
        <LevelRing hero={hero} />
        <div className="rq-runner-hero__who">
          <div className="rq-runner-hero__nameline">
            <h1 className="rq-display rq-runner-hero__name" tabIndex={-1}>{hero.name}</h1>
            <BadgeMinis showcase={showcase} />
          </div>
          <p className="rq-runner-hero__meta">{standing}</p>
          <p className="rq-runner-hero__xp">{xpToNextText(hero)}</p>
        </div>
      </div>

      <CellGrid cells={visible} variant="cells" />
    </section>
  );
}
