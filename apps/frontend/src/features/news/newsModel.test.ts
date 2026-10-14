import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/shared/utils/logger';
import { ACTIVITY_TYPES, BADGE_SERIES, TIER_NAMES, resolveSettings, type ActivityType, type NewsItem } from '@runquest/shared';
import {
  CATEGORY_ICON, CATEGORY_OF, NEWS_FILTERS, appendOlder, badgeText, buildNewsGroups, buildNewsRow, buildPopoverRows, classifiableRowOf, countByFilter, dedupeById, describeNews,
  POINTER_SETTLE_MS, READ_DWELL_MS, READ_FLUSH_MS, createReadBatcher, markReadInFeed, markUnreadInFeed,
  feedFromPage, formatAgo, fullTime, gapCursor, groupByDay, isUnread, markSeenInFeed, mergeNewer, parseFilterParam, serializeFilterParam,
  replaceNewest, parseInvolvesParam, serializeInvolvesParam, involvesMe, involvesAnnouncement, toggleFilter, topIdOf, typeParamOf, typesForFilters, unreadSummary, untilText, isKnownNewsItem, type NewsContext, type UnknownNewsItem, type WireNewsItem,
} from './newsModel';
import { formatInt } from '@/features/log/logFormat';
import { ADAM, DAN, ME, NICK, NOW, KARL, at, ref, badgeEarned, challengeAccepted, challengeWon, eventOpen, item, levelUp, meta, rankPassed, releasePublished, streakBroken, titleTaken } from './news.fixture';

const ctx = (over: Partial<NewsContext> = {}): NewsContext => ({ viewerId: ME.id, now: NOW, ...over });
const DEFAULT_SETTINGS = resolveSettings({}, 'user');
/** Popoverns alternativ: defaults och ME som betraktare — tester skriver bara över det de provar. */
type PopoverOptions = Parameters<typeof buildPopoverRows>[2];
const popover = (over: Partial<PopoverOptions> = {}): PopoverOptions => ({ settings: DEFAULT_SETTINGS, viewerId: ME.id, ...over });

describe('kategorier och filter', () => {
  // release_published (RUN-161) är medvetet utan filterchip: systemraden syns när inget filter är valt.
  const WITHOUT_FILTER: readonly ActivityType[] = ['release_published'];

  it('varje händelsetyp hör till exakt en kategori och ett filter (utom release_published)', () => {
    for (const type of ACTIVITY_TYPES) {
      expect(CATEGORY_OF[type], type).toBeTruthy();
      expect(NEWS_FILTERS.filter((filter) => filter.types.includes(type)).map((filter) => filter.key), type).toHaveLength(WITHOUT_FILTER.includes(type) ? 0 : 1);
    }
    expect(NEWS_FILTERS.flatMap((filter) => filter.types).sort()).toEqual(ACTIVITY_TYPES.filter((type) => !WITHOUT_FILTER.includes(type)).sort());
  });

  it('release_published: kategori "release" utan eget filter, och inget chip räknar eller släpper igenom den', () => {
    expect(CATEGORY_OF.release_published).toBe('release');
    expect(NEWS_FILTERS.some((filter) => filter.category === 'release')).toBe(false);
    expect(Object.values(countByFilter([releasePublished(1)]))).toEqual(NEWS_FILTERS.map(() => 0));
    // Inget filter valt = ingen typfiltrering alls, så raden kommer med; varje valt chip utesluter den.
    expect(typesForFilters([])).toBeNull();
    for (const filter of NEWS_FILTERS) expect(typesForFilters([filter.key])).not.toContain('release_published');
  });

  it('Levels = level_up + run_milestone (ADR 008); badge_earned har eget chip sedan v0.6.1 men raderna behåller kategorin level (ADR 009 beslut 5)', () => {
    expect(NEWS_FILTERS.find((filter) => filter.key === 'levels')?.types).toEqual(['level_up', 'run_milestone']);
    expect(CATEGORY_OF.run_milestone).toBe('level');
    expect(CATEGORY_OF.badge_earned).toBe('level');
  });

  it('adressparametern: okända nycklar och dubbletter faller bort, ordningen är chipens', () => {
    expect(parseFilterParam(null)).toEqual([]);
    expect(parseFilterParam('')).toEqual([]);
    expect(parseFilterParam('levels,titles,titles,nonsense')).toEqual(['titles', 'levels']);
    expect(serializeFilterParam(['levels', 'titles'])).toBe('titles,levels');
    expect(serializeFilterParam([])).toBeNull();
  });

  it('toggleFilter lägger till och tar bort; det sista valda chipet blir "allt"', () => {
    expect(toggleFilter([], 'events')).toEqual(['events']);
    expect(toggleFilter(['events'], 'titles')).toEqual(['titles', 'events']);
    expect(toggleFilter(['titles', 'events'], 'titles')).toEqual(['events']);
    expect(toggleFilter(NEWS_FILTERS.slice(0, -1).map((filter) => filter.key), NEWS_FILTERS[NEWS_FILTERS.length - 1].key)).toEqual([]);
  });

  it('chipsens typer blir serverns type= i stabil ordning; inget filter = ingen parameter', () => {
    expect(typesForFilters([])).toBeNull();
    expect(typeParamOf(null)).toBeUndefined();
    expect(typesForFilters(['levels', 'titles'])).toEqual(['title_unlocked', 'title_taken', 'title_revoked', 'level_up', 'run_milestone']);
    expect(typeParamOf(typesForFilters(['streaks']))).toBe('streak_broken');
  });

  it('chip-räknarna är antal per kategori i det laddade fönstret', () => {
    const counts = countByFilter([titleTaken(5), titleTaken(4), levelUp(3, 25), streakBroken(2), eventOpen(1)]);
    expect(counts).toEqual({ titles: 2, challenges: 0, ranks: 0, events: 1, levels: 1, badges: 0, streaks: 1 });
    // badge_earned räknas under Badges, inte Levels.
    expect(countByFilter([badgeEarned(2), levelUp(1, 25)])).toMatchObject({ levels: 1, badges: 1 });
  });

  it("Badges-chipet släpper bara igenom badge_earned, ligger direkt efter Levels, har Levels-färg men egen ikon (shield)", () => {
    const filter = NEWS_FILTERS.find((candidate) => candidate.key === "badges");
    expect(filter).toMatchObject({ label: "Badges", category: "level", icon: "shield", types: ["badge_earned"] });
    expect(NEWS_FILTERS.map((candidate) => candidate.key)).toEqual(["titles", "challenges", "ranks", "events", "levels", "badges", "streaks"]);
    expect(NEWS_FILTERS.filter((candidate) => candidate.key !== "badges").every((candidate) => !candidate.types.includes("badge_earned"))).toBe(true);
  });

  it("?type=badges: går runt adress → chip → serverns type=, och okända nycklar faller bort", () => {
    expect(parseFilterParam("badges")).toEqual(["badges"]);
    expect(serializeFilterParam(parseFilterParam("badges,nonsense"))).toBe("badges");
    expect(serializeFilterParam(["streaks", "badges", "levels"])).toBe("levels,badges,streaks");
    expect(toggleFilter(["levels"], "badges")).toEqual(["levels", "badges"]);
    expect(typesForFilters(["badges"])).toEqual(["badge_earned"]);
    expect(typeParamOf(typesForFilters(["levels", "badges"]))).toBe("level_up,run_milestone,badge_earned");
  });

  it('Ranks-chipet släpper bara igenom rank_passed och challenge_accepted ligger under Challenges', () => {
    expect(NEWS_FILTERS.find((filter) => filter.key === 'ranks')).toMatchObject({ label: 'Ranks', category: 'rank', types: ['rank_passed'] });
    expect(NEWS_FILTERS.filter((filter) => filter.key !== 'ranks').every((filter) => !filter.types.includes('rank_passed'))).toBe(true);
    expect(NEWS_FILTERS.find((filter) => filter.key === 'challenges')?.types).toContain('challenge_accepted');
    expect(NEWS_FILTERS.filter((filter) => filter.key !== 'challenges').every((filter) => !filter.types.includes('challenge_accepted'))).toBe(true);
    expect(CATEGORY_OF.rank_passed).toBe('rank');
    expect(CATEGORY_OF.challenge_accepted).toBe('challenge');
    // Chipet står efter Challenges (frame N3), och typerna följer ACTIVITY_TYPES-ordningen i serverns type=.
    expect(NEWS_FILTERS.map((filter) => filter.key)).toEqual(['titles', 'challenges', 'ranks', 'events', 'levels', 'badges', 'streaks']);
    expect(typesForFilters(['ranks'])).toEqual(['rank_passed']);
    expect(typeParamOf(typesForFilters(['challenges', 'ranks']))).toBe('challenge_received,challenge_won,challenge_draw,rank_passed,challenge_accepted');
    // Räknarna: en passering är en Ranks-rad, en accepterad utmaning en Challenges-rad.
    expect(countByFilter([rankPassed(2), challengeAccepted(1)])).toMatchObject({ ranks: 1, challenges: 1 });
  });

  it('parseFilterParam känner igen ranks och alla sju valda blir inget filter', () => {
    expect(parseFilterParam('ranks')).toEqual(['ranks']);
    expect(parseFilterParam('streaks,ranks,titles,nonsense')).toEqual(['titles', 'ranks', 'streaks']);
    expect(serializeFilterParam(['streaks', 'ranks'])).toBe('ranks,streaks');
    expect(toggleFilter(['titles'], 'ranks')).toEqual(['titles', 'ranks']);
    const all = NEWS_FILTERS.map((filter) => filter.key);
    expect(all).toHaveLength(7);
    expect(parseFilterParam(all.join(','))).toEqual([]);
    expect(parseFilterParam(all.slice(1).join(','))).toHaveLength(6);
    expect(serializeFilterParam(all)).toBeNull();
  });
});

