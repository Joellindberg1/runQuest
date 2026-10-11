import { describe, expect, it } from 'vitest';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER, TIER_NAMES, requirementText, tierFlavor } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from './api';
import {
  applySeen, applyShowcase, buildCollection, buildPopupQueue, buildRunnerBadges, cleanShowcase, dismissSeries, ownedSeriesOf, sameShowcase, skipAllSeries, toggleShowcase,
  type BadgeRow,
} from './badgeModel';

const ME = 'u-me';
const OTHER = 'u-other';
const own = { viewerId: ME, ownerId: ME };
const others = { viewerId: ME, ownerId: OTHER };

const [first, second, third, fourth] = BADGE_SERIES;
const keys = BADGE_SERIES.map((s) => s.key);

const item = (series: string, tier: number, seen?: number): BadgeUserItem => ({
  series, tier, earned_at: '2026-10-01T12:00:00Z', ...(seen === undefined ? {} : { seen_tier: seen }),
});
const user = (items: BadgeUserItem[], showcase: string[] = []): BadgeUserResponse => ({ items, showcase });

/** Rutnät som servern: `held[serie]` = antal med tier >= t för t = 1..6 (fullständigt, nollor inkluderade). */
function group(held: Record<string, number[]>, memberCount: number | null = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const key of keys) {
    holders[key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[key][String(tier)] = held[key]?.[tier - 1] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}

const rowOf = (rows: BadgeRow[], key: string) => rows.find((row) => row.series === key) as BadgeRow;
const textOf = (row: BadgeRow) => JSON.stringify(row);

describe('buildCollection — en rad per serie', () => {
  it('alla serier i BADGE_SERIES-ordning, även utan data (då är de låsta)', () => {
    expect(buildCollection(user([]), undefined, own).map((row) => row.series)).toEqual(keys);
    expect(buildCollection(undefined, undefined, own).map((row) => row.series)).toEqual(keys);
  });

  it('raderna följer BADGE_SERIES-ordningen oavsett items-ordning, och namn/ikon kommer ur shared', () => {
    const rows = buildCollection(user([item(third.key, 2), item(first.key, 1)]), undefined, own);
    expect(rows.map((row) => row.series)).toEqual(keys);
    expect(rows[0]).toMatchObject({ name: first.name, icon: first.icon, metricLabel: first.metricLabel });
  });

  it('en intjänad rad: tier, tiernamn, flavor, kravtext UTAN nivåprefix, pips-text', () => {
    const row = rowOf(buildCollection(user([item('milestoner', 3)]), undefined, own), 'milestoner');
    expect(row).toMatchObject({
      earned: true, tier: 3, tierName: 'Rare', maxed: false,
      flavor: tierFlavor(first, 3), requirement: requirementText(first, 3), pipsLabel: 'Tier 3 of 6',
    });
    expect(row.requirement.startsWith(TIER_NAMES[2])).toBe(false);
    expect(row.requirement).not.toContain(' — ');
    expect(row.unlock).toBeUndefined();
  });

  it('Next-raden: "Next: {Tier} — {krav}" för nästa nivå, utan flavor', () => {
    const row = rowOf(buildCollection(user([item('milestoner', 2)]), undefined, own), 'milestoner');
    expect(row.next).toBe(`Next: Rare — ${requirementText(first, 3)}`);
    expect(row.next).toBe('Next: Rare — A single run of 21.1 km');
    expect(row.next).not.toContain(tierFlavor(first, 3));
  });

  it('maxad serie: ingen Next, maxed = true, flavor kvar', () => {
    const row = rowOf(buildCollection(user([item('milestoner', MAX_TIER)]), undefined, own), 'milestoner');
    expect(row).toMatchObject({ maxed: true, tierName: 'Legendary', pipsLabel: 'Tier 6 of 6', flavor: tierFlavor(first, MAX_TIER) });
    expect(row.next).toBeUndefined();
  });

  it('låst serie: "Unlock: Common — {krav}", måttetikett, ingen flavor/Next/held-by, tier null', () => {
    const rows = buildCollection(user([item('milestoner', 2)]), group({ climber: [6, 5, 4, 3, 2, 1] }), own);
    const row = rowOf(rows, 'climber');
    expect(row).toMatchObject({
      earned: false, tier: null, tierName: null, maxed: false, displayPosition: null,
      metricLabel: BADGE_SERIES[2].metricLabel, unlock: `Unlock: Common — ${requirementText(BADGE_SERIES[2], 1)}`,
    });
    expect(row.flavor).toBeUndefined();
    expect(row.next).toBeUndefined();
    expect(row.heldBy).toBeUndefined();
    expect(row.pipsLabel).toBe('Locked');
  });

  it('inga "undefined"/"null"/"NaN" i någon rads text, i något tillstånd', () => {
    const rows = buildCollection(
      user([item(first.key, MAX_TIER), item(second.key, 1), item(fourth.key, 4)], [first.key]),
      group({ [first.key]: [6, 6, 6, 6, 6, 6], [second.key]: [3] }),
      own,
    );
    for (const row of rows) expect(textOf(row)).not.toMatch(/undefined|NaN|"null"|Infinity/);
    for (const row of rows) for (const value of [row.requirement, row.pipsLabel, row.heldBy, row.next, row.unlock, row.flavor]) {
      if (value !== undefined) expect(value).not.toMatch(/undefined|null|NaN/);
    }
  });

  it('okända serier och ogiltiga tier i svaret ignoreras (ingen krasch): raden är låst', () => {
    const rows = buildCollection(
      user([item('removed_series', 3), item(first.key, 0), item(second.key, 7), item(third.key, 2.5), item(fourth.key, 2)]),
      undefined,
      own,
    );
    expect(rows).toHaveLength(keys.length);
    expect(rows.filter((row) => row.earned).map((row) => row.series)).toEqual([fourth.key]);
  });

  it('displayPosition = plats i det valda showcase-urvalet (1-baserad), annars null; bara ägda serier räknas', () => {
    const rows = buildCollection(user([item(first.key, 1), item(second.key, 2)], [second.key, 'climber', first.key]), undefined, own);
    expect(rowOf(rows, second.key).displayPosition).toBe(1);
    expect(rowOf(rows, first.key).displayPosition).toBe(2);
    expect(rowOf(rows, 'climber').displayPosition).toBeNull();
    expect(rowOf(rows, third.key).displayPosition).toBeNull();
  });
});

describe('buildCollection — held-by (Design Council 1)', () => {
  const earned = user([item(first.key, 3), item(second.key, 2), item(third.key, 1)]);

  it('"Held by X of N in your pack" ur holders[serie][tier] och member_count', () => {
    const rows = buildCollection(earned, group({ [first.key]: [5, 4, 3, 2, 1, 0] }, 6), own);
    expect(rowOf(rows, first.key).heldBy).toBe('Held by 3 of 6 in your pack');
  });

  it('X = 1 på mitt eget kort: "Only you hold this in your pack"', () => {
    const rows = buildCollection(earned, group({ [first.key]: [3, 2, 1, 0, 0, 0] }), own);
    expect(rowOf(rows, first.key).heldBy).toBe('Only you hold this in your pack');
  });

  it('X = 1 på någon annans kort är inte "du": "Held by 1 of N"', () => {
    const rows = buildCollection(earned, group({ [first.key]: [3, 2, 1, 0, 0, 0] }), others);
    expect(rowOf(rows, first.key).heldBy).toBe('Held by 1 of 6 in your pack');
  });

  it('X = N visas på mitt eget kort men göms på andras kort (Runner card)', () => {
    const everyone = group({ [second.key]: [6, 6, 0, 0, 0, 0] }, 6);
    expect(rowOf(buildCollection(earned, everyone, own), second.key).heldBy).toBe('Held by 6 of 6 in your pack');
    expect(rowOf(buildCollection(earned, everyone, others), second.key).heldBy).toBeUndefined();
  });

  it('visas aldrig på låsta serier, hur många som än håller dem', () => {
    const rows = buildCollection(earned, group({ [fourth.key]: [6, 5, 4, 3, 2, 1], speedster: [2] }), own);
    expect(rowOf(rows, fourth.key).earned).toBe(false);
    expect(rowOf(rows, fourth.key).heldBy).toBeUndefined();
    expect(rowOf(rows, 'speedster').heldBy).toBeUndefined();
  });

  it('utelämnas utan platshållare när uppgift saknas: ingen group, ingen member_count, ingen serie/tier i rutnätet', () => {
    expect(rowOf(buildCollection(earned, undefined, own), first.key).heldBy).toBeUndefined();
    expect(rowOf(buildCollection(earned, group({ [first.key]: [5, 4, 3] }, null), own), first.key).heldBy).toBeUndefined();
    const partial: GroupBadges = { members: [], holders: { [first.key]: { '1': 4 } }, member_count: 6 };
    expect(rowOf(buildCollection(earned, partial, own), first.key).heldBy).toBeUndefined();
    const noSeries: GroupBadges = { members: [], holders: {}, member_count: 6 };
    expect(rowOf(buildCollection(earned, noSeries, own), first.key).heldBy).toBeUndefined();
  });

  it('osammanhängande värden utelämnas hellre än visas: X = 0, X > N, N = 0', () => {
    expect(rowOf(buildCollection(earned, group({ [first.key]: [0, 0, 0, 0, 0, 0] }), own), first.key).heldBy).toBeUndefined();
    expect(rowOf(buildCollection(earned, group({ [first.key]: [9, 9, 9, 9, 9, 9] }, 6), own), first.key).heldBy).toBeUndefined();
    expect(rowOf(buildCollection(earned, group({ [first.key]: [1, 1, 1, 1, 1, 1] }, 0), own), first.key).heldBy).toBeUndefined();
  });
});

describe('showcase: cleanShowcase / toggleShowcase / sameShowcase / ownedSeriesOf', () => {
  const owned = [first.key, second.key, third.key, fourth.key];

  it(`cleanShowcase: bara ägda, utan dubbletter, i vald ordning, högst ${MAX_SHOWCASE}`, () => {
    expect(cleanShowcase([second.key, 'speedster', second.key, first.key, third.key, fourth.key], owned)).toEqual([second.key, first.key, third.key]);
    expect(cleanShowcase(['nope'], owned)).toEqual([]);
  });

  it('toggleShowcase lägger till sist, och tar bort en vald', () => {
    expect(toggleShowcase([first.key], owned, second.key)).toEqual([first.key, second.key]);
    expect(toggleShowcase([first.key, second.key], owned, first.key)).toEqual([second.key]);
  });

  it('toggleShowcase: full lista (3) tar inte emot en fjärde, men en vald kan fortfarande tas bort', () => {
    const full = [first.key, second.key, third.key];
    expect(toggleShowcase(full, owned, fourth.key)).toEqual(full);
    expect(toggleShowcase(full, owned, second.key)).toEqual([first.key, third.key]);
  });

  it('toggleShowcase: en låst (ej ägd) serie kan aldrig väljas', () => {
    expect(toggleShowcase([first.key], owned, 'speedster')).toEqual([first.key]);
    expect(toggleShowcase([], [], first.key)).toEqual([]);
  });

  it('toggleShowcase städar ett utkast som innehåller en serie jag tappat', () => {
    expect(toggleShowcase([first.key, 'precisionist'], owned, second.key)).toEqual([first.key, second.key]);
  });

  it('toggleShowcase muterar inte indata', () => {
    const selected = [first.key];
    toggleShowcase(selected, owned, second.key);
    expect(selected).toEqual([first.key]);
  });

  it('sameShowcase jämför innehåll och ordning (för "dirty")', () => {
    expect(sameShowcase([first.key, second.key], [first.key, second.key])).toBe(true);
    expect(sameShowcase([first.key, second.key], [second.key, first.key])).toBe(false);
    expect(sameShowcase([first.key], [])).toBe(false);
  });

  it('ownedSeriesOf: kända serier med giltig tier, i svarets ordning', () => {
    expect(ownedSeriesOf(user([item(second.key, 2), item('removed', 1), item(first.key, 0), item(third.key, 6)]))).toEqual([second.key, third.key]);
    expect(ownedSeriesOf(undefined)).toEqual([]);
  });
});

describe('buildPopupQueue — en post per serie med tier > seen_tier', () => {
  it('bara serier med oviss uppgradering; seen_tier = tier hoppas över', () => {
    const queue = buildPopupQueue([item(first.key, 3, 3), item(second.key, 2, 1), item(third.key, 1, 0)]);
    expect(queue.map((entry) => entry.series)).toEqual([second.key, third.key]);
  });

  it('seen_tier saknas (andras data) ger ingen popup — aldrig en tyst "ny" badge', () => {
    expect(buildPopupQueue([item(first.key, 3), item(second.key, 2)])).toEqual([]);
  });

  it('en post per serie på HÖGSTA tier, även om flera rader finns för serien', () => {
    const queue = buildPopupQueue([item(first.key, 2, 0), item(first.key, 5, 0), item(first.key, 4, 0)]);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ series: first.key, tier: 5 });
  });

  it('ordning = BADGE_SERIES-ordning', () => {
    const queue = buildPopupQueue([item(third.key, 1, 0), item(first.key, 2, 0)]);
    expect(queue.map((entry) => entry.series)).toEqual([first.key, third.key]);
  });

  it('earned (seen_tier 0) respektive evolved (seen_tier >= 1) med fromTier', () => {
    const [earned, evolved] = buildPopupQueue([item(first.key, 1, 0), item(second.key, 4, 2)]);
    expect(earned).toMatchObject({ kind: 'earned', fromTier: null, fromTierName: null });
    expect(evolved).toMatchObject({ kind: 'evolved', fromTier: 2, fromTierName: 'Uncommon', tier: 4, tierName: 'Heroic' });
  });

  it('texterna: namn, ikon, flavor och kravtext (utan nivåprefix) för den NYA tiern', () => {
    const [entry] = buildPopupQueue([item(first.key, 3, 1)]);
    expect(entry).toMatchObject({
      name: first.name, icon: first.icon, flavor: tierFlavor(first, 3), requirement: requirementText(first, 3),
    });
    expect(entry.requirement).not.toContain('Rare —');
  });

  it('held-by i popupen är min egen räkning ("Only you hold this" vid X = 1), utelämnad utan group', () => {
    const grid = group({ [first.key]: [4, 2, 1, 0, 0, 0] });
    expect(buildPopupQueue([item(first.key, 3, 2)], grid)[0].heldBy).toBe('Only you hold this in your pack');
    expect(buildPopupQueue([item(first.key, 3, 2)])[0].heldBy).toBeUndefined();
    expect(buildPopupQueue([item(first.key, 2, 1)], grid)[0].heldBy).toBe('Held by 2 of 6 in your pack');
  });

  it('okända serier och ogiltiga tier hoppas över utan krasch', () => {
    expect(buildPopupQueue([item('removed', 2, 0), item(first.key, 9, 0), item(second.key, 0, 0)])).toEqual([]);
  });

  it('tom lista ger tom kö', () => {
    expect(buildPopupQueue([])).toEqual([]);
  });

  it('avfärdande skickar den enda serien; "Skip all" skickar varje serie i kön', () => {
    const queue = buildPopupQueue([item(first.key, 2, 0), item(third.key, 3, 1), item(second.key, 1, 1)]);
    expect(dismissSeries(queue[1])).toEqual([queue[1].series]);
    expect(skipAllSeries(queue)).toEqual(queue.map((entry) => entry.series));
    expect(skipAllSeries([])).toEqual([]);
  });
});

