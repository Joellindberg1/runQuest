import { describe, expect, it } from 'vitest';
import type { EventItem } from '@runquest/shared';
import {
  FIVE_K, H_COMPETITION_FOURTH, H_COMPETITION_SECOND, H_COMPETITION_SKIPPED, H_HANGOVER_MISSED, H_MORNING_DONE, H_STORM_DONE, HANGOVER,
  LIVE_ELEVATION, NOW, WEEKLY_KM, event, mine,
} from './events.fixture';
import {
  buildEventsView, buildHistoryRows, buildRecord, eventPhase, pageCount, pagerItems, parsePage, summaryText, takenCount, weatherTags,
} from './eventsModel';

describe('eventPhase', () => {
  it('före start är upcoming, i fönstret open, efter slut ended', () => {
    expect(eventPhase(HANGOVER, NOW)).toBe('upcoming');
    expect(eventPhase(FIVE_K, NOW)).toBe('open');
    expect(eventPhase(FIVE_K, new Date('2026-10-02T21:59:00Z'))).toBe('ended');
  });

  it('ett event som startat men fortfarande har status "scheduled" räknas som öppet (cron var 5:e minut)', () => {
    const justStarted = event({ id: 'e-x', status: 'scheduled', startsAt: '2026-10-02T15:40:00Z', endsAt: '2026-10-02T20:00:00Z' });
    expect(eventPhase(justStarted, NOW)).toBe('open');
  });
});

describe('eventPhase — exakta gränser', () => {
  it('now == startsAt är open och now == endsAt är ended; en millisekund före start är upcoming', () => {
    const window = { startsAt: '2026-10-02T10:00:00Z', endsAt: '2026-10-02T12:00:00Z' };
    expect(eventPhase(window, new Date('2026-10-02T09:59:59.999Z'))).toBe('upcoming');
    expect(eventPhase(window, new Date('2026-10-02T10:00:00Z'))).toBe('open');
    expect(eventPhase(window, new Date('2026-10-02T11:59:59.999Z'))).toBe('open');
    expect(eventPhase(window, new Date('2026-10-02T12:00:00Z'))).toBe('ended');
  });
});

describe('XP för ett klarat event: samma regel i kort, historik och facit', () => {
  const zero = { ...H_MORNING_DONE, myEntry: mine({ xpAwarded: 0 }) };
  it('0 (eller null) i xpAwarded faller tillbaka på mallens belöning överallt', () => {
    expect(buildHistoryRows([zero])[0].xp).toBe('+25 XP');
    expect(buildRecord([zero])?.earned).toBe(25);
    const open = buildEventsView([{ ...FIVE_K, myEntry: mine({ xpAwarded: 0 }) }], NOW).open[0];
    expect(open.chips.at(-1)?.label).toBe('Done · +25 XP');
  });
});

describe('buildEventsView — öppet nu', () => {
  const view = buildEventsView([FIVE_K, HANGOVER, WEEKLY_KM], NOW);

  it('öppna kort, antal, up next och resten av veckan', () => {
    expect(view.openCount).toBe(1);
    expect(view.open.map((card) => card.name)).toEqual(['5K Friday']);
    expect(view.upNext?.name).toBe('Hangover Run');
    expect(view.week.map((row) => row.name)).toEqual(['Weekly km']);
  });

  it('participation-kortet: regeln ordagrant, nedräkning, ring och "4 of 6 done"', () => {
    const card = view.open[0];
    expect(card.rule).toBe('Run 5 km or more before midnight');
    expect(card.countdown).toBe('6h 13m');
    expect(card.ringLabel).toBe('left to run');
    expect(card.ringFraction).toBeCloseTo((6 * 60 + 13) / (24 * 60 - 1), 3);
    expect(card.doneText).toBe('4 of 6 done');
    expect(card.doneFraction).toBeCloseTo(4 / 6);
    expect(card.board).toBeNull();
  });

  it('chips: minimidistans, stängningstid och värdetagg i den ordningen', () => {
    expect(view.open[0].chips.map((chip) => [chip.tone, chip.label])).toEqual([
      ['tag', 'Min 5 km'], ['tag', 'Closes 23:59'], ['reward', '+25 XP'],
    ]);
  });

  it('har jag klarat eventet byts värdetaggen mot "Done" med den XP jag fick', () => {
    const done = buildEventsView([{ ...FIVE_K, myEntry: mine({ xpAwarded: 25 }) }], NOW).open[0];
    expect(done.mineDone).toBe(true);
    expect(done.chips.at(-1)).toEqual({ key: 'reward', label: 'Done · +25 XP', tone: 'done' });
  });

  it('väder-villkor blir taggar, oavsett om databasen har text eller lista', () => {
    expect(weatherTags('rain')).toEqual(['rain']);
    expect(weatherTags(['rain', 'wind'])).toEqual(['rain', 'wind']);
    expect(weatherTags(null)).toEqual([]);
    const storm = buildEventsView([{ ...FIVE_K, template: { ...FIVE_K.template, requiresWeather: 'rain' } }], NOW).open[0];
    expect(storm.chips.map((chip) => chip.label)).toContain('rain');
  });

  it('"X of Y" blir aldrig större än gruppen (före detta medlemmar har kvar sina entries)', () => {
    expect(takenCount({ participantCount: 8, memberCount: 6 })).toBe(6);
  });

  it('inget event: tomt öppet, ingen up next', () => {
    expect(buildEventsView([], NOW)).toEqual({ open: [], openCount: 0, upNext: null, week: [] });
  });
});

