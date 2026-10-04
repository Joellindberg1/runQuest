import type { EventItem } from '@runquest/shared';
import {
  dateRangeText, dayLabel, formatClock, formatCountdown, formatEventValue, formatMinKm, stockholmDate, weekdayOf, windowText,
} from './eventsFormat';

// Vymodeller för Events: vad som är öppet, vad som kommer, mitt facit och historikraderna. Rena funktioner — `now` skickas in.
// Spelets regler (verkliga, inte prototypens placeholder): ett participation-event ger XP direkt när en runda klarar minimidistansen
// inom fönstret; ett competition-event rankar gruppen på total km/höjdmeter och betalar topp tre när veckan avräknas.
// Events dras slumpmässigt kvällen före — det finns inget framtida "schema", så "This week" visar bara det som faktiskt är schemalagt.

/** Sökparametern för historikens sida (ADR 006: historiken sidas med ?page=). */
export const PAGE_PARAM = 'page';
/** Historiksidor om sex rader, som designens pager. */
export const HISTORY_PAGE_SIZE = 6;
/** Mitt facit läser hela historiken i sidor om 50 (endpointens max) — högst så här många sidor. */
export const RECORD_PAGE_SIZE = 50;
export const RECORD_MAX_PAGES = 10;

export type EventKind = EventItem['type'];
export type EventPhase = 'upcoming' | 'open' | 'ended';

const KIND_LABEL: Record<EventKind, string> = { participation: 'Participation', competition: 'Competition' };

/**
 * Ett event som startat räknas som öppet även om backend ännu inte flyttat det från "scheduled" (cron var 5:e minut;
 * checkEventQualification gör samma tolkning). `ended` = fönstret har passerat men eventet är inte avräknat än.
 */
export function eventPhase(event: Pick<EventItem, 'startsAt' | 'endsAt'>, now: Date): EventPhase {
  const nowMs = now.getTime();
  if (nowMs < Date.parse(event.startsAt)) return 'upcoming';
  if (nowMs >= Date.parse(event.endsAt)) return 'ended';
  return 'open';
}

export type ChipTone = 'tag' | 'reward' | 'done';

export interface EventChip {
  key: string;
  label: string;
  /** `tag` = fakta (bara desktop, mobilen har regeln som text), `reward` = värdetagg, `done` = jag har tagit eventet. */
  tone: ChipTone;
}

export interface BoardRow {
  userId: string;
  rank: number;
  name: string;
  mine: boolean;
  value: string;
  /** "+100 XP" för plats 1–3 när priset är större än noll. */
  prize: string | null;
}

export interface OpenCard {
  id: string;
  kind: EventKind;
  kindLabel: string;
  name: string;
  /** Regeln ordagrant ur databasen (template.description). */
  rule: string;
  chips: EventChip[];
  countdown: string;
  ringLabel: string;
  /** Andel av fönstret som återstår (0–1) — ringens fyllnad. */
  ringFraction: number;
  /** "4 of 6 done" (participation). */
  doneText: string | null;
  doneFraction: number | null;
  /** Jag har klarat eventet (participation). */
  mineDone: boolean;
  /** Fönstret har passerat, avräkningen väntar (competition). */
  settling: boolean;
  board: BoardRow[] | null;
  boardNote: string | null;
}

export interface UpNextCard {
  id: string;
  kind: EventKind;
  kindLabel: string;
  name: string;
  rule: string;
  /** Mobilens enrader: "3 km · 18:00–22:00 · +25 XP". */
  facts: string;
  chips: EventChip[];
  countdown: string;
}

export interface WeekRow {
  id: string;
  kind: EventKind;
  kindLabel: string;
  day: string;
  name: string;
  rule: string;
  reward: string | null;
}

export interface EventsView {
  open: OpenCard[];
  /** Antal event vars fönster pågår nu. */
  openCount: number;
  upNext: UpNextCard | null;
  week: WeekRow[];
}

const startMs = (event: EventItem): number => Date.parse(event.startsAt);
const endMs = (event: EventItem): number => Date.parse(event.endsAt);

/** `requires_weather` är en text eller en lista beroende på hur raden är sparad — båda blir en lista taggar. */
export function weatherTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

/** Antal som tagit/deltagit, aldrig fler än gruppen (före detta medlemmar har kvar sina entries). */
export const takenCount = (event: Pick<EventItem, 'participantCount' | 'memberCount'>): number =>
  Math.min(event.participantCount, event.memberCount);

function rewardLabel(event: EventItem): string | null {
  const { template } = event;
  if (event.type === 'participation') return template.rewardXp > 0 ? `+${template.rewardXp} XP` : null;
  return template.rewardXp1st > 0 ? `Up to ${template.rewardXp1st} XP` : null;
}

function prizeFor(event: EventItem, rank: number): string | null {
  const xp = [event.template.rewardXp1st, event.template.rewardXp2nd, event.template.rewardXp3rd][rank - 1] ?? 0;
  return xp > 0 ? `+${xp} XP` : null;
}

