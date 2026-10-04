import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_TYPES,
  RUN_MILESTONES,
  activityKeys,
  addDaysToDay,
  buildChallengeReceivedDraft,
  buildChallengeSettledDraft,
  buildEventClosedDraft,
  buildEventOpenDraft,
  buildLevelUpDrafts,
  buildRunMilestoneDrafts,
  buildStreakBrokenDraft,
  buildTitleDrafts,
  diffTitleHolders,
  isActivityType,
  isStreakBroken,
  levelsCrossed,
  milestonesCrossed,
  stockholmMidnightIso,
  streakBrokenOccurredAt,
  streakBrokenThreshold,
  type ChallengeActivityRow,
  type EventActivityRow,
  type TitleHolder,
} from '../activity.js';

describe('ACTIVITY_TYPES', () => {
  it('är exakt ADR 008:s elva typer, unika', () => {
    expect([...ACTIVITY_TYPES].sort()).toEqual([
      'challenge_draw', 'challenge_received', 'challenge_won', 'event_closed', 'event_open', 'level_up',
      'run_milestone', 'streak_broken', 'title_revoked', 'title_taken', 'title_unlocked',
    ]);
    expect(new Set(ACTIVITY_TYPES).size).toBe(ACTIVITY_TYPES.length);
  });

  it('isActivityType avvisar okända värden och icke-strängar', () => {
    expect(isActivityType('level_up')).toBe(true);
    expect(isActivityType('challenge_lost')).toBe(false);
    expect(isActivityType(5)).toBe(false);
    expect(isActivityType(undefined)).toBe(false);
  });
});

describe('activityKeys (stabila nycklar — live och backfill delar dem)', () => {
  it('följer ADR 008 beslut 3 exakt', () => {
    expect(activityKeys.challengeReceived('c1')).toBe('challenge_received:c1');
    expect(activityKeys.challengeSettled('c1')).toBe('challenge_settled:c1');
    expect(activityKeys.levelUp('u1', 7)).toBe('level_up:u1:7');
    expect(activityKeys.runMilestone('u1', 'total_km', 100)).toBe('run_milestone:u1:total_km:100');
    expect(activityKeys.streakBroken('u1', '2026-10-01')).toBe('streak_broken:u1:2026-10-01');
    expect(activityKeys.eventOpen('e1')).toBe('event_open:e1');
    expect(activityKeys.eventClosed('e1')).toBe('event_closed:e1');
    expect(activityKeys.titleUnlocked('t1', 'u1', 42)).toBe('title_unlocked:t1:u1:42');
    expect(activityKeys.titleTaken('t1', 'new', 'old', 42.5)).toBe('title_taken:t1:new:old:42.5');
    expect(activityKeys.titleRevoked('t1', 'u1', '2026-10-05')).toBe('title_revoked:t1:u1:2026-10-05');
  });

  it('numeriska värden normaliseras (12.5 och "12.5000" ger samma nyckel)', () => {
    expect(activityKeys.titleUnlocked('t', 'u', '12.5000')).toBe(activityKeys.titleUnlocked('t', 'u', 12.5));
    expect(activityKeys.titleTaken('t', 'a', 'b', '7.0000')).toBe(activityKeys.titleTaken('t', 'a', 'b', 7));
  });

  it('challenge_won och challenge_draw delar nyckel (en utmaning avgörs en gång)', () => {
    const base: ChallengeActivityRow = {
      id: 'c9', group_id: 'g', tier: 'minor', metric: 'km', duration_days: 3, challenger_id: 'a', opponent_id: 'b',
    };
    const won = buildChallengeSettledDraft({ ...base, outcome: 'challenger_wins' }, '2026-10-05T10:00:00.000Z')!;
    const draw = buildChallengeSettledDraft({ ...base, outcome: 'draw' }, '2026-10-05T10:00:00.000Z')!;
    expect(won.dedupe_key).toBe(draw.dedupe_key);
  });
});

