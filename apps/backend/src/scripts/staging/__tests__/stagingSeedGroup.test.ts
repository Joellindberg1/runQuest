/**
 * staging/stagingSeedGroup.ts: the "Staging Pack" test group. The password is random, goes only to the seed file, never to the output.
 * No real network and no real file in the repo: the seed file is written to a temp directory.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createFakeManagementApi, type RecordedCall } from '../../../test-utils/fakeManagementApi.js';
import {
  DEFAULT_SEED_FILE,
  SEED_FILE_NAME,
  STAGING_GROUP_NAME,
  TEST_PEOPLE,
  buildSeedGroupSql,
  exitCodeFor,
  parseArgs,
  runSeedGroup,
} from '../stagingSeedGroup.js';
import { STAGING_PROJECT_REF } from '../stagingTarget.js';

const TOKEN = 'sbp_staging_token_0123456789abcdef0123456789';
const ENV = { SUPABASE_STAGING_ACCESS_TOKEN: TOKEN };

const dirs: string[] = [];
const tempSeedFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-group-'));
  dirs.push(dir);
  return join(dir, SEED_FILE_NAME);
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** A staging database that knows groups and users well enough to answer the existence checks and take the insert. */
function fakeStaging(options: { foreignEmail?: boolean; failInsert?: boolean; insertLandsButAnswerIsLost?: boolean; recheckFails?: boolean } = {}) {
  const groups: string[] = [];
  const users: string[] = [];
  let groupChecks = 0;
  const api = createFakeManagementApi((call: RecordedCall) => {
    const sql = String(call.body?.query ?? '');
    if (call.ref !== STAGING_PROJECT_REF) return undefined;
    if (sql.includes('from public.groups where name')) {
      groupChecks++;
      if (groupChecks > 1 && options.recheckFails) return { status: 500, body: 'down' };
      return { body: [{ n: groups.length }] };
    }
    if (sql.includes('from public.users where email in')) return { body: [{ n: options.foreignEmail ? 1 : users.length }] };
    if (sql.startsWith('begin;')) {
      if (options.insertLandsButAnswerIsLost) {
        groups.push(STAGING_GROUP_NAME);
        return { status: 504, body: 'gateway timeout' };
      }
      if (options.failInsert) return { status: 400, body: 'constraint violation' };
      groups.push(STAGING_GROUP_NAME);
      for (const m of sql.matchAll(/insert into public\.users/g)) users.push(String(m.index));
      return { body: [] };
    }
    return undefined;
  });
  return { api, groups, users };
}

let counter = 0;
const run = (apply: boolean, staging = fakeStaging(), seedFile = tempSeedFile(), env: NodeJS.ProcessEnv = ENV) => {
  const printed: string[] = [];
  const password = `pw-${++counter}-AbCdEfGhIjKlMnOp`;
  return runSeedGroup({
    apply,
    env,
    fetchImpl: staging.api.fetchImpl,
    log: (l) => printed.push(l),
    seedFile,
    hashPassword: async (p) => `hash-of-${p.length}`,
    generatePassword: () => password,
  }).then((report) => ({ report, printed, staging, seedFile, password }));
};

