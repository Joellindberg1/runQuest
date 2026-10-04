import { describe, it, expect } from 'vitest';
import {
  backfillChallenges,
  backfillEvents,
  backfillLevelUps,
  backfillRunMilestones,
  backfillStreakBroken,
  defaultSinceDay,
  filterSince,
  replayLevels,
  sortChronologically,
  streakSegments,
  type BackfillChallengeRow,
} from '../activityBackfill.js';
import { stockholmMidnightIso, type ActivityDraft, type EventActivityRow } from '../activity.js';
import { buildXpLedger } from '../xpLedger.js';
import type { LevelRequirement } from '../levelCalculation.js';

const REQS: LevelRequirement[] = [
  { level: 1, xp_required: 0 }, { level: 2, xp_required: 50 }, { level: 3, xp_required: 100 }, { level: 4, xp_required: 200 },
];
const groups = new Map<string, string | null>([['a', 'g1'], ['b', 'g1'], ['loner', null]]);

function challenge(partial: Partial<BackfillChallengeRow>): BackfillChallengeRow {
  return {
    id: 'c1', group_id: 'g1', status: 'completed', tier: 'minor', metric: 'km', duration_days: 3,
    challenger_id: 'a', opponent_id: 'b', outcome: 'challenger_wins', challenger_final_value: 10, opponent_final_value: 4,
    winner_type: 'multiplier_days', winner_delta: 0.1, winner_duration: 2, loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
    determine_at: '2026-09-20T01:00:00.000Z', end_date: '2026-09-19', created_at: '2026-09-15T08:00:00.000Z',
    ...partial,
  };
}

describe('backfillChallenges', () => {
  it('completed → challenge_won med is_backfill och occurred_at = determine_at', () => {
    const [d] = backfillChallenges([challenge({})]);
    expect(d).toMatchObject({ type: 'challenge_won', is_backfill: true, occurred_at: '2026-09-20T01:00:00.000Z', dedupe_key: 'challenge_settled:c1' });
  });

  it('determine_at saknas → end_date (Stockholm-midnatt)', () => {
    const [d] = backfillChallenges([challenge({ determine_at: null, end_date: '2026-09-19' })]);
    expect(d.occurred_at).toBe(stockholmMidnightIso('2026-09-19'));
  });

  it('draw → challenge_draw', () => {
    const [d] = backfillChallenges([challenge({ outcome: 'draw' })]);
    expect(d.type).toBe('challenge_draw');
  });

  it('pending → challenge_received (created_at); active och okänt utfall ger inget', () => {
    const drafts = backfillChallenges([
      challenge({ id: 'p', status: 'pending', outcome: null }),
      challenge({ id: 'a', status: 'active', outcome: null }),
      challenge({ id: 'x', status: 'completed', outcome: null }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ type: 'challenge_received', occurred_at: '2026-09-15T08:00:00.000Z', dedupe_key: 'challenge_received:p' });
  });
});

describe('backfillEvents', () => {
  const ev = (partial: Partial<EventActivityRow> & { status: string }): EventActivityRow & { status: string } => ({
    id: 'e1', group_id: 'g1', type: 'competition', starts_at: '2026-09-14T00:00:00.000Z', ends_at: '2026-09-20T21:55:00.000Z',
    settled_at: '2026-09-20T22:00:00.000Z',
    template: { name: 'Weekly Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 150 },
    ...partial,
  });

  it('active → event_open (starts_at); scheduled → ingenting', () => {
    const drafts = backfillEvents([ev({ id: 'a', status: 'active' }), ev({ id: 's', status: 'scheduled' })], [], { g1: 6 });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ type: 'event_open', occurred_at: '2026-09-14T00:00:00.000Z', is_backfill: true });
  });

  it('settled → event_closed med participants ur event_entries, members = gruppstorlek och topp 3', () => {
    const entries = [
      { event_id: 'e1', user_id: 'a', rank: 1, xp_awarded: 75 },
      { event_id: 'e1', user_id: 'b', rank: 2, xp_awarded: 45 },
      { event_id: 'e1', user_id: 'c', rank: null, xp_awarded: null },
      { event_id: 'other', user_id: 'a', rank: 1, xp_awarded: 99 },
    ];
    const [d] = backfillEvents([ev({ status: 'settled' })], entries, { g1: 6 });
    expect(d).toMatchObject({ type: 'event_closed', occurred_at: '2026-09-20T22:00:00.000Z', is_backfill: true });
    expect(d.payload).toMatchObject({
      participants: 3, members: 6,
      top: [{ user_id: 'a', rank: 1, xp: 75 }, { user_id: 'b', rank: 2, xp: 45 }],
    });
  });

  it('settled_at saknas (participation) → ends_at', () => {
    const [d] = backfillEvents([ev({ status: 'settled', type: 'participation', settled_at: null })], [], { g1: 6 });
    expect(d.occurred_at).toBe('2026-09-20T21:55:00.000Z');
    expect(d.payload).not.toHaveProperty('top');
  });
});

