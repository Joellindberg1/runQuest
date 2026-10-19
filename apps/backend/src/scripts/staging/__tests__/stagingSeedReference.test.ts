/**
 * staging/stagingSeedReference.ts: copies rules/configuration from prod to staging, nothing else, and only with --read-prod. No real network:
 * a fake prod and a fake staging that applies `insert … on conflict do nothing` to an in-memory table.
 */
import { describe, it, expect } from 'vitest';
import { createFakeManagementApi, isSelect, type RecordedCall } from '../../../test-utils/fakeManagementApi.js';
import {
  ALLOWED_PROD_QUERIES,
  REFERENCE_KEY_COLUMNS,
  REFERENCE_TABLES,
  REFERENCE_TABLE_NAMES,
  buildSeedSql,
  exitCodeFor,
  findMissingKeys,
  parseArgs,
  prodSelectFor,
  runSeedReference,
} from '../stagingSeedReference.js';
import { PROD_PROJECT_REF, STAGING_PROJECT_REF, StagingGuardError } from '../stagingTarget.js';

const STAGING_TOKEN = 'sbp_staging_token_0123456789abcdef0123456789';
const PROD_TOKEN = 'sbp_prod_read_token_0123456789abcdef012345678';
const ENV = { SUPABASE_STAGING_ACCESS_TOKEN: STAGING_TOKEN, RUNQUEST_PROD_READ_TOKEN: PROD_TOKEN };

const PROD_ROWS: Record<string, Record<string, unknown>[]> = {
  challenge_durations: [{ id: 'd1', days: 7 }],
  challenge_metrics: [{ id: 'm1', key: 'distance' }, { id: 'm2', key: 'pace' }],
  challenge_rewards: [{ id: 'r1', xp: 50 }],
  event_templates: [{ id: 'e1', name: "Storm Chaser's run" }],
  event_pools: [{ id: 'p1', name: 'Weekly' }],
  event_pool_members: [{ pool_id: 'p1', template_id: 'e1', weight: 1 }],
  level_challenge_rewards: [{ level: 5, tier: 'bronze' }],
  level_requirements: [{ id: 'q1', level: 1, xp_required: 0 }, { id: 'q2', level: 2, xp_required: 100 }],
  streak_multipliers: [{ id: 's1', days: 3, multiplier: 1.5 }],
  titles: [{ id: 't1', name: 'Marathoner', current_holder_id: null, current_value: null }],
  admin_settings: [{ id: 'a1', admin_password_hash: 'staging-ej-anvand', base_xp: 15 }],
};

/** A prod that answers the exact SELECT the script is allowed to send per table, and a staging that applies the inserts. */
function fakeWorld(options: { dropFromStaging?: string; emptyProdTable?: string } = {}) {
  const staging = new Map<string, Map<string, Record<string, unknown>>>(REFERENCE_TABLE_NAMES.map((t) => [t, new Map()]));
  const prodQueries: string[] = [];
  const api = createFakeManagementApi((call: RecordedCall) => {
    const sql = String(call.body?.query ?? '');
    if (call.ref === PROD_PROJECT_REF) {
      if (call.path !== '/database/query/read-only') return undefined;
      prodQueries.push(sql);
      const table = REFERENCE_TABLE_NAMES.find((t) => sql === prodSelectFor(t));
      return table ? { body: table === options.emptyProdTable ? [] : PROD_ROWS[table] } : undefined;
    }
    if (call.ref !== STAGING_PROJECT_REF) return undefined;
    if (sql.includes('union all')) {
      return { body: REFERENCE_TABLE_NAMES.map((t) => ({ t, n: staging.get(t)?.size ?? 0 })) };
    }
    if (sql.startsWith('begin;')) {
      for (const m of sql.matchAll(/insert into public\.(\w+) \(([^)]*)\) select [^;]*? from json_populate_recordset\(null::public\.\w+, '((?:[^']|'')*)'\) on conflict do nothing;/g)) {
        const rows = JSON.parse(m[3].replace(/''/g, "'")) as Record<string, unknown>[];
        for (const row of rows) {
          if (m[1] === options.dropFromStaging && row === rows[0]) continue;
          staging.get(m[1])?.set(JSON.stringify(row), row);
        }
      }
      return { body: [] };
    }
    const keySelect = /^select ([\w, ]+) from public\.(\w+)$/.exec(sql);
    if (keySelect) {
      const columns = keySelect[1].split(',').map((c) => c.trim());
      return { body: [...(staging.get(keySelect[2])?.values() ?? [])].map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))) };
    }
    return undefined;
  });
  return { api, staging, prodQueries };
}

const run = (flags: { apply?: boolean; readProd?: boolean }, world = fakeWorld(), env: NodeJS.ProcessEnv = ENV) => {
  const printed: string[] = [];
  return runSeedReference({ apply: flags.apply ?? false, readProd: flags.readProd ?? false, env, fetchImpl: world.api.fetchImpl, log: (l) => printed.push(l) }).then((report) => ({
    report,
    printed,
    world,
  }));
};

