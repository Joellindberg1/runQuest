// En sanning för positionstexterna. Profilens och leaderboardens vymodell skriver samma saker om samma svar: den pågående veckan, tankstrecket
// för en vecka före inträdet (skrivet, talat och förklarat) och en placering som #N. Veckoetiketterna och den synliga perioden ("week 27–34")
// ägs av positionWeekLabels; den här modulen äger resten av texterna, också den talade perioden, så att ingen modell formulerar egna.

import { crossesIsoYear, positionWeekLabels, type LabelledWeek } from './positionWeekLabels';

/** Den pågående veckan, överallt där den nämns. */
export const CURRENT_WEEK_PHRASE = 'this week so far';

/** Gruppen har bara den pågående veckan: ingen linje att dra än. Profilens och leaderboardens vy säger samma sak. */
export const NO_FINISHED_WEEK_MESSAGE = 'No finished week yet. Position shows where you stood at the end of each week.';

/** Tecknet för en vecka före inträdet i gruppen. */
export const NOT_IN_GROUP_DASH = '—';
/** Det skärmläsaren får i stället för tankstrecket. */
export const NOT_IN_GROUP_SPOKEN = 'not in the group yet';
/** Fotnoten som förklarar tankstrecket, när tabellen har ett. */
export const NOT_IN_GROUP_FOOTNOTE = `${NOT_IN_GROUP_DASH} = ${NOT_IN_GROUP_SPOKEN}`;

/** "#3", eller tankstrecket för en vecka utan placering. */
export function placementText(position: number | null): string {
  return position === null ? NOT_IN_GROUP_DASH : `#${position}`;
}

/** "#3", eller "not in the group yet" för en vecka utan placering. */
export function spokenPlacementText(position: number | null): string {
  return position === null ? NOT_IN_GROUP_SPOKEN : `#${position}`;
}

/**
 * Perioden som skärmläsaren får: "weeks 27 to 34", över årsskiftet "week 52, 2026 to week 1, 2027", en enda vecka "week 34", inga veckor ''.
 * Den visuella formen med tankstreck ("week 27–34", `range` ur positionWeekLabels) läses olika av olika skärmläsare och används bara på ytan.
 */
export function spokenRange(weeks: ReadonlyArray<LabelledWeek>): string {
  if (weeks.length === 0) return '';
  const { labels } = positionWeekLabels(weeks);
  if (weeks.length === 1) return labels[0].spoken;
  if (crossesIsoYear(weeks)) return `${labels[0].spoken} to ${labels[labels.length - 1].spoken}`;
  return `weeks ${weeks[0].iso_week} to ${weeks[weeks.length - 1].iso_week}`;
}

/** "Week 34 is this week so far." Veckan är den talade etiketten ur positionWeekLabels ("week 34", "week 1, 2027"). */
export function currentWeekSentence(spokenWeek: string): string {
  return `${spokenWeek.charAt(0).toUpperCase()}${spokenWeek.slice(1)} is ${CURRENT_WEEK_PHRASE}.`;
}