describe('replayLevels (XP-liggaren)', () => {
  it('ger dagen då kumulativ XP först når varje nivåtröskel, per användare', () => {
    const ledger = buildXpLedger(
      [
        { id: 'r1', user_id: 'a', date: '2026-09-01', xp_gained: 30 },
        { id: 'r2', user_id: 'a', date: '2026-09-02', xp_gained: 30 }, // 60 → nivå 2
        { id: 'r3', user_id: 'a', date: '2026-09-05', xp_gained: 150 }, // 210 → nivå 3 och 4 samma dag
        { id: 'r4', user_id: 'b', date: '2026-09-03', xp_gained: 10 },
      ],
      [],
    );
    expect(replayLevels(ledger, REQS)).toEqual([
      { user_id: 'a', level: 2, date: '2026-09-02' },
      { user_id: 'a', level: 3, date: '2026-09-05' },
      { user_id: 'a', level: 4, date: '2026-09-05' },
    ]);
  });

  it('ordnar efter dag även om liggaren kommer osorterad', () => {
    const out = replayLevels(
      [
        { user_id: 'a', source: 'run', ref_id: 'late', date: '2026-09-09', xp: 40 },
        { user_id: 'a', source: 'run', ref_id: 'early', date: '2026-09-01', xp: 40 },
      ],
      REQS,
    );
    expect(out).toEqual([{ user_id: 'a', level: 2, date: '2026-09-09' }]);
  });

  it('inkluderar event-XP (participation → qualified_at)', () => {
    const ledger = buildXpLedger(
      [{ id: 'r1', user_id: 'a', date: '2026-09-01', xp_gained: 40 }],
      [{ entry_id: 'en1', user_id: 'a', event_id: 'e', event_type: 'participation', xp_awarded: 25, qualified_at: '2026-09-04T10:00:00Z', settled_at: null, ends_at: '2026-09-04T12:00:00Z' }],
    );
    expect(replayLevels(ledger, REQS)).toEqual([{ user_id: 'a', level: 2, date: '2026-09-04' }]);
  });
});

describe('backfillLevelUps', () => {
  it('level_up med level_up:<user>:<level>, midnatt Stockholm, is_backfill; användare utan grupp hoppas över', () => {
    const ledger = [
      { user_id: 'a', source: 'run' as const, ref_id: 'r1', date: '2026-09-02', xp: 60 },
      { user_id: 'loner', source: 'run' as const, ref_id: 'r2', date: '2026-09-02', xp: 60 },
    ];
    const drafts = backfillLevelUps(ledger, REQS, groups);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      type: 'level_up', group_id: 'g1', actor_user_id: 'a', payload: { level: 2 },
      dedupe_key: 'level_up:a:2', occurred_at: stockholmMidnightIso('2026-09-02'), is_backfill: true,
    });
  });
});

describe('backfillRunMilestones', () => {
  it('kumulerar km i datumordning och ger dagen tröskeln passerades; en rad per tröskel', () => {
    const runs = [
      { id: 'r2', user_id: 'a', date: '2026-09-10', distance: 60 },
      { id: 'r1', user_id: 'a', date: '2026-09-01', distance: 50 }, // osorterad inmatning
      { id: 'r3', user_id: 'a', date: '2026-09-20', distance: '160.5' }, // 270.5 → passerar 250
    ];
    const drafts = backfillRunMilestones(runs, groups);
    expect(drafts.map((d) => [d.payload, d.occurred_at])).toEqual([
      [{ kind: 'total_km', threshold: 100 }, stockholmMidnightIso('2026-09-10')],
      [{ kind: 'total_km', threshold: 250 }, stockholmMidnightIso('2026-09-20')],
    ]);
    expect(drafts[0]).toMatchObject({ dedupe_key: 'run_milestone:a:total_km:100', is_backfill: true });
  });

  it('exakt 100 km räknas som passerad', () => {
    const drafts = backfillRunMilestones([{ id: 'r', user_id: 'a', date: '2026-09-01', distance: 100 }], groups);
    expect(drafts).toHaveLength(1);
  });

  it('inga rader under första tröskeln eller för användare utan grupp', () => {
    expect(backfillRunMilestones([{ id: 'r', user_id: 'a', date: '2026-09-01', distance: 99.9 }], groups)).toEqual([]);
    expect(backfillRunMilestones([{ id: 'r', user_id: 'loner', date: '2026-09-01', distance: 500 }], groups)).toEqual([]);
  });
});

