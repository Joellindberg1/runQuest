import { cssVars } from '@/features/leaderboard/cssVars';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { formatInt } from '@/features/leaderboard/boardFormat';
import type { RunnerHero, StatCell } from '../runnerModel';
import { xpToNextText } from '../runnerModel';

interface HeroCardProps {
  hero: RunnerHero;
  cells: StatCell[];
}

/** Hjältekortet (`.rq-card--hero`): nivåring, namn · rank · rundor · XP kvar, och statcellerna i hårlinjegrid. */
export function HeroCard({ hero, cells }: HeroCardProps) {
  // Web Prototype har fem celler, App Prototype tre: samma brytpunkt som skalet (ADR 006).
  const wide = useIsDesktop() === true;
  const visible = cells.filter((cell) => wide || !cell.wideOnly);
  const percent = Math.round(hero.ringTurn * 100);
  const ringLabel = hero.nextLevel === null
    ? `Level ${hero.level}, max level`
    : `Level ${hero.level}, ${percent}% of the way to level ${hero.nextLevel}`;
  const standing = [hero.rank === null ? null : `#${hero.rank} in the group`, `${formatInt(hero.runs)} runs`].filter(Boolean).join(' · ');

  return (
    <section className="rq-card rq-card--hero rq-runner-hero" aria-label="Runner">
      <div className="rq-runner-hero__id">
        <div className="rq-ring rq-runner-ring" role="img" aria-label={ringLabel} style={cssVars({ '--rq-ring-p': `${hero.ringTurn}turn` })}>
          <div className="rq-ring-hole">
            <span className="rq-runner-ring__level">{hero.level}</span>
            <span className="rq-runner-ring__caption">level</span>
          </div>
        </div>
        <div className="rq-runner-hero__who">
          <h1 className="rq-display rq-runner-hero__name">{hero.name}</h1>
          <p className="rq-runner-hero__meta">{standing}</p>
          <p className="rq-runner-hero__xp">{xpToNextText(hero)}</p>
        </div>
      </div>

      <dl className="rq-hairgrid rq-runner-cells">
        {visible.map((cell) => (
          <div key={cell.key} className="rq-runner-cell" data-cell={cell.key}>
            <dt className="rq-runner-cell__label">{cell.label}</dt>
            <dd className="rq-runner-cell__value" data-tone={cell.tone}>{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
