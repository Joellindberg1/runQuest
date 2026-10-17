/**
 * staging/stagingMigrate.ts: baseline + migrations >= 032 in order, recorded ones skipped, dry-run writes nothing. No real network.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { createFakeManagementApi, type RecordedCall } from '../../../test-utils/fakeManagementApi.js';
import {
  DEFAULT_MIGRATIONS_DIR,
  exitCodeFor,
  loadMigrationFiles,
  parseArgs,
  runMigrate,
  selectStagingMigrationFiles,
  type MigrationFile,
} from '../stagingMigrate.js';
import { PROD_PROJECT_REF, STAGING_PROJECT_REF } from '../stagingTarget.js';

const TOKEN = 'sbp_staging_token_0123456789abcdef0123456789';
const ENV = { SUPABASE_STAGING_ACCESS_TOKEN: TOKEN };

const FILES: MigrationFile[] = [
  { name: '000_baseline', sql: 'create table a();' },
  { name: '032_one', sql: 'select 1;' },
  { name: '033_two', sql: 'select 2;' },
];

/** A staging project that records what is applied, so a second run can be compared with the first. */
function fakeStaging(initiallyRecorded: string[] = []) {
  const recorded = [...initiallyRecorded];
  const api = createFakeManagementApi((call: RecordedCall) => {
    if (call.ref !== STAGING_PROJECT_REF) return undefined;
    if (call.path === '/database/migrations' && call.method === 'GET') return { body: recorded.map((name) => ({ version: '1', name })) };
    if (call.path === '/database/migrations' && call.method === 'POST') {
      recorded.push(String(call.body?.name));
      return { body: [] };
    }
    return undefined;
  });
  return { api, recorded };
}

const run = (overrides: Partial<Parameters<typeof runMigrate>[0]> & { api: ReturnType<typeof fakeStaging>['api'] }) => {
  const printed: string[] = [];
  const { api, ...rest } = overrides;
  return runMigrate({ apply: false, env: ENV, fetchImpl: api.fetchImpl, log: (l) => printed.push(l), files: FILES, sleep: async () => undefined, ...rest }).then((report) => ({
    report,
    printed,
  }));
};

describe('which migration files a new database is built from', () => {
  it('takes the baseline and every number from 032, in order, and leaves the frozen history out', () => {
    const names = ['001_a.sql', '031_b.sql', '000_baseline.sql', '033_c.sql', '032_d.sql', 'README.md', '050_e.sql'];
    expect(selectStagingMigrationFiles(names)).toEqual(['000_baseline.sql', '032_d.sql', '033_c.sql', '050_e.sql']);
  });

  it('refuses two files with the same number', () => {
    expect(() => selectStagingMigrationFiles(['000_baseline.sql', '040_a.sql', '040_b.sql'])).toThrow(/share the number 040/);
  });

  it('throws on a .sql file whose name does not match NNN_name.sql instead of skipping it', () => {
    expect(() => selectStagingMigrationFiles(['000_baseline.sql', '51_late.sql'])).toThrow(/does not match NNN_name.sql: 51_late.sql/);
    expect(() => selectStagingMigrationFiles(['000_baseline.sql', 'hotfix.sql'])).toThrow(/hotfix.sql/);
    expect(() => selectStagingMigrationFiles(['000_baseline.sql', 'README.md', 'notes.txt'])).not.toThrow();
  });

  it('reads the repo migrations: baseline first, then the numbers from 032, no duplicates', () => {
    const loaded = loadMigrationFiles();
    expect(loaded[0].name).toBe('000_baseline');
    expect(loaded.slice(1).every((f) => Number(f.name.slice(0, 3)) >= 32)).toBe(true);
    expect(new Set(loaded.map((f) => f.name.slice(0, 3))).size).toBe(loaded.length);
    const onDisk = readdirSync(DEFAULT_MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && (Number(f.slice(0, 3)) === 0 || Number(f.slice(0, 3)) >= 32));
    expect(loaded.map((f) => `${f.name}.sql`).sort()).toEqual(onDisk.sort());
  });
});

