import type { PositionHistoryResponse, PositionRunner } from '@runquest/shared';
import { getInitials } from '@/shared/utils/formatters';
import { firstName } from '@/shared/utils/format';
import { positionWeekLabels } from './positionWeekLabels';
import { CURRENT_WEEK_PHRASE, NOT_IN_GROUP_FOOTNOTE, NO_FINISHED_WEEK_MESSAGE, currentWeekSentence, placementText, spokenPlacementText, spokenRange } from './positionTexts';

// Vymodellen för leaderboardens positionsgraf (Position-fliken). Ren: ingen React, ingen klocka och ingen färg per löpare (komponenten väljer
// guld för `isMe`, neutralt för resten och ca 25 % opacitet för `dimmed`). Tiden, veckorna och ordningen kommer ur svaret.
//
// ORDNING OCH TIE-BREAK: svarets `runners` är redan i Standings ordning (xp fallande, därefter namn, därefter id = `compareXpStandings` i
// packages/shared/src/rankPasses.ts, som servern placerar med i buildPositionHistory). Modellen sorterar därför ALDRIG själv; linjer,
// "Current order" och tabell behåller svarets ordning, och ingen delar rad.
//
// ANTALET VECKOR: `weeks.length` kan vara 1–26 (servern beskär förledande veckor utan närvarande). Inget här antar åtta.

/** Marginal över första och under sista raden, så slutpunktens bild och guldlinjens tjocklek får plats. */
const CHART_PADDING = 16;
/** Golv: aldrig tätare rader än så, hur många löpare det än är (namnen vid linjeslutet får aldrig överlappa). */
const MIN_ROW_HEIGHT = 24;
/** Radavstånd i px, ur den godkända prototypen: luftigt för en liten flock, tätare men läsbart för en stor. Höjden växer, grafen scrollar aldrig. */
const ROW_HEIGHT = {
  mobile: { few: 34, many: 33 },
  desktop: { few: 44, many: 27 },
} as const;
/** Upp till så här många löpare räknas som en liten flock. */
const FEW_RUNNERS = 6;

export type PositionChartMode =
  /** Rita grafen. */
  | 'chart'
  /** Färre än två löpare, eller ett svar utan veckor: ingen flik att visa (ADR 007 B11). */
  | 'hidden'
  /** Två eller fler löpare men bara den pågående veckan: ingen linje att dra än, klienten förklarar. */
  | 'no-finished-week';

export interface ChartWeek {
  /** "W27". */
  visual: string;
  /** "week 27", med år när perioden korsar ISO-årsskiftet. */
  spoken: string;
  /** Andel av bredden (0 äldsta veckan, 1 pågående): samma x som punkterna för veckan, för veckoetiketterna. */
  x: number;
  isCurrent: boolean;
}

/** En rad i rutnätet. */
export interface GridRow {
  /** 1-baserad placering. */
  position: number;
  /** Rad i px, där punkterna för placeringen ligger. */
  y: number;
}

export interface ChartGeometry {
  /** Avstånd i px mellan två placeringar. */
  rowHeight: number;
  /** Marginal i px över första och under sista raden. */
  padding: number;
  /** Total höjd i px = chartHeight(löpare, mobil). */
  height: number;
}

interface ChartPointBase {
  /** Index i `weeks`. */
  weekIndex: number;
  /** 1-baserad placering. */
  position: number;
  /** Andel av bredden, 0 (äldsta veckan) till 1 (pågående vecka). */
  x: number;
  /** Rad i px från toppen av grafytan. */
  y: number;
}

export type ChartPoint =
  | (ChartPointBase & { kind: 'dot' })
  | (ChartPointBase & { kind: 'hollow' })
  | (ChartPointBase & { kind: 'endpoint'; pictureUrl: string | null; initials: string });

export type EndpointPoint = Extract<ChartPoint, { kind: 'endpoint' }>;

