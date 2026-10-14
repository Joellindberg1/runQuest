import { ACTIVITY_TYPES, BADGE_SERIES, MS_DAY, TIER_NAMES, classifyNotification, daysBetween, isActivityType, isKindEnabled, mondayOf, stockholmClock, type ActivityType, type ClassifiableRow, type NewsItem, type NewsMeta } from '@runquest/shared';
import type { ChallengeMetric } from '@runquest/types';
import { isEarnedTier } from '@/features/badges/components/badgeTier';
import type { RQIconName } from '@/shared/components/icons';
import { logger } from '@/shared/utils/logger';
import { deltaText, durationLongText, firstName, metricLabel } from '@/features/challenges/duelsFormat';
import { formatClock, stockholmDate, weekdayOf } from '@/features/events/eventsFormat';
import { formatInt } from '@/features/log/logFormat';
import { SHORT_MONTHS } from '@/features/profile/profileFormat';
import { resolveGenderedTitle, titleValueText } from '@/features/titles/titleFormat';

// Pack News (ADR 008): raden är ett FAKTUM (typ + payload) — texten renderas här ur typ, payload och vem som tittar
// ("took … from you" när target är den som tittar). Allt är ren logik med `now` som parameter, så dag-gruppering,
// tider och texter går att testa med fasta klockslag. Engelskt UI i en-GB, egna månads- och veckodagsnamn.

// ─── Kategorier och filter ──────────────────────────────────────────────────

export type NewsCategory = 'title' | 'challenge' | 'level' | 'event' | 'streak' | 'release';

/**
 * Kategorin styr ikon, färg och kant. run_milestone hör till Levels (ADR 008: Levels = level_up + run_milestone), liksom
 * badge_earned (ADR 009 beslut 5, F7: kanten förblir Levels-grön). release_published (RUN-161) är en systemhändelse med en
 * egen kategori utan filterchip: raden syns när inget filter är valt.
 */
export const CATEGORY_OF: Record<ActivityType, NewsCategory> = {
  title_unlocked: 'title',
  title_taken: 'title',
  title_revoked: 'title',
  challenge_received: 'challenge',
  challenge_won: 'challenge',
  challenge_draw: 'challenge',
  level_up: 'level',
  run_milestone: 'level',
  streak_broken: 'streak',
  event_open: 'event',
  event_closed: 'event',
  badge_earned: 'level',
  release_published: 'release',
};

/** Ikonerna ur runquest-icons (prototypens `kinds`). */
export const CATEGORY_ICON: Record<NewsCategory, RQIconName> = {
  title: 'crown',
  challenge: 'swords',
  level: 'zap',
  event: 'calendar',
  streak: 'flame',
  release: 'sparkles',
};

export type NewsFilterKey = 'titles' | 'challenges' | 'events' | 'levels' | 'badges' | 'streaks';

export interface NewsFilter {
  key: NewsFilterKey;
  label: string;
  category: NewsCategory;
  /** Chipets egen ikon när den ska skilja sig från kategorins (Badges delar Levels-färg men ritar `shield`). */
  icon?: RQIconName;
  /** Typerna som chipet släpper igenom — mappas i klienten till `?type=` (ADR 008 beslut 9). */
  types: readonly ActivityType[];
}

export const NEWS_FILTERS: readonly NewsFilter[] = [
  { key: 'titles', label: 'Titles', category: 'title', types: ['title_unlocked', 'title_taken', 'title_revoked'] },
  { key: 'challenges', label: 'Challenges', category: 'challenge', types: ['challenge_received', 'challenge_won', 'challenge_draw'] },
  { key: 'events', label: 'Events', category: 'event', types: ['event_open', 'event_closed'] },
  { key: 'levels', label: 'Levels', category: 'level', types: ['level_up', 'run_milestone'] },
  { key: 'badges', label: 'Badges', category: 'level', icon: 'shield', types: ['badge_earned'] },
  { key: 'streaks', label: 'Streaks', category: 'streak', types: ['streak_broken'] },
];

/** Sökparametern för filtret: chip-nycklar, kommaseparerade (`?type=titles,levels`). Tom = allt. */
export const FILTER_PARAM = 'type';

/** Okända nycklar och dubbletter faller bort; ordningen är chipens (så att adressen är kanonisk). */
export function parseFilterParam(raw: string | null | undefined): NewsFilterKey[] {
  const wanted = new Set((raw ?? '').split(',').map((part) => part.trim()));
  const keys = NEWS_FILTERS.filter((filter) => wanted.has(filter.key)).map((filter) => filter.key);
  // Alla chip valda = inget filter alls.
  return keys.length === NEWS_FILTERS.length ? [] : keys;
}

