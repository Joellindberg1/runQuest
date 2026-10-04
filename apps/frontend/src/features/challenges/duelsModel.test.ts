import { describe, expect, it } from 'vitest';
import {
  autoStartText, buildBoosts, buildHistoryRows, buildIncoming, buildLiveCards, buildRecord, buildSent, buildStandings, buildTokenGroups,
  nameMap, summaryText, tokenTotal,
} from './duelsModel';
import { ADAM, DAN, KARL, ME, NAMES, NICK, NOW, boost, challenge, historyItem, stat, token } from './duels.fixture';

describe('nameMap', () => {
  it('id → namn ur group-stats', () => {
    expect(nameMap([stat(ME), stat(KARL)])).toEqual({ [ME]: 'Joel Lindberg', [KARL]: 'Karl Persson' });
  });
});

describe('buildLiveCards', () => {
  const mine = challenge({
    id: 'c-mine', challenger_id: ME, opponent_id: ADAM, tier: 'major', metric: 'runs', duration_days: 7, status: 'active',
    start_date: '2026-10-02', end_date: '2026-10-05',
  });
  const other = challenge({
    id: 'c-other', challenger_id: KARL, opponent_id: DAN, tier: 'legendary', metric: 'km', duration_days: 14, status: 'active',
    start_date: '2026-09-25', end_date: '2026-10-13',
  });
  const progress = {
    'c-mine': [{ user_id: ME, value: 5 }, { user_id: ADAM, value: 4 }],
    'c-other': [{ user_id: KARL, value: 48 }, { user_id: DAN, value: 61.2 }],
  };

  it('min duell först, sedan det som slutar snart', () => {
    const cards = buildLiveCards([other, mine], progress, ME, NAMES, NOW);
    expect(cards.map((card) => card.id)).toEqual(['c-mine', 'c-other']);
    expect(cards[0].mine).toBe(true);
    expect(cards[1].mine).toBe(false);
  });

  it('ledaren står till vänster; mitt värde är "mine", annars lead/trail', () => {
    const [mineCard, otherCard] = buildLiveCards([other, mine], progress, ME, NAMES, NOW);
    expect(mineCard.sides.map((side) => [side.shortName, side.value, side.tone])).toEqual([['Joel', '5', 'mine'], ['Adam', '4', 'trail']]);
    expect(otherCard.sides.map((side) => [side.shortName, side.value, side.tone])).toEqual([['Daniel', '61.2', 'lead'], ['Karl', '48.0', 'trail']]);
  });

  it('mitt värde markeras även när jag ligger efter', () => {
    const behind = { 'c-mine': [{ user_id: ME, value: 2 }, { user_id: ADAM, value: 9 }] };
    const [card] = buildLiveCards([mine], behind, ME, NAMES, NOW);
    expect(card.sides.map((side) => [side.shortName, side.tone])).toEqual([['Adam', 'lead'], ['Joel', 'mine']]);
  });

  it('rubrik, längd, insats och tid kvar', () => {
    const [mineCard, otherCard] = buildLiveCards([other, mine], progress, ME, NAMES, NOW);
    expect(mineCard).toMatchObject({ tierLabel: 'Major', metric: 'Most runs', duration: '7 d' });
    expect(mineCard.time).toEqual({ text: 'ends tomorrow', tone: 'duel' });
    expect(mineCard.stake.win).toBe('+0.25× / 10 d');
    expect(otherCard.time).toEqual({ text: '9 d left', tone: 'neutral' });
    expect(otherCard.stake.lose).toBe('−0.25× / 14 d');
  });

  it('en utmaning som inte börjat än visar "starts in …" i stället för tid kvar', () => {
    const waiting = challenge({ id: 'c-wait', challenger_id: KARL, opponent_id: NICK, status: 'active', start_date: '2026-10-05', end_date: '2026-10-12' });
    const [card] = buildLiveCards([waiting], {}, ME, NAMES, NOW);
    expect(card.time).toEqual({ text: 'starts in 12 h', tone: 'neutral' });
  });

  it('saknad framdrift visas som "—", aldrig som en påhittad nolla', () => {
    const [card] = buildLiveCards([other], {}, ME, NAMES, NOW);
    expect(card.sides.map((side) => side.value)).toEqual(['—', '—']);
  });

  it('namn ur group-stats vinner över namnen på raden; okänt faller tillbaka', () => {
    const [card] = buildLiveCards([mine], progress, ME, { ...NAMES, [ADAM]: 'Adam E.' }, NOW);
    expect(card.sides[1].name).toBe('Adam E.');
    const [anon] = buildLiveCards([{ ...mine, opponent_name: undefined as unknown as string }], {}, ME, { [ME]: 'Joel Lindberg' }, NOW);
    expect(anon.sides.map((side) => side.name)).toContain('Unknown');
  });
});