describe('seed-reference reads only the allowed tables', () => {
  it('lists exactly the rule and configuration tables and no user, run or token table', () => {
    expect(REFERENCE_TABLE_NAMES).toEqual([
      'challenge_durations',
      'challenge_metrics',
      'challenge_rewards',
      'event_templates',
      'event_pools',
      'event_pool_members',
      'level_challenge_rewards',
      'level_requirements',
      'streak_multipliers',
      'titles',
      'admin_settings',
    ]);
    for (const forbidden of ['users', 'runs', 'strava_tokens', 'groups', 'user_titles', 'activity_log', 'user_settings', 'waitlist_signups', 'events', 'event_entries']) {
      expect(REFERENCE_TABLE_NAMES).not.toContain(forbidden);
    }
  });

  it('inserts the event pools before their members, and the templates before both', () => {
    const order = REFERENCE_TABLE_NAMES;
    expect(order.indexOf('event_templates')).toBeLessThan(order.indexOf('event_pools'));
    expect(order.indexOf('event_pools')).toBeLessThan(order.indexOf('event_pool_members'));
  });

  it('refuses to build a prod query for a table that is not in the list', () => {
    expect(() => prodSelectFor('users')).toThrow(StagingGuardError);
    expect(() => prodSelectFor('runs; drop table users')).toThrow(StagingGuardError);
  });

  it('sends prod nothing but the listed SELECTs, one per table, all of them on the allow-list', async () => {
    const { world } = await run({ readProd: true });
    expect(world.prodQueries).toEqual(REFERENCE_TABLE_NAMES.map(prodSelectFor));
    expect(world.prodQueries.every((q) => ALLOWED_PROD_QUERIES.has(q))).toBe(true);
    expect(world.api.callsTo(PROD_PROJECT_REF).every((c) => c.authorization === `Bearer ${PROD_TOKEN}` && c.path === '/database/query/read-only')).toBe(true);
  });

  it('keeps holders, current values and the admin password hash out of what is read from prod', () => {
    expect(prodSelectFor('titles')).not.toContain('current_holder_id');
    expect(prodSelectFor('titles')).not.toContain('current_value');
    expect(prodSelectFor('admin_settings')).toContain("'staging-ej-anvand'::text as admin_password_hash");
    expect(prodSelectFor('admin_settings').replace("'staging-ej-anvand'::text as admin_password_hash", '')).not.toContain('admin_password_hash');
    expect(REFERENCE_TABLES.titles).not.toContain('holder');
  });
});