describe('flödet: dedupe, kursor och sammanslagning', () => {
  const a = titleTaken(10);
  const b = levelUp(9, 25);
  const c = streakBroken(8);
  const d = eventOpen(7);

  it('dedupe på id: första förekomsten vinner, id fallande', () => {
    const newer = { ...a, is_unread: true };
    expect(dedupeById([c, a, newer, b]).map((row) => row.id)).toEqual([10, 9, 8]);
    expect(dedupeById([c, a, newer])[0].is_unread).toBe(false);
  });

  it('topIdOf: högsta id, null när flödet är tomt', () => {
    expect(topIdOf([c, a, b])).toBe(10);
    expect(topIdOf([])).toBeNull();
  });

  describe('gapCursor (ADR 008 addendum 4)', () => {
    it('inga fler rader inom intervallet → klart', () => {
      expect(gapCursor({ items: [a, b], meta: meta({ has_more: false }) }, 5)).toBeNull();
    });
    it('fler rader och äldsta sidan ligger över vårt kända id → fortsätt med next_before', () => {
      expect(gapCursor({ items: [a, b], meta: meta({ has_more: true, next_before: 9 }) }, 5)).toBe(9);
    });
    it('klienten stannar vid sitt kända id: sidan har nått det (äldsta ≤ känt) → klart även om has_more', () => {
      expect(gapCursor({ items: [a, b, c], meta: meta({ has_more: true, next_before: 8 }) }, 8)).toBeNull();
      expect(gapCursor({ items: [a, b, c], meta: meta({ has_more: true, next_before: 8 }) }, 12)).toBeNull();
    });
    it('has_more men ingen next_before eller en tom sida → klart (ingen oändlig loop)', () => {
      expect(gapCursor({ items: [a], meta: meta({ has_more: true, next_before: null }) }, 1)).toBeNull();
      expect(gapCursor({ items: [], meta: meta({ has_more: true, next_before: 3 }) }, 1)).toBeNull();
    });
  });

  describe('mergeNewer', () => {
    const feed = { items: [c, d], meta: meta({ unread_count: 0, has_more: true, next_before: 7, last_seen_id: 6 }) };

    it('kompletta nya rader: sammanslaget, dedupat, den äldre kanten orörd och oläst-siffran är den färska', () => {
      const merged = mergeNewer(feed, [a, b, c], meta({ unread_count: 2, last_seen_id: 6, has_more: false, next_before: null }), true);
      expect(merged.items.map((row) => row.id)).toEqual([10, 9, 8, 7]);
      expect(merged.meta).toEqual({ unread_count: 2, last_seen_id: 6, has_more: true, next_before: 7 });
    });

    it('ofullständig catch-up: fönstret ersätts av det hämtade (inget hål i mitten) och kanten är sista sidans', () => {
      const replaced = mergeNewer(feed, [a, b], meta({ unread_count: 2, has_more: true, next_before: 9 }), false);
      expect(replaced.items.map((row) => row.id)).toEqual([10, 9]);
      expect(replaced.meta).toEqual(meta({ unread_count: 2, has_more: true, next_before: 9 }));
    });

    it('en tom catch-up ändrar inget utom räknaren', () => {
      const merged = mergeNewer(feed, [], meta({ unread_count: 4, last_seen_id: 6 }), true);
      expect(merged.items).toEqual(feed.items);
      expect(merged.meta.unread_count).toBe(4);
    });
  });

  describe('replaceNewest (fokus: den nyaste sidan ersätter, så retractade rader försvinner)', () => {
    it('en rad som saknas i den nyaste sidan tas bort; rader äldre än sidan behålls och räknaren är den färska', () => {
      const feed = { items: [a, b, c, d], meta: meta({ unread_count: 1, has_more: true, next_before: 7 }) };
      // b (id 9) är retractad: sidan har bara 10 och 8 och har fler äldre rader (has_more) — 7 ligger under sidan och behålls.
      const next = replaceNewest(feed, { items: [a, c], meta: meta({ unread_count: 3, last_seen_id: 4, has_more: true, next_before: 8 }) });
      expect(next.items.map((row) => row.id)).toEqual([10, 8, 7]);
      expect(next.meta).toEqual({ unread_count: 3, last_seen_id: 4, has_more: true, next_before: 7 });
    });

    it('sidan är hela flödet (inget has_more): allt ersätts, även en tom sida', () => {
      const feed = { items: [a, b, c], meta: meta({ has_more: false }) };
      expect(replaceNewest(feed, { items: [a], meta: meta({ has_more: false }) }).items.map((row) => row.id)).toEqual([10]);
      expect(replaceNewest(feed, { items: [], meta: meta({ has_more: false }) }).items).toEqual([]);
    });

    it('nya rader och oförändrade rader: ingen dubblering', () => {
      const feed = { items: [b, c], meta: meta({ has_more: true, next_before: 8 }) };
      const next = replaceNewest(feed, { items: [a, b, c], meta: meta({ has_more: true, next_before: 8 }) });
      expect(next.items.map((row) => row.id)).toEqual([10, 9, 8]);
    });
  });

  it('appendOlder: Show more lägger raderna efter, dedupar överlapp och flyttar kanten', () => {
    const feed = feedFromPage({ items: [a, b], meta: meta({ has_more: true, next_before: 9, unread_count: 1 }) });
    const next = appendOlder(feed, { items: [b, c, d], meta: meta({ has_more: false, next_before: null, unread_count: 1 }) });
    expect(next.items.map((row) => row.id)).toEqual([10, 9, 8, 7]);
    expect(next.meta.has_more).toBe(false);
    expect(next.meta.next_before).toBeNull();
  });

  it('markSeenInFeed: rader upp till id:t blir lästa, nyare orörda, räknaren sätts och vattenmärket höjs (aldrig sänks)', () => {
    const unreadNew = { ...titleTaken(12), is_unread: true };
    const unreadOld = { ...levelUp(9, 25), is_unread: true };
    const feed = { items: [unreadNew, titleTaken(10, {}, {}), unreadOld], meta: meta({ unread_count: 2, last_seen_id: 8 }) };
    const next = markSeenInFeed(feed, 10, 1);
    expect(next.items.map((row) => row.is_unread)).toEqual([true, false, false]);
    expect(next.meta).toMatchObject({ unread_count: 1, last_seen_id: 10 });
    expect(markSeenInFeed(feed, 5, 2).meta.last_seen_id).toBe(8);
  });
});