describe('stockholmMidnightIso', () => {
  it('vinter (CET, +1): midnatt = 23:00 UTC dagen innan', () => {
    expect(stockholmMidnightIso('2026-01-15')).toBe('2026-01-14T23:00:00.000Z');
  });
  it('sommar (CEST, +2): midnatt = 22:00 UTC dagen innan', () => {
    expect(stockholmMidnightIso('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
  });
  it('vårens DST-dag (2026-03-29): midnatt ligger FÖRE växlingen, alltså +1', () => {
    expect(stockholmMidnightIso('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
    expect(stockholmMidnightIso('2026-03-30')).toBe('2026-03-29T22:00:00.000Z');
  });
  it('höstens DST-dag (2026-10-25): midnatt ligger FÖRE växlingen, alltså +2', () => {
    expect(stockholmMidnightIso('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(stockholmMidnightIso('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
  });
});

describe('addDaysToDay', () => {
  it('klarar månads- och årsskiften', () => {
    expect(addDaysToDay('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToDay('2026-12-31', 2)).toBe('2027-01-02');
    expect(addDaysToDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('levelsCrossed', () => {
  it('en rad per uppnådd nivå i (prev, new]', () => {
    expect(levelsCrossed(3, 6)).toEqual([4, 5, 6]);
    expect(levelsCrossed(1, 2)).toEqual([2]);
  });
  it('ingen rad vid oförändrad eller sänkt nivå', () => {
    expect(levelsCrossed(5, 5)).toEqual([]);
    expect(levelsCrossed(6, 4)).toEqual([]);
  });
  it('okänd föregående nivå ger ingen "historieflod"', () => {
    expect(levelsCrossed(null, 12)).toEqual([]);
    expect(levelsCrossed(undefined, 12)).toEqual([]);
  });
});

describe('milestonesCrossed', () => {
  it('prev < tröskel ≤ ny', () => {
    expect(milestonesCrossed(99.5, 100)).toEqual([100]);
    expect(milestonesCrossed(90, 260)).toEqual([100, 250]);
  });
  it('exakt på tröskeln före är redan passerad (prev < tröskel krävs)', () => {
    expect(milestonesCrossed(100, 120)).toEqual([]);
  });
  it('flera milstolpar i ett hopp och ingen rad vid minskning', () => {
    expect(milestonesCrossed(0, 5000)).toEqual([...RUN_MILESTONES]);
    expect(milestonesCrossed(300, 200)).toEqual([]);
  });
  it('saknat föregående värde ger inga rader', () => {
    expect(milestonesCrossed(null, 400)).toEqual([]);
  });
});

describe('streak-brott', () => {
  it('T = lägsta days i streak_multipliers, fallback 5', () => {
    expect(streakBrokenThreshold([{ days: 15 }, { days: 7 }, { days: 30 }])).toBe(7);
    expect(streakBrokenThreshold([])).toBe(5);
    expect(streakBrokenThreshold(null)).toBe(5);
  });
  it('bryts bara när prev ≥ T och ny = 0', () => {
    expect(isStreakBroken(5, 0, 5)).toBe(true);
    expect(isStreakBroken(12, 0, 5)).toBe(true);
    expect(isStreakBroken(4, 0, 5)).toBe(false);
    expect(isStreakBroken(8, 3, 5)).toBe(false);
    expect(isStreakBroken(null, 0, 5)).toBe(false);
  });
  it('occurred_at = 00:00 Stockholm dag last_run_date + 2', () => {
    expect(streakBrokenOccurredAt('2026-01-10')).toBe('2026-01-11T23:00:00.000Z'); // 2026-01-12 00:00 CET
    expect(streakBrokenOccurredAt('2026-06-30')).toBe('2026-07-01T22:00:00.000Z'); // 2026-07-02 00:00 CEST
  });
});

const holder = (title_id: string, user_id: string, value: number): TitleHolder => ({ title_id, user_id, value });
const always = () => true;
const never = () => false;

describe('diffTitleHolders', () => {
  it('ingen → någon = unlocked', () => {
    expect(diffTitleHolders([], [holder('t1', 'a', 10)], always)).toEqual([
      { kind: 'unlocked', title_id: 't1', user_id: 'a', value: 10 },
    ]);
  });

  it('A → B där A behåller sin rad = taken/overtaken', () => {
    const out = diffTitleHolders([holder('t1', 'a', 10)], [holder('t1', 'b', 12)], always);
    expect(out).toEqual([
      { kind: 'taken', title_id: 't1', new_holder_id: 'b', old_holder_id: 'a', value: 12, previous_value: 10, reason: 'overtaken' },
    ]);
  });

  it('A → B där A inte längre har en rad = taken/revoked', () => {
    const out = diffTitleHolders([holder('t1', 'a', 10)], [holder('t1', 'b', 3)], never);
    expect(out[0]).toMatchObject({ kind: 'taken', reason: 'revoked', previous_value: 10, value: 3 });
  });

  it('någon → ingen = revoked (den förra innehavaren)', () => {
    expect(diffTitleHolders([holder('t1', 'a', 10)], [], never)).toEqual([
      { kind: 'revoked', title_id: 't1', user_id: 'a' },
    ]);
  });

  it('samma innehavare med ändrat värde = ingen händelse', () => {
    expect(diffTitleHolders([holder('t1', 'a', 10)], [holder('t1', 'a', 14)], always)).toEqual([]);
  });

  it('ingen förändring alls = tomt', () => {
    expect(diffTitleHolders([holder('t1', 'a', 10)], [holder('t1', 'a', 10)], always)).toEqual([]);
    expect(diffTitleHolders([], [], always)).toEqual([]);
  });

  it('hanterar flera titlar oberoende och i deterministisk (title_id-)ordning', () => {
    const out = diffTitleHolders(
      [holder('t2', 'a', 1), holder('t3', 'c', 5)],
      [holder('t1', 'z', 9), holder('t2', 'b', 2), holder('t3', 'c', 6)],
      always,
    );
    expect(out.map((c) => [c.kind, c.title_id])).toEqual([['unlocked', 't1'], ['taken', 't2']]);
  });

  it('numeriska strängvärden (numeric från PostgREST) normaliseras till tal', () => {
    const out = diffTitleHolders([], [{ title_id: 't1', user_id: 'a', value: '12.5000' as unknown as number }], always);
    expect(out[0]).toMatchObject({ value: 12.5 });
  });

  it('stillHolds anropas med (titleId, förra innehavaren)', () => {
    const seen: Array<[string, string]> = [];
    diffTitleHolders([holder('t1', 'a', 1)], [holder('t1', 'b', 2)], (t, u) => { seen.push([t, u]); return true; });
    expect(seen).toEqual([['t1', 'a']]);
  });
});

describe('buildTitleDrafts', () => {
  const titles = new Map([['t1', { id: 't1', name: 'The Marathoner', metric_key: 'fastest_marathon' }]]);
  const groups = new Map<string, string | null>([['a', 'g1'], ['b', 'g1'], ['x', null]]);
  const at = '2026-10-05T10:00:00.000Z';

  it('title_unlocked: aktör = ny innehavare, ingen target, titelnamn som ögonblicksbild', () => {
    const [d] = buildTitleDrafts([{ kind: 'unlocked', title_id: 't1', user_id: 'a', value: 7 }], titles, groups, at, '2026-10-05');
    expect(d).toMatchObject({
      type: 'title_unlocked', group_id: 'g1', actor_user_id: 'a', target_user_id: null, is_backfill: false,
      payload: { title_id: 't1', title_name: 'The Marathoner', metric_key: 'fastest_marathon', value: 7 },
      dedupe_key: 'title_unlocked:t1:a:7', occurred_at: at,
    });
  });

  it('title_taken: aktör = ny, target = förra; payload bär previous_value och reason', () => {
    const [d] = buildTitleDrafts(
      [{ kind: 'taken', title_id: 't1', new_holder_id: 'b', old_holder_id: 'a', value: 9, previous_value: 7, reason: 'revoked' }],
      titles, groups, at, '2026-10-05',
    );
    expect(d).toMatchObject({
      type: 'title_taken', actor_user_id: 'b', target_user_id: 'a',
      payload: { value: 9, previous_value: 7, reason: 'revoked' }, dedupe_key: 'title_taken:t1:b:a:9',
    });
  });

  it('title_revoked: aktör = förra innehavaren, dagen ingår i nyckeln', () => {
    const [d] = buildTitleDrafts([{ kind: 'revoked', title_id: 't1', user_id: 'a' }], titles, groups, at, '2026-10-05');
    expect(d).toMatchObject({ type: 'title_revoked', actor_user_id: 'a', dedupe_key: 'title_revoked:t1:a:2026-10-05' });
  });

  it('hoppar över rader utan grupp eller utan titelmeta', () => {
    const noGroup = buildTitleDrafts([{ kind: 'unlocked', title_id: 't1', user_id: 'x', value: 1 }], titles, groups, at, 'd');
    const unknownUser = buildTitleDrafts([{ kind: 'unlocked', title_id: 't1', user_id: 'nobody', value: 1 }], titles, groups, at, 'd');
    const noTitle = buildTitleDrafts([{ kind: 'unlocked', title_id: 'tX', user_id: 'a', value: 1 }], titles, groups, at, 'd');
    expect([noGroup, unknownUser, noTitle]).toEqual([[], [], []]);
  });
});

describe('level-/milstolpe-/streakbyggare', () => {
  it('buildLevelUpDrafts: en rad per nivå med level_up:<user>:<level>', () => {
    const drafts = buildLevelUpDrafts('u1', 'g1', 3, 5, '2026-10-05T10:00:00.000Z');
    expect(drafts.map((d) => d.dedupe_key)).toEqual(['level_up:u1:4', 'level_up:u1:5']);
    expect(drafts[0]).toMatchObject({ type: 'level_up', actor_user_id: 'u1', target_user_id: null, payload: { level: 4 }, is_backfill: false });
  });

  it('buildRunMilestoneDrafts: payload {kind,threshold}', () => {
    const [d] = buildRunMilestoneDrafts('u1', 'g1', 95, 101, '2026-10-05T10:00:00.000Z');
    expect(d).toMatchObject({ type: 'run_milestone', payload: { kind: 'total_km', threshold: 100 }, dedupe_key: 'run_milestone:u1:total_km:100' });
  });

  it('buildStreakBrokenDraft: payload {length,last_run_date} och occurred_at kl 00:00 dag+2', () => {
    const d = buildStreakBrokenDraft('u1', 'g1', 9, '2026-01-10');
    expect(d).toMatchObject({
      type: 'streak_broken', payload: { length: 9, last_run_date: '2026-01-10' },
      dedupe_key: 'streak_broken:u1:2026-01-10', occurred_at: stockholmMidnightIso('2026-01-12'),
    });
  });
});

describe('utmaningsbyggare', () => {
  const challenge: ChallengeActivityRow = {
    id: 'c1', group_id: 'g1', status: 'completed', tier: 'major', metric: 'km', duration_days: 7,
    challenger_id: 'ch', opponent_id: 'op', outcome: 'opponent_wins',
    challenger_final_value: '12.5', opponent_final_value: 20,
    winner_type: 'multiplier_days', winner_delta: '0.2', winner_duration: 3,
    loser_type: 'multiplier_days', loser_delta: '-0.1', loser_duration: 2,
  };

  it('challenge_won: vinnaren (motståndaren) → förloraren, värden och boostar ur raden', () => {
    const d = buildChallengeSettledDraft(challenge, '2026-10-05T10:00:00.000Z')!;
    expect(d).toMatchObject({
      type: 'challenge_won', group_id: 'g1', actor_user_id: 'op', target_user_id: 'ch',
      payload: {
        challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7, winner_value: 20, loser_value: 12.5,
        winner_boost: { type: 'multiplier_days', delta: 0.2, duration: 3 },
        loser_boost: { type: 'multiplier_days', delta: -0.1, duration: 2 },
      },
      dedupe_key: 'challenge_settled:c1',
    });
  });

  it('challenger_wins vänder på rollerna', () => {
    const d = buildChallengeSettledDraft({ ...challenge, outcome: 'challenger_wins' }, 'x')!;
    expect(d).toMatchObject({ actor_user_id: 'ch', target_user_id: 'op', payload: { winner_value: 12.5, loser_value: 20 } });
  });

  it('challenge_draw: utmanaren → motståndaren med challenger_value/opponent_value och utan boostar', () => {
    const d = buildChallengeSettledDraft({ ...challenge, outcome: 'draw', challenger_final_value: 5, opponent_final_value: 5 }, 'x')!;
    expect(d.type).toBe('challenge_draw');
    expect(d).toMatchObject({ actor_user_id: 'ch', target_user_id: 'op', payload: { challenger_value: 5, opponent_value: 5 } });
    expect(d.payload).not.toHaveProperty('winner_boost');
  });

  it('okänt eller saknat utfall ger null (ingen gissning)', () => {
    expect(buildChallengeSettledDraft({ ...challenge, outcome: null }, 'x')).toBeNull();
    expect(buildChallengeSettledDraft({ ...challenge, outcome: 'forfeit' }, 'x')).toBeNull();
  });

  it('challenge_received: utmanaren → motståndaren', () => {
    const d = buildChallengeReceivedDraft(challenge, '2026-10-05T09:00:00.000Z');
    expect(d).toMatchObject({
      type: 'challenge_received', actor_user_id: 'ch', target_user_id: 'op',
      payload: { challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7 }, dedupe_key: 'challenge_received:c1',
    });
  });
});

describe('eventbyggare', () => {
  const participation: EventActivityRow = {
    id: 'e1', group_id: 'g1', type: 'participation', starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z',
    template: { name: 'Morning Run', icon: 'sun', reward_xp: 25, reward_xp_1st: null },
  };
  const competition: EventActivityRow = {
    id: 'e2', group_id: 'g1', type: 'competition', starts_at: '2026-10-05T00:00:00.000Z', ends_at: '2026-10-11T21:55:00.000Z',
    template: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 150 },
  };

  it('event_open: occurred_at = starts_at, reward_xp per eventtyp, ingen aktör', () => {
    expect(buildEventOpenDraft(participation)).toMatchObject({
      type: 'event_open', actor_user_id: null, target_user_id: null, occurred_at: participation.starts_at,
      payload: { event_id: 'e1', event_type: 'participation', template_name: 'Morning Run', icon: 'sun', reward_xp: 25, ends_at: participation.ends_at },
      dedupe_key: 'event_open:e1',
    });
    expect(buildEventOpenDraft(competition).payload).toMatchObject({ reward_xp: 150 });
  });

  it('event_closed: participants av members; competition får topp 3 sorterad på rank', () => {
    const d = buildEventClosedDraft(
      competition,
      { participants: 4, members: 6, top: [
        { user_id: 'c', rank: 3, xp: 30 }, { user_id: 'a', rank: 1, xp: 75 },
        { user_id: 'b', rank: 2, xp: 45 }, { user_id: 'd', rank: 4, xp: 0 },
      ] },
      '2026-10-11T21:56:00.000Z',
    );
    expect(d).toMatchObject({ type: 'event_closed', dedupe_key: 'event_closed:e2', occurred_at: '2026-10-11T21:56:00.000Z' });
    expect(d.payload).toMatchObject({ participants: 4, members: 6 });
    expect((d.payload as { top: Array<{ rank: number }> }).top.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it('event_closed för participation har ingen top', () => {
    const d = buildEventClosedDraft(participation, { participants: 1, members: 6, top: [{ user_id: 'a', rank: 1, xp: 1 }] }, 'x');
    expect(d.payload).not.toHaveProperty('top');
  });
});

describe('payloadbyggarna läcker ingen PII (e-post, hashar, tokens, Strava-id)', () => {
  it('extra kolumner i käll-raderna når aldrig payloaden', () => {
    const dirtyChallenge = {
      id: 'c1', group_id: 'g1', tier: 'minor', metric: 'km', duration_days: 3, challenger_id: 'a', opponent_id: 'b',
      outcome: 'challenger_wins', challenger_final_value: 1, opponent_final_value: 0,
      email: 'secret@example.com', password_hash: 'HASH', token_id: 'TOKEN', external_id: 'strava-123', access_token: 'AT',
    } as ChallengeActivityRow;
    const dirtyEvent = {
      id: 'e1', group_id: 'g1', type: 'competition', starts_at: 'a', ends_at: 'b',
      template: { name: 'n', icon: 'i', reward_xp: null, reward_xp_1st: 1, email: 'secret@example.com', strava_id: 99 },
    } as unknown as EventActivityRow;

    const drafts = [
      buildChallengeReceivedDraft(dirtyChallenge, 'x'),
      buildChallengeSettledDraft(dirtyChallenge, 'x')!,
      buildEventOpenDraft(dirtyEvent),
      buildEventClosedDraft(dirtyEvent, { participants: 1, members: 2, top: [] }, 'x'),
    ];
    const json = JSON.stringify(drafts.map((d) => d.payload));
    for (const forbidden of ['secret@example.com', 'HASH', 'TOKEN', 'strava-123', '"AT"', 'email', 'password', 'external_id', 'strava']) {
      expect(json).not.toContain(forbidden);
    }
  });
});