export function serializeFilterParam(keys: readonly NewsFilterKey[]): string | null {
  const canonical = parseFilterParam(keys.join(','));
  return canonical.length === 0 ? null : canonical.join(',');
}

export function toggleFilter(current: readonly NewsFilterKey[], key: NewsFilterKey): NewsFilterKey[] {
  const next = current.includes(key) ? current.filter((existing) => existing !== key) : [...current, key];
  return parseFilterParam(next.join(','));
}

/** De valda chipsens typer i ACTIVITY_TYPES-ordning (stabil query-nyckel). null = ingen filtrering. */
export function typesForFilters(keys: readonly NewsFilterKey[]): ActivityType[] | null {
  if (keys.length === 0) return null;
  const allowed = new Set(NEWS_FILTERS.filter((filter) => keys.includes(filter.key)).flatMap((filter) => filter.types));
  return ACTIVITY_TYPES.filter((type) => allowed.has(type));
}

export const typeParamOf = (types: readonly ActivityType[] | null): string | undefined => (types && types.length > 0 ? types.join(',') : undefined);

/**
 * En rad med en händelsetyp den här klienten inte känner (backend nyare än fliken). Typen kommer som string från API:t —
 * `NewsItem` lovar bara de kända — så anropare som tar emot svaret rått typar mot `WireNewsItem`.
 */
export type UnknownNewsItem = Omit<NewsItem, 'type' | 'payload'> & { type: string; payload: unknown };
export type WireNewsItem = NewsItem | UnknownNewsItem;

/** Typvakt: raden är en av de kända händelsetyperna (och därmed typad per payload). */
export const isKnownNewsItem = (item: WireNewsItem): item is NewsItem => isActivityType(item.type);

/** Antal rader per chip i det laddade fönstret (ADR 008: chip-räknare = antal i det laddade fönstret). Okända typer räknas inte. */
export function countByFilter(items: readonly Pick<WireNewsItem, 'type'>[]): Record<NewsFilterKey, number> {
  const counts: Record<NewsFilterKey, number> = { titles: 0, challenges: 0, events: 0, levels: 0, badges: 0, streaks: 0 };
  for (const item of items) {
    if (!isActivityType(item.type)) continue;
    const type = item.type;
    const filter = NEWS_FILTERS.find((candidate) => candidate.types.includes(type));
    if (filter) counts[filter.key] += 1;
  }
  return counts;
}

// ─── Flödet: sidor, kursor, deduplicering ───────────────────────────────────

export interface NewsFeed {
  /** id fallande, deduplicerade. */
  items: WireNewsItem[];
  /**
   * unread_count och last_seen_id följer det senaste svaret; has_more/next_before beskriver flödets ÄLDRE kant
   * (det som "Show more" fortsätter från).
   */
  meta: NewsMeta;
}

export interface NewsPage {
  items: WireNewsItem[];
  meta: NewsMeta;
}

export const NEWS_PAGE_SIZE = 30;
/** Hämtningar per catch-up när glappet är större än en sida (`after` ger bara de nyaste N). */
export const NEWS_CATCH_UP_LIMIT = 100;
export const NEWS_MAX_GAP_PAGES = 5;

/** Första förekomsten av varje id vinner; ordningen id fallande. */
export function dedupeById<T extends { id: number }>(items: readonly T[]): T[] {
  const seen = new Set<number>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique.sort((a, b) => b.id - a.id);
}

export const feedFromPage = (page: NewsPage): NewsFeed => ({ items: dedupeById(page.items), meta: page.meta });

/** Högsta id vi känner till i flödet (catch-upens `after`, och det "Mark all read" kvitterar). */
export const topIdOf = (items: readonly Pick<NewsItem, 'id'>[]): number | null => (items.length === 0 ? null : Math.max(...items.map((item) => item.id)));

/**
 * Luckan mellan det vi känner till och nuläget fylls med upprepade `?before=next_before` (ADR 008 addendum 4: `after` ger de
 * nyaste N inom intervallet och has_more/next_before beskriver de äldre inom det). Klienten stannar vid sitt kända id —
 * en sida som nått det (äldsta id ≤ kända) eller som är sista (has_more falskt) är slutet. Null = klart.
 */
export function gapCursor(page: NewsPage, knownTopId: number): number | null {
  if (!page.meta.has_more || page.meta.next_before === null) return null;
  const oldest = page.items.length > 0 ? Math.min(...page.items.map((item) => item.id)) : null;
  if (oldest === null || oldest <= knownTopId) return null;
  return page.meta.next_before;
}