export interface ChartLine {
  id: string;
  /** Fullt namn (tabellen och skärmläsartexten). */
  name: string;
  /** Förnamnet: det som står vid linjeslutet och i legenden. */
  label: string;
  /** Den inloggades linje: guld och tjock i komponenten. */
  isMe: boolean;
  selected: boolean;
  /** Vald löpare finns och det är inte den här: komponenten ger ca 25 % opacitet. */
  dimmed: boolean;
  /** Live-placeringen (sista elementet) = Standings; null bara om svaret saknar den. */
  position: number | null;
  /** Rad i px för namnet vid linjeslutet (den pågående veckans rad); null utan live-placering. */
  labelY: number | null;
  /** Från första placeringen och framåt, äldst först. Avslutade veckor är `dot`, sista avslutade är `endpoint`, den pågående är `hollow`. */
  points: ChartPoint[];
  /** Bild eller initialer i slutet av den sista avslutade veckan; null om löparen inte har någon placering där. Samma objekt som i `points`. */
  endpoint: EndpointPoint | null;
}

export interface OrderEntry {
  id: string;
  name: string;
  initials: string;
  pictureUrl: string | null;
  /** Live-placeringen; null bara om svaret saknar den. */
  position: number | null;
  isMe: boolean;
  selected: boolean;
  dimmed: boolean;
  /** Veckoetiketten ("W32") för första placeringen, eller null när löparen är placerad från början av perioden. */
  firstPlacedWeek: string | null;
  /** Kom in under den pågående veckan: ingen avslutad vecka har någon placering för hen. */
  isNewcomer: boolean;
}

export interface TableColumn {
  /** "W27". */
  weekLabel: string;
  spoken: string;
  /** Kolumnrubriken: veckoetiketten, men "this week so far" för den pågående. */
  header: string;
  isCurrent: boolean;
}

export interface TableCell {
  /** "#3", eller "—" när löparen inte hade någon placering. */
  text: string;
  /** Det skärmläsaren får: "#3", eller "not in the group yet" i stället för tankstrecket. */
  spokenText: string;
  position: number | null;
  isCurrent: boolean;
}

export interface TableRow {
  id: string;
  /** Fullt namn. */
  name: string;
  isMe: boolean;
  cells: TableCell[];
}

export interface PositionTableModel {
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
  /** Minst en cell är "—": komponenten förklarar tankstrecket. */
  hasEmptyCells: boolean;
  /** "— = not in the group yet" när minst en cell är "—", annars null. */
  footnote: string | null;
}

export interface PositionChartModel {
  mode: PositionChartMode;
  /** Förklaringen som visas i stället för grafen när läget är `no-finished-week`, annars null. */
  message: string | null;
  /** Vald löpares id, annars null. */
  selectedId: string | null;
  weeks: ChartWeek[];
  /** "week 27–34", över årsskiftet "week 50, 2026 – week 4, 2027". */
  range: string;
  /** Samma period för skärmläsaren (aria-label och captionen): "weeks 27 to 34", över årsskiftet "week 52, 2026 to week 1, 2027". */
  spokenRange: string;
  geometry: ChartGeometry;
  /** Rutnätet och axeltalen: en rad per placering 1..antal löpare. Tom vid `hidden`. */
  gridRows: GridRow[];
  /** En per löpare i svarets ordning (= Standings). Tom när det inte finns något att rita. */
  lines: ChartLine[];
  /** Id:n i ritordning: övriga i svarets ordning, sedan den inloggade, sist den valda, så de syns ovanpå. */
  paintOrder: string[];
  /** "Current order": samma löpare i samma ordning som `lines`. */
  order: OrderEntry[];
  /** Null när läget är `hidden`. */
  table: PositionTableModel | null;
  /** Texten för `role="img"`: perioden, den pågående veckan och varje löpares placering med fullt namn. */
  ariaLabel: string;
}

export interface PositionChartOptions {
  /** Den inloggades id. Null = ingen linje är markerad som egen. */
  meId: string | null;
  mobile: boolean;
  /** Förvald löpare; okänt id ignoreras. */
  selectedId?: string | null;
}

const countOf = (runners: number | ReadonlyArray<unknown>) => (typeof runners === 'number' ? runners : runners.length);

