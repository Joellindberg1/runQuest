import { ACTIVITY_TYPES, type ActivityType, type NewsItem, type NewsMeta } from '@runquest/shared';
import type { ChallengeMetric } from '@runquest/types';
import { stockholmClock } from '@/app-shell/rightNowItems';
import type { RQIconName } from '@/shared/components/icons';
import { deltaText, durationLongText, firstName, metricLabel } from '@/features/challenges/duelsFormat';
import { formatClock, stockholmDate, weekdayOf } from '@/features/events/eventsFormat';
import { formatInt } from '@/features/log/logFormat';
import { SHORT_MONTHS } from '@/features/profile/profileFormat';
import { resolveGenderedTitle, titleValueText } from '@/features/titles/titleFormat';

// Pack News (ADR 008): raden är ett FAKTUM (typ + payload) — texten renderas här ur typ, payload och vem som tittar
// ("took … from you" när target är den som tittar). Allt är ren logik med `now` som parameter, så dag-gruppering,
// tider och texter går att testa med fasta klockslag. Engelskt UI i en-GB, egna månads- och veckodagsnamn.

// ─── Kategorier och filter ──────────────────────────────────────────────────

export type NewsCategory = 'title' | 'challenge' | 'level' | 'event' | 'streak';

/** Kategorin styr ikon, färg och kant. run_milestone hör till Levels (ADR 008: Levels = level_up + run_milestone). */
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
};

/** Ikonerna ur runquest-icons (prototypens `kinds`). */
export const CATEGORY_ICON: Record<NewsCategory, RQIconName> = {
  title: 'crown',
  challenge: 'swords',
  level: 'zap',
  event: 'calendar',
  streak: 'flame',
};

export type NewsFilterKey = 'titles' | 'challenges' | 'events' | 'levels' | 'streaks';

export interface NewsFilter {
  key: NewsFilterKey;
  label: string;
  category: NewsCategory;
  /** Typerna som chipet släpper igenom — mappas i klienten till `?type=` (ADR 008 beslut 9). */
  types: readonly ActivityType[];
}

export const NEWS_FILTERS: readonly NewsFilter[] = [
  { key: 'titles', label: 'Titles', category: 'title', types: ['title_unlocked', 'title_taken', 'title_revoked'] },
  { key: 'challenges', label: 'Challenges', category: 'challenge', types: ['challenge_received', 'challenge_won', 'challenge_draw'] },
  { key: 'events', label: 'Events', category: 'event', types: ['event_open', 'event_closed'] },
  { key: 'levels', label: 'Levels', category: 'level', types: ['level_up', 'run_milestone'] },
  { key: 'streaks', label: 'Streaks', category: 'streak', types: ['streak_broken'] },
];

/** Sökparametern för filtret: chip-nycklar, kommaseparerade (`?type=titles,levels`). Tom = allt. */
export const FILTER_PARAM = 'type';