/**
 * Nyare rader in i flödet. `complete` = luckan är helt fylld → slå ihop (dedupe) och behåll den äldre kanten.
 * Annars (fler nya rader än catch-upen orkar hämta) ersätts fönstret med det vi fick, och `meta` (sista sidans) bär den äldre
 * kanten: hellre ett kortare flöde än ett med hål i mitten.
 */
export function mergeNewer(feed: NewsFeed, fetched: readonly WireNewsItem[], meta: NewsMeta, complete: boolean): NewsFeed {
  if (!complete) return { items: dedupeById(fetched), meta };
  return {
    items: dedupeById([...fetched, ...feed.items]),
    meta: { ...feed.meta, unread_count: meta.unread_count, last_seen_id: meta.last_seen_id },
  };
}

/**
 * Fönstret kom i fokus: den nyaste sidan ersätter motsvarande del av flödet HELT (catch-up kan bara lägga till — en retractad rad, t.ex. en
 * utmaning som drogs tillbaka, ligger annars kvar). Rader äldre än sidan behålls. Är sidan hela flödet (inget has_more) ersätts allt.
 */
export function replaceNewest(feed: NewsFeed, page: NewsPage): NewsFeed {
  if (page.items.length === 0 || !page.meta.has_more) return feedFromPage(page);
  const oldestInPage = Math.min(...page.items.map((row) => row.id));
  return {
    items: dedupeById([...page.items, ...feed.items.filter((row) => row.id < oldestInPage)]),
    meta: { ...feed.meta, unread_count: page.meta.unread_count, last_seen_id: page.meta.last_seen_id },
  };
}

/** En äldre sida ("Show more") efter flödet. Kanten flyttas till sidans; oläst-siffran är sidans (den är färskast). */
export function appendOlder(feed: NewsFeed, page: NewsPage): NewsFeed {
  return {
    items: dedupeById([...feed.items, ...page.items]),
    meta: { ...page.meta },
  };
}

/** Kvittera allt upp till `upToId`: raderna slutar vara olästa och räknaren sätts (optimistiskt 0, sedan serverns svar). */
export function markSeenInFeed(feed: NewsFeed, upToId: number, unreadCount: number): NewsFeed {
  return {
    items: feed.items.map((item) => (item.id <= upToId && item.is_unread ? { ...item, is_unread: false } : item)),
    meta: { ...feed.meta, unread_count: unreadCount, last_seen_id: Math.max(feed.meta.last_seen_id ?? 0, upToId) },
  };
}

// ─── Läst per rad (ADR 011 beslut 4 och addendum 2026-10-14) ────────────────
// Datalagret exponerar bara `markRead(id)`. Gesterna (hover efter rörelse, tap, Enter/Space) hör till vyerna och använder
// konstanterna härifrån i stället för egna siffror.

/** Väntetiden EFTER en giltig hover innan raden räknas som läst. 0 = direkt; en dröjsmålsregel kan införas utan omdesign. */
export const READ_DWELL_MS = 0;
/** Fönstret efter att listan monterats där `pointerenter` ignoreras, så att en vilande pekare inte markerar raden (något annat än READ_DWELL_MS). */
export const POINTER_SETTLE_MS = 150;
/** Kvitteringarna buntas: högst så här länge väntar nätverksanropet efter det första id:t. UI:t väntar aldrig. */
export const READ_FLUSH_MS = 300;
/** Serverns tak per POST /news/read (1–50 unika id:n). */
export const READ_BATCH_MAX = 50;
/** Hur länge klockans räknare ska stå still innan en minskning annonseras: en svepning över flera rader ger ett tal, inte en tirad. */
export const UNREAD_ANNOUNCE_MS = 500;

/**
 * Kvittera enskilda rader lokalt: bara olästa rader vars id står i `ids` flippas, och räknaren minskar med antalet flippade (aldrig
 * under noll). `unreadCount` (serverns svar) skriver i stället över räknaren. Ingen flippad rad och ingen ny räknare → samma flöde tillbaka.
 * Vattenmärket (`last_seen_id`) rörs inte: det är "Mark all read":s.
 */
export function markReadInFeed(feed: NewsFeed, ids: readonly number[], unreadCount?: number): NewsFeed {
  return setReadInFeed(feed, ids, true, unreadCount);
}

/** Omvändningen av markReadInFeed, för att återställa ett misslyckat anrop: lästa rader i `ids` blir olästa, räknaren sätts till `unreadCount`. */
export function markUnreadInFeed(feed: NewsFeed, ids: readonly number[], unreadCount: number): NewsFeed {
  return setReadInFeed(feed, ids, false, unreadCount);
}