describe('seed-group', () => {
  it('parses no flag as a dry-run and --apply as apply', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseArgs(['--password=x'])).toThrow(/Unknown argument/);
  });

  it('writes no row and no file in a dry-run', async () => {
    const { report, staging, seedFile, printed } = await run(false);
    expect(report.outcome).toBe('dry_run');
    expect(staging.api.writes()).toHaveLength(0);
    expect(existsSync(seedFile)).toBe(false);
    expect(printed.join('\n')).toContain('Would create');
    expect(printed.join('\n')).toContain(`db.${STAGING_PROJECT_REF}.supabase.co`);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('creates the group with four users, one of them the admin and the owner, in one transaction', async () => {
    const { report, staging } = await run(true);
    expect(report.outcome).toBe('created');
    expect(staging.api.writes()).toHaveLength(1);
    const sql = String(staging.api.writes()[0].body?.query);
    expect(sql.startsWith('begin;') && sql.endsWith('commit;')).toBe(true);
    expect(sql.match(/insert into public\.users/g)).toHaveLength(4);
    expect(sql.match(/, true\);/g)).toHaveLength(1);
    // The group, the admin membership and the pointer come from the database functions of migration 053, not from rows written here.
    expect(sql).not.toMatch(/insert into public\.(groups|group_members)|group_id|update public\./);
    expect(sql.match(/select public\.create_group_with_admin\(/g)).toHaveLength(1);
    expect(sql.match(/select public\.join_group\(/g)).toHaveLength(3);
    expect(sql).toMatch(/select public\.create_group_with_admin\('Staging Pack', '[^']+', '[0-9a-f-]{36}', '\d{4}-\d{2}-\d{2}'\);/);
    expect(sql).toMatch(/, 'member', '\d{4}-\d{2}-\d{2}'\);/);
    expect(TEST_PEOPLE.filter((p) => p.admin)).toHaveLength(1);
    expect(TEST_PEOPLE[0].admin).toBe(true); // the first person is the one who creates the group
    expect(TEST_PEOPLE.every((p) => p.email.endsWith('@staging.runquest.test'))).toBe(true);
  });

  it('writes the generated password only to the seed file, never to the output or the SQL', async () => {
    const { printed, staging, seedFile, password } = await run(true);
    const file = readFileSync(seedFile, 'utf8');
    expect(file).toContain(password);
    expect(file).toContain('admin@staging.runquest.test');
    expect(printed.join('\n')).not.toContain(password);
    expect(String(staging.api.writes()[0].body?.query)).not.toContain(password);
    expect(printed.join('\n')).not.toContain(TOKEN);
  });

  it('uses a different random password on every run', async () => {
    const first = await run(true);
    const second = await run(true);
    expect(first.password).not.toBe(second.password);
  });

  it('can be run again without duplicates and leaves the first seed file alone', async () => {
    const staging = fakeStaging();
    const seedFile = tempSeedFile();
    const first = await run(true, staging, seedFile);
    const fileAfterFirst = readFileSync(seedFile, 'utf8');
    const second = await run(true, staging, seedFile);
    expect(first.report.outcome).toBe('created');
    expect(second.report.outcome).toBe('already_exists');
    expect(staging.groups).toHaveLength(1);
    expect(staging.users).toHaveLength(4);
    expect(staging.api.writes()).toHaveLength(1);
    expect(readFileSync(seedFile, 'utf8')).toBe(fileAfterFirst);
    expect(exitCodeFor(second.report)).toBe(0);
  });

  it('refuses when a test e-mail address already exists outside the group', async () => {
    const { report, staging, seedFile } = await run(true, fakeStaging({ foreignEmail: true }));
    expect(report.outcome).toBe('refused_email_taken');
    expect(staging.api.writes()).toHaveLength(0);
    expect(existsSync(seedFile)).toBe(false);
    expect(exitCodeFor(report)).toBe(1);
  });

  it('removes the seed file again when the insert fails and the group is confirmed absent', async () => {
    const { report, seedFile, printed } = await run(true, fakeStaging({ failInsert: true }));
    expect(report.outcome).toBe('failed');
    expect(existsSync(seedFile)).toBe(false);
    expect(printed.join('\n')).toContain('the seed file was removed');
  });

  it('keeps the seed file when the insert answer is lost but the group exists', async () => {
    const { report, seedFile, password } = await run(true, fakeStaging({ insertLandsButAnswerIsLost: true }));
    expect(report.outcome).toBe('failed');
    expect(existsSync(seedFile)).toBe(true);
    expect(readFileSync(seedFile, 'utf8')).toContain(password);
  });

  it('keeps the seed file when it cannot be confirmed that the group is absent', async () => {
    const { report, seedFile, printed } = await run(true, fakeStaging({ failInsert: true, recheckFails: true }));
    expect(report.outcome).toBe('failed');
    expect(existsSync(seedFile)).toBe(true);
    expect(printed.join('\n')).toContain('was KEPT');
  });

  it('prints neither the password nor its hash, also when the server echoes the failing statement', async () => {
    const api = createFakeManagementApi((call: RecordedCall) => {
      const sql = String(call.body?.query ?? '');
      if (sql.includes('from public.groups where name') || sql.includes('from public.users where email in')) return { body: [{ n: 0 }] };
      return { status: 400, body: `failed: ${sql}` };
    });
    const printed: string[] = [];
    const password = 'pw-echo-AbCdEfGhIjKlMnOp';
    await runSeedGroup({
      apply: true,
      env: ENV,
      fetchImpl: api.fetchImpl,
      log: (l) => printed.push(l),
      seedFile: tempSeedFile(),
      hashPassword: async () => '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0',
      generatePassword: () => password,
    });
    const text = printed.join('\n');
    expect(text).toContain('Creating failed');
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(text).not.toContain(password);
  });

  it('refuses without the staging token and sends nothing', async () => {
    const { report, staging } = await run(true, fakeStaging(), tempSeedFile(), {});
    expect(report.outcome).toBe('missing_env');
    expect(staging.api.calls).toHaveLength(0);
  });

  it('escapes quotes in what it puts into the SQL', () => {
    const sql = buildSeedGroupSql({ userIds: ['a', 'b', 'c', 'd'], inviteCode: "ST'G", passwordHash: "ha'sh", today: '2026-10-18' });
    expect(sql).toContain("'ST''G'");
    expect(sql).toContain("'ha''sh'");
  });

  it('makes the first person the group creator and the other three members, all joined on the given day', () => {
    const ids = ['a-admin', 'b', 'c', 'd'];
    const sql = buildSeedGroupSql({ userIds: ids, inviteCode: 'STGCODE', passwordHash: 'h', today: '2026-10-18' });
    expect(sql).toContain("select public.create_group_with_admin('Staging Pack', 'STGCODE', 'a-admin', '2026-10-18');");
    for (const id of ids.slice(1)) {
      expect(sql).toContain(`select public.join_group('${id}', (select id from public.groups where invite_code = 'STGCODE'), 'member', '2026-10-18');`);
    }
    expect(sql).not.toContain("join_group('a-admin'");
  });

  it('puts the default seed file in the repo root under the git-ignored name', () => {
    expect(basename(DEFAULT_SEED_FILE)).toBe('staging-testkonton.seed');
    expect(existsSync(join(dirname(DEFAULT_SEED_FILE), 'package.json'))).toBe(true);
    expect(readFileSync(join(dirname(DEFAULT_SEED_FILE), '.gitignore'), 'utf8')).toMatch(/^\*\.seed$/m);
  });
});