describe('läst per rad', () => {
  const unread = (id: number) => ({ ...levelUp(id, id), is_unread: true });
  const unreadFeed = () => ({ items: [unread(12), unread(11), levelUp(10, 10), unread(9)], meta: meta({ unread_count: 3, last_seen_id: 4 }) });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('markReadInFeed flippar bara olästa rader i ids och minskar räknaren med antalet flippade', () => {
    const feed = unreadFeed();
    // 10 är redan läst och 99 finns inte i flödet: ingen av dem räknas som flippad.
    const next = markReadInFeed(feed, [11, 10, 99]);
    expect(next.items.map((row) => row.is_unread)).toEqual([true, false, false, true]);
    expect(next.meta.unread_count).toBe(2);
    // Vattenmärket rörs aldrig av en enskild kvittering.
    expect(next.meta.last_seen_id).toBe(4);
    // Indata muteras inte.
    expect(feed.items[1].is_unread).toBe(true);
    expect(feed.meta.unread_count).toBe(3);
  });

  it('markReadInFeed sänker aldrig räknaren under noll och rör inte andra rader', () => {
    const drained = { items: unreadFeed().items, meta: meta({ unread_count: 1 }) };
    const next = markReadInFeed(drained, [12, 11, 9]);
    expect(next.meta.unread_count).toBe(0);
    expect(next.items[2]).toBe(drained.items[2]);
    // Ingen flippad rad: samma flöde tillbaka, räknaren orörd.
    expect(markReadInFeed(drained, [10])).toBe(drained);
    // Serverns räknare skriver över den lokala (och en tom id-lista flippar inget).
    const overwritten = markReadInFeed(unreadFeed(), [12], 7);
    expect(overwritten.meta.unread_count).toBe(7);
    expect(overwritten.items.map((row) => row.is_unread)).toEqual([false, true, false, true]);
    expect(markReadInFeed(unreadFeed(), [], 5).meta.unread_count).toBe(5);
  });

  it('markUnreadInFeed återställer bara de givna lästa raderna och sätter räknaren till det angivna värdet', () => {
    const read = markReadInFeed(unreadFeed(), [12, 9]);
    const restored = markUnreadInFeed(read, [12], 2);
    expect(restored.items.map((row) => row.is_unread)).toEqual([true, true, false, false]);
    expect(restored.meta.unread_count).toBe(2);
    expect(markUnreadInFeed(read, [999], 1).items).toEqual(read.items);
  });

  it('markReadInFeed och markUnreadInFeed lämnar backfill-rader orörda, även när flaggan säger oläst', () => {
    const backfill = { ...levelUp(3, 3), is_unread: true, is_backfill: true };
    const feed = { items: [backfill], meta: meta({ unread_count: 1 }) };
    expect(markReadInFeed(feed, [3])).toBe(feed);
    expect(markUnreadInFeed({ items: [{ ...backfill, is_unread: false }], meta: meta({ unread_count: 0 }) }, [3], 0).items[0].is_unread).toBe(false);
  });

  it('bunten: efter flush() får den gamla timern inte skicka ett senare id för tidigt', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const batcher = createReadBatcher(send);
    batcher.add(7);
    batcher.flush();
    vi.advanceTimersByTime(100);
    batcher.add(8);
    vi.advanceTimersByTime(READ_FLUSH_MS - 50);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(send).toHaveBeenLastCalledWith([8]);
  });

  it('READ_DWELL_MS är 0 och READ_FLUSH_MS är 300', () => {
    expect(READ_DWELL_MS).toBe(0);
    expect(READ_FLUSH_MS).toBe(300);
    // Rörelsevakten efter montering är en egen sak (ADR 011 addendum 2026-10-14), inte väntetiden efter en giltig hover.
    expect(POINTER_SETTLE_MS).toBe(150);
  });

  it('läs-bunten tömmer efter READ_FLUSH_MS, vid flush och delar upp mer än 50 id', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const batcher = createReadBatcher(send);

    // Tidsfönstret: id:n buntas, dubbletter slås ihop, och inget skickas före READ_FLUSH_MS.
    batcher.add(3);
    batcher.add(4);
    batcher.add(3);
    vi.advanceTimersByTime(READ_FLUSH_MS - 1);
    expect(send).not.toHaveBeenCalled();
    expect(batcher.hasPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith([3, 4]);
    expect(batcher.hasPending()).toBe(false);

    // Fönstret startar vid första id:t och förlängs inte av fler (högst var 300 ms).
    batcher.add(5);
    vi.advanceTimersByTime(200);
    batcher.add(6);
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenLastCalledWith([5, 6]);

    // flush() skickar direkt och avbryter timern (inget andra anrop senare); en tom flush skickar ingenting.
    send.mockClear();
    batcher.add(7);
    batcher.flush();
    expect(send).toHaveBeenCalledWith([7]);
    batcher.flush();
    vi.advanceTimersByTime(READ_FLUSH_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);

    // Högst 50 id per anrop, i insättningsordning.
    send.mockClear();
    for (let id = 1; id <= 120; id += 1) batcher.add(id);
    batcher.flush();
    expect(send.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 20]);
    expect(send.mock.calls[0][0][0]).toBe(1);
    expect(send.mock.calls[2][0].at(-1)).toBe(120);
  });
});

describe('oläst', () => {
  it('backfill-rader är aldrig olästa, vad flaggan än säger', () => {
    expect(isUnread({ is_unread: true, is_backfill: false })).toBe(true);
    expect(isUnread({ is_unread: true, is_backfill: true })).toBe(false);
    expect(isUnread({ is_unread: false, is_backfill: false })).toBe(false);
  });

  it('klockans räknare: dold vid 0, "99+" över hundra', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(3)).toBe('3');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
    expect(badgeText(Number.NaN)).toBeNull();
  });

  it('underrubriken', () => {
    expect(unreadSummary(3)).toBe('3 unread');
    expect(unreadSummary(0)).toBe('All caught up');
  });
});

describe('tider', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it('kompakt: now · minuter · timmar · dagar · datum', () => {
    expect(formatAgo(ago(20_000), NOW)).toBe('now');
    expect(formatAgo(ago(12 * MIN), NOW)).toBe('12m');
    expect(formatAgo(ago(2 * HOUR), NOW)).toBe('2h');
    expect(formatAgo(ago(23 * HOUR), NOW)).toBe('23h');
    expect(formatAgo(ago(1 * DAY + HOUR), NOW)).toBe('1d');
    expect(formatAgo(ago(4 * DAY), NOW)).toBe('4d');
    expect(formatAgo(ago(9 * DAY), NOW)).toBe('29 Sep');
    expect(formatAgo('2025-12-30T10:00:00Z', NOW)).toBe('30 Dec 2025');
  });

  it('popoverns form: "2h ago", "Yesterday", "2 days ago"', () => {
    expect(formatAgo(ago(20_000), NOW, true)).toBe('Just now');
    expect(formatAgo(ago(5 * HOUR), NOW, true)).toBe('5h ago');
    expect(formatAgo(ago(30 * HOUR), NOW, true)).toBe('Yesterday');
    expect(formatAgo(ago(2 * DAY + HOUR), NOW, true)).toBe('2 days ago');
  });

  it('en tid i framtiden (klockskev) läses som "now", inte negativ', () => {
    expect(formatAgo(ago(-5 * MIN), NOW)).toBe('now');
  });

  it('fullTime: veckodag, datum och Stockholm-klockslag (egna månadsnamn)', () => {
    expect(fullTime('2026-10-02T12:05:00Z', NOW)).toBe('Fri 2 Oct · 14:05');
  });
});