function setReadInFeed(feed: NewsFeed, ids: readonly number[], read: boolean, unreadCount: number | undefined): NewsFeed {
  const wanted = new Set(ids);
  let flipped = 0;
  const items = feed.items.map((row) => {
    if (!wanted.has(row.id) || row.is_unread === !read || row.is_backfill) return row;
    flipped += 1;
    return { ...row, is_unread: !read };
  });
  const count = unreadCount ?? Math.max(0, feed.meta.unread_count - flipped);
  if (flipped === 0 && count === feed.meta.unread_count) return feed;
  return { items: flipped === 0 ? feed.items : items, meta: { ...feed.meta, unread_count: count } };
}

export interface ReadBatcher {
  /** Köa ett id (dubbletter slås ihop). Det första id:t startar fönstret; fler förlänger det inte. */
  add: (id: number) => void;
  /** Skicka allt köat direkt (avmontering) och avbryt timern. */
  flush: () => void;
  hasPending: () => boolean;
}

/**
 * Ren buntning av läs-id:n (ingen React): `send` anropas efter READ_FLUSH_MS eller vid `flush()`, med högst READ_BATCH_MAX id per anrop
 * (fler delas upp i flera anrop, i insättningsordning). Feltolkning av svaren är anroparens sak.
 */
export function createReadBatcher(send: (ids: number[]) => void, flushMs: number = READ_FLUSH_MS): ReadBatcher {
  const queued = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const all = [...queued];
    queued.clear();
    for (let start = 0; start < all.length; start += READ_BATCH_MAX) send(all.slice(start, start + READ_BATCH_MAX));
  };

  return {
    add: (id) => {
      queued.add(id);
      if (timer === null) timer = setTimeout(flush, flushMs);
    },
    flush,
    hasPending: () => queued.size > 0,
  };
}

// ─── Oläst ──────────────────────────────────────────────────────────────────

/** Backfill-rader är aldrig olästa (ADR 008 beslut 8); backend räknar redan så, men raden ska aldrig markeras ändå. */
export const isUnread = (item: Pick<NewsItem, 'is_unread' | 'is_backfill'>): boolean => item.is_unread && !item.is_backfill;

/** Räknaren på klockan: dold vid 0, "99+" över hundra. */
export function badgeText(unreadCount: number): string | null {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return null;
  return unreadCount > 99 ? '99+' : String(Math.floor(unreadCount));
}

export function unreadSummary(unreadCount: number): string {
  return unreadCount > 0 ? `${formatInt(unreadCount)} unread` : 'All caught up';
}

// ─── Tider och dag-gruppering ───────────────────────────────────────────────

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;
const DAYS_BEFORE_DATE = 7;

const dayNumbers = (day: string): [number, number, number] => {
  const [year, month, date] = day.split('-').map(Number);
  return [year, month, date];
};

/** "2 Oct" — med år när det inte är innevarande år ("2 Oct 2025"). */
function dateText(day: string, todayKey: string): string {
  const [year, month, date] = dayNumbers(day);
  const base = `${date} ${SHORT_MONTHS[month - 1]}`;
  return year === dayNumbers(todayKey)[0] ? base : `${base} ${year}`;
}

/** Tiden sedan raden: "now", "12m", "2h", "3d", sedan datum. `long` ger popoverns form: "2h ago", "Yesterday", "2 days ago". */
export function formatAgo(iso: string, now: Date, long = false): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const todayKey = stockholmClock(now).date;
  const dayKey = stockholmDate(iso);
  if (ms < MS_MINUTE) return long ? 'Just now' : 'now';
  if (ms < MS_HOUR) return long ? `${Math.floor(ms / MS_MINUTE)}m ago` : `${Math.floor(ms / MS_MINUTE)}m`;
  if (ms < MS_DAY) return long ? `${Math.floor(ms / MS_HOUR)}h ago` : `${Math.floor(ms / MS_HOUR)}h`;
  const days = Math.max(1, Math.min(daysBetween(dayKey, todayKey), Math.floor(ms / MS_DAY)));
  if (days >= DAYS_BEFORE_DATE) return dateText(dayKey, todayKey);
  if (long) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return `${days}d`;
}

/** "Fri 2 Oct · 14:05" i Stockholm-tid — raden pekar ut sin exakta tid i `title`. */
export function fullTime(iso: string, now: Date): string {
  const day = stockholmDate(iso);
  return `${weekdayOf(day)} ${dateText(day, stockholmClock(now).date)} · ${formatClock(iso)}`;
}

export interface NewsDayGroup<T> {
  /** 'today' · 'yesterday' · 'week' ("Earlier this week") · annars kalenderdagen YYYY-MM-DD. */
  key: string;
  label: string;
  rows: T[];
}