describe('optimistiska uppdateringar av cachen: applySeen / applyShowcase', () => {
  const data = user([item(first.key, 3, 1), item(second.key, 2, 2), item(third.key, 1, 0)], [first.key]);

  it('applySeen med serier höjer bara de serierna till sin tier; övriga och showcase orörda', () => {
    const next = applySeen(data, [first.key, third.key]);
    expect(next.items.map((entry) => entry.seen_tier)).toEqual([3, 2, 1]);
    expect(next.showcase).toEqual([first.key]);
    expect(applySeen(data, [third.key]).items.map((entry) => entry.seen_tier)).toEqual([1, 2, 1]);
  });

  it('applySeen utan serier = alla (serverns betydelse); [] = inga; sänker aldrig', () => {
    expect(applySeen(data).items.map((entry) => entry.seen_tier)).toEqual([3, 2, 1]);
    expect(applySeen(data, []).items.map((entry) => entry.seen_tier)).toEqual([1, 2, 0]);
    const ahead = user([item(first.key, 2, 5)]);
    expect(applySeen(ahead).items[0].seen_tier).toBe(5);
  });

  it('applySeen rör inte rader utan seen_tier (andras data) och muterar inte indata', () => {
    const others = user([item(first.key, 3)]);
    expect(applySeen(others).items[0]).not.toHaveProperty('seen_tier');
    applySeen(data);
    expect(data.items[0].seen_tier).toBe(1);
  });

  it('applySeen: efter en uppdatering är kön tom', () => {
    expect(buildPopupQueue(applySeen(data).items)).toEqual([]);
  });

  it('applyShowcase byter showcase-listan och lämnar items orörda', () => {
    const next = applyShowcase(data, [second.key, first.key]);
    expect(next.showcase).toEqual([second.key, first.key]);
    expect(next.items).toBe(data.items);
    expect(data.showcase).toEqual([first.key]);
  });
});