describe('prod is only contacted with --read-prod', () => {
  it('parses the flags', () => {
    expect(parseArgs([])).toEqual({ apply: false, readProd: false });
    expect(parseArgs(['--read-prod', '--apply'])).toEqual({ apply: true, readProd: true });
    expect(() => parseArgs(['--prod'])).toThrow(/Unknown argument/);
  });

  it('prints the plan and makes no request at all without --read-prod', async () => {
    const { report, world, printed } = await run({});
    expect(report.outcome).toBe('plan_only');
    expect(world.api.calls).toHaveLength(0);
    expect(printed.join('\n')).toContain('select * from public.level_requirements');
    expect(printed.join('\n')).toContain('No --read-prod');
    expect(exitCodeFor(report)).toBe(0);
  });

  it('refuses --apply without --read-prod and makes no request', async () => {
    const { report, world } = await run({ apply: true });
    expect(report.outcome).toBe('refused');
    expect(world.api.calls).toHaveLength(0);
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('dry-run', () => {
  it('writes nothing to staging and reports what it read', async () => {
    const { report, world, printed } = await run({ readProd: true });
    expect(report.outcome).toBe('dry_run');
    expect(report.read.level_requirements).toBe(2);
    expect(world.api.writes()).toHaveLength(0);
    expect([...world.staging.values()].every((rows) => rows.size === 0)).toBe(true);
    expect(world.api.calls.every((c) => isSelect(c.body?.query))).toBe(true);
    expect(printed.join('\n')).toContain(`db.${STAGING_PROJECT_REF}.supabase.co`);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('warns when prod returns no rows for a table', async () => {
    const { report, printed } = await run({ readProd: true }, fakeWorld({ emptyProdTable: 'titles' }));
    expect(report.outcome).toBe('dry_run');
    expect(printed.join('\n')).toMatch(/no rows for titles/);
  });
});

describe('--apply', () => {
  it('writes only to staging, in one transaction, and the rows arrive', async () => {
    const { report, world } = await run({ readProd: true, apply: true });
    expect(report.outcome).toBe('seeded');
    expect(world.api.writes()).toHaveLength(1);
    expect(world.api.writes()[0].ref).toBe(STAGING_PROJECT_REF);
    expect(world.api.callsTo(PROD_PROJECT_REF).every((c) => isSelect(c.body?.query))).toBe(true);
    expect(world.staging.get('level_requirements')?.size).toBe(2);
    expect(world.staging.get('event_pool_members')?.size).toBe(1);
    expect(report.stagingCounts.titles).toBe(1);
  });

  it('can be run again without duplicates', async () => {
    const world = fakeWorld();
    const first = await run({ readProd: true, apply: true }, world);
    const afterFirst = REFERENCE_TABLE_NAMES.map((t) => [...(world.staging.get(t)?.keys() ?? [])].sort());
    const second = await run({ readProd: true, apply: true }, world);
    const afterSecond = REFERENCE_TABLE_NAMES.map((t) => [...(world.staging.get(t)?.keys() ?? [])].sort());
    expect(afterSecond).toEqual(afterFirst);
    expect(second.report.stagingCounts).toEqual(first.report.stagingCounts);
  });

  it('makes every insert idempotent and escapes quotes in the data', () => {
    const sql = buildSeedSql({ event_templates: [{ id: 'e1', name: "Storm Chaser's run" }], titles: [] });
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql.endsWith('commit;')).toBe(true);
    expect(sql).toContain("Storm Chaser''s run");
    const inserts = sql.split('\n').filter((l) => l.startsWith('insert'));
    expect(inserts).toHaveLength(1);
    expect(inserts.every((l) => l.endsWith('on conflict do nothing;'))).toBe(true);
  });

  it('names the columns in the insert, so a column staging has and prod does not send gets its default, not NULL', () => {
    const sql = buildSeedSql({ titles: [{ id: 't1', name: 'x', unlock_requirement: 1 }] });
    expect(sql).toContain('insert into public.titles ("id", "name", "unlock_requirement") select "id", "name", "unlock_requirement" from json_populate_recordset(');
    expect(sql).not.toContain('select *');
  });

  it('refuses a column name that is not a plain identifier, because it ends up in SQL', () => {
    expect(() => buildSeedSql({ titles: [{ 'id") ; drop table users; --': 1 }] })).toThrow(StagingGuardError);
  });

  it('checks that every prod key is in staging afterwards, and reports a deviation', async () => {
    const ok = await run({ readProd: true, apply: true });
    expect(ok.report.missingInStaging).toEqual({});
    expect(ok.printed.join('\n')).toContain('Checked: every prod key exists in staging.');
    const dropped = await run({ readProd: true, apply: true }, fakeWorld({ dropFromStaging: 'level_requirements' }));
    expect(dropped.report.outcome).toBe('deviations');
    expect(dropped.report.missingInStaging).toEqual({ level_requirements: ['q1'] });
    expect(dropped.printed.join('\n')).toContain('Deviation: level_requirements is missing 1 prod key(s)');
    expect(exitCodeFor(dropped.report)).toBe(1);
  });

  it('uses the primary key of the tables that have no id column', () => {
    expect(REFERENCE_KEY_COLUMNS).toEqual({ event_pool_members: ['pool_id', 'template_id'], level_challenge_rewards: ['level'] });
    const missing = findMissingKeys({ event_pool_members: [{ pool_id: 'p1', template_id: 'e1' }, { pool_id: 'p1', template_id: 'e2' }] }, { event_pool_members: [{ pool_id: 'p1', template_id: 'e1' }] });
    expect(missing).toEqual({ event_pool_members: ['p1|e2'] });
  });

  it('writes nothing when prod cannot be read', async () => {
    const broken = createFakeManagementApi((call) => (call.ref === PROD_PROJECT_REF ? { status: 500, body: 'down' } : { body: [] }));
    const printed: string[] = [];
    const report = await runSeedReference({ apply: true, readProd: true, env: ENV, fetchImpl: broken.fetchImpl, log: (l) => printed.push(l) });
    expect(report.outcome).toBe('failed');
    expect(broken.writes()).toHaveLength(0);
  });

  it('refuses without both tokens and sends nothing; the general Supabase token does not count', async () => {
    const envs: NodeJS.ProcessEnv[] = [
      { SUPABASE_STAGING_ACCESS_TOKEN: STAGING_TOKEN },
      { RUNQUEST_PROD_READ_TOKEN: PROD_TOKEN },
      { SUPABASE_STAGING_ACCESS_TOKEN: STAGING_TOKEN, SUPABASE_ACCESS_TOKEN: PROD_TOKEN },
    ];
    for (const env of envs) {
      const { report, world } = await run({ readProd: true, apply: true }, fakeWorld(), env);
      expect(report.outcome).toBe('missing_env');
      expect(world.api.calls).toHaveLength(0);
    }
  });

  it('never prints a token', async () => {
    const { printed } = await run({ readProd: true, apply: true });
    expect(printed.join('\n')).not.toContain(STAGING_TOKEN);
    expect(printed.join('\n')).not.toContain(PROD_TOKEN);
  });
});