describe('streakSegments', () => {
  it('delar upp unika dagar i obrutna följder', () => {
    expect(streakSegments(['2026-09-03', '2026-09-01', '2026-09-02', '2026-09-02', '2026-09-10'])).toEqual([
      { start: '2026-09-01', end: '2026-09-03', length: 3 },
      { start: '2026-09-10', end: '2026-09-10', length: 1 },
    ]);
  });
  it('månadsskifte räknas som obrutet', () => {
    expect(streakSegments(['2026-08-31', '2026-09-01'])).toEqual([{ start: '2026-08-31', end: '2026-09-01', length: 2 }]);
  });
  it('tom lista', () => {
    expect(streakSegments([])).toEqual([]);
  });
});

describe('backfillStreakBroken', () => {
  const days = (start: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ user_id: 'a', date: new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10) }));

  it('följd ≥ T som följts av ett glapp → streak_broken (längd, sista dag, midnatt dag+2)', () => {
    const runs = [...days('2026-09-01', 6), { user_id: 'a', date: '2026-09-12' }];
    const drafts = backfillStreakBroken(runs, groups, 5, '2026-09-13');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      type: 'streak_broken', payload: { length: 6, last_run_date: '2026-09-06' },
      dedupe_key: 'streak_broken:a:2026-09-06', occurred_at: stockholmMidnightIso('2026-09-08'), is_backfill: true,
    });
  });

  it('följd som slutade före igår (end + 2 ≤ idag) räknas som bruten', () => {
    const drafts = backfillStreakBroken(days('2026-09-01', 5), groups, 5, '2026-09-07'); // end 09-05, +2 = 09-07 ≤ idag
    expect(drafts).toHaveLength(1);
  });

  it('följd som slutade igår lever fortfarande (kan räddas idag)', () => {
    expect(backfillStreakBroken(days('2026-09-01', 5), groups, 5, '2026-09-06')).toEqual([]);
  });

  it('följd som är kortare än T ger ingen rad', () => {
    expect(backfillStreakBroken(days('2026-09-01', 4), groups, 5, '2026-09-30')).toEqual([]);
  });

  it('användare utan grupp hoppas över', () => {
    expect(backfillStreakBroken(days('2026-09-01', 6).map((r) => ({ ...r, user_id: 'loner' })), groups, 5, '2026-09-30')).toEqual([]);
  });
});

describe('filterSince / sortChronologically / defaultSinceDay', () => {
  const draft = (key: string, at: string): ActivityDraft => ({
    type: 'level_up', group_id: 'g1', actor_user_id: 'a', target_user_id: null, payload: { level: 2 },
    payload_version: 1, dedupe_key: key, occurred_at: at, is_backfill: true,
  });

  it('filterSince behåller rader från början av Stockholm-dagen', () => {
    const since = stockholmMidnightIso('2026-09-10');
    const kept = filterSince([draft('old', '2026-09-09T21:59:59.000Z'), draft('edge', since), draft('new', '2026-09-20T00:00:00.000Z')], '2026-09-10');
    expect(kept.map((d) => d.dedupe_key)).toEqual(['edge', 'new']);
  });

  it('sortChronologically: occurred_at, sedan dedupe_key; muterar inte indata', () => {
    const input = [draft('b', '2026-09-02T00:00:00.000Z'), draft('z', '2026-09-01T00:00:00.000Z'), draft('a', '2026-09-02T00:00:00.000Z')];
    expect(sortChronologically(input).map((d) => d.dedupe_key)).toEqual(['z', 'a', 'b']);
    expect(input.map((d) => d.dedupe_key)).toEqual(['b', 'z', 'a']);
  });

  it('defaultSinceDay = idag − 90 dagar', () => {
    expect(defaultSinceDay('2026-10-05')).toBe('2026-07-07');
    expect(defaultSinceDay('2026-10-05', 5)).toBe('2026-09-30');
  });
});
