/**
 * staging/stagingTarget.ts: the guards every staging script relies on. No real network: the management API is a fake.
 */
import { describe, it, expect } from 'vitest';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MissingEnvError,
  PROD_PROJECT_REF,
  PROD_READ_TOKEN_ENV,
  STAGING_PROJECT_REF,
  StagingGuardError,
  assertReadOnlySql,
  assertStagingTarget,
  createProdReader,
  createSay,
  createStagingClient,
  entryDecision,
  requireToken,
} from '../stagingTarget.js';
import { FINGERPRINT_QUERIES } from '../schemaFingerprint.js';
import { ALLOWED_PROD_QUERIES as SEED_QUERIES, REFERENCE_TABLE_NAMES, prodSelectFor } from '../stagingSeedReference.js';
import { ALLOWED_PROD_QUERIES as DIFF_QUERIES } from '../stagingSchemaDiff.js';
import { createFakeManagementApi, isSelect } from '../../../test-utils/fakeManagementApi.js';

const TOKEN = 'sbp_FAKE_TEST_TOKEN_1_not_a_real_secret';
const ALLOWED_SELECT = 'select 1 as x';

const reader = (api: ReturnType<typeof createFakeManagementApi>, allowed: string[] = [ALLOWED_SELECT]) =>
  createProdReader({ token: TOKEN, fetchImpl: api.fetchImpl, allowedQueries: new Set(allowed) });

describe('the write target is staging only', () => {
  it('refuses the prod project ref as a write target', () => {
    const api = createFakeManagementApi(() => ({ body: [] }));
    expect(() => createStagingClient({ token: TOKEN, fetchImpl: api.fetchImpl, projectRef: PROD_PROJECT_REF })).toThrow(/PRODUCTION/);
    expect(api.calls).toHaveLength(0);
  });

  it('refuses the prod ref however it is written', () => {
    expect(() => assertStagingTarget(`  ${PROD_PROJECT_REF.toUpperCase()} `)).toThrow(StagingGuardError);
  });

  it('refuses any project that is not the staging ref', () => {
    expect(() => assertStagingTarget('someotherprojectref')).toThrow(/not the staging project/);
    expect(() => assertStagingTarget('')).toThrow(StagingGuardError);
  });

  it('accepts the staging ref, which is not the prod ref', () => {
    expect(STAGING_PROJECT_REF).not.toBe(PROD_PROJECT_REF);
    expect(() => assertStagingTarget(STAGING_PROJECT_REF)).not.toThrow();
  });

  it('sends every request of the staging client to the staging project with the bearer token', async () => {
    const api = createFakeManagementApi(() => ({ body: [{ n: 1 }] }));
    const client = createStagingClient({ token: TOKEN, fetchImpl: api.fetchImpl });
    await client.query('select 1 as n');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ ref: STAGING_PROJECT_REF, path: '/database/query', method: 'POST', authorization: `Bearer ${TOKEN}` });
  });

  it('reads staging through the read-only endpoint when asked to, and refuses a write there', async () => {
    const api = createFakeManagementApi(() => ({ body: [] }));
    const client = createStagingClient({ token: TOKEN, fetchImpl: api.fetchImpl });
    await client.readOnlyQuery('select 1');
    expect(api.calls[0].path).toBe('/database/query/read-only');
    await expect(client.readOnlyQuery('delete from public.runs')).rejects.toBeInstanceOf(StagingGuardError);
    expect(api.calls).toHaveLength(1);
  });
});

