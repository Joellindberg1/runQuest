import type { RQIconName } from '@/shared/components/icons';
import type { GroupEligibilityEntry, TitleLeaderboard } from '@/shared/services/backendApi';
import { TITLE_CATEGORIES, categoryOf, iconOf, type TitleCategoryId } from './titleCategories';
import { hasLinearGap, resolveGenderedTitle, titleValueText, unlockText } from './titleFormat';

// Titles-skärmens vymodeller: allt skärmen visar, härlett ur /titles/leaderboard + /titles/group-eligibility.
// Titelnamn, regler och värden kommer ur databasen. Ren logik — ingen DOM, ingen datahämtning.

export const TITLE_FILTERS = ['all', 'mine', 'unclaimed'] as const;
export type TitleFilter = (typeof TITLE_FILTERS)[number];
export const TITLE_FILTER_PARAM = 'filter';

export const MAX_DISPLAYED = 3;
const CHASE_LIMIT = 3;

// ─── Titelrader ───────────────────────────────────────────────────────────────

export interface TitleRunnerUp {
  position: number;
  name: string;
  value: string;
  mine: boolean;
}

export interface TitleRow {
  id: string;
  name: string;
  /** titles.description — titelns regel, ordagrant ur databasen. */
  rule: string;
  icon: RQIconName;
  categoryId: TitleCategoryId;
  state: 'mine' | 'held' | 'unclaimed';
  holder: { name: string; value: string; mine: boolean } | null;
  /** Position 2–3 ur runners_up, sorterade. */
  runnersUp: TitleRunnerUp[];
  /** Bara för olåsta titlar: den som ligger närmast (även under tröskeln). */
  bestSoFar: { name: string; value: string } | null;
  /** "7 runs" — vad som krävs för att låsa upp; bara för olåsta titlar. */
  unlock: string | null;
}

/** Högst värde > 0 för måttet bland gruppens löpare. Värdena är sorteringskodade (högre = bättre) för alla mått. */
export function bestSoFar(metricKey: string | undefined, eligibility: GroupEligibilityEntry[]): { name: string; value: number } | null {
  if (!metricKey) return null;
  let best: { name: string; value: number } | null = null;
  for (const entry of eligibility) {
    const value = entry.values?.[metricKey];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    if (!best || value > best.value) best = { name: entry.name, value };
  }
  return best;
}

export function buildTitleRow(title: TitleLeaderboard, eligibility: GroupEligibilityEntry[], meId: string | null): TitleRow {
  const metric = title.metric_key;
  const holderIsMe = !!title.holder && title.holder.user_id === meId;

  const runnersUp = [...(title.runners_up ?? [])]
    .filter((runner) => runner.position === 2 || runner.position === 3)
    .sort((a, b) => a.position - b.position)
    .map((runner) => ({
      position: runner.position,
      name: runner.user_name,
      value: titleValueText(metric, runner.value),
      mine: runner.user_id === meId,
    }));

  const best = title.holder ? null : bestSoFar(metric, eligibility);

  return {
    id: title.id,
    name: resolveGenderedTitle(title.name, title.holder?.user_gender),
    rule: title.description,
    icon: iconOf(metric),
    categoryId: categoryOf(metric),
    state: !title.holder ? 'unclaimed' : holderIsMe ? 'mine' : 'held',
    holder: title.holder ? { name: title.holder.user_name, value: titleValueText(metric, title.holder.value), mine: holderIsMe } : null,
    runnersUp: title.holder ? runnersUp : [],
    bestSoFar: best ? { name: best.name, value: titleValueText(metric, best.value) } : null,
    unlock: title.holder ? null : unlockText(metric, title.unlock_requirement),
  };
}

// ─── Grupper och filter ───────────────────────────────────────────────────────

export interface TitleGroup {
  id: TitleCategoryId;
  label: string;
  icon: RQIconName;
  /** "3 titles" / "1 title" */
  count: string;
  rows: TitleRow[];
}

export interface TitlesView {
  /** Antal titlar i spel (alla, oavsett filter). */
  inPlay: number;
  /** Titlar jag håller (alla, oavsett filter). */
  held: number;
  /** Grupper efter filtret; tomma grupper utelämnas. */
  groups: TitleGroup[];
  /** Alla rader oavsett filter (visningspanelen slår upp valda titlar här). */
  rows: TitleRow[];
}

const countText = (count: number) => `${count} ${count === 1 ? 'title' : 'titles'}`;

function passesFilter(row: TitleRow, filter: TitleFilter): boolean {
  if (filter === 'mine') return row.state === 'mine';
  if (filter === 'unclaimed') return row.state === 'unclaimed';
  return true;
}

export function buildTitlesView(
  board: TitleLeaderboard[],
  eligibility: GroupEligibilityEntry[],
  meId: string | null,
  filter: TitleFilter,
): TitlesView {
  const rows = board.map((title) => buildTitleRow(title, eligibility, meId));

  const groups = TITLE_CATEGORIES.map((category) => {
    const groupRows = rows.filter((row) => row.categoryId === category.id && passesFilter(row, filter));
    return { id: category.id, label: category.label, icon: category.icon, count: countText(groupRows.length), rows: groupRows };
  }).filter((group) => group.rows.length > 0);

  return { inPlay: rows.length, held: rows.filter((row) => row.state === 'mine').length, groups, rows };
}