describe('inkommande och skickad', () => {
  it('rubrik "Förnamn · mått · längd", insats och Decline för minor/major', () => {
    const [card] = buildIncoming([challenge({ id: 'c1', challenger_id: NICK, opponent_id: ME, tier: 'major', duration_days: 7 })], NAMES, NOW);
    expect(card).toMatchObject({ id: 'c1', fromId: NICK, from: 'Nicklas von Elling', headline: 'Nicklas · Most km · 7 d', canDecline: true, note: null });
    expect(card.stake.win).toBe('+0.25× / 10 d');
  });

  it('legendary kan inte avböjas och visar när den startar av sig själv', () => {
    const sentAt = '2026-10-02T08:00:00Z'; // + 4 d = 6 okt 08:00 → 1 d 22 h kvar vid 4 okt 10:00
    const [card] = buildIncoming(
      [challenge({ id: 'c2', challenger_id: KARL, opponent_id: ME, tier: 'legendary', legendary_sent_at: sentAt })], NAMES, NOW,
    );
    expect(card.canDecline).toBe(false);
    expect(card.note).toBe('Auto-starts in 1 d 22 h');
  });

  it('autoStartText: passerad tid och saknad tid', () => {
    expect(autoStartText('2026-09-29T08:00:00Z', NOW)).toBe('Auto-starts soon');
    expect(autoStartText(undefined, NOW)).toBeNull();
  });

  it('skickad: väntar på svar, kan dras tillbaka utom legendary', () => {
    const minor = buildSent(challenge({ id: 's1', challenger_id: ME, opponent_id: DAN, tier: 'minor', metric: 'total_xp', duration_days: 5 }), NAMES);
    expect(minor).toMatchObject({ to: 'Daniel Lindblad Lüthje', headline: 'Daniel · Most XP · 5 d', canWithdraw: true, note: 'Waiting for Daniel to respond' });
    const legendary = buildSent(challenge({ id: 's2', challenger_id: ME, opponent_id: DAN, tier: 'legendary' }), NAMES);
    expect(legendary?.canWithdraw).toBe(false);
    expect(buildSent(null, NAMES)).toBeNull();
  });
});

describe('buildTokenGroups', () => {
  const tokens = [
    token({ id: 't1', tier: 'major', metric: 'runs', duration_days: 10 }),
    token({ id: 't2', tier: 'minor', metric: 'runs', duration_days: 5 }),
    token({ id: 't3', tier: 'minor', metric: 'km', duration_days: 7 }),
    token({ id: 't4', tier: 'minor', metric: 'km', duration_days: 7 }),
    token({ id: 't5', tier: 'minor', metric: 'km', duration_days: 5 }),
  ];

  it('nivåerna i designens ordning, bara de som finns', () => {
    const groups = buildTokenGroups(tokens);
    expect(groups.map((group) => [group.tier, group.count])).toEqual([['minor', 4], ['major', 1]]);
    expect(tokenTotal(groups)).toBe(5);
    expect(buildTokenGroups([])).toEqual([]);
  });

  it('tokens med samma nivå, mått och längd slås ihop; raderna ordnas på mått, sedan längd', () => {
    const [minor] = buildTokenGroups(tokens);
    expect(minor.combos.map((combo) => [combo.metric, combo.durationDays, combo.count])).toEqual([
      ['km', 5, 1], ['km', 7, 2], ['runs', 5, 1],
    ]);
    expect(minor.combos[1]).toMatchObject({ tokenId: 't3', metricLabel: 'Most km', durationLabel: '7 days', key: 'minor|km|7' });
  });

  it('insatsen kommer ur token-raden', () => {
    const [minor] = buildTokenGroups(tokens);
    expect(minor.stake.summary).toBe('+0.15× win · −0.07× loss');
  });
});