describe('dry-run is the default', () => {
  it('parses no flag as a dry-run and --apply as apply', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseArgs(['--prod'])).toThrow(/Unknown argument/);
  });

  it('writes nothing in a dry-run and lists what would be applied', async () => {
    const { api, recorded } = fakeStaging(['000_baseline']);
    const { report, printed } = await run({ api });
    expect(report.outcome).toBe('dry_run');
    expect(report.pending).toEqual(['032_one', '033_two']);
    expect(api.writes()).toHaveLength(0);
    expect(recorded).toEqual(['000_baseline']);
    expect(printed.join('\n')).toContain('would apply: 032_one');
    expect(exitCodeFor(report)).toBe(0);
  });

  it('says which host it talks to and never prints the token', async () => {
    const { api } = fakeStaging();
    const { printed } = await run({ api });
    expect(printed.join('\n')).toContain(`db.${STAGING_PROJECT_REF}.supabase.co`);
    expect(printed.join('\n')).not.toContain(TOKEN);
  });
});

describe('--apply', () => {
  it('applies the pending migrations in order, with a pause between them, to staging only', async () => {
    const { api, recorded } = fakeStaging();
    const pauses: number[] = [];
    const { report } = await run({ api, apply: true, sleep: async (ms: number) => void pauses.push(ms) });
    expect(report.outcome).toBe('applied');
    expect(recorded).toEqual(['000_baseline', '032_one', '033_two']);
    expect(api.calls.every((c) => c.ref === STAGING_PROJECT_REF)).toBe(true);
    expect(api.callsTo(PROD_PROJECT_REF)).toHaveLength(0);
    expect(pauses).toEqual([1500, 1500]);
  });

  it('skips what staging has recorded, so a second run applies nothing', async () => {
    const { api, recorded } = fakeStaging();
    await run({ api, apply: true });
    const writesAfterFirst = api.writes().length;
    const second = await run({ api, apply: true });
    expect(second.report.outcome).toBe('up_to_date');
    expect(second.report.skipped).toEqual(['000_baseline', '032_one', '033_two']);
    expect(api.writes()).toHaveLength(writesAfterFirst);
    expect(recorded).toHaveLength(3);
  });

  it('refuses to apply a migration that is older than one staging already has, and applies nothing', async () => {
    const { api, recorded } = fakeStaging(['000_baseline', '033_two']);
    const { report, printed } = await run({ api, apply: true });
    expect(report.outcome).toBe('refused_out_of_order');
    expect(report.outOfOrder).toEqual(['032_one']);
    expect(api.writes()).toHaveLength(0);
    expect(recorded).toEqual(['000_baseline', '033_two']);
    expect(printed.join('\n')).toContain('REFUSED: 032_one is older than 033_two');
    expect(exitCodeFor(report)).toBe(1);
  });

  it('only warns about the order in a dry-run', async () => {
    const { api } = fakeStaging(['000_baseline', '033_two']);
    const { report, printed } = await run({ api });
    expect(report.outcome).toBe('dry_run');
    expect(printed.join('\n')).toContain('warning: 032_one is older than 033_two');
  });

  it('reports migrations that staging has recorded but the repo does not have', async () => {
    const { api } = fakeStaging(['000_baseline', '032_one', '033_two', '099_applied_by_hand']);
    const { report, printed } = await run({ api });
    expect(report.recordedNotInRepo).toEqual(['099_applied_by_hand']);
    expect(printed.join('\n')).toContain('staging has recorded 099_applied_by_hand');
  });

  it('stops at the first failure and runs no later migration', async () => {
    const applied: string[] = [];
    const api = createFakeManagementApi((call) => {
      if (call.path === '/database/migrations' && call.method === 'GET') return { body: [] };
      if (call.path === '/database/migrations' && call.method === 'POST') {
        if (call.body?.name === '032_one') return { status: 400, body: `syntax error near ${TOKEN}` };
        applied.push(String(call.body?.name));
        return { body: [] };
      }
      return undefined;
    });
    const { report, printed } = await run({ api, apply: true });
    expect(report.outcome).toBe('failed');
    expect(applied).toEqual(['000_baseline']);
    expect(report.applied).toEqual(['000_baseline']);
    expect(printed.join('\n')).toContain('FAILED 032_one');
    expect(printed.join('\n')).not.toContain(TOKEN);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('applies nothing when the list of recorded migrations cannot be read', async () => {
    const api = createFakeManagementApi((call) => (call.method === 'GET' ? { status: 500, body: 'down' } : { body: [] }));
    const { report } = await run({ api, apply: true });
    expect(report.outcome).toBe('failed');
    expect(api.writes()).toHaveLength(0);
  });

  it('refuses to run without the staging token and sends nothing', async () => {
    const { api } = fakeStaging();
    const { report, printed } = await run({ api, apply: true, env: {} });
    expect(report.outcome).toBe('missing_env');
    expect(api.calls).toHaveLength(0);
    expect(printed.join('\n')).toContain('SUPABASE_STAGING_ACCESS_TOKEN');
  });
});
