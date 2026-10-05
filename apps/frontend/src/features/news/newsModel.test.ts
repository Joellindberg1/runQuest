import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES } from '@runquest/shared';
import {
  CATEGORY_OF, NEWS_FILTERS, appendOlder, badgeText, buildNewsGroups, buildNewsRow, buildPopoverRows, countByFilter, dedupeById, describeNews,
  feedFromPage, formatAgo, fullTime, gapCursor, groupByDay, isUnread, markSeenInFeed, mergeNewer, parseFilterParam, serializeFilterParam,
  toggleFilter, topIdOf, typeParamOf, typesForFilters, unreadSummary, untilText, type NewsContext,
} from './newsModel';
import { formatInt } from '@/features/log/logFormat';
import { ADAM, DAN, ME, NICK, NOW, KARL, at, challengeWon, eventOpen, item, levelUp, meta, streakBroken, titleTaken } from './news.fixture';

const ctx = (over: Partial<NewsContext> = {}): NewsContext => ({ viewerId: ME.id, now: NOW, ...over });

describe('kategorier och filter', () => {
  it('varje händelsetyp har en kategori och hör till exakt ett filter (en ny typ i shared kräver ett beslut här)', () => {
    for (const type of ACTIVITY_TYPES) {
      expect(CATEGORY_OF[type], type).toBeTruthy();
      expect(NEWS_FILTERS.filter((filter) => filter.types.includes(type)).map((filter) => filter.key), type).toHaveLength(1);
    }
    expect(NEWS_FILTERS.flatMap((filter) => filter.types).sort()).toEqual([...ACTIVITY_TYPES].sort());
  });

  it('Levels = level_up + run_milestone (ADR 008)', () => {
    expect(NEWS_FILTERS.find((filter) => filter.key === 'levels')?.types).toEqual(['level_up', 'run_milestone']);
    expect(CATEGORY_OF.run_milestone).toBe('level');
  });

  it('adressparametern: okända nycklar och dubbletter faller bort, ordningen är chipens, alla fem = inget filter', () => {
    expect(parseFilterParam(null)).toEqual([]);
    expect(parseFilterParam('')).toEqual([]);
    expect(parseFilterParam('levels,titles,titles,nonsense')).toEqual(['titles', 'levels']);
    expect(parseFilterParam('titles,challenges,events,levels,streaks')).toEqual([]);
    expect(serializeFilterParam(['levels', 'titles'])).toBe('titles,levels');
    expect(serializeFilterParam([])).toBeNull();
  });

  it('toggleFilter lägger till och tar bort; det femte valda blir "allt"', () => {
    expect(toggleFilter([], 'events')).toEqual(['events']);
    expect(toggleFilter(['events'], 'titles')).toEqual(['titles', 'events']);
    expect(toggleFilter(['titles', 'events'], 'titles')).toEqual(['events']);
    expect(toggleFilter(['titles', 'challenges', 'events', 'levels'], 'streaks')).toEqual([]);
  });

  it('chipsens typer blir serverns type= i stabil ordning; inget filter = ingen parameter', () => {
    expect(typesForFilters([])).toBeNull();
    expect(typeParamOf(null)).toBeUndefined();
    expect(typesForFilters(['levels', 'titles'])).toEqual(['title_unlocked', 'title_taken', 'title_revoked', 'level_up', 'run_milestone']);
    expect(typeParamOf(typesForFilters(['streaks']))).toBe('streak_broken');
  });

  it('chip-räknarna är antal per kategori i det laddade fönstret', () => {
    const counts = countByFilter([titleTaken(5), titleTaken(4), levelUp(3, 25), streakBroken(2), eventOpen(1)]);
    expect(counts).toEqual({ titles: 2, challenges: 0, events: 1, levels: 1, streaks: 1 });
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
    const rows = buildPopoverRows(items, ctx());
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.id)).toEqual([8, 7, 6, 5, 4]);
  });
});