function buildBoard(event: EventItem): BoardRow[] {
  return (event.leaderboard ?? [])
    .map((row, index) => ({ row, rank: row.rank ?? index + 1 }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ row, rank }) => ({
      userId: row.userId,
      rank,
      // Backend skickar "Du" för mig — UI:t är engelskt.
      name: row.isMe ? 'You' : row.userName,
      mine: row.isMe,
      value: formatEventValue(event.metric, row.totalValue),
      prize: prizeFor(event, rank),
    }));
}

function openChips(event: EventItem, done: boolean): EventChip[] {
  const { template } = event;
  const chips: EventChip[] = [];
  if (event.type === 'participation') {
    if (template.minKm > 0) chips.push({ key: 'min', label: `Min ${formatMinKm(template.minKm)}`, tone: 'tag' });
    chips.push({ key: 'closes', label: `Closes ${formatClock(event.endsAt)}`, tone: 'tag' });
  } else {
    chips.push({ key: 'metric', label: event.metric === 'km' ? 'Total distance' : 'Total elevation', tone: 'tag' });
    chips.push({ key: 'ends', label: `Ends ${weekdayOf(stockholmDate(event.endsAt))} ${formatClock(event.endsAt)}`, tone: 'tag' });
  }
  weatherTags(template.requiresWeather).forEach((weather) => chips.push({ key: `weather-${weather}`, label: weather, tone: 'tag' }));
  const reward = rewardLabel(event);
  if (done) {
    const earned = event.myEntry?.xpAwarded ?? template.rewardXp;
    chips.push({ key: 'reward', label: `Done · +${earned} XP`, tone: 'done' });
  } else if (reward) {
    chips.push({ key: 'reward', label: reward, tone: 'reward' });
  }
  return chips;
}

function buildOpenCard(event: EventItem, now: Date, phase: EventPhase): OpenCard {
  const isParticipation = event.type === 'participation';
  const settling = phase === 'ended';
  const total = endMs(event) - startMs(event);
  const remaining = Math.max(0, endMs(event) - now.getTime());
  const mineDone = isParticipation && !!event.myEntry?.qualified;

  return {
    id: event.id,
    kind: event.type,
    kindLabel: KIND_LABEL[event.type].toLowerCase(),
    name: event.template.name,
    rule: event.template.description,
    chips: openChips(event, mineDone),
    countdown: settling ? 'Final' : formatCountdown(remaining),
    ringLabel: settling ? 'settling soon' : 'left to run',
    ringFraction: settling || total <= 0 ? 0 : Math.min(1, remaining / total),
    doneText: isParticipation && event.memberCount > 0 ? `${takenCount(event)} of ${event.memberCount} done` : null,
    doneFraction: isParticipation && event.memberCount > 0 ? takenCount(event) / event.memberCount : null,
    mineDone,
    settling,
    board: isParticipation ? null : buildBoard(event),
    boardNote: isParticipation || event.myEntry ? null : 'You are not on the board yet — log a run this week to enter.',
  };
}

function buildUpNext(event: EventItem, now: Date): UpNextCard {
  const { template } = event;
  const reward = rewardLabel(event);
  const facts = [
    event.type === 'participation' && template.minKm > 0 ? formatMinKm(template.minKm) : null,
    windowText(event.startsAt, event.endsAt),
    reward ? reward.replace(/^Up to/, 'up to') : null,
  ].filter((part): part is string => part !== null);

  const chips: EventChip[] = [];
  if (event.type === 'participation' && template.minKm > 0) chips.push({ key: 'min', label: `Min ${formatMinKm(template.minKm)}`, tone: 'tag' });
  if (event.type === 'competition') chips.push({ key: 'metric', label: event.metric === 'km' ? 'Total distance' : 'Total elevation', tone: 'tag' });
  weatherTags(template.requiresWeather).forEach((weather) => chips.push({ key: `weather-${weather}`, label: weather, tone: 'tag' }));
  if (reward) chips.push({ key: 'reward', label: reward, tone: 'reward' });

  return {
    id: event.id,
    kind: event.type,
    kindLabel: KIND_LABEL[event.type].toLowerCase(),
    name: template.name,
    rule: template.description,
    facts: facts.join(' · '),
    chips,
    countdown: formatCountdown(Math.max(0, startMs(event) - now.getTime())),
  };
}

function buildWeekRow(event: EventItem, now: Date): WeekRow {
  return {
    id: event.id,
    kind: event.type,
    kindLabel: KIND_LABEL[event.type],
    day: dayLabel(event.startsAt, now),
    name: event.template.name,
    rule: event.template.description,
    reward: rewardLabel(event),
  };
}

/**
 * Öppet nu (participation före competition, sedan efter slutdatum), "Up next" = det som öppnar först och "This week" =
 * resten som är schemalagt. Ett participation-event som passerat sitt slut hålls utanför — det avräknas inom fem minuter
 * och dyker då upp i historiken; ett competition-event väntar på söndagens avräkning och visas som "settling".
 */
