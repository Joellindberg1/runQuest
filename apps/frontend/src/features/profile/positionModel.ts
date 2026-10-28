import type { PositionHistoryResponse } from '@runquest/shared';
import { positionWeekLabels } from '@/features/leaderboard/positionWeekLabels';
import { CURRENT_WEEK_PHRASE, NOT_IN_GROUP_FOOTNOTE, NO_FINISHED_WEEK_MESSAGE, currentWeekSentence, placementText, spokenPlacementText, spokenRange } from '@/features/leaderboard/positionTexts';

// Vymodellen för profilens positionsgraf (ADR 007 addendum 2026-10-26, punkt 1): axel, Best/Lowest/Now, lägen och texter.
// Ren: ingen React, ingen klocka (tiden kommer från svaret), inga färger. Komponenten ritar bara det här. Antalet veckor styrs av
// svaret (1–26), veckoetiketterna och perioden kommer ur positionWeekLabels, texterna för den pågående veckan och tankstrecket ur
// positionTexts (delade med leaderboardens modell) och modellen räknar ingen egen kalender.

export const NEW_RUNNER_MESSAGE = 'First week in the group. Position appears after your first week';

/** Den som dras: kolumn = veckoindex (0 = äldsta), position = 1-baserad placering. */
export interface PositionPoint {
  column: number;
  position: number;
}

export interface PositionColumn {
  /** "W27", det som ritas under grafen. */
  visual: string;
  /** "week 27", det skärmläsaren får. */
  spoken: string;
  /** Sant för sista kolumnen = den pågående veckan. */
  current: boolean;
}

/** Axelns spann i placeringar (inga siffror ritas på axeln; siffran bärs av dotten). */
export interface PositionAxis {
  /** Översta raden = bästa placeringen på axeln. */
  first: number;
  last: number;
  /** last − first + 1, minst 3 utom för en grupp på två. */
  rows: number;
}

export interface PositionDot extends PositionPoint {
  /** Radens index från toppen: position − axis.first. */
  row: number;
  /** Fylld guld: en avslutad vecka på plats 1. */
  filled: boolean;
  /** Guldring på alla dottar. */
  ring: boolean;
  /** Ihålig: den pågående veckan (live). */
  hollow: boolean;
}

export interface PositionLine {
  /** Heldragen linje genom de avslutade veckorna med placering, från första veckan med placering. */
  solid: PositionPoint[];
  /** Streckad etapp från sista avslutade placeringen till live-placeringen. */
  dashed: { from: PositionPoint; to: PositionPoint };
}

export interface PositionBest {
  position: number;
  /** Antal avslutade veckor på bästa placeringen. */
  weeks: number;
  /** Antal avslutade veckor med placering. */
  ofWeeks: number;
  /** "Best #1 · 6 of 7 weeks". */
  text: string;
}

export interface PositionStats {
  best: PositionBest;
  /** Sämsta placeringen (högsta siffran) på en avslutad vecka. */
  lowest: { position: number; text: string };
  /** Live-placeringen, sista elementet. */
  now: { position: number; text: string };
}

export interface PositionTableRow {
  /** "W27". */
  week: string;
  /** "week 27". */
  spoken: string;
  position: number | null;
  /** "#3", eller tankstreck för en vecka före inträdet. */
  text: string;
  /** Det skärmläsaren får: "#3" eller "not in the group yet". */
  spokenText: string;
  current: boolean;
  /** "this week so far" för den pågående veckan, annars null. */
  note: string | null;
}

export interface PositionGraphModel {
  mode: 'ready';
  columns: PositionColumn[];
  /** Den synliga perioden (eyebrowen): "week 27–34", över årsskiftet "week 50, 2026 – week 4, 2027". */
  range: string;
  /** Samma period som skärmläsaren får (meningen och captionen): "weeks 27 to 34", över årsskiftet "week 52, 2026 to week 1, 2027". */
  spokenRange: string;
  axis: PositionAxis;
  /** Antal rutnätsrader (en per placering på axeln). */
  gridRows: number;
  dots: PositionDot[];
  line: PositionLine;
  stats: PositionStats;
  /** Textalternativet i en mening, även grafens tillgängliga namn. */
  summary: string;
  /** Raderna bakom "Show as table". */
  table: PositionTableRow[];
  /** Tabellens caption: "Position per week, weeks 27 to 34. Week 34 is this week so far." */
  tableCaption: string;
  /** "— = not in the group yet" när tabellen har tankstreck, annars null. */
  tableFootnote: string | null;
  /** "W34 · this week so far", förklaringen till den ihåliga dotten. */
  legend: string;
}

export type PositionProfileModel =
  | { mode: 'hidden' }
  | { mode: 'new-runner'; message: string }
  | { mode: 'no-finished-week'; message: string }
  | PositionGraphModel;