describe('dag-gruppering (Stockholm-dagar)', () => {
  const row = (id: number, iso: string) => ({ id, occurred_at: iso });

  it('Today · Yesterday · Earlier this week · en grupp per äldre dag', () => {
    const groups = groupByDay([
      row(8, '2026-10-08T08:00:00Z'),
      row(7, '2026-10-07T20:00:00Z'),
      row(6, '2026-10-06T09:00:00Z'),
      row(5, '2026-10-05T09:00:00Z'),
      row(4, '2026-10-04T09:00:00Z'),
      row(3, '2026-10-02T09:00:00Z'),
      row(2, '2026-10-02T07:00:00Z'),
    ], NOW);
    expect(groups.map((group) => [group.key, group.label, group.rows.map((r) => r.id)])).toEqual([
      ['today', 'Today', [8]],
      ['yesterday', 'Yesterday', [7]],
      ['week', 'Earlier this week', [6, 5]],
      ['2026-10-04', 'Sun 4 Oct', [4]],
      ['2026-10-02', 'Fri 2 Oct', [3, 2]],
    ]);
  });

  it('dagen är Stockholms: 23:30 UTC den 7:e är redan den 8:e (CEST) = Today', () => {
    expect(groupByDay([row(1, '2026-10-07T22:30:00Z')], NOW)[0].key).toBe('today');
    expect(groupByDay([row(1, '2026-10-07T21:30:00Z')], NOW)[0].key).toBe('yesterday');
  });

  it('en måndag har ingen "Earlier this week": gårdagen är söndag och hör till förra veckan som egen dag', () => {
    const monday = new Date('2026-10-05T10:00:00Z');
    const groups = groupByDay([row(2, '2026-10-05T07:00:00Z'), row(1, '2026-10-04T10:00:00Z'), row(0, '2026-10-03T10:00:00Z')], monday);
    expect(groups.map((group) => group.key)).toEqual(['today', 'yesterday', '2026-10-03']);
  });

  it('visningsordningen är occurred_at, inte id: en backfillad rad med högre id men äldre dag hamnar där dagen är', () => {
    const groups = groupByDay([row(100, '2026-10-02T09:00:00Z'), row(50, '2026-10-08T08:00:00Z'), row(49, '2026-10-07T20:00:00Z')], NOW);
    expect(groups.map((group) => group.rows.map((r) => r.id))).toEqual([[50], [49], [100]]);
  });

  it('samma tidpunkt: högre id först', () => {
    const groups = groupByDay([row(1, '2026-10-08T08:00:00Z'), row(2, '2026-10-08T08:00:00Z')], NOW);
    expect(groups[0].rows.map((r) => r.id)).toEqual([2, 1]);
  });

  it('en rad i framtiden (klockskev) hamnar i Today', () => {
    expect(groupByDay([row(1, '2026-10-09T08:00:00Z')], NOW)[0].key).toBe('today');
  });

  it('en dag från ett annat år visar året', () => {
    expect(groupByDay([row(1, '2025-12-30T10:00:00Z')], NOW)[0].label).toBe('Tue 30 Dec 2025');
  });

  it('tomt flöde → inga grupper', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe('texterna ur typ + payload + vem som tittar', () => {
  describe('titlar', () => {
    it('title_taken: from you / by you / tredje part, med värdet formaterat ur måttnyckeln', () => {
      expect(describeNews(titleTaken(1), ctx())).toEqual({ kind: 'Title taken', text: 'Karl took The Longest Run from you — 32.8 km' });
      expect(describeNews(titleTaken(1, { actor: ME, target: KARL }), ctx())).toEqual({ kind: 'Title taken', text: 'You took The Longest Run from Karl — 32.8 km' });
      expect(describeNews(titleTaken(1, { actor: DAN, target: ADAM }, { title_name: 'The Consistent King', metric_key: 'longestStreak', value: 21 }), ctx()).text)
        .toBe('Daniel took The Consistent King from Adam — 21 days');
    });

    it('title_taken reason "revoked": förra innehavaren uppfyller inte längre kravet', () => {
      expect(describeNews(titleTaken(1, {}, { reason: 'revoked' }), ctx()).text).toBe('Karl took The Longest Run from you, as you no longer qualify — 32.8 km');
      expect(describeNews(titleTaken(1, { target: ADAM }, { reason: 'revoked' }), ctx()).text).toBe('Karl took The Longest Run from Adam, who no longer qualifies — 32.8 km');
    });

    it('title_unlocked och title_revoked', () => {
      const unlocked = item('title_unlocked', 2, { title_id: 't', title_name: 'The Commuter', metric_key: 'earlyRunCount', value: 20 }, { actor: KARL });
      expect(describeNews(unlocked, ctx())).toEqual({ kind: 'Title unlocked', text: 'Karl unlocked The Commuter — 20 runs' });
      expect(describeNews({ ...unlocked, actor: ME }, ctx()).text).toBe('You unlocked The Commuter — 20 runs');
      const revoked = item('title_revoked', 3, { title_id: 't', title_name: 'The Commuter', metric_key: 'earlyRunCount' }, { actor: ADAM });
      expect(describeNews(revoked, ctx())).toEqual({ kind: 'Title lost', text: 'Adam lost The Commuter — nobody holds it now' });
    });

    it('ett okänt mått ger bara namnet utan värdestreck, och "—"-värden utelämnas', () => {
      const unlocked = item('title_unlocked', 2, { title_id: 't', title_name: 'The Mystery', metric_key: 'fastestMarathon', value: -500 }, { actor: KARL });
      expect(describeNews(unlocked, ctx()).text).toBe('Karl unlocked The Mystery');
    });

    it('King/Queen följer innehavarens kön när det är känt, annars lämnas namnet', () => {
      const taken = titleTaken(1, { actor: ADAM }, { title_name: 'The Consistent King/Queen', metric_key: 'longestStreak', value: 21 });
      expect(describeNews(taken, ctx()).text).toBe('Adam took The Consistent King/Queen from you — 21 days');
      expect(describeNews(taken, ctx({ genderOf: () => 'male' })).text).toBe('Adam took The Consistent King from you — 21 days');
      expect(describeNews(taken, ctx({ genderOf: () => 'female' })).text).toBe('Adam took The Consistent Queen from you — 21 days');
    });

    it('en raderad användare är "a former member"', () => {
      expect(describeNews(titleTaken(1, { actor: KARL, target: null }), ctx()).text).toBe('Karl took The Longest Run from a former member — 32.8 km');
      expect(describeNews(titleTaken(1, { actor: null, target: ME }), ctx()).text).toBe('A former member took The Longest Run from you — 32.8 km');
    });
  });

  describe('utmaningar', () => {
    it('förlorad (jag är target): vinnarens boost är "live" bara medan dess dagar pågår', () => {
      expect(describeNews(challengeWon(1, { occurred_at: at(24) }), ctx())).toEqual({
        kind: 'Challenge lost', text: "Nicklas beat you in Most km · 7 days. Nicklas's boost is live",
      });
      // Fem dagar gammal med en fyradagars boost → inget påstående om "live".
      expect(describeNews(challengeWon(1, { occurred_at: at(5 * 24) }), ctx()).text).toBe('Nicklas beat you in Most km · 7 days');
      // Körboost: klienten vet inte hur mycket som är kvar.
      expect(describeNews(challengeWon(1, { occurred_at: at(1) }, { winner_boost: { type: 'multiplier_runs', delta: 0.2, duration: 3 } }), ctx()).text)
        .toBe('Nicklas beat you in Most km · 7 days');
    });

    it('vunnen (jag är actor): med min boost; tredje part: utan boost', () => {
      const won = challengeWon(1, { actor: ME, target: ADAM }, { metric: 'runs', duration_days: 5 });
      expect(describeNews(won, ctx())).toEqual({ kind: 'Challenge won', text: 'You beat Adam in Most runs · 5 days · +0.2× for 4 days' });
      expect(describeNews(challengeWon(1, { actor: KARL, target: ADAM }), ctx())).toEqual({ kind: 'Challenge won', text: 'Karl beat Adam in Most km · 7 days' });
      expect(describeNews(challengeWon(1, { actor: ME, target: ADAM }, { winner_boost: { type: 'multiplier_days', delta: 0, duration: 4 } }), ctx()).text)
        .toBe('You beat Adam in Most km · 7 days');
    });

    it('oavgjort: den som tittar står först', () => {
      const draw = item('challenge_draw', 2, { challenge_id: 'c', tier: 'minor', metric: 'total_xp', duration_days: 3, challenger_value: 100, opponent_value: 100 }, { actor: KARL, target: ME });
      expect(describeNews(draw, ctx())).toEqual({ kind: 'Challenge drawn', text: 'You and Karl drew in Most XP · 3 days' });
      expect(describeNews({ ...draw, actor: ME, target: KARL }, ctx()).text).toBe('You and Karl drew in Most XP · 3 days');
      expect(describeNews({ ...draw, actor: ADAM, target: KARL }, ctx()).text).toBe('Adam and Karl drew in Most XP · 3 days');
    });

    it('mottagen utmaning: sedd av mottagaren, avsändaren och andra', () => {
      const received = item('challenge_received', 3, { challenge_id: 'c', tier: 'major', metric: 'km', duration_days: 7 }, { actor: NICK, target: ME });
      expect(describeNews(received, ctx())).toEqual({ kind: 'Challenge received', text: 'Nicklas challenged you to Most km · 7 days' });
      expect(describeNews({ ...received, actor: ME, target: ADAM }, ctx())).toEqual({ kind: 'Challenge sent', text: 'You challenged Adam to Most km · 7 days' });
      expect(describeNews({ ...received, actor: KARL, target: ADAM }, ctx())).toEqual({ kind: 'Challenge', text: 'Karl challenged Adam to Most km · 7 days' });
    });
  });

  describe('rank_passed och challenge_accepted (frame N3)', () => {
    it('describeNews: rank_passed ur passerarens, den passerades och en utomståendes perspektiv, per mått', () => {
      // Den passerade (jag): "Passed you".
      expect(describeNews(rankPassed(1), ctx())).toEqual({ kind: 'Passed you', text: 'Karl passed you on the leaderboard — now #2' });
      expect(describeNews(rankPassed(1, {}, { measure: 'challenge_points', passer_rank: 1 }), ctx())).toEqual({
        kind: 'Passed you', text: 'Karl passed you on the challenge standings — now #1',
      });
      // Passeraren (jag): "You passed".
      expect(describeNews(rankPassed(2, { actor: ME, target: KARL }), ctx())).toEqual({ kind: 'You passed', text: 'You passed Karl on the leaderboard — now #2' });
      expect(describeNews(rankPassed(2, { actor: ME, target: NICK }, { measure: 'challenge_points', passer_rank: 3 }), ctx())).toEqual({
        kind: 'You passed', text: 'You passed Nicklas on the challenge standings — now #3',
      });
      // En utomstående: "Rank passed".
      expect(describeNews(rankPassed(3, { actor: ADAM, target: NICK }, { passer_rank: 4 }), ctx())).toEqual({
        kind: 'Rank passed', text: 'Adam passed Nicklas on the leaderboard — now #4',
      });
      expect(describeNews(rankPassed(3, { actor: ADAM, target: NICK }, { measure: 'challenge_points', passer_rank: 4 }), ctx()).text)
        .toBe('Adam passed Nicklas on the challenge standings — now #4');
      // En raderad användare är "a former member".
      expect(describeNews(rankPassed(4, { actor: null }), ctx()).text).toBe('A former member passed you on the leaderboard — now #2');
      expect(describeNews(rankPassed(4, { actor: ADAM, target: null }), ctx()).text).toBe('Adam passed a former member on the leaderboard — now #2');
    });

    it('describeNews: challenge_accepted för utmanaren och för andra', () => {
      // Utmanaren (jag, target): "Karl accepted your challenge".
      expect(describeNews(challengeAccepted(1), ctx())).toEqual({ kind: 'Challenge accepted', text: 'Karl accepted your challenge — it starts tomorrow' });
      // Motståndaren själv (jag, actor) och en utomstående.
      expect(describeNews(challengeAccepted(2, { actor: ME, target: ADAM }), ctx()).text).toBe("You accepted Adam's challenge — it starts tomorrow");
      expect(describeNews(challengeAccepted(3, { actor: KARL, target: ADAM }), ctx())).toEqual({
        kind: 'Challenge accepted', text: "Karl accepted Adam's challenge — it starts tomorrow",
      });
      expect(describeNews(challengeAccepted(4, { actor: KARL, target: null }), ctx()).text).toBe("Karl accepted a former member's challenge — it starts tomorrow");
    });

    it('challenge_accepted: starttiden räknas i Stockholm-dagar från start_date, som övriga utmaningstider', () => {
      const text = (startDate: string, now: Date = NOW) => describeNews(challengeAccepted(1, {}, { start_date: startDate }), ctx({ now })).text;
      expect(text('2026-10-09')).toBe('Karl accepted your challenge — it starts tomorrow');
      // Kalenderdagar, inte 24-timmarsperioder: 23:59 den 8:e (CEST) är fortfarande "i morgon", och vid midnatt har den börjat.
      expect(text('2026-10-09', new Date('2026-10-08T21:59:00Z'))).toBe('Karl accepted your challenge — it starts tomorrow');
      expect(text('2026-10-09', new Date('2026-10-08T22:00:00Z'))).toBe('Karl accepted your challenge — it has started');
      // Längre fram delar texten format med "starts in 2 d" på dueller.
      expect(text('2026-10-10')).toBe('Karl accepted your challenge — it starts in 2 d');
      expect(text('2026-10-08')).toBe('Karl accepted your challenge — it has started');
      expect(text('2026-10-01')).toBe('Karl accepted your challenge — it has started');
    });

    it('raden: kategori rank med trophy, challenge_accepted behåller Challenges (swords)', () => {
      expect(buildNewsRow(rankPassed(1), ctx())).toMatchObject({ category: 'rank', tone: 'rank', icon: 'trophy', emblem: null, kind: 'Passed you' });
      expect(buildNewsRow(challengeAccepted(2), ctx())).toMatchObject({ category: 'challenge', tone: 'challenge', icon: 'swords', kind: 'Challenge accepted' });
      expect(CATEGORY_ICON.rank).toBe('trophy');
    });

    it('describeNews tål en payload utan fält', () => {
      const bare = (row: WireNewsItem, payload: unknown): WireNewsItem => ({ ...row, payload }) as WireNewsItem;
      for (const payload of [{}, null, undefined]) {
        // Utan mått: tabellen "leaderboard"; utan rang: ingen "now #N". Aldrig "undefined", "NaN" eller "null".
        expect(describeNews(bare(rankPassed(1), payload), ctx())?.text, String(payload)).toBe('Karl passed you on the leaderboard');
        // Utan start_date: ingen tidsfras.
        expect(describeNews(bare(challengeAccepted(2), payload), ctx())?.text, String(payload)).toBe('Karl accepted your challenge');
        expect(buildNewsRow(bare(rankPassed(1), payload), ctx())).not.toBeNull();
        expect(buildNewsRow(bare(challengeAccepted(2), payload), ctx())).not.toBeNull();
      }
      const odd = describeNews(bare(rankPassed(3), { measure: 'challenge_points', passer_rank: 'two', passed_rank: Number.NaN }), ctx())?.text;
      expect(odd).toBe('Karl passed you on the challenge standings');
      expect(describeNews(bare(challengeAccepted(4), { start_date: 'not-a-date' }), ctx())?.text).toBe('Karl accepted your challenge');
      expect(describeNews(bare(challengeAccepted(5), { start_date: 7 }), ctx())?.text).toBe('Karl accepted your challenge');
    });
  });

  describe('level, milstolpe, streak', () => {
    it('level up, milstolpe och bruten streak — "You" när det är jag', () => {
      expect(describeNews(levelUp(1, 25), ctx())).toEqual({ kind: 'Level up', text: 'Karl reached level 25' });
      expect(describeNews(levelUp(1, 25, { actor: ME }), ctx()).text).toBe('You reached level 25');
      const milestone = item('run_milestone', 2, { kind: 'total_km', threshold: 1000 }, { actor: ADAM });
      expect(describeNews(milestone, ctx())).toEqual({ kind: 'Milestone', text: `Adam passed ${formatInt(1000)} km in total` });
      expect(describeNews(streakBroken(3), ctx())).toEqual({ kind: 'Streak broken', text: 'Daniel lost a 27-day streak — multiplier back to 1.0×' });
      expect(describeNews(streakBroken(3, { actor: ME }), ctx()).text).toBe('You lost a 27-day streak — multiplier back to 1.0×');
    });
  });

  describe('badge_earned (F7)', () => {
    it('previous_tier null → "earned" med serienamn och tier-namn ur shared', () => {
      expect(describeNews(badgeEarned(1), ctx())).toEqual({ kind: 'Badge earned', text: 'Karl earned Streak Keeper — Common.' });
      expect(describeNews(badgeEarned(1, { actor: ME }, { series: 'night_owl', tier: 3 }), ctx()))
        .toEqual({ kind: 'Badge earned', text: 'You earned Night Owl — Rare.' });
    });

    it('previous_tier satt → "evolved" från gamla till nya tiern', () => {
      expect(describeNews(badgeEarned(1, { actor: ME }, { series: 'milestoner', tier: 3, previous_tier: 2 }), ctx()))
        .toEqual({ kind: 'Badge evolved', text: 'You evolved Milestoner from Uncommon to Rare.' });
      const climber = BADGE_SERIES.find((series) => series.key === 'climber')!;
      expect(describeNews(badgeEarned(1, {}, { series: 'climber', tier: 6, previous_tier: 5 }), ctx()).text)
        .toBe(`Karl evolved ${climber.name} from Epic to Legendary.`);
    });

    it('serie- och tier-namnen kommer ur BADGE_SERIES/TIER_NAMES — varje serie och tier renderas utan hårdkodning', () => {
      for (const series of BADGE_SERIES) {
        TIER_NAMES.forEach((tierName, index) => {
          expect(describeNews(badgeEarned(1, {}, { series: series.key, tier: index + 1 }), ctx()).text)
            .toBe(`Karl earned ${series.name} — ${tierName}.`);
        });
      }
    });

    it('en raderad användare är "A former member"; en okänd serie eller tier ger ett läsbart reservnamn, inte "undefined"', () => {
      expect(describeNews(badgeEarned(1, { actor: null }), ctx()).text).toBe('A former member earned Streak Keeper — Common.');
      const unknown = describeNews(badgeEarned(1, {}, { series: 'retired_series', tier: 9, previous_tier: 8 }), ctx()).text;
      expect(unknown).not.toMatch(/undefined|NaN/);
      expect(unknown).toContain('retired_series');
    });

    it('en payload utan previous_tier (fältet saknas) räknas som earned; utan tier utelämnas tiern — aldrig "undefined"', () => {
      const noPrevious = badgeEarned(1, {}, { series: 'milestoner', tier: 2 });
      delete (noPrevious.payload as { previous_tier?: number | null }).previous_tier;
      expect(describeNews(noPrevious, ctx())).toEqual({ kind: 'Badge earned', text: 'Karl earned Milestoner — Uncommon.' });

      const noTier = badgeEarned(1, {}, { series: 'milestoner', previous_tier: null });
      delete (noTier.payload as { tier?: number }).tier;
      expect(describeNews(noTier, ctx())).toEqual({ kind: 'Badge earned', text: 'Karl earned Milestoner.' });

      const evolvedNoTier = badgeEarned(1, {}, { series: 'milestoner', previous_tier: 1 });
      delete (evolvedNoTier.payload as { tier?: number }).tier;
      expect(describeNews(evolvedNoTier, ctx())).toEqual({ kind: 'Badge evolved', text: 'Karl evolved Milestoner.' });

      const noSeries = badgeEarned(1, {}, { tier: 1 });
      delete (noSeries.payload as { series?: string }).series;
      expect(describeNews(noSeries, ctx()).text).toBe('Karl earned a badge — Common.');

      for (const row of [noPrevious, noTier, evolvedNoTier, noSeries]) expect(describeNews(row, ctx()).text).not.toMatch(/undefined|NaN|null/);
    });

    it('raden ligger i Levels: kategori level, zap-ikon (dekorativ, texten bär betydelsen), grön ton', () => {
      expect(buildNewsRow(badgeEarned(1), ctx())).toMatchObject({ category: 'level', tone: 'level', icon: 'zap', kind: 'Badge earned' });
      expect(buildNewsRow(badgeEarned(1, {}, { tier: 2, previous_tier: 1 }), ctx()).kind).toBe('Badge evolved');
    });

    it('emblem: serien och den NYA nivån för en känd serie; null för okänd serie, tier utanför 1..6 och alla andra typer', () => {
      expect(buildNewsRow(badgeEarned(1), ctx()).emblem).toEqual({ series: 'streak_keeper', tier: 1 });
      expect(buildNewsRow(badgeEarned(1, {}, { series: 'milestoner', tier: 3, previous_tier: 2 }), ctx()).emblem).toEqual({ series: 'milestoner', tier: 3 });
      for (const payload of [{ series: 'retired_series', tier: 2 }, { series: 'milestoner', tier: 9 }, { series: 'milestoner', tier: 0 }, { series: 'milestoner', tier: 2.5 }]) {
        expect(buildNewsRow(badgeEarned(1, {}, payload), ctx()).emblem).toBeNull();
      }
      const noTier = badgeEarned(1, {}, { series: 'milestoner' });
      delete (noTier.payload as { tier?: number }).tier;
      expect(buildNewsRow(noTier, ctx()).emblem).toBeNull();
      expect(buildNewsRow(levelUp(1, 25), ctx()).emblem).toBeNull();
    });
  });

  describe('release_published', () => {
    it('"New version" med texten "RunQuest vX is out — titel"; systemrad utan aktör', () => {
      expect(describeNews(releasePublished(1), ctx())).toEqual({ kind: 'New version', text: 'RunQuest v0.6.1 is out — News about releases' });
      expect(describeNews(releasePublished(1, {}, { version: '0.7.0', title: 'Season stats' }), ctx()).text).toBe('RunQuest v0.7.0 is out — Season stats');
    });

    it('texten är densamma för alla som tittar (ingen "you")', () => {
      expect(describeNews(releasePublished(1), ctx({ viewerId: null })).text).toBe(describeNews(releasePublished(1), ctx()).text);
    });

    it('raden: kategori release, ikon sparkles, ingen emblem; oläst följer vattenmärket som för alla rader', () => {
      expect(buildNewsRow(releasePublished(1), ctx())).toMatchObject({ category: 'release', tone: 'release', icon: 'sparkles', emblem: null, kind: 'New version' });
      expect(buildNewsRow(releasePublished(1, { is_unread: true }), ctx()).unread).toBe(true);
      expect(buildNewsRow(releasePublished(1, { is_unread: true, is_backfill: true }), ctx()).unread).toBe(false);
    });

    it('tåligt mot en payload utan fält: ingen krasch, aldrig "undefined"', () => {
      const noTitle = releasePublished(1);
      delete (noTitle.payload as { title?: string }).title;
      expect(describeNews(noTitle, ctx())).toEqual({ kind: 'New version', text: 'RunQuest v0.6.1 is out' });

      const noVersion = releasePublished(1);
      delete (noVersion.payload as { version?: string }).version;
      expect(describeNews(noVersion, ctx()).text).toBe('A new RunQuest version is out — News about releases');

      const empty = { ...releasePublished(1), payload: {} } as unknown as WireNewsItem;
      expect(describeNews(empty, ctx())?.text).toBe('A new RunQuest version is out');
      expect(buildNewsRow(empty, ctx())).not.toBeNull();

      const nullPayload = { ...releasePublished(1), payload: null } as unknown as WireNewsItem;
      expect(() => buildNewsRow(nullPayload, ctx())).not.toThrow();

      for (const row of [noTitle, noVersion, empty]) expect(describeNews(row, ctx())?.text).not.toMatch(/undefined|NaN|null/);
    });

    it('flödet och popovern tar med raden i tidsordning; en okänd framtida typ filtreras fortfarande bort', () => {
      const unknownFuture = { ...releasePublished(3), type: 'something_new', payload: {} } as unknown as UnknownNewsItem;
      const items: WireNewsItem[] = [releasePublished(2), levelUp(1, 4), unknownFuture];
      const rows = buildNewsGroups(items, ctx()).flatMap((group) => group.rows.map((row) => row.id));
      expect(rows.sort()).toEqual([1, 2]);
      expect(buildPopoverRows(items, ctx(), popover()).map((row) => row.kind).sort()).toEqual(['Level up', 'New version']);
    });
  });

  describe('events', () => {
    it('öppet till midnatt, och med klockslag/veckodag/datum längre fram', () => {
      expect(describeNews(eventOpen(1), ctx())).toEqual({ kind: 'Event open', text: '5K Friday is open until midnight · +25 XP' });
      expect(describeNews(eventOpen(1, {}, { ends_at: '2026-10-08T16:00:00Z' }), ctx()).text).toBe('5K Friday is open until 18:00 · +25 XP');
      expect(describeNews(eventOpen(1, {}, { ends_at: '2026-10-11T21:59:00Z' }), ctx()).text).toBe('5K Friday is open until Sun midnight · +25 XP');
      expect(describeNews(eventOpen(1, {}, { ends_at: '2026-10-20T21:59:00Z' }), ctx()).text).toBe('5K Friday is open until 20 Oct · +25 XP');
    });

    it('ett event som redan stängt ("opened"), en tävling visar förstapriset, och utan belöning utelämnas den', () => {
      expect(describeNews(eventOpen(1, {}, { ends_at: '2026-10-07T21:59:00Z' }), ctx()).text).toBe('5K Friday opened · +25 XP');
      expect(describeNews(eventOpen(1, {}, { event_type: 'competition', template_name: 'Weekly km', reward_xp: 100, ends_at: '2026-10-11T21:59:00Z' }), ctx()).text)
        .toBe('Weekly km is open until Sun midnight · 1st place +100 XP');
      expect(describeNews(eventOpen(1, {}, { reward_xp: null }), ctx()).text).toBe('5K Friday is open until midnight');
    });

    it('event_closed: deltagarsiffran, och tävlingens vinnare ur namnuppslaget', () => {
      const participation = item('event_closed', 5, { event_id: 'e', event_type: 'participation', template_name: 'Morning Run', participants: 4, members: 6 });
      expect(describeNews(participation, ctx())).toEqual({ kind: 'Event closed', text: 'Morning Run closed — 4 of 6 finished it' });
      const competition = item('event_closed', 6, {
        event_id: 'e2', event_type: 'competition', template_name: 'Weekly km', participants: 5, members: 6,
        top: [{ user_id: KARL.id, rank: 1, xp: 100 }, { user_id: ME.id, rank: 2, xp: 60 }],
      });
      expect(describeNews(competition, ctx({ nameOf: (id) => (id === KARL.id ? 'Karl Persson' : null) })).text).toBe('Weekly km closed — Karl won · 5 of 6 took part');
      expect(describeNews(competition, ctx()).text).toBe('Weekly km closed — 5 of 6 took part');
      expect(describeNews({ ...competition, payload: { ...competition.payload, top: [{ user_id: ME.id, rank: 1, xp: 100 }] } }, ctx()).text).toBe('Weekly km closed — You won · 5 of 6 took part');
    });
  });
});

describe('untilText', () => {
  it('samma dag, inom veckan, längre fram', () => {
    expect(untilText('2026-10-08T21:59:00Z', NOW)).toBe('until midnight');
    expect(untilText('2026-10-08T15:30:00Z', NOW)).toBe('until 17:30');
    expect(untilText('2026-10-10T21:59:00Z', NOW)).toBe('until Sat midnight');
    expect(untilText('2026-10-15T10:00:00Z', NOW)).toBe('until 15 Oct');
  });
});

describe('vymodeller', () => {
  it('raden bär kategori, ikon, båda tidsformerna och oläst-flaggan (backfill aldrig oläst)', () => {
    const unread = { ...titleTaken(1, { occurred_at: at(2) }), is_unread: true };
    const model = buildNewsRow(unread, ctx());
    expect(model).toMatchObject({ id: 1, category: 'title', tone: 'title', icon: 'crown', time: '2h', timeLong: '2h ago', unread: true });
    expect(model.timeTitle).toMatch(/^Thu 8 Oct · \d\d:\d\d$/);
    expect(buildNewsRow({ ...unread, is_backfill: true }, ctx()).unread).toBe(false);
  });

  it('en förlorad utmaning har tonen "loss" (popoverns röda prick), kategorin förblir challenge', () => {
    const model = buildNewsRow(challengeWon(1, { occurred_at: at(24) }), ctx());
    expect(model).toMatchObject({ category: 'challenge', tone: 'loss', icon: 'swords' });
    expect(buildNewsRow(challengeWon(1, { actor: ME, target: ADAM }), ctx()).tone).toBe('challenge');
  });

  it('kategoriikonerna ur ikonsetet: crown · swords · zap · calendar · flame', () => {
    const icons = [titleTaken(1), challengeWon(2), levelUp(3, 2), eventOpen(4), streakBroken(5)].map((row) => buildNewsRow(row, ctx()).icon);
    expect(icons).toEqual(['crown', 'swords', 'zap', 'calendar', 'flame']);
  });

  it('buildNewsGroups: rader i dagsgrupper med färdiga vymodeller', () => {
    const groups = buildNewsGroups([titleTaken(3, { occurred_at: at(2) }), levelUp(2, 25, { occurred_at: at(30) }), streakBroken(1, { occurred_at: at(24 * 2) })], ctx());
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.kind)])).toEqual([
      ['Today', ['Title taken']],
      ['Yesterday', ['Level up']],
      ['Earlier this week', ['Streak broken']],
    ]);
  });

  it('popovern: de fem senaste i visningsordning', () => {
    const items = Array.from({ length: 8 }, (_, index) => levelUp(index + 1, index + 1, { occurred_at: at(8 - index) }));
    const rows = buildPopoverRows(items, ctx(), popover());
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.id)).toEqual([8, 7, 6, 5, 4]);
  });
});