describe('buildStandings', () => {
  const stats = [
    stat(DAN),
    stat(KARL, { wins: 0, losses: 2 }),
    stat(ME, { wins: 2, losses: 1 }),
    stat(NICK, { wins: 2 }),
    stat(ADAM, { wins: 1, draws: 1 }),
  ];

  it('poäng per match (vinst 1, oavgjort ½), ospelade sist; formaterat med tre decimaler', () => {
    const rows = buildStandings(stats, ME);
    expect(rows.map((row) => [row.rank, row.name, row.pct])).toEqual([
      [1, 'Nicklas von Elling', '1.000'],
      [2, 'Adam Einstein', '0.750'],
      [3, 'Joel Lindberg', '0.667'],
      [4, 'Karl Persson', '0.000'],
      [5, 'Daniel Lindblad Lüthje', '—'],
    ]);
  });

  it('markerar mig; lika poäng avgörs på vinster, sedan namn', () => {
    const rows = buildStandings([stat(KARL, { wins: 1, losses: 1 }), stat(ADAM, { wins: 2, losses: 2 }), stat(ME, { wins: 1, losses: 1 })], ME);
    expect(rows.map((row) => row.userId)).toEqual([ADAM, ME, KARL]);
    expect(rows.find((row) => row.userId === ME)?.mine).toBe(true);
    expect(rows.filter((row) => row.mine)).toHaveLength(1);
  });
});

describe('buildHistoryRows', () => {
  const won = historyItem({ id: 'h1' });
  const lost = historyItem({
    id: 'h2', tier: 'minor', metric: 'total_xp', duration_days: 3, outcome: 'opponent_wins', winner_id: KARL,
    challenger: { id: NICK, name: NAMES[NICK], profile_picture: null, level: 23 },
    opponent: { id: KARL, name: NAMES[KARL], profile_picture: null, level: 24 },
    challenger_value: 171, opponent_value: 204, winner_boost: { type: 'multiplier_days', delta: 0.15, duration: 5 },
  });
  const draw = historyItem({ id: 'h3', outcome: 'draw', winner_id: null, challenger_value: 3, opponent_value: 3 });

  it('vänster = utmanare, höger = motståndare; vinnare och förlorare', () => {
    const [row] = buildHistoryRows([won], ME, false);
    expect(row.left).toMatchObject({ name: 'Joel Lindberg', score: '6', result: 'Win', tone: 'up', mine: true, emphasis: true });
    expect(row.right).toMatchObject({ name: 'Adam Einstein', score: '4', result: 'Loss', tone: 'down', mine: false, emphasis: false });
    expect(row).toMatchObject({ what: 'Major · Most runs', days: '5 d', reward: '+0.25× / 10 d', date: '21 Aug', mine: true });
  });

  it('motståndaren vinner → rollerna byter plats i resultatet; XP-värden i en-GB', () => {
    const [row] = buildHistoryRows([lost], ME, false);
    expect(row.left).toMatchObject({ result: 'Loss', score: '171' });
    expect(row.right).toMatchObject({ result: 'Win', score: '204' });
    expect(row.mine).toBe(false);
    expect(row.reward).toBe('+0.15× / 5 d');
  });

  it('oavgjort: båda "Draw", ingen ändring', () => {
    const [row] = buildHistoryRows([draw], ME, false);
    expect([row.left.result, row.right.result]).toEqual(['Draw', 'Draw']);
    expect(row.left.emphasis && row.right.emphasis).toBe(true);
    expect(row.reward).toBe('No change');
  });

  it('"My matches" behåller bara de jag deltog i, ordningen oförändrad', () => {
    expect(buildHistoryRows([won, lost, draw], ME, false).map((row) => row.id)).toEqual(['h1', 'h2', 'h3']);
    expect(buildHistoryRows([won, lost, draw], ME, true).map((row) => row.id)).toEqual(['h1', 'h3']);
  });

  it('saknat värde visas som "—"', () => {
    const [row] = buildHistoryRows([historyItem({ id: 'h4', challenger_value: null })], ME, false);
    expect(row.left.score).toBe('—');
  });
});