/** Okända nycklar och dubbletter faller bort; ordningen är chipens (så att adressen är kanonisk). */
export function parseFilterParam(raw: string | null | undefined): NewsFilterKey[] {
  const wanted = new Set((raw ?? '').split(',').map((part) => part.trim()));
  const keys = NEWS_FILTERS.filter((filter) => wanted.has(filter.key)).map((filter) => filter.key);
  // Alla fem valda = inget filter alls.
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

/** Antal rader per chip i det laddade fönstret (ADR 008: chip-räknare = antal i det laddade fönstret). */
export function countByFilter(items: readonly Pick<NewsItem, 'type'>[]): Record<NewsFilterKey, number> {
  const counts: Record<NewsFilterKey, number> = { titles: 0, challenges: 0, events: 0, levels: 0, streaks: 0 };
  for (const item of items) {
    const filter = NEWS_FILTERS.find((candidate) => candidate.types.includes(item.type));
    if (filter) counts[filter.key] += 1;
  }
  return counts;
}

// ─── Flödet: sidor, kursor, deduplicering ───────────────────────────────────

export interface NewsFeed {
  /** id fallande, deduplicerade. */
  items: NewsItem[];
  /**
   * unread_count och last_seen_id följer det senaste svaret; has_more/next_before beskriver flödets ÄLDRE kant
   * (det som "Show more" fortsätter från).
   */
  meta: NewsMeta;
}

export interface NewsPage {
  items: NewsItem[];
  meta: NewsMeta;
}

export const NEWS_PAGE_SIZE = 30;
/** Hämtningar per catch-up när glappet är större än en sida (`after` ger bara de nyaste N). */
export const NEWS_CATCH_UP_LIMIT = 100;
export const NEWS_MAX_GAP_PAGES = 5;

/** Första förekomsten av varje id vinner; ordningen id fallande. */
export function dedupeById(items: readonly NewsItem[]): NewsItem[] {
  const seen = new Set<number>();
  const unique: NewsItem[] = [];
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
export function mergeNewer(feed: NewsFeed, fetched: readonly NewsItem[], meta: NewsMeta, complete: boolean): NewsFeed {
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
const MS_DAY = 86_400_000;
const DAYS_BEFORE_DATE = 7;

const dayNumbers = (day: string): [number, number, number] => {
  const [year, month, date] = day.split('-').map(Number);
  return [year, month, date];
};

const utcDay = (day: string): number => {
  const [year, month, date] = dayNumbers(day);
  return Date.UTC(year, month - 1, date);
};

/** Hela dygn mellan två kalenderdagar (YYYY-MM-DD). */
const daysApart = (earlier: string, later: string): number => Math.round((utcDay(later) - utcDay(earlier)) / MS_DAY);

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
  const days = Math.max(1, Math.min(daysApart(dayKey, todayKey), Math.floor(ms / MS_DAY)));
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

/** Måndagen i veckan som `day` tillhör (ISO-vecka, Stockholm-dagar). */
function mondayOf(day: string): string {
  const weekday = (new Date(utcDay(day)).getUTCDay() + 6) % 7;
  return new Date(utcDay(day) - weekday * MS_DAY).toISOString().slice(0, 10);
}

function bucketOf(dayKey: string, todayKey: string): { key: string; label: string } {
  // Ett klockslag i framtiden (klockskev) hör hemma i dag.
  if (dayKey >= todayKey) return { key: 'today', label: 'Today' };
  const days = daysApart(dayKey, todayKey);
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
  const ahead = daysApart(todayKey, endDay);
  if (ahead > 0 && ahead < DAYS_BEFORE_DATE) return `until ${weekdayOf(endDay)} ${clockOrMidnight(endsAt)}`;
  return `until ${dateText(endDay, todayKey)}`;
}

export interface NewsText {
  /** Typraden: "Title taken", "Challenge lost" … (sett från den som tittar). */
  kind: string;
  text: string;
}

export function describeNews(item: NewsItem, ctx: NewsContext): NewsText {
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

export function buildNewsRow(item: NewsItem, ctx: NewsContext): NewsRowModel {
  const category = CATEGORY_OF[item.type];
  const { kind, text } = describeNews(item, ctx);
  return {
    id: item.id,
    category,
    tone: kind === 'Challenge lost' ? 'loss' : category,
    icon: CATEGORY_ICON[category],
    kind,
    text,
    time: formatAgo(item.occurred_at, ctx.now),
    timeLong: formatAgo(item.occurred_at, ctx.now, true),
    timeTitle: fullTime(item.occurred_at, ctx.now),
    iso: item.occurred_at,
    unread: isUnread(item),
  };
}

export function buildNewsGroups(items: readonly NewsItem[], ctx: NewsContext): NewsDayGroup<NewsRowModel>[] {
  return groupByDay(items, ctx.now).map((group) => ({ ...group, rows: group.rows.map((item) => buildNewsRow(item, ctx)) }));
}

export const POPOVER_ROWS = 5;

/** Popovern: de senaste fem i visningsordning (samma ordning som skärmens översta rader). */
export function buildPopoverRows(items: readonly NewsItem[], ctx: NewsContext, limit = POPOVER_ROWS): NewsRowModel[] {
  const ordered = [...items].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id);
  return ordered.slice(0, limit).map((item) => buildNewsRow(item, ctx));
}