export function buildEventsView(events: readonly EventItem[], now: Date): EventsView {
  const open: Array<{ event: EventItem; phase: EventPhase }> = [];
  const upcoming: EventItem[] = [];

  for (const event of events) {
    const phase = eventPhase(event, now);
    if (phase === 'upcoming') upcoming.push(event);
    else if (phase === 'open' || event.type === 'competition') open.push({ event, phase });
  }

  open.sort((a, b) => Number(a.event.type === 'competition') - Number(b.event.type === 'competition') || endMs(a.event) - endMs(b.event));
  upcoming.sort((a, b) => startMs(a) - startMs(b));

  return {
    open: open.map(({ event, phase }) => buildOpenCard(event, now, phase)),
    openCount: open.filter(({ phase }) => phase === 'open').length,
    upNext: upcoming[0] ? buildUpNext(upcoming[0], now) : null,
    week: upcoming.slice(1).map((event) => buildWeekRow(event, now)),
  };
}

export interface RecordView {
  /** Participation-event jag klarat / alla avslutade participation-event. */
  taken: number;
  total: number;
  fraction: number;
  /** All XP jag fått från events (participation + tävlingspriser). */
  earned: number;
  /** XP för de participation-event jag missade. */
  left: number;
}

/**
 * "Your record" (all-time — begreppet "season" finns inte i datamodellen, ägarbeslut 2). Räknar över alla avslutade event
 * i gruppen; null när inget participation-event avslutats än.
 */
export function buildRecord(history: readonly EventItem[]): RecordView | null {
  let taken = 0;
  let total = 0;
  let earned = 0;
  let left = 0;

  for (const event of history) {
    const xp = event.myEntry?.xpAwarded ?? 0;
    if (event.type === 'participation') {
      total += 1;
      if (event.myEntry?.qualified) {
        taken += 1;
        earned += xp > 0 ? xp : event.template.rewardXp;
      } else {
        left += event.template.rewardXp;
      }
    } else if (event.myEntry) {
      earned += xp;
    }
  }

  return total === 0 ? null : { taken, total, fraction: taken / total, earned, left };
}

export type HistoryTone = 'up' | 'down' | 'muted' | 'rank-1' | 'rank-2' | 'rank-3';

export interface HistoryRow {
  id: string;
  name: string;
  kind: EventKind;
  /** "21 Aug · 4 of 6 finished" */
  meta: string;
  status: string;
  tone: HistoryTone;
  xp: string;
}

function resultOf(event: EventItem): Pick<HistoryRow, 'status' | 'tone' | 'xp'> {
  const entry = event.myEntry;
  if (event.type === 'participation') {
    if (!entry?.qualified) return { status: 'Missed', tone: 'down', xp: '—' };
    return { status: '✓ Done', tone: 'up', xp: `+${entry.xpAwarded ?? event.template.rewardXp} XP` };
  }
  if (!entry) return { status: 'Missed', tone: 'down', xp: '—' };
  const xp = entry.xpAwarded && entry.xpAwarded > 0 ? `+${entry.xpAwarded} XP` : '—';
  if (entry.rank === null) return { status: 'Entered', tone: 'muted', xp };
  const tone: HistoryTone = entry.rank <= 3 ? (`rank-${entry.rank}` as HistoryTone) : 'muted';
  return { status: `#${entry.rank}`, tone, xp };
}

export function buildHistoryRows(events: readonly EventItem[]): HistoryRow[] {
  return events.map((event) => {
    const date = dateRangeText(event.startsAt, event.endsAt);
    const counted = event.memberCount > 0 ? ` · ${takenCount(event)} of ${event.memberCount} ${event.type === 'participation' ? 'finished' : 'entered'}` : '';
    return { id: event.id, name: event.template.name, kind: event.type, meta: `${date}${counted}`, ...resultOf(event) };
  });
}

/** Sidnumret ur `?page=` — ett positivt heltal, annars sida 1. */
export function parsePage(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 ? page : 1;
}

export const pageCount = (total: number, perPage = HISTORY_PAGE_SIZE): number => Math.max(1, Math.ceil(total / perPage));

export type PagerItem = { kind: 'page'; page: number } | { kind: 'gap'; key: string };

const PAGER_FULL_UP_TO = 7;

/** 1 2 3 … 9 när det får plats, annars första, sista och grannarna till aktuell sida med luckor emellan. */
export function pagerItems(current: number, pages: number): PagerItem[] {
  if (pages <= PAGER_FULL_UP_TO) return Array.from({ length: pages }, (_, index) => ({ kind: 'page', page: index + 1 }));
  const wanted = new Set([1, pages, current - 1, current, current + 1].filter((page) => page >= 1 && page <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const items: PagerItem[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) items.push({ kind: 'gap', key: `gap-${page}` });
    items.push({ kind: 'page', page });
  });
  return items;
}

/** Rubrikens underrad: "1 open now · 4 of 12 taken" (desktop: "… taken all-time"). */
export function summaryText(openCount: number, record: RecordView | null, isDesktop: boolean): string {
  const parts = [openCount > 0 ? `${openCount} open now` : 'Nothing open now'];
  if (record) parts.push(`${record.taken} of ${record.total} taken${isDesktop ? ' all-time' : ''}`);
  return parts.join(' · ');
}