describe('klockans popover följer inställningarna', () => {
  const others = (id: number, hoursAgo: number) => levelUp(id, id, { occurred_at: at(hoursAgo) });
  const unknown = (id: number, hoursAgo: number): UnknownNewsItem => ({ ...levelUp(id, 1, { occurred_at: at(hoursAgo) }), type: 'quest_completed', payload: { quest: 'x' } });

  it('buildPopoverRows utesluter egna rader, avstängda slag och okända typer före gränsen på fem', () => {
    const items: WireNewsItem[] = [
      levelUp(30, 3, { actor: ME, occurred_at: at(0.5) }), // egen handling
      streakBroken(29, { occurred_at: at(1) }), // slaget är avstängt
      unknown(28, 1.5),
      ...Array.from({ length: 6 }, (_, index) => others(index + 1, 10 - index)), // sex som släpps igenom, id 6 nyast
    ];
    const rows = buildPopoverRows(items, ctx(), popover({ settings: resolveSettings({ 'notify.streak_broken_others': false }, 'user') }));
    expect(rows.map((row) => row.id)).toEqual([6, 5, 4, 3, 2]);
  });

  it('buildPopoverRows tar med lästa rader av påslagna slag', () => {
    const items = [{ ...others(3, 1), is_unread: true }, { ...others(2, 2), is_unread: false }, { ...streakBroken(1, { occurred_at: at(3) }), is_unread: false }];
    const rows = buildPopoverRows(items, ctx(), popover());
    expect(rows.map((row) => [row.id, row.unread])).toEqual([[3, true], [2, false], [1, false]]);
  });

  it('buildPopoverRows: ett event där jag deltog styrs av event_closed_me, övriga av event_closed_others', () => {
    const closed = (id: number, entrants: string[]) =>
      item('event_closed', id, { event_id: `e${id}`, event_type: 'participation', template_name: '5K', participants: 2, members: 5, entrant_ids: entrants });
    const items = [closed(2, [ME.id, KARL.id]), closed(1, [KARL.id])];

    expect(buildPopoverRows(items, ctx(), popover()).map((row) => row.id)).toEqual([2, 1]);
    const meOff = resolveSettings({ 'notify.event_closed_me': false }, 'user');
    expect(buildPopoverRows(items, ctx(), popover({ settings: meOff })).map((row) => row.id)).toEqual([1]);
    const othersOff = resolveSettings({ 'notify.event_closed_others': false }, 'user');
    expect(buildPopoverRows(items, ctx(), popover({ settings: othersOff })).map((row) => row.id)).toEqual([2]);
  });

  it('buildPopoverRows ger tom lista när allt filtreras bort', () => {
    const items: WireNewsItem[] = [levelUp(3, 3, { actor: ME }), unknown(2, 2), streakBroken(1)];
    const settings = resolveSettings({ 'notify.streak_broken_others': false }, 'user');
    expect(buildPopoverRows(items, ctx(), popover({ settings }))).toEqual([]);
    expect(buildPopoverRows([], ctx(), popover())).toEqual([]);
  });

  it('buildPopoverRows ger tom lista utan betraktare (egna rader går inte att avgöra)', () => {
    expect(buildPopoverRows([others(1, 1)], ctx({ viewerId: null }), popover({ viewerId: null }))).toEqual([]);
  });

  it('buildPopoverRows håller gränsen och ordningen när limit anges', () => {
    const items = Array.from({ length: 4 }, (_, index) => others(index + 1, 8 - index));
    expect(buildPopoverRows(items, ctx(), popover({ limit: 2 })).map((row) => row.id)).toEqual([4, 3]);
  });

  it('classifiableRowOf mappar aktör och mål till id:n (null för en raderad användare) och bär typ och payload', () => {
    const won = challengeWon(1);
    expect(classifiableRowOf(won)).toEqual({ type: 'challenge_won', actorId: won.actor?.id, targetId: ME.id, payload: won.payload });
    expect(classifiableRowOf(titleTaken(2, { actor: null, target: null }))).toMatchObject({ actorId: null, targetId: null });
    expect(classifiableRowOf(unknown(3, 1))).toMatchObject({ type: 'quest_completed' });
  });
});