/** Radavstånd i px för en graf med så här många löpare. Aldrig under MIN_ROW_HEIGHT. */
export function rowSpacing(runners: number | ReadonlyArray<unknown>, mobile: boolean): number {
  const set = mobile ? ROW_HEIGHT.mobile : ROW_HEIGHT.desktop;
  return Math.max(MIN_ROW_HEIGHT, countOf(runners) <= FEW_RUNNERS ? set.few : set.many);
}

/** Grafens höjd i px: höjden växer med antalet löpare så att radavståndet hålls och ingen scroll behövs. */
export function chartHeight(runners: number | ReadonlyArray<unknown>, mobile: boolean): number {
  return 2 * CHART_PADDING + Math.max(0, countOf(runners) - 1) * rowSpacing(runners, mobile);
}

/** Samma id igen avmarkerar; ett annat id flyttar markeringen. */
function toggledSelection(current: string | null, id: string): string | null {
  return current === id ? null : id;
}

/** Ritordning: övriga först (stabilt, i svarets ordning), sedan den inloggade, sist den valda. */
function paintOrderOf(lines: ReadonlyArray<ChartLine>): string[] {
  const weight = (line: ChartLine) => (line.selected ? 2 : line.isMe ? 1 : 0);
  return [...lines].sort((a, b) => weight(a) - weight(b)).map((line) => line.id);
}

/** Andel av bredden för en vecka (0 äldst, 1 pågående). EN formel för punkterna och veckoetiketterna, så de aldrig glider isär. */
function weekX(weekIndex: number, weekCount: number): number {
  return weekCount <= 1 ? 1 : weekIndex / (weekCount - 1);
}

/** Rad i px för en placering. EN formel för punkterna, namnen vid linjeslutet och rutnätet. */
function rowY(position: number, geometry: ChartGeometry): number {
  return geometry.padding + (position - 1) * geometry.rowHeight;
}

function chartPoints(runner: PositionRunner, weekCount: number, geometry: ChartGeometry): ChartPoint[] {
  const lastIndex = weekCount - 1;
  const initials = getInitials(runner.name);
  const points: ChartPoint[] = [];
  runner.positions.forEach((position, weekIndex) => {
    if (position === null) return;
    const base = {
      weekIndex,
      position,
      x: weekX(weekIndex, weekCount),
      y: rowY(position, geometry),
    };
    if (weekIndex === lastIndex) points.push({ ...base, kind: 'hollow' });
    else if (weekIndex === lastIndex - 1) points.push({ ...base, kind: 'endpoint', pictureUrl: runner.profile_picture, initials });
    else points.push({ ...base, kind: 'dot' });
  });
  return points;
}