describe('buildBoosts', () => {
  const history = [challenge({ id: 'c-old', challenger_id: ME, opponent_id: ADAM, metric: 'runs', duration_days: 5, status: 'completed' })];

  it('"+0.25× for 4 days" med bakgrunden ur min historik', () => {
    // utgår 8 okt 03:00 UTC; från 4 okt 10:00 UTC återstår 3,7 dygn → 4 dagar
    const [view] = buildBoosts([boost({ id: 'b1' })], history, ME, NAMES, NOW);
    expect(view).toEqual({ id: 'b1', positive: true, headline: '+0.25× for 4 days', detail: 'Won against Adam · most runs · 5 d' });
  });

  it('förlorarens straff: minustecken, "Lost to"', () => {
    const [view] = buildBoosts([boost({ id: 'b2', outcome: 'loser', delta: -0.07 })], history, ME, NAMES, NOW);
    expect(view.positive).toBe(false);
    expect(view.headline).toBe('−0.07× for 4 days');
    expect(view.detail).toBe('Lost to Adam · most runs · 5 d');
  });

  it('utgångna boosts försvinner; saknas utmaningen i historiken utelämnas bakgrunden', () => {
    expect(buildBoosts([boost({ id: 'b3', expires_at: '2026-10-04T09:00:00Z' })], history, ME, NAMES, NOW)).toEqual([]);
    const [view] = buildBoosts([boost({ id: 'b4', challenge_id: 'c-unknown' })], [], ME, NAMES, NOW);
    expect(view.detail).toBeNull();
  });

  it('en dag kvar läses i singular', () => {
    const [view] = buildBoosts([boost({ id: 'b5', expires_at: '2026-10-05T03:00:00Z' })], [], ME, NAMES, NOW);
    expect(view.headline).toBe('+0.25× for 1 day');
  });

  it('boost per runda: laddningarna är totala, mina rundor efter skapandet förbrukar dem', () => {
    const perRun = boost({ id: 'b6', type: 'multiplier_runs', remaining: 3, expires_at: undefined, created_at: '2026-10-01T03:00:00Z' });
    const runs = [{ date: '2026-09-30' }, { date: '2026-10-02' }, { date: '2026-10-03' }];
    expect(buildBoosts([perRun], [], ME, NAMES, NOW, runs)[0].headline).toBe('+0.25× for 1 run');
    expect(buildBoosts([perRun], [], ME, NAMES, NOW, [...runs, { date: '2026-10-04' }])).toEqual([]);
    // Utan kända rundor visas alla laddningar.
    expect(buildBoosts([perRun], [], ME, NAMES, NOW)[0].headline).toBe('+0.25× for 3 runs');
  });

  it('en boost utan slutdatum visas utan längd', () => {
    const [view] = buildBoosts([boost({ id: 'b7', expires_at: undefined })], [], ME, NAMES, NOW);
    expect(view.headline).toBe('+0.25×');
  });
});

describe('buildRecord', () => {
  it('vunna · oavgjorda · förlorade · vinstprocent av alla matcher', () => {
    expect(buildRecord({ wins: 11, draws: 0, losses: 6 }).map((cell) => [cell.key, cell.value])).toEqual([
      ['won', '11'], ['drawn', '0'], ['lost', '6'], ['rate', '65%'],
    ]);
  });

  it('inga matcher → "—" i stället för 0 %; saknad rad räknas som nollor', () => {
    expect(buildRecord(undefined).find((cell) => cell.key === 'rate')?.value).toBe('—');
  });
});

describe('summaryText', () => {
  it('mobil: live och tokens; desktop: även "waiting on you" och "unspent"', () => {
    const counts = { live: 3, waitingOnMe: 1, tokens: 5 };
    expect(summaryText(counts, false)).toBe('3 live · 5 tokens');
    expect(summaryText(counts, true)).toBe('3 live · 1 waiting on you · 5 tokens unspent');
  });

  it('inget väntar → segmentet utelämnas; ett token i singular', () => {
    expect(summaryText({ live: 0, waitingOnMe: 0, tokens: 1 }, true)).toBe('0 live · 1 token unspent');
  });
});