describe('okända händelsetyper och trasiga rader', () => {
  // Backend kan vara nyare än fliken: typen kommer som string, payloaden är okänd.
  const unknownItem = (id: number, over: Partial<UnknownNewsItem> = {}): UnknownNewsItem => ({ ...levelUp(id, 1), type: 'quest_completed', payload: { quest: 'x' }, ...over });
  const brokenPayload = (id: number): WireNewsItem => ({ ...titleTaken(id), payload: null } as unknown as WireNewsItem);

  it('okänd händelsetyp → ingen krasch, raden filtreras (describeNews: null, buildNewsRow: null)', () => {
    expect(isKnownNewsItem(unknownItem(1))).toBe(false);
    expect(describeNews(unknownItem(1), ctx())).toBeNull();
    expect(buildNewsRow(unknownItem(1), ctx())).toBeNull();
    expect(() => buildNewsGroups([unknownItem(2)], ctx())).not.toThrow();
  });

  it('loggar en varning med id och typ (aldrig payload) när en okänd typ eller en trasig rad filtreras', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      buildNewsRow(unknownItem(701, { payload: { secret: 'hemligt' } }), ctx());
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('id=701 type=quest_completed'));
      buildNewsRow(brokenPayload(702), ctx());
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('id=702 type=title_taken'));
      expect(warn.mock.calls.flat().join(' ')).not.toContain('hemligt');
      // Samma rad vid nästa rendering loggar inte igen.
      warn.mockClear();
      buildNewsRow(unknownItem(701), ctx());
      expect(warn).not.toHaveBeenCalled();
      // Kända, fungerande rader loggar inget.
      buildNewsRow(levelUp(703, 2), ctx());
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('skärmens lista: den okända raden är borta, de kända raderna och dag-grupperna är orörda', () => {
    const groups = buildNewsGroups([unknownItem(4, { occurred_at: at(1) }), titleTaken(3, { occurred_at: at(2) }), unknownItem(2, { occurred_at: at(30) }), levelUp(1, 25, { occurred_at: at(24 * 2) })], ctx());
    expect(groups.map((group) => [group.label, group.rows.map((row) => row.id)])).toEqual([
      ['Today', [3]],
      ['Earlier this week', [1]],
    ]);
  });

  it('en dag som bara hade okända rader ger ingen tom dag-grupp', () => {
    expect(buildNewsGroups([unknownItem(1)], ctx())).toEqual([]);
  });

  it('popovern: okända rader tar ingen av de fem platserna', () => {
    const known = Array.from({ length: 6 }, (_, index) => levelUp(index + 1, index + 1, { occurred_at: at(10 - index) }));
    const rows = buildPopoverRows([unknownItem(99, { occurred_at: at(0) }), ...known], ctx(), popover());
    expect(rows.map((row) => row.id)).toEqual([6, 5, 4, 3, 2]);
  });

  it('chip-räknarna räknar inte okända rader', () => {
    expect(countByFilter([levelUp(1, 2), unknownItem(2), unknownItem(3)])).toEqual({ titles: 0, challenges: 0, ranks: 0, events: 0, levels: 1, badges: 0, streaks: 0 });
  });

  it('flödet behåller okända rader (så att "Mark all read" når det verkliga högsta id:t) men ingen oläst-markör byggs för dem', () => {
    const feed = feedFromPage({ items: [levelUp(8, 3, { is_unread: true })], meta: meta({ unread_count: 2 }) });
    const withUnknown = [unknownItem(9, { is_unread: true }), ...feed.items];
    expect(topIdOf(withUnknown)).toBe(9);
    expect(buildNewsGroups(withUnknown, ctx()).flatMap((group) => group.rows).filter((row) => row.unread).map((row) => row.id)).toEqual([8]);
  });

  it('känd typ med trasig payload (null / tomt objekt) kraschar inte och filtreras', () => {
    expect(() => buildNewsRow(brokenPayload(1), ctx())).not.toThrow();
    expect(buildNewsRow(brokenPayload(1), ctx())).toBeNull();
    expect(buildNewsGroups([brokenPayload(2), levelUp(1, 4)], ctx()).flatMap((group) => group.rows.map((row) => row.id))).toEqual([1]);
    expect(buildNewsRow({ ...challengeWon(3), payload: {} } as unknown as WireNewsItem, ctx())).toBeNull();
  });

  it('en rad med oläslig tid kraschar inte listan', () => {
    expect(buildNewsGroups([{ ...levelUp(1, 4), occurred_at: 'inte-en-tid' }, levelUp(2, 5)], ctx()).flatMap((group) => group.rows.map((row) => row.id))).toEqual([2]);
  });

  it('exhaustiveness: varje känd ACTIVITY_TYPES-typ ger text och rad (Record<ActivityType, …> kräver ett exempel per ny typ vid tsc)', () => {
    const samples: Record<ActivityType, NewsItem> = {
      title_unlocked: item('title_unlocked', 1, { title_id: 't', title_name: 'The Longest Run', metric_key: 'longestRun', value: 5 }, { actor: KARL }),
      title_taken: titleTaken(2),
      title_revoked: item('title_revoked', 3, { title_id: 't', title_name: 'The Longest Run', metric_key: 'longestRun' }, { actor: KARL }),
      challenge_received: item('challenge_received', 4, { challenge_id: 'c', tier: 'bronze', metric: 'distance', duration_days: 7 }, { actor: KARL, target: ME }),
      challenge_won: challengeWon(5),
      challenge_draw: item('challenge_draw', 6, { challenge_id: 'c', tier: 'bronze', metric: 'distance', duration_days: 7, challenger_value: 1, opponent_value: 1 }, { actor: KARL, target: ME }),
      level_up: levelUp(7, 3),
      run_milestone: item('run_milestone', 8, { kind: 'total_km', threshold: 100 }, { actor: KARL }),
      streak_broken: streakBroken(9),
      event_open: eventOpen(10),
      event_closed: item('event_closed', 11, { event_id: 'e', event_type: 'participation', template_name: '5K Friday', participants: 3, members: 5 }),
      badge_earned: badgeEarned(12),
      release_published: releasePublished(13),
      rank_passed: rankPassed(14),
      challenge_accepted: challengeAccepted(15),
    };
    for (const type of ACTIVITY_TYPES) {
      expect(isKnownNewsItem(samples[type]), type).toBe(true);
      expect(describeNews(samples[type], ctx())?.text, type).toBeTruthy();
      expect(buildNewsRow(samples[type], ctx()), type).not.toBeNull();
    }
  });
});