function bucketOf(dayKey: string, todayKey: string): { key: string; label: string } {
  // Ett klockslag i framtiden (klockskev) hör hemma i dag.
  if (dayKey >= todayKey) return { key: 'today', label: 'Today' };
  const days = daysBetween(dayKey, todayKey);
  if (days === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (dayKey >= mondayOf(todayKey)) return { key: 'week', label: 'Earlier this week' };
  return { key: dayKey, label: `${weekdayOf(dayKey)} ${dateText(dayKey, todayKey)}` };
}

/**
 * Raderna i visningsordning (occurred_at fallande, id fallande vid lika) grupperade på Stockholm-dag. Flödet sorteras på id
 * i API:t, men en backfillad rad kan ha högre id och äldre occurred_at — dagen avgör var den hamnar.
 */
export function groupByDay<T extends { occurred_at: string; id: number }>(items: readonly T[], now: Date): NewsDayGroup<T>[] {
  const todayKey = stockholmClock(now).date;
  const ordered = [...items].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id);
  const groups: NewsDayGroup<T>[] = [];
  for (const item of ordered) {
    const bucket = bucketOf(stockholmDate(item.occurred_at), todayKey);
    const last = groups[groups.length - 1];
    if (last && last.key === bucket.key) last.rows.push(item);
    else groups.push({ ...bucket, rows: [item] });
  }
  return groups;
}

// ─── Texter ─────────────────────────────────────────────────────────────────

export interface NewsContext {
  /** Den som tittar — "you" när raden handlar om den personen. */
  viewerId: string | null;
  now: Date;
  /** Namn för användare som bara har ett id i payloaden (event_closed.top). Okänd → utelämnas. */
  nameOf?: (userId: string) => string | null | undefined;
  /** Kön för "The Consistent King/Queen"-titlar. Okänt → namnet lämnas som det är. */
  genderOf?: (userId: string) => string | null | undefined;
}

type UserRef = NewsItem['actor'];

const FORMER_MEMBER = 'a former member';

const isViewer = (ref: UserRef, ctx: NewsContext): boolean => !!ref && ref.id === ctx.viewerId;
/** Subjekt: "You" / "Karl". En raderad användare är "A former member". */
const subject = (ref: UserRef, ctx: NewsContext): string => (isViewer(ref, ctx) ? 'You' : ref ? firstName(ref.name) : 'A former member');
/** Objekt: "you" / "Karl" / "a former member". */
const object = (ref: UserRef, ctx: NewsContext): string => (isViewer(ref, ctx) ? 'you' : ref ? firstName(ref.name) : FORMER_MEMBER);
const possessive = (ref: UserRef, ctx: NewsContext): string => (isViewer(ref, ctx) ? 'Your' : `${ref ? firstName(ref.name) : 'A former member'}'s`);

const withValue = (text: string, formatted: string): string => (formatted === '—' || formatted === '' ? text : `${text} — ${formatted}`);

function titleText(name: string, holder: UserRef, ctx: NewsContext): string {
  return resolveGenderedTitle(name, holder ? ctx.genderOf?.(holder.id) : null);
}

const metricText = (metric: string): string => metricLabel(metric as ChallengeMetric);
const durationText = (days: number): string => durationLongText(days);

function boostWindow(duration: number | null, type: string): string {
  if (duration === null) return '';
  const unit = type === 'multiplier_runs' ? (duration === 1 ? 'run' : 'runs') : duration === 1 ? 'day' : 'days';
  return ` for ${duration} ${unit}`;
}

/** Dagsboostar går att räkna ut; körboostar vet klienten inte hur mycket som är kvar av. */
function boostIsLive(boost: { type: string; delta: number; duration: number | null }, occurredAt: string, now: Date): boolean {
  if (boost.delta === 0 || boost.duration === null) return false;
  if (boost.type === 'multiplier_runs') return false;
  return Date.parse(occurredAt) + boost.duration * MS_DAY > now.getTime();
}

/** Serienamnet ur BADGE_SERIES; en okänd (pensionerad) nyckel visas som den är hellre än som ett tomt ord. */
const badgeSeriesName = (seriesKey: string | null | undefined): string =>
  typeof seriesKey === 'string' && seriesKey !== '' ? (BADGE_SERIES.find((series) => series.key === seriesKey)?.name ?? seriesKey) : 'a badge';
const isTier = (tier: unknown): tier is number => typeof tier === 'number' && Number.isFinite(tier);
/** Tier-namnet ur TIER_NAMES (1-baserat); en okänd tier blir "Tier N". */
const badgeTierName = (tier: number): string => TIER_NAMES[tier - 1] ?? `Tier ${tier}`;

