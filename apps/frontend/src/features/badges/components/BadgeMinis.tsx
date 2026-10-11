import { BADGE_SERIES, type BadgeShowcaseEntry } from '@runquest/shared';
import { BadgeEmblem } from './BadgeEmblem';
import { tierName } from './badgeTier';

const SERIES_NAMES = new Map<string, string>(BADGE_SERIES.map((series) => [series.key, series.name]));

/** "Rare Milestoner" — samma etikett som ett enskilt emblem får, så gruppen och emblemet säger likadant. */
function miniLabel({ series, tier }: BadgeShowcaseEntry): string {
  return [tierName(tier), SERIES_NAMES.get(series) ?? series].filter(Boolean).join(' ');
}

interface BadgeMinisProps {
  /** De visade badges i användarens ordning (modellen har redan skurit till max 3 och släppt okända poster). */
  showcase: readonly BadgeShowcaseEntry[];
}

/**
 * Minis-gruppen på Board-raderna (spec §4 F5, Council 13): sm-emblem inline. Gruppen är ETT element med `role="img"` och en samlad etikett
 * ("Badges: Rare Milestoner, Epic Climber"); varje mini är dekorativ, så skärmläsaren läser raden en gång. Ingen platshållare utan showcase.
 * Layouten (inline-flex, glapp, krymper inte) bor i board.css där gruppen placeras.
 */
export function BadgeMinis({ showcase }: BadgeMinisProps) {
  if (showcase.length === 0) return null;
  return (
    <span className="rq-badge-minis" role="img" aria-label={`Badges: ${showcase.map(miniLabel).join(', ')}`}>
      {showcase.map((entry) => (
        <BadgeEmblem key={entry.series} series={entry.series} tier={entry.tier} size="sm" decorative />
      ))}
    </span>
  );
}