describe('Involves me (vyfilter vid sidan av typchipsen)', () => {
  it('parseInvolvesParam och serializeInvolvesParam: me är på, allt annat är av', () => {
    expect(parseInvolvesParam('me')).toBe(true);
    for (const other of [null, undefined, '', 'ME', 'Me', 'true', '1', 'yes', ' me', 'me,me', 'all']) expect(parseInvolvesParam(other), String(other)).toBe(false);
    expect(serializeInvolvesParam(true)).toBe('me');
    expect(serializeInvolvesParam(false)).toBeNull();
    expect(parseInvolvesParam(serializeInvolvesParam(true))).toBe(true);
  });

  it('involvesMe: aktör, target och deltagare i ett event räknas; en rad utan mig gör det inte', () => {
    const closed = (entrants: unknown) => item('event_closed', 9, { event_id: 'e', event_type: 'participation', template_name: '5K', participants: 2, members: 5, entrant_ids: entrants } as never);
    expect(involvesMe(levelUp(1, 5, { actor: ME }), ME.id)).toBe(true);
    expect(involvesMe(titleTaken(2, { actor: KARL, target: ME }), ME.id)).toBe(true);
    expect(involvesMe(levelUp(3, 5, { actor: KARL }), ME.id)).toBe(false);
    expect(involvesMe(eventOpen(4), ME.id)).toBe(false);
    expect(involvesMe(closed([KARL.id, ME.id]), ME.id)).toBe(true);
    expect(involvesMe(closed([KARL.id]), ME.id)).toBe(false);
    // Fältet kan saknas (äldre rader) eller vara trasigt: aldrig ett kast, bara "inte jag".
    expect(involvesMe(closed(undefined), ME.id)).toBe(false);
    expect(involvesMe(closed('u-me'), ME.id)).toBe(false);
    // Bara event_closed bär deltagarlistan, och utan betraktare är inget "mitt".
    expect(involvesMe({ ...eventOpen(5), payload: { entrant_ids: [ME.id] } } as never, ME.id)).toBe(false);
    expect(involvesMe(levelUp(6, 5, { actor: ME }), null)).toBe(false);
  });

  it('involvesMe matchar som servern: betraktarens id i gemener mot det lagrade, exakt', () => {
    const closed = (entrants: string[]) => item('event_closed', 9, { event_id: 'e', event_type: 'participation', template_name: '5K', participants: 2, members: 5, entrant_ids: entrants } as never);
    // Ett lagrat id med versaler matchar aldrig (servern jämför jsonb exakt mot gemener) ...
    expect(involvesMe(closed(['U-ME']), 'u-me')).toBe(false);
    // ... men en betraktare med versaler gemeniseras, precis som serverns filter gör.
    expect(involvesMe(closed(['u-me']), 'U-ME')).toBe(true);
    expect(involvesMe(levelUp(1, 5, { actor: ref('u-me', 'Me') }), 'U-ME')).toBe(true);
  });

  it('involvesMe utan betraktare är false även för event_closed med deltagare, och kastar inte', () => {
    const closed = item('event_closed', 9, { event_id: 'e', event_type: 'participation', template_name: '5K', participants: 2, members: 5, entrant_ids: [ME.id] } as never);
    expect(() => involvesMe(closed, null)).not.toThrow();
    expect(involvesMe(closed, null)).toBe(false);
    expect(involvesMe(closed, '')).toBe(false);
  });

  it('involvesAnnouncement säger vad filtret visar', () => {
    expect(involvesAnnouncement(true, 4, false)).toBe('Showing 4 rows that involve you');
    expect(involvesAnnouncement(true, 1, false)).toBe('Showing 1 row that involves you');
    expect(involvesAnnouncement(true, 0, false)).toBe('Nothing involves you yet');
    expect(involvesAnnouncement(false, 7, false)).toBe('Showing all pack news');
    // Med ett typfilter vid sidan av beskriver texten raderna, inte hela flödet.
    expect(involvesAnnouncement(false, 3, true)).toBe('Showing 3 rows');
    expect(involvesAnnouncement(true, 2, true)).toBe('Showing 2 rows that involve you');
  });
});