describe('buildEventsView — up next och veckan', () => {
  it('up next är det som öppnar först; veckodagen räknas från Stockholm-dagen', () => {
    const view = buildEventsView([WEEKLY_KM, HANGOVER], NOW);
    expect(view.upNext).toMatchObject({ name: 'Hangover Run', countdown: '6h 14m', facts: '5 km · all day · +40 XP' });
    expect(view.week[0]).toMatchObject({ name: 'Weekly km', day: 'Mon', kindLabel: 'Competition', reward: 'Up to 100 XP' });
  });

  it('en tävling som up next: fönstret över flera dagar och högsta priset i faktaraden', () => {
    const view = buildEventsView([WEEKLY_KM], NOW);
    expect(view.upNext?.facts).toBe('Mon 00:01 – Sun 23:59 · up to 100 XP');
    expect(view.upNext?.chips.map((chip) => chip.label)).toEqual(['Total distance', 'Up to 100 XP']);
  });

  it('ett participation-event som passerat sitt slut visas inte (det avräknas inom fem minuter)', () => {
    const over = new Date('2026-10-02T22:30:00Z');
    expect(buildEventsView([FIVE_K], over).open).toEqual([]);
  });
});

describe('buildEventsView — tävling', () => {
  const view = buildEventsView([LIVE_ELEVATION, FIVE_K], NOW);

  it('participation före competition', () => {
    expect(view.open.map((card) => card.kind)).toEqual(['participation', 'competition']);
  });

  it('tabellen: rank, "You" i stället för Du, värde i höjdmeter och pris för topp tre', () => {
    const board = view.open[1].board;
    expect(board?.map((entry) => [entry.rank, entry.name, entry.mine, entry.value, entry.prize])).toEqual([
      [1, 'Karl Persson', false, '612 m', '+100 XP'],
      [2, 'You', true, '540 m', '+60 XP'],
      [3, 'Adam Einstein', false, '198 m', '+30 XP'],
    ]);
    expect(view.open[1].boardNote).toBeNull();
  });

  it('fjärde plats får inget pris; saknad rank faller tillbaka på ordningen', () => {
    const tied = { ...LIVE_ELEVATION, leaderboard: [
      { userId: 'a', userName: 'A', totalValue: 5, rank: null, isMe: false },
      { userId: 'b', userName: 'B', totalValue: 4, rank: null, isMe: false },
    ] satisfies EventItem['leaderboard'] };
    expect(buildEventsView([tied], NOW).open[0].board?.map((entry) => entry.rank)).toEqual([1, 2]);
    const four = { ...LIVE_ELEVATION, leaderboard: [{ userId: 'd', userName: 'D', totalValue: 1, rank: 4, isMe: false }] };
    expect(buildEventsView([four], NOW).open[0].board?.[0].prize).toBeNull();
  });

  it('är jag inte med i tävlingen än ger kortet en förklarande rad', () => {
    const notIn = { ...LIVE_ELEVATION, myEntry: null };
    expect(buildEventsView([notIn], NOW).open[0].boardNote).toContain('log a run');
  });

  it('chips: mått, slut och högsta pris', () => {
    expect(view.open[1].chips.map((chip) => chip.label)).toEqual(['Total elevation', 'Ends Sun 23:59', 'Up to 100 XP']);
    expect(view.open[1].doneText).toBeNull();
  });

  it('efter slutdatum men före avräkningen: "settling", ringen tom, räknas inte som öppen', () => {
    const after = new Date('2026-10-04T22:30:00Z');
    const settling = buildEventsView([LIVE_ELEVATION], after);
    expect(settling.openCount).toBe(0);
    expect(settling.open[0]).toMatchObject({ settling: true, countdown: 'Final', ringLabel: 'settling soon', ringFraction: 0 });
  });
});