const MIN_AXIS_ROWS = 3;

/** min−1 .. max+1 av de visade placeringarna, klampat till [1, N] och minst tre rader (en grupp på två får två). */
function axisFor(shown: number[], groupSize: number): PositionAxis {
  let first = Math.max(1, Math.min(...shown) - 1);
  let last = Math.max(first, Math.min(groupSize, Math.max(...shown) + 1));
  // Utvidga nedåt först (högre siffror), sedan uppåt när gruppens botten är nådd.
  while (last - first + 1 < MIN_AXIS_ROWS) {
    if (last < groupSize) last += 1;
    else if (first > 1) first -= 1;
    else break;
  }
  return { first, last, rows: last - first + 1 };
}

/**
 * Bygger profilens positionsgraf för en löpare ur positions-svaret. Lägen: `hidden` (färre än två medlemmar, ingen löpare eller ingen
 * live-placering, inga veckor), `no-finished-week` (bara den pågående veckan), `new-runner` (ingen placering på någon avslutad vecka)
 * och `ready`.
 */
export function buildPositionProfileModel(history: PositionHistoryResponse, userId: string): PositionProfileModel {
  const { weeks, runners } = history;
  const me = runners.find((runner) => runner.user_id === userId);
  if (runners.length < 2 || !me || weeks.length === 0) return { mode: 'hidden' };

  const positions = weeks.map((_, i) => me.positions[i] ?? null);
  const liveColumn = weeks.length - 1;
  const live = positions[liveColumn];
  if (live === null) return { mode: 'hidden' };
  if (weeks.length === 1) return { mode: 'no-finished-week', message: NO_FINISHED_WEEK_MESSAGE };

  const finished: PositionPoint[] = [];
  positions.slice(0, liveColumn).forEach((position, column) => {
    if (position !== null) finished.push({ column, position });
  });
  if (finished.length === 0) return { mode: 'new-runner', message: NEW_RUNNER_MESSAGE };

  const finishedPositions = finished.map((point) => point.position);
  const bestPosition = Math.min(...finishedPositions);
  const lowestPosition = Math.max(...finishedPositions);
  const bestWeeks = finishedPositions.filter((position) => position === bestPosition).length;
  const ofWeeks = finishedPositions.length;
  const stats: PositionStats = {
    best: {
      position: bestPosition,
      weeks: bestWeeks,
      ofWeeks,
      text: `Best #${bestPosition} · ${bestWeeks} of ${ofWeeks} ${ofWeeks === 1 ? 'week' : 'weeks'}`,
    },
    lowest: { position: lowestPosition, text: `Lowest #${lowestPosition}` },
    now: { position: live, text: `Now #${live}` },
  };

  const axis = axisFor([...finishedPositions, live], runners.length);
  const { labels, range } = positionWeekLabels(weeks);
  const columns: PositionColumn[] = labels.map((label, column) => ({ ...label, current: column === liveColumn }));

  const dots: PositionDot[] = [];
  positions.forEach((position, column) => {
    if (position === null) return;
    const isLive = column === liveColumn;
    dots.push({ column, position, row: position - axis.first, filled: !isLive && position === 1, ring: true, hollow: isLive });
  });

  const lastFinished = finished[finished.length - 1];
  const line: PositionLine = { solid: finished, dashed: { from: lastFinished, to: { column: liveColumn, position: live } } };

  const firstPlaced = positions.findIndex((position) => position !== null);
  const from = firstPlaced > 0 ? `, from ${labels[firstPlaced].spoken}` : '';
  const parts = positions.flatMap((position, column) => {
    if (position === null) return [];
    return column === liveColumn ? [`${CURRENT_WEEK_PHRASE} #${position}`] : [`${labels[column].spoken} #${position}`];
  });
  const spokenPeriod = spokenRange(weeks);
  const summary = `Position in the group, ${spokenPeriod}${from}: ${parts.join(', ')}`;
  const hasDashes = positions.some((position) => position === null);

  const table: PositionTableRow[] = positions.map((position, column) => ({
    week: labels[column].visual,
    spoken: labels[column].spoken,
    position,
    text: placementText(position),
    spokenText: spokenPlacementText(position),
    current: column === liveColumn,
    note: column === liveColumn ? CURRENT_WEEK_PHRASE : null,
  }));

  return {
    mode: 'ready',
    columns,
    range,
    spokenRange: spokenPeriod,
    axis,
    gridRows: axis.rows,
    dots,
    line,
    stats,
    summary,
    table,
    tableCaption: `Position per week, ${spokenPeriod}. ${currentWeekSentence(labels[liveColumn].spoken)}`,
    tableFootnote: hasDashes ? NOT_IN_GROUP_FOOTNOTE : null,
    legend: `${labels[liveColumn].visual} · ${CURRENT_WEEK_PHRASE}`,
  };
}
