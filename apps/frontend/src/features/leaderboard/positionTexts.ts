// En sanning för positionstexterna. Profilens och leaderboardens vymodell skriver samma saker om samma svar: den pågående veckan, tankstrecket
// för en vecka före inträdet (skrivet, talat och förklarat) och en placering som #N. Veckoetiketterna och perioden ("week 27–34") ägs av
// positionWeekLabels; den här modulen äger resten av texterna så att ingen modell formulerar egna.

/** Den pågående veckan, överallt där den nämns. */
export const CURRENT_WEEK_PHRASE = 'this week so far';

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

/** "Week 34 is this week so far." Veckan är den talade etiketten ur positionWeekLabels ("week 34", "week 1, 2027"). */
export function currentWeekSentence(spokenWeek: string): string {
  return `${spokenWeek.charAt(0).toUpperCase()}${spokenWeek.slice(1)} is ${CURRENT_WEEK_PHRASE}.`;
}