describe('prod is read only', () => {
  it('has a prod reader without any write method', () => {
    const r = reader(createFakeManagementApi(() => ({ body: [] })));
    expect(Object.keys(r).sort()).toEqual(['query', 'ref']);
    expect(r.ref).toBe(PROD_PROJECT_REF);
  });

  it('sends an allowed statement to prod through the read-only endpoint only', async () => {
    const api = createFakeManagementApi(() => ({ body: [{ x: 1 }] }));
    await expect(reader(api).query(ALLOWED_SELECT)).resolves.toEqual([{ x: 1 }]);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ ref: PROD_PROJECT_REF, path: '/database/query/read-only', method: 'POST' });
  });

  it.each([
    ['insert', "insert into public.titles (name) values ('x')"],
    ['update', 'update public.users set is_admin = true'],
    ['delete', 'delete from public.runs'],
    ['drop', 'drop table public.runs'],
    ['a second statement', 'select 1; drop table public.runs'],
    ['select into', 'select * into public.copy_of_users from public.users'],
    ['a plain select that is not on the list', 'select * from public.users'],
    ['an allowed statement with something appended', `${ALLOWED_SELECT} or true`],
  ])('refuses a prod query with %s and sends nothing', async (_label, sql) => {
    const api = createFakeManagementApi(() => ({ body: [] }));
    await expect(reader(api).query(sql)).rejects.toBeInstanceOf(StagingGuardError);
    expect(api.calls).toHaveLength(0);
  });

  // The first version of the filter could be fooled by these two; the allow-list refuses them whatever the filter thinks.
  const BYPASSES = [
    ["an E'' string with a backslash-escaped quote", "select E'\\''; drop table public.runs; select ''"],
    ['a dollar sign inside an identifier', 'select 1 as x$a$; drop table t; select 1 as y$a$'],
  ] as const;

  it.each(BYPASSES)('refuses %s because it is not on the list, and sends nothing', async (_label, sql) => {
    const api = createFakeManagementApi(() => ({ body: [] }));
    await expect(reader(api).query(sql)).rejects.toThrow(/fixed list/);
    expect(api.calls).toHaveLength(0);
  });

  it.each(BYPASSES)('refuses %s in the lexical filter too, also when the statement is on the list', async (_label, sql) => {
    expect(() => assertReadOnlySql(sql)).toThrow(StagingGuardError);
    const api = createFakeManagementApi(() => ({ body: [] }));
    await expect(reader(api, [sql]).query(sql)).rejects.toBeInstanceOf(StagingGuardError);
    expect(api.calls).toHaveLength(0);
  });

  it('lets a plain select through the filter, also with a keyword inside a string literal or a comment', () => {
    expect(() => assertReadOnlySql("select 'delete me; drop table x' as x -- insert into nothing\n")).not.toThrow();
    expect(() => assertReadOnlySql("select E'it\\'s; fine' as x, 1 as y$a$")).not.toThrow();
  });

  it('lets every statement the scripts send to prod pass the filter, and puts exactly those on the lists', () => {
    for (const sql of Object.values(FINGERPRINT_QUERIES)) expect(() => assertReadOnlySql(sql)).not.toThrow();
    for (const table of REFERENCE_TABLE_NAMES) expect(() => assertReadOnlySql(prodSelectFor(table))).not.toThrow();
    expect([...DIFF_QUERIES].sort()).toEqual(Object.values(FINGERPRINT_QUERIES).sort());
    expect([...SEED_QUERIES].sort()).toEqual(REFERENCE_TABLE_NAMES.map(prodSelectFor).sort());
  });

  it('has a fake that counts every non-select as a write, so the "no writes" assertions mean something', () => {
    expect(isSelect('select 1')).toBe(true);
    expect(isSelect('select 1; drop table t')).toBe(false);
    expect(isSelect("select E'\\''; drop table public.runs; select ''")).toBe(false);
    expect(isSelect('begin; select 1; commit;')).toBe(false);
    expect(isSelect('select * into x from y')).toBe(false);
  });
});

describe('secrets', () => {
  it('names the missing variable but never a value', () => {
    expect(() => requireToken({}, 'SUPABASE_STAGING_ACCESS_TOKEN')).toThrow(MissingEnvError);
    expect(() => requireToken({ SUPABASE_STAGING_ACCESS_TOKEN: '   ' }, 'SUPABASE_STAGING_ACCESS_TOKEN')).toThrow(/SUPABASE_STAGING_ACCESS_TOKEN/);
    expect(requireToken({ X: ` ${TOKEN} ` }, 'X')).toBe(TOKEN);
  });

  it('reads the prod token from its own variable, never from the general Supabase one', () => {
    expect(PROD_READ_TOKEN_ENV).toBe('RUNQUEST_PROD_READ_TOKEN');
    expect(PROD_READ_TOKEN_ENV).not.toBe('SUPABASE_ACCESS_TOKEN');
  });

  it('scrubs a token from an error answer that echoes it', async () => {
    const api = createFakeManagementApi(() => ({ status: 401, body: `invalid token ${TOKEN}, sorry` }));
    const client = createStagingClient({ token: TOKEN, fetchImpl: api.fetchImpl });
    const error = await client.query('select 1').catch((e: Error) => e);
    expect((error as Error).message).toContain('HTTP 401');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('prints no line with a secret in it', () => {
    const printed: string[] = [];
    const { say, lines } = createSay((l) => printed.push(l), [TOKEN]);
    say(`token is ${TOKEN}`);
    expect(printed.join('\n')).not.toContain(TOKEN);
    expect(lines).toEqual(printed);
  });

  it('treats an answer that is not a list of rows as an error, never as no rows', async () => {
    const api = createFakeManagementApi(() => ({ body: { message: 'weird' } }));
    const client = createStagingClient({ token: TOKEN, fetchImpl: api.fetchImpl });
    await expect(client.query('select 1')).rejects.toThrow(/not a list of rows/);
    await expect(client.listMigrationNames()).rejects.toThrow(/not a list/);
  });
});

describe('when main runs', () => {
  const here = fileURLToPath(import.meta.url);
  const moduleUrl = pathToFileURL(here).href;
  const decide = (argv1: string | undefined, env: NodeJS.ProcessEnv = {}) => entryDecision({ moduleUrl, argv1, env, name: 'staging:test' });

  it('runs when the module is the script node was started with', () => {
    expect(decide(here)).toEqual({ action: 'run' });
  });

  it('refuses to run under CI or a test runner, even when it is the entry point', () => {
    expect(decide(here, { CI: 'true' })).toMatchObject({ action: 'refuse' });
    expect(decide(here, { VITEST: 'true' })).toMatchObject({ action: 'refuse' });
  });

  it('stays silent when the module is only imported', () => {
    expect(decide('C:/somewhere/else/vitest.mjs')).toEqual({ action: 'skip' });
    expect(decide(undefined)).toEqual({ action: 'skip' });
  });

  it('says so when the file name matches but the path comparison fails', () => {
    const decision = decide(`C:/another/copy/${basename(here)}`);
    expect(decision.action).toBe('skip');
    expect((decision as { message?: string }).message).toMatch(/main did not run/);
  });
});