describe('buildRecord', () => {
  it('räknar klarade/avslutade participation-event, XP från events och XP som blev kvar', () => {
    const record = buildRecord([H_MORNING_DONE, H_HANGOVER_MISSED, H_STORM_DONE, H_COMPETITION_SECOND, H_COMPETITION_FOURTH]);
    expect(record).toEqual({ taken: 2, total: 3, fraction: 2 / 3, earned: 25 + 50 + 60, left: 40 });
  });

  it('null utan avslutade participation-event (då finns inget facit att visa)', () => {
    expect(buildRecord([])).toBeNull();
    expect(buildRecord([H_COMPETITION_SECOND])).toBeNull();
  });
});

describe('buildHistoryRows', () => {
  const rows = buildHistoryRows([H_MORNING_DONE, H_HANGOVER_MISSED, H_COMPETITION_SECOND, H_COMPETITION_FOURTH, H_COMPETITION_SKIPPED]);

  it('participation: Done med XP, Missed med streck', () => {
    expect(rows[0]).toMatchObject({ name: 'Morning Run', status: '✓ Done', tone: 'up', xp: '+25 XP', meta: '28 Sep · 4 of 6 finished' });
    expect(rows[1]).toMatchObject({ name: 'Hangover Run', status: 'Missed', tone: 'down', xp: '—', meta: '27 Sep · 2 of 6 finished' });
  });

  it('tävling: placering färgad efter pallen, "entered" i stället för "finished"', () => {
    expect(rows[2]).toMatchObject({ status: '#2', tone: 'rank-2', xp: '+60 XP', meta: '21 Sep – 27 Sep · 5 of 6 entered' });
    expect(rows[3]).toMatchObject({ status: '#4', tone: 'muted', xp: '—' });
  });

  it('tävling jag inte var med i är Missed', () => {
    expect(rows[4]).toMatchObject({ status: 'Missed', tone: 'down', xp: '—' });
  });

  it('en deltagare utan rank är "Entered"', () => {
    const entered = { ...H_COMPETITION_SECOND, myEntry: mine({ rank: null, xpAwarded: null }) };
    expect(buildHistoryRows([entered])[0]).toMatchObject({ status: 'Entered', tone: 'muted', xp: '—' });
  });

  it('utan gruppstorlek visas bara datumet', () => {
    expect(buildHistoryRows([{ ...H_MORNING_DONE, memberCount: 0 }])[0].meta).toBe('28 Sep');
  });
});

describe('paginering', () => {
  it('parsePage: positivt heltal, annars 1', () => {
    expect([null, '', 'abc', '0', '-2', '1.5', '3', '12'].map(parsePage)).toEqual([1, 1, 1, 1, 1, 1, 3, 12]);
  });

  it('pageCount: minst en sida', () => {
    expect([0, 6, 7, 12, 13].map((total) => pageCount(total))).toEqual([1, 1, 2, 2, 3]);
  });

  it('pagerItems: alla sidor när de får plats, annars första/sista och grannar med luckor', () => {
    const labels = (items: ReturnType<typeof pagerItems>) => items.map((item) => (item.kind === 'page' ? item.page : '…'));
    expect(labels(pagerItems(1, 3))).toEqual([1, 2, 3]);
    expect(labels(pagerItems(1, 12))).toEqual([1, 2, '…', 12]);
    expect(labels(pagerItems(6, 12))).toEqual([1, '…', 5, 6, 7, '…', 12]);
    expect(labels(pagerItems(12, 12))).toEqual([1, '…', 11, 12]);
    expect(labels(pagerItems(3, 12))).toEqual([1, 2, 3, 4, '…', 12]);
  });
});

describe('summaryText', () => {
  const record = { taken: 4, total: 12, fraction: 1 / 3, earned: 100, left: 200 };
  it('mobil: "1 open now · 4 of 12 taken"; desktop lägger till "all-time" (ägarbeslut 2: ingen season)', () => {
    expect(summaryText(1, record, false)).toBe('1 open now · 4 of 12 taken');
    expect(summaryText(1, record, true)).toBe('1 open now · 4 of 12 taken all-time');
  });

  it('inget öppet och inget facit', () => {
    expect(summaryText(0, null, false)).toBe('Nothing open now');
  });
});