/** "midnight" för 23:59, annars klockslaget. */
const clockOrMidnight = (iso: string): string => {
  const clock = formatClock(iso);
  return clock === '23:59' || clock === '00:00' ? 'midnight' : clock;
};

/** "until midnight" · "until 18:00" · "until Sun midnight" · "until 12 Oct" — sett från Stockholm-dagen `now`. */
export function untilText(endsAt: string, now: Date): string {
  const endDay = stockholmDate(endsAt);
  const todayKey = stockholmClock(now).date;
  if (endDay === todayKey) return `until ${clockOrMidnight(endsAt)}`;
  const ahead = daysBetween(todayKey, endDay);
  if (ahead > 0 && ahead < DAYS_BEFORE_DATE) return `until ${weekdayOf(endDay)} ${clockOrMidnight(endsAt)}`;
  return `until ${dateText(endDay, todayKey)}`;
}

export interface NewsText {
  /** Typraden: "Title taken", "Challenge lost" … (sett från den som tittar). */
  kind: string;
  text: string;
}

/**
 * Texten för en rad. En okänd typ har ingen text att visa → null (anroparen filtrerar bort raden); en känd typ ger alltid text.
 * Switchen är uttömmande över ACTIVITY_TYPES: en ny typ utan case gör `item` icke-`never` i default och tsc säger till.
 */
export function describeNews(item: NewsItem, ctx: NewsContext): NewsText;
export function describeNews(item: WireNewsItem, ctx: NewsContext): NewsText | null;
export function describeNews(wire: WireNewsItem, ctx: NewsContext): NewsText | null {
  if (!isKnownNewsItem(wire)) return null;
  const item = wire;
  const { actor, target } = item;
  const viewerIsTarget = isViewer(target, ctx);
  const viewerIsActor = isViewer(actor, ctx);

  switch (item.type) {
    case 'title_unlocked': {
      const title = titleText(item.payload.title_name, actor, ctx);
      return { kind: 'Title unlocked', text: withValue(`${subject(actor, ctx)} unlocked ${title}`, titleValueText(item.payload.metric_key, item.payload.value)) };
    }
    case 'title_taken': {
      const { payload } = item;
      const title = titleText(payload.title_name, actor, ctx);
      const from = payload.reason === 'revoked'
        ? viewerIsTarget ? 'from you, as you no longer qualify' : `from ${object(target, ctx)}, who no longer qualifies`
        : `from ${object(target, ctx)}`;
      return { kind: 'Title taken', text: withValue(`${subject(actor, ctx)} took ${title} ${from}`, titleValueText(payload.metric_key, payload.value)) };
    }
    case 'title_revoked': {
      const title = titleText(item.payload.title_name, actor, ctx);
      return { kind: 'Title lost', text: `${subject(actor, ctx)} lost ${title} — nobody holds it now` };
    }
    case 'challenge_received': {
      const { payload } = item;
      const kind = viewerIsTarget ? 'Challenge received' : viewerIsActor ? 'Challenge sent' : 'Challenge';
      return { kind, text: `${subject(actor, ctx)} challenged ${object(target, ctx)} to ${metricText(payload.metric)} · ${durationText(payload.duration_days)}` };
    }
    case 'challenge_won': {
      const { payload } = item;
      const stakes = `${metricText(payload.metric)} · ${durationText(payload.duration_days)}`;
      if (viewerIsTarget) {
        const live = boostIsLive(payload.winner_boost, item.occurred_at, ctx.now);
        return { kind: 'Challenge lost', text: `${subject(actor, ctx)} beat you in ${stakes}${live ? `. ${possessive(actor, ctx)} boost is live` : ''}` };
      }
      const boost = payload.winner_boost;
      const gain = viewerIsActor && boost.delta !== 0 ? ` · ${deltaText(boost.delta)}${boostWindow(boost.duration, boost.type)}` : '';
      return { kind: 'Challenge won', text: `${subject(actor, ctx)} beat ${object(target, ctx)} in ${stakes}${gain}` };
    }
    case 'challenge_draw': {
      const { payload } = item;
      const stakes = `${metricText(payload.metric)} · ${durationText(payload.duration_days)}`;
      // Den som tittar står först: "You and Karl drew".
      const [first, second] = viewerIsTarget ? [target, actor] : [actor, target];
      return { kind: 'Challenge drawn', text: `${subject(first, ctx)} and ${object(second, ctx)} drew in ${stakes}` };
    }
    case 'level_up':
      return { kind: 'Level up', text: `${subject(actor, ctx)} reached level ${item.payload.level}` };
    case 'run_milestone':
      return { kind: 'Milestone', text: `${subject(actor, ctx)} passed ${formatInt(item.payload.threshold)} km in total` };
    case 'badge_earned': {
      const { series, tier, previous_tier: previousTier } = item.payload;
      const name = badgeSeriesName(series);
      // F7: "Karl earned Streak Keeper — Common." / "You evolved Milestoner from Uncommon to Rare."
      // Tåligt mot en payload utan fält: saknad previous_tier = "earned"; saknad tier utelämnas hellre än "Tier undefined".
      const who = subject(actor, ctx);
      if (!isTier(previousTier)) {
        return { kind: 'Badge earned', text: isTier(tier) ? `${who} earned ${name} — ${badgeTierName(tier)}.` : `${who} earned ${name}.` };
      }
      return {
        kind: 'Badge evolved',
        text: isTier(tier) ? `${who} evolved ${name} from ${badgeTierName(previousTier)} to ${badgeTierName(tier)}.` : `${who} evolved ${name}.`,
      };
    }
    case 'streak_broken':
      return { kind: 'Streak broken', text: `${subject(actor, ctx)} lost a ${item.payload.length}-day streak — multiplier back to 1.0×` };
    case 'event_open': {
      const { payload } = item;
      const open = Date.parse(payload.ends_at) > ctx.now.getTime();
      const reward = payload.reward_xp === null ? '' : payload.event_type === 'competition' ? ` · 1st place +${formatInt(payload.reward_xp)} XP` : ` · +${formatInt(payload.reward_xp)} XP`;
      return { kind: 'Event open', text: `${payload.template_name} ${open ? `is open ${untilText(payload.ends_at, ctx.now)}` : 'opened'}${reward}` };
    }
    case 'event_closed': {
      const { payload } = item;
      if (payload.event_type === 'participation') {
        return { kind: 'Event closed', text: `${payload.template_name} closed — ${payload.participants} of ${payload.members} finished it` };
      }
      const first = payload.top?.find((entry) => entry.rank === 1);
      const winnerName = first ? (first.user_id === ctx.viewerId ? 'You' : (ctx.nameOf?.(first.user_id) ? firstName(ctx.nameOf(first.user_id) as string) : null)) : null;
      const took = `${payload.participants} of ${payload.members} took part`;
      return { kind: 'Event closed', text: `${payload.template_name} closed — ${winnerName ? `${winnerName} won · ` : ''}${took}` };
    }
    case 'release_published': {
      // Tåligt mot en payload utan fält (som badge_earned): saknad rubrik utelämnas, saknad version ger en neutral formulering.
      const { version, title } = item.payload ?? {};
      const hasVersion = typeof version === 'string' && version !== '';
      const hasTitle = typeof title === 'string' && title !== '';
      const lead = hasVersion ? `RunQuest v${version} is out` : 'A new RunQuest version is out';
      return { kind: 'New version', text: hasTitle ? `${lead} — ${title}` : lead };
    }
    default: {
      const unhandled: never = item;
      void unhandled;
      return null;
    }
  }
}