/** "21 in play · you hold 5" — på desktop med "· 3 on display" (Web-prototypen). */
export function summaryText(view: Pick<TitlesView, 'inPlay' | 'held'>, onDisplay: number | null): string {
  const base = `${view.inPlay} in play · you hold ${view.held}`;
  return onDisplay === null ? base : `${base} · ${onDisplay} on display`;
}

// ─── Visning på leaderboarden (max 3) ─────────────────────────────────────────

export interface DisplayedRow {
  id: string;
  position: number;
  name: string;
  value: string;
}

/** Id:n på titlar jag håller. */
export function heldTitleIds(board: TitleLeaderboard[], meId: string | null): string[] {
  return board.filter((title) => !!meId && title.holder?.user_id === meId).map((title) => title.id);
}

/** Valet städat: bara titlar jag fortfarande håller, högst tre, utan dubbletter, i vald ordning. */
export function cleanSelection(selected: readonly string[], heldIds: readonly string[]): string[] {
  const held = new Set(heldIds);
  return selected.filter((id, index) => held.has(id) && selected.indexOf(id) === index).slice(0, MAX_DISPLAYED);
}

/** Lägger till (om det finns plats) eller tar bort en titel i valet. */
export function toggleDisplayed(selected: readonly string[], heldIds: readonly string[], id: string): string[] {
  const clean = cleanSelection(selected, heldIds);
  if (clean.includes(id)) return clean.filter((candidate) => candidate !== id);
  if (!heldIds.includes(id) || clean.length >= MAX_DISPLAYED) return clean;
  return [...clean, id];
}

export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function buildDisplayedRows(selected: readonly string[], rows: readonly TitleRow[]): DisplayedRow[] {
  return selected.flatMap((id, index) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row?.holder ? [{ id, position: index + 1, name: row.name, value: row.holder.value }] : [];
  });
}

const OVERFLOW_NAME = 'The one with too many names to mention!';

/** Så visas valet på leaderboarden (samma regler som Board-kortets titelrad). */
export function formatDisplayPreview(names: readonly string[], totalHeld: number): string {
  if (names.length === 0) return 'No titles selected';
  const last = names[names.length - 1];
  const init = names.slice(0, -1);
  if (totalHeld > MAX_DISPLAYED) {
    return names.length === 1 ? `${last} & ${OVERFLOW_NAME}` : `${init.join(', ')}, ${last} & ${OVERFLOW_NAME}`;
  }
  return names.length === 1 ? last : `${init.join(', ')} & ${last}`;
}

// ─── Closest chase (desktop) ──────────────────────────────────────────────────

export type ChaseKind = 'behind' | 'ahead' | 'unclaimed';

export interface Chase {
  titleId: string;
  title: string;
  /** Avståndet i måttets enhet ("4 runs"). */
  gap: string;
  kind: ChaseKind;
  /** En mening om vem det gäller. */
  who: string;
}

/**
 * De närmaste jakterna, närmast först: titlar där jag är #2/#3 (avståndet till innehavaren), titlar jag håller där någon
 * ligger precis bakom, och olåsta titlar jag är på väg mot. Närhet = avståndet relativt det jämförda värdet, så "4 runs"
 * och "3.1 km" går att ställa mot varandra. Mått där en differens inte är läsbar (tider, datum) hoppas över.
 */
export function buildChases(board: TitleLeaderboard[], eligibility: GroupEligibilityEntry[], meId: string | null): Chase[] {
  if (!meId) return [];
  const mine = eligibility.find((entry) => entry.userId === meId);
  const candidates: Array<{ chase: Chase; closeness: number }> = [];

  for (const title of board) {
    const metric = title.metric_key;
    if (!hasLinearGap(metric)) continue;
    const name = resolveGenderedTitle(title.name, title.holder?.user_gender);
    const add = (kind: ChaseKind, gap: number, reference: number, who: string) => {
      if (!(gap > 0) || !(reference > 0)) return;
      candidates.push({ chase: { titleId: title.id, title: name, gap: titleValueText(metric, gap), kind, who }, closeness: gap / reference });
    };

    if (title.holder && title.holder.user_id !== meId) {
      const me = title.runners_up?.find((runner) => runner.user_id === meId);
      if (me) add('behind', title.holder.value - me.value, title.holder.value, `${title.holder.user_name} is ahead of you`);
    } else if (title.holder) {
      const next = [...(title.runners_up ?? [])].sort((a, b) => a.position - b.position)[0];
      if (next) add('ahead', title.holder.value - next.value, title.holder.value, `${next.user_name} is closest behind you`);
    } else {
      const mineValue = metric ? mine?.values?.[metric] : undefined;
      const unlock = unlockText(metric, title.unlock_requirement);
      if (typeof mineValue === 'number' && unlock && mineValue > 0) {
        add('unclaimed', title.unlock_requirement - mineValue, title.unlock_requirement, `Unclaimed — ${unlock} unlocks it`);
      }
    }
  }

  return candidates
    .sort((a, b) => a.closeness - b.closeness || a.chase.title.localeCompare(b.chase.title))
    .slice(0, CHASE_LIMIT)
    .map((candidate) => candidate.chase);
}