/** Bygger hela vymodellen ur svaret. Se filhuvudet för ordning och antal veckor. */
export function buildPositionChart(data: PositionHistoryResponse, options: PositionChartOptions): PositionChartModel {
  const { runners } = data;
  const weekCount = data.weeks.length;
  const finishedCount = Math.max(0, weekCount - 1);
  const { labels, range } = positionWeekLabels(data.weeks);
  const speech = spokenRange(data.weeks);
  const weeks: ChartWeek[] = labels.map((label, i) => ({ ...label, x: weekX(i, weekCount), isCurrent: i === weekCount - 1 }));

  const mode: PositionChartMode = runners.length < 2 || weekCount === 0 ? 'hidden' : finishedCount === 0 ? 'no-finished-week' : 'chart';
  const geometry: ChartGeometry = {
    rowHeight: rowSpacing(runners, options.mobile),
    padding: CHART_PADDING,
    height: chartHeight(runners, options.mobile),
  };
  const selectedId = options.selectedId && runners.some((r) => r.user_id === options.selectedId) ? options.selectedId : null;
  const isDimmed = (id: string) => selectedId !== null && id !== selectedId;

  const drawn = mode === 'chart';
  const lines: ChartLine[] = drawn
    ? runners.map((runner) => {
        const points = chartPoints(runner, weekCount, geometry);
        const live = runner.positions[weekCount - 1] ?? null;
        return {
          id: runner.user_id,
          name: runner.name,
          label: firstName(runner.name),
          isMe: runner.user_id === options.meId,
          selected: runner.user_id === selectedId,
          dimmed: isDimmed(runner.user_id),
          position: live,
          labelY: live === null ? null : rowY(live, geometry),
          points,
          endpoint: points.find((p): p is EndpointPoint => p.kind === 'endpoint') ?? null,
        };
      })
    : [];

  const order: OrderEntry[] =
    mode === 'hidden'
      ? []
      : runners.map((runner) => {
          const firstIndex = runner.positions.findIndex((p) => p !== null);
          const live = runner.positions[weekCount - 1] ?? null;
          return {
            id: runner.user_id,
            name: runner.name,
            initials: getInitials(runner.name),
            pictureUrl: runner.profile_picture,
            position: live,
            isMe: runner.user_id === options.meId,
            selected: runner.user_id === selectedId,
            dimmed: isDimmed(runner.user_id),
            firstPlacedWeek: firstIndex > 0 ? weeks[firstIndex].visual : null,
            isNewcomer: finishedCount > 0 && live !== null && runner.positions.slice(0, finishedCount).every((p) => p === null),
          };
        });

  const hasEmptyCells = runners.some((runner) => weeks.some((_, i) => (runner.positions[i] ?? null) === null));
  const table: PositionTableModel | null =
    mode === 'hidden'
      ? null
      : {
          caption: `Position per week, ${speech}. ${currentWeekSentence(weeks[weekCount - 1].spoken)}`,
          columns: weeks.map((week) => ({
            weekLabel: week.visual,
            spoken: week.spoken,
            header: week.isCurrent ? CURRENT_WEEK_PHRASE : week.visual,
            isCurrent: week.isCurrent,
          })),
          rows: runners.map((runner) => ({
            id: runner.user_id,
            name: runner.name,
            isMe: runner.user_id === options.meId,
            cells: weeks.map((week, i) => ({
              text: placementText(runner.positions[i] ?? null),
              spokenText: spokenPlacementText(runner.positions[i] ?? null),
              position: runner.positions[i] ?? null,
              isCurrent: week.isCurrent,
            })),
          })),
          hasEmptyCells,
          footnote: hasEmptyCells ? NOT_IN_GROUP_FOOTNOTE : null,
        };

  const standing = (runner: PositionRunner) => {
    const live = runner.positions[weekCount - 1] ?? null;
    return `${runner.name}${runner.user_id === options.meId ? ' (you)' : ''} ${live === null ? '(no placement)' : `#${live}`}`;
  };
  const lastWeek = weeks[weekCount - 1];
  const ariaLabel =
    mode === 'hidden'
      ? ''
      : `Position over time, ${speech}. ${currentWeekSentence(lastWeek.spoken)} ${runners.map(standing).join(', ')}.`;

  const gridRows: GridRow[] = mode === 'hidden' ? [] : runners.map((_, k) => ({ position: k + 1, y: rowY(k + 1, geometry) }));

  return { mode, message: mode === 'no-finished-week' ? NO_FINISHED_WEEK_MESSAGE : null, selectedId, weeks, range, spokenRange: speech, geometry, gridRows, lines, paintOrder: paintOrderOf(lines), order, table, ariaLabel };
}

/**
 * Markerar löparen (övriga blir `dimmed`); samma id igen avmarkerar. Ett okänt id ändrar ingenting. Bygger om från de redan
 * beräknade raderna, så svaret behövs inte igen.
 */
export function selectRunner(model: PositionChartModel, id: string): PositionChartModel {
  if (!model.order.some((entry) => entry.id === id)) return model;
  const selectedId = toggledSelection(model.selectedId, id);
  const mark = <T extends { id: string }>(item: T) => ({ ...item, selected: item.id === selectedId, dimmed: selectedId !== null && item.id !== selectedId });
  const lines = model.lines.map(mark);
  return { ...model, selectedId, lines, order: model.order.map(mark), paintOrder: paintOrderOf(lines) };
}