// ─── Vymodeller ─────────────────────────────────────────────────────────────

export type NewsTone = NewsCategory | 'loss';

export interface NewsRowModel {
  id: number;
  category: NewsCategory;
  /** Popoverns prick/typrad: kategorins färg, men en förlorad utmaning är röd (som Web Prototypens popover). */
  tone: NewsTone;
  icon: RQIconName;
  /**
   * badge_earned (F7): serien och nya nivån, så raden ritar ett sm-emblem i ikonkolumnen i stället för `icon`. null för allt annat — och för en okänd serie
   * eller en tier utanför 1..6 (en annan serverversion), som behåller reservikonen `icon` i stället för ett emblem som ljuger.
   */
  emblem: { series: string; tier: number } | null;
  kind: string;
  text: string;
  /** Kompakt: "2h". */
  time: string;
  /** Popoverns form: "2h ago". */
  timeLong: string;
  /** Exakt tid för `title`. */
  timeTitle: string;
  iso: string;
  unread: boolean;
}

/**
 * Vymodellen för en rad, eller null när raden inte går att visa: en okänd händelsetyp (ingen text) eller en känd typ vars
 * payload/tid inte går att rendera. Ett fel i en enskild rad ska aldrig fälla hela skärmen (ShellErrorBoundary).
 */
export function buildNewsRow(item: NewsItem, ctx: NewsContext): NewsRowModel;
export function buildNewsRow(item: WireNewsItem, ctx: NewsContext): NewsRowModel | null;
export function buildNewsRow(item: WireNewsItem, ctx: NewsContext): NewsRowModel | null {
  if (!isKnownNewsItem(item)) {
    warnFiltered(item, 'unknown type');
    return null;
  }
  try {
    return renderRow(item, ctx);
  } catch {
    warnFiltered(item, 'could not be rendered');
    return null;
  }
}