describe('buildRunnerBadges — Runner card (spec F4)', () => {
  const [s1, s2, s3, s4, s5] = keys;

  it('bara intjänade serier: låsta listas inte', () => {
    const { rows } = buildRunnerBadges(user([item(s2, 2), item(s4, 1)]), undefined, others);
    expect(rows.map((row) => row.series).sort()).toEqual([s2, s4].sort());
    expect(rows.every((row) => row.earned)).toBe(true);
  });

  it('ordning: visade först (i användarens ordning), sedan högst tier, sedan BADGE_SERIES-ordning', () => {
    // s5, s3 och s1 är visade (i den ordningen); s2 och s4 står på samma tier och skiljs av serieordningen.
    const items = [item(s1, 1), item(s2, 4), item(s3, 6), item(s4, 4), item(s5, 2)];
    const { rows } = buildRunnerBadges(user(items, [s5, s3, s1]), undefined, others);
    expect(rows.map((row) => row.series)).toEqual([s5, s3, s1, s2, s4]);
  });

  it('utan visade badges: högst tier först, lika tier i serieordning', () => {
    const { rows } = buildRunnerBadges(user([item(s1, 2), item(s2, 5), item(s3, 5), item(s4, 3)]), undefined, others);
    expect(rows.map((row) => row.series)).toEqual([s2, s3, s4, s1]);
  });

  it('showcase = de visade i användarens ordning med sin tier (minis i hjältekortet); inget visat ger tom lista', () => {
    const items = [item(s1, 1), item(s2, 4), item(s3, 6)];
    expect(buildRunnerBadges(user(items, [s3, s1]), undefined, others).showcase).toEqual([{ series: s3, tier: 6 }, { series: s1, tier: 1 }]);
    expect(buildRunnerBadges(user(items), undefined, others).showcase).toEqual([]);
  });

  it('en visad serie som löparen inte äger, och mer än tre, städas bort', () => {
    const items = [item(s1, 1), item(s2, 2), item(s3, 3), item(s4, 4)];
    const { showcase } = buildRunnerBadges(user(items, [s5, s4, s3, s2, s1]), undefined, others);
    expect(showcase).toEqual([{ series: s4, tier: 4 }, { series: s3, tier: 3 }, { series: s2, tier: 2 }]);
  });

  it('held-by göms när X = N på andras kort, finns annars, och utelämnas utan group', () => {
    const grid = group({ [s1]: [6, 6, 5, 1, 1, 1], [s2]: [6, 3, 2, 1, 1, 1] }, 6);
    const items = [item(s1, 2), item(s2, 2)];
    const withGroup = buildRunnerBadges(user(items), grid, others).rows;
    expect(rowOf(withGroup, s1).heldBy).toBeUndefined();
    expect(rowOf(withGroup, s2).heldBy).toBe('Held by 3 of 6 in your pack');
    const without = buildRunnerBadges(user(items), undefined, others).rows;
    expect(without.every((row) => row.heldBy === undefined)).toBe(true);
  });

  it('utan svar (laddar/fel) eller utan serier: tomma rader och tom showcase', () => {
    expect(buildRunnerBadges(undefined, undefined, others)).toEqual({ rows: [], showcase: [] });
    expect(buildRunnerBadges(user([]), undefined, others)).toEqual({ rows: [], showcase: [] });
  });

  it('okända serier och ogiltiga tier från en annan serverversion ignoreras', () => {
    const { rows, showcase } = buildRunnerBadges(user([item('nonexistent', 3), item(s1, 9), item(s2, 2)], ['nonexistent', s1, s2]), undefined, others);
    expect(rows.map((row) => row.series)).toEqual([s2]);
    expect(showcase).toEqual([{ series: s2, tier: 2 }]);
  });
});
