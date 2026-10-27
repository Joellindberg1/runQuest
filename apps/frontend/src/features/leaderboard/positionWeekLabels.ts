import type { PositionWeek } from '@runquest/shared';

export interface PositionWeekLabel {
  /** Det som ritas: "W27". */
  visual: string;
  /** Det skärmläsaren får: "week 27", och "week 53, 2026" när perioden korsar ISO-årsskiftet. */
  spoken: string;
}

export interface PositionWeekLabels {
  /** Parallell med veckorna som skickades in. */
  labels: PositionWeekLabel[];
  /** Intervalltexten: "week 27–34", "week 50, 2026 – week 4, 2027" över årsskiftet, "week 34" för en vecka, '' utan veckor. */
  range: string;
}

type LabelledWeek = Pick<PositionWeek, 'iso_week' | 'iso_year'>;

/**
 * ENDA stället som gör veckoetiketter av `iso_week`/`iso_year` (API:t skickar ingen etikett). Antalet veckor styrs av svaret, aldrig av
 * antalet som begärdes: en period kortare än åtta veckor (ny grupp, beskurna förledande veckor) ger exakt de veckor som finns.
 * Året nämns i skärmläsartexten bara när perioden korsar ISO-årsskiftet, och då på varje etikett så att texten är jämn.
 */
export function positionWeekLabels(weeks: ReadonlyArray<LabelledWeek>): PositionWeekLabels {
  if (weeks.length === 0) return { labels: [], range: '' };
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const crossesYear = weeks.some((week) => week.iso_year !== first.iso_year);
  const spoken = (week: LabelledWeek) => (crossesYear ? `week ${week.iso_week}, ${week.iso_year}` : `week ${week.iso_week}`);

  const labels = weeks.map((week) => ({ visual: `W${week.iso_week}`, spoken: spoken(week) }));
  if (weeks.length === 1) return { labels, range: spoken(first) };
  const range = crossesYear ? `${spoken(first)} – ${spoken(last)}` : `week ${first.iso_week}–${last.iso_week}`;
  return { labels, range };
}