/** Raderna byggs om vid varje rendering — en varning per rad och orsak räcker. Bara id och typ loggas, aldrig payloaden. */
const warnedRows = new Set<string>();
function warnFiltered(item: Pick<WireNewsItem, 'id' | 'type'>, reason: string): void {
  const key = `${item.id}:${item.type}:${reason}`;
  if (warnedRows.has(key)) return;
  warnedRows.add(key);
  logger.warn(`News row filtered (${reason}): id=${item.id} type=${item.type}`);
}

/** Emblemet i badge_earned-raden: bara en känd serie med en giltig nya nivå; allt annat ritar raden med kategorins ikon. */
function emblemOf(item: NewsItem): NewsRowModel['emblem'] {
  if (item.type !== 'badge_earned') return null;
  const { series, tier } = item.payload;
  return BADGE_SERIES.some((def) => def.key === series) && isEarnedTier(tier) ? { series, tier } : null;
}

function renderRow(item: NewsItem, ctx: NewsContext): NewsRowModel {
  const category = CATEGORY_OF[item.type];
  const { kind, text } = describeNews(item, ctx);
  return {
    id: item.id,
    category,
    tone: kind === 'Challenge lost' ? 'loss' : category,
    icon: CATEGORY_ICON[category],
    emblem: emblemOf(item),
    kind,
    text,
    time: formatAgo(item.occurred_at, ctx.now),
    timeLong: formatAgo(item.occurred_at, ctx.now, true),
    timeTitle: fullTime(item.occurred_at, ctx.now),
    iso: item.occurred_at,
    unread: isUnread(item),
  };
}

/**
 * Rader som inte går att visa (okänd typ, trasig payload) filtreras bort HÄR och inte i flödet: de ligger kvar i `NewsFeed`
 * så att "Mark all read" kvitterar upp till det verkliga högsta id:t och serverns oläst-räkning (alla typer) kan nollas.
 */
export function buildNewsGroups(items: readonly WireNewsItem[], ctx: NewsContext): NewsDayGroup<NewsRowModel>[] {
  const entries = items.flatMap((item) => {
    const row = buildNewsRow(item, ctx);
    return row ? [{ id: item.id, occurred_at: item.occurred_at, row }] : [];
  });
  return groupByDay(entries, ctx.now).map((group) => ({ key: group.key, label: group.label, rows: group.rows.map((entry) => entry.row) }));
}

export const POPOVER_ROWS = 5;

/**
 * Klientens rad som delad klassificering (`classifyNotification`) förstår: id:n i stället för användarreferenser.
 * En raderad användare är `null` i flödet och blir `null` här — aldrig betraktaren.
 */
export function classifiableRowOf(item: WireNewsItem): ClassifiableRow {
  return { type: item.type, actorId: item.actor?.id ?? null, targetId: item.target?.id ?? null, payload: item.payload };
}

export interface PopoverOptions {
  /** Användarens upplösta inställningar (`notify.<slag>`); `useUserSettings().values`, defaults om de inte kunnat läsas. */
  settings: Readonly<Record<string, unknown>>;
  /** Den som tittar. `null` (ingen inloggad) ger en tom lista: egna handlingar går då inte att skilja ut. */
  viewerId: string | null;
  limit?: number;
}

/**
 * Klockans popover (ADR 011 beslut 3): de senaste raderna vars slag är påslaget, lästa som olästa, i visningsordning (samma som
 * skärmens översta rader). Egna handlingar (`own`) hör hemma på /news, inte här. Oläst-avgörandet är serverns (`is_unread`) —
 * `isNotifiable` används inte på klienten, bara samma `classifyNotification` och `isKindEnabled` som servern.
 */
export function buildPopoverRows(items: readonly WireNewsItem[], ctx: NewsContext, { settings, viewerId, limit = POPOVER_ROWS }: PopoverOptions): NewsRowModel[] {
  if (viewerId === null) return [];
  const ordered = [...items].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id);
  const rows: NewsRowModel[] = [];
  // Filtreringen sker före gränsen så att en okänd, egen eller avstängd rad inte tar en av platserna.
  for (const item of ordered) {
    if (rows.length >= limit) break;
    const kind = classifyNotification(classifiableRowOf(item), viewerId);
    if (kind === null || kind === 'own' || !isKindEnabled(kind, settings)) continue;
    const row = buildNewsRow(item, ctx);
    if (row) rows.push(row);
  }
  return rows;
}
