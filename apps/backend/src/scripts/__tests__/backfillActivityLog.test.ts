/**
 * Backfill-skriptet (ADR 008 beslut 7): dry-run skriver inget, --apply är idempotent via dedupe_key,
 * rader markeras is_backfill, --since/--group avgränsar, titlar backfillas aldrig.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  testDatabaseConnection: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

import { formatReport, parseArgs, runBackfill, supabaseHost } from '../backfillActivityLog.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { stockholmMidnightIso } from '@runquest/shared';

const NOW = new Date('2026-10-05T10:00:00.000Z');

const day = (start: string, i: number) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10);

function seed(): Record<string, Row[]> {
  const template = { name: 'Weekend Km', icon: 'trophy', reward_xp: null, reward_xp_1st: 75 };
  const challenge = (over: Row): Row => ({
    id: 'c1', group_id: 'g1', status: 'completed', tier: 'major', metric: 'km', duration_days: 3, challenger_id: 'a', opponent_id: 'b',
    outcome: 'challenger_wins', challenger_final_value: 12, opponent_final_value: 4,
    winner_type: 'multiplier_days', winner_delta: 0.2, winner_duration: 3, loser_type: 'multiplier_days', loser_delta: -0.1, loser_duration: 2,
    determine_at: '2026-09-20T01:00:00.000Z', end_date: '2026-09-19', created_at: '2026-09-15T08:00:00.000Z', ...over,
  });
  return {
    activity_log: [],
    users: [{ id: 'a', group_id: 'g1' }, { id: 'b', group_id: 'g1' }, { id: 'c', group_id: 'g2' }],
    challenges: [
      challenge({}),
      challenge({ id: 'c2', status: 'pending', outcome: null, created_at: '2026-09-30T08:00:00.000Z', determine_at: null }),
      challenge({ id: 'c3', status: 'active', outcome: null }),
      challenge({ id: 'c4', determine_at: '2026-05-01T01:00:00.000Z', end_date: '2026-04-30' }), // före default --since
      challenge({ id: 'c5', group_id: 'g2', challenger_id: 'c', opponent_id: 'x' }),
    ],
    events: [
      { id: 'e1', group_id: 'g1', type: 'competition', status: 'settled', starts_at: '2026-09-14T00:00:00.000Z', ends_at: '2026-09-20T21:55:00.000Z', settled_at: '2026-09-21T22:00:00.000Z', event_templates: template },
      { id: 'e2', group_id: 'g1', type: 'participation', status: 'active', starts_at: '2026-10-05T06:00:00.000Z', ends_at: '2026-10-05T16:00:00.000Z', settled_at: null, event_templates: { ...template, name: 'Morning Run', reward_xp: 25, reward_xp_1st: null } },
      { id: 'e3', group_id: 'g1', type: 'participation', status: 'scheduled', starts_at: '2026-10-06T06:00:00.000Z', ends_at: '2026-10-06T16:00:00.000Z', settled_at: null, event_templates: template },
    ],
    event_entries: [
      { id: 'n1', event_id: 'e1', user_id: 'a', rank: 1, xp_awarded: 75, qualified_at: null, events: { type: 'competition', settled_at: '2026-09-21T22:00:00.000Z', ends_at: '2026-09-20T21:55:00.000Z' } },
      { id: 'n2', event_id: 'e1', user_id: 'b', rank: 2, xp_awarded: 45, qualified_at: null, events: { type: 'competition', settled_at: '2026-09-21T22:00:00.000Z', ends_at: '2026-09-20T21:55:00.000Z' } },
    ],
    runs: [
      // a: 110 km på två dagar (milstolpe 100 den 08-02), 120 XP (nivå 2 den 08-01, nivå 3 den 08-02)
      { id: 'ra1', user_id: 'a', date: '2026-08-01', distance: 60, xp_gained: 60 },
      { id: 'ra2', user_id: 'a', date: '2026-08-02', distance: 50, xp_gained: 60 },
      // b: sju dagar i rad (09-01 … 09-07) och sedan uppehåll → streak_broken; 70 XP → nivå 2 den 09-05
      ...Array.from({ length: 7 }, (_, i) => ({ id: `rb${i}`, user_id: 'b', date: day('2026-09-01', i), distance: 1, xp_gained: 10 })),
    ],
    level_requirements: [
      { level: 1, xp_required: 0 }, { level: 2, xp_required: 50 }, { level: 3, xp_required: 100 }, { level: 4, xp_required: 200 },
    ],
    streak_multipliers: [{ days: 5 }, { days: 15 }],
  };
}

function use(t: Record<string, Row[]>) {
  return createFakeDb(t, { numericIds: ['activity_log'] }).client as any;
}

const keys = (t: Record<string, Row[]>) => t.activity_log.map((r) => r.dedupe_key);
const options = (over: Partial<Parameters<typeof runBackfill>[1]> = {}) => ({ apply: false, since: '2026-07-07', ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('runBackfill — dry-run', () => {
  it('skriver ingenting men räknar per typ', async () => {
    const t = seed();
    const report = await runBackfill(use(t), options());

    expect(t.activity_log).toHaveLength(0);
    expect(report.inserted).toBe(0);
    const n = (type: keyof typeof report.perType) => report.perType[type].new;
    expect(n('challenge_won')).toBe(2);       // c1 + c5 (c4 ligger före --since)
    expect(n('challenge_received')).toBe(1);  // bara pending: c2
    expect(n('event_open')).toBe(1);          // active e2 (scheduled e3 ger inget)
    expect(n('event_closed')).toBe(1);        // settled e1
    expect(n('level_up')).toBe(4);            // a: 2,3 (195 XP) · b: 2 (09-05) och 3 (09-21, 70 + 45 event-XP = 115)
    expect(n('run_milestone')).toBe(1);       // a: 100 km
    expect(n('streak_broken')).toBe(1);       // b: 7 dagar
    expect(n('title_unlocked') + n('title_taken') + n('title_revoked')).toBe(0);
    expect(report.totalNew).toBe(Object.values(report.perType).reduce((s, r) => s + r.new, 0));
  });
});

describe('runBackfill --apply', () => {
  it('skriver is_backfill-rader med samma nycklar som live, kronologiskt (id-ordning = tidsordning)', async () => {
    const t = seed();
    const report = await runBackfill(use(t), options({ apply: true }));

    expect(report.inserted).toBe(report.totalNew);
    expect(t.activity_log.length).toBe(report.totalNew);
    expect(t.activity_log.every((r) => r.is_backfill === true)).toBe(true);

    // exakt live-nycklarna
    expect(keys(t)).toEqual(expect.arrayContaining([
      'challenge_settled:c1', 'challenge_received:c2', 'event_open:e2', 'event_closed:e1',
      'level_up:a:2', 'level_up:a:3', 'run_milestone:a:total_km:100', 'streak_broken:b:2026-09-07',
    ]));

    // kronologisk skrivordning
    const times = t.activity_log.map((r) => Date.parse(r.occurred_at));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(t.activity_log.map((r) => r.id)).toEqual(t.activity_log.map((_, i) => i + 1));
  });

  it('rätt occurred_at och payload per härledning', async () => {
    const t = seed();
    await runBackfill(use(t), options({ apply: true }));
    const by = (k: string) => t.activity_log.find((r) => r.dedupe_key === k)!;

    expect(by('challenge_settled:c1')).toMatchObject({ type: 'challenge_won', actor_user_id: 'a', target_user_id: 'b', occurred_at: '2026-09-20T01:00:00.000Z', payload: { winner_value: 12, loser_value: 4 } });
    expect(by('challenge_received:c2')).toMatchObject({ type: 'challenge_received', occurred_at: '2026-09-30T08:00:00.000Z' });
    expect(by('event_open:e2')).toMatchObject({ occurred_at: '2026-10-05T06:00:00.000Z', payload: { template_name: 'Morning Run', reward_xp: 25 } });
    expect(by('event_closed:e1')).toMatchObject({
      occurred_at: '2026-09-21T22:00:00.000Z',
      payload: { participants: 2, members: 2, top: [{ user_id: 'a', rank: 1, xp: 75 }, { user_id: 'b', rank: 2, xp: 45 }] },
    });
    expect(by('level_up:a:2').occurred_at).toBe(stockholmMidnightIso('2026-08-01'));
    expect(by('level_up:a:3').occurred_at).toBe(stockholmMidnightIso('2026-08-02'));
    expect(by('run_milestone:a:total_km:100').occurred_at).toBe(stockholmMidnightIso('2026-08-02'));
    expect(by('streak_broken:b:2026-09-07')).toMatchObject({ occurred_at: stockholmMidnightIso('2026-09-09'), payload: { length: 7, last_run_date: '2026-09-07' }, group_id: 'g1' });
  });

  it('idempotent: omkörning ger inga dubbletter och 0 nya rader', async () => {
    const t = seed();
    const first = await runBackfill(use(t), options({ apply: true }));
    const before = keys(t);
    const second = await runBackfill(use(t), options({ apply: true }));

    expect(second.totalNew).toBe(0);
    expect(second.inserted).toBe(0);
    expect(keys(t)).toEqual(before);
    expect(new Set(keys(t)).size).toBe(first.inserted);
    expect(Object.values(second.perType).every((r) => r.existing === r.total)).toBe(true);
  });

  it('en redan live-skriven rad (samma nyckel) lämnas orörd och räknas som "finns redan"', async () => {
    const t = seed();
    t.activity_log.push({
      id: 1, dedupe_key: 'challenge_settled:c1', type: 'challenge_won', is_backfill: false, occurred_at: '2026-09-20T01:05:00.000Z', group_id: 'g1', payload: {},
    });
    const report = await runBackfill(use(t), options({ apply: true }));
    const row = t.activity_log.find((r) => r.dedupe_key === 'challenge_settled:c1')!;
    expect(row.is_backfill).toBe(false);
    expect(row.occurred_at).toBe('2026-09-20T01:05:00.000Z');
    expect(t.activity_log.filter((r) => r.dedupe_key === 'challenge_settled:c1')).toHaveLength(1);
    expect(report.perType.challenge_won).toMatchObject({ total: 2, existing: 1, new: 1 });
  });

  it('en andra körning efter att live-kod skrivit en ny händelse rör inte den', async () => {
    const t = seed();
    await runBackfill(use(t), options({ apply: true }));
    t.activity_log.push({ id: 999, dedupe_key: 'level_up:b:4', type: 'level_up', is_backfill: false, occurred_at: NOW.toISOString(), group_id: 'g1', payload: { level: 4 } });
    await runBackfill(use(t), options({ apply: true }));
    expect(t.activity_log.filter((r) => r.dedupe_key === 'level_up:b:4')).toHaveLength(1);
  });
});

describe('--since och --group', () => {
  it('--since släpper bara igenom händelser från dagen och framåt', async () => {
    const t = seed();
    const report = await runBackfill(use(t), options({ since: '2026-09-25' }));
    // kvar: c2 (09-30), e2 (10-05). Borta: c1 (09-20), e1 (09-21), level_up a (08-0x), streak (09-09), levels b (09-05/09-21)
    expect(report.perType.challenge_received.new).toBe(1);
    expect(report.perType.event_open.new).toBe(1);
    expect(report.perType.challenge_won.new).toBe(0);
    expect(report.perType.event_closed.new).toBe(0);
    expect(report.perType.level_up.new).toBe(0);
    expect(report.perType.streak_broken.new).toBe(0);
    expect(report.perType.run_milestone.new).toBe(0);
  });

  it('level-trösklar spelas upp över HELA historiken även när --since är sent (nivå räknas ur total XP)', async () => {
    const t = seed();
    // b når nivå 3 den 09-21 (70 run-XP + 45 event-XP = 115 ≥ 100); --since=09-21 ska ge just den raden
    const report = await runBackfill(use(t), options({ apply: true, since: '2026-09-21' }));
    expect(t.activity_log.filter((r) => r.type === 'level_up').map((r) => r.dedupe_key)).toEqual(['level_up:b:3']);
    expect(report.perType.level_up.new).toBe(1);
  });

  it('--group avgränsar till en grupp', async () => {
    const t = seed();
    await runBackfill(use(t), options({ apply: true, groupId: 'g2' }));
    expect(keys(t)).toEqual(['challenge_settled:c5']);
    expect(t.activity_log[0].group_id).toBe('g2');
  });

  it('--group för en grupp utan data ger inget (och inget fel)', async () => {
    const t = seed();
    const report = await runBackfill(use(t), options({ apply: true, groupId: 'nobody' }));
    expect(report.totalNew).toBe(0);
    expect(t.activity_log).toHaveLength(0);
  });
});

describe('tom databas och fel', () => {
  it('tomma tabeller → 0 rader utan fel', async () => {
    const t: Record<string, Row[]> = {
      activity_log: [], users: [], challenges: [], events: [], event_entries: [], runs: [], level_requirements: [], streak_multipliers: [],
    };
    const report = await runBackfill(use(t), options({ apply: true }));
    expect(report.totalNew).toBe(0);
  });

  it('databasfel vid skrivning kastar (skriptet avslutar med felkod)', async () => {
    const t = seed();
    const db = createFakeDb(t, { numericIds: ['activity_log'], failWhen: (q) => (q.table === 'activity_log' && q.select === null ? { message: 'write failed' } : null) });
    await expect(runBackfill(db.client as any, options({ apply: true }))).rejects.toMatchObject({ message: 'write failed' });
  });
});

describe('parseArgs', () => {
  it('default: dry-run, since = idag − 90 dagar (Stockholm), alla grupper', () => {
    expect(parseArgs([], '2026-10-05')).toEqual({ apply: false, since: '2026-07-07' });
  });
  it('--apply, --since och --group', () => {
    expect(parseArgs(['--apply', '--since=2026-09-01', '--group=g1'], '2026-10-05')).toEqual({ apply: true, since: '2026-09-01', groupId: 'g1' });
  });
  it('avvisar ogiltigt datum, tom grupp och okända argument', () => {
    expect(() => parseArgs(['--since=2026-02-30'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--since=igår'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--group='])).toThrow(/group/);
    expect(() => parseArgs(['--force'])).toThrow(/Unknown argument/);
  });
});

describe('formatReport', () => {
  it('dry-run-rapporten säger det och visar räknare per typ', async () => {
    const t = seed();
    const text = formatReport(await runBackfill(use(t), options()));
    expect(text).toContain('DRY-RUN');
    expect(text).toContain('Re-run with --apply');
    expect(text).toMatch(/challenge_won\s+2/);
    expect(text).toContain('e.g. streak_broken:b:2026-09-07');
    expect(text).toContain('title_* events are never backfilled');
  });
  it('rapporten (dry-run och apply) visar målets värd ur SUPABASE_URL — aldrig nyckel eller sökväg', async () => {
    const prev = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co/rest/v1?apikey=SECRET';
    try {
      const dry = formatReport(await runBackfill(use(seed()), options()));
      const applied = formatReport(await runBackfill(use(seed()), options({ apply: true })));
      for (const text of [dry, applied]) {
        expect(text).toContain('target database: abcdefgh.supabase.co');
        expect(text).not.toContain('SECRET');
      }
    } finally {
      if (prev === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = prev;
    }
  });
});

describe('supabaseHost', () => {
  it('värd ur URL, "unknown" när den saknas eller är ogiltig', () => {
    expect(supabaseHost('https://x.supabase.co')).toBe('x.supabase.co');
    expect(supabaseHost('')).toBe('unknown');
    expect(supabaseHost('localhost:54321')).toBe('unknown');
    expect(supabaseHost('not a url')).toBe('unknown');
  });
});
