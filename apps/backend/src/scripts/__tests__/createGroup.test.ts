/**
 * scripts/createGroup.ts (ADR 012 beslut 7): creates a group through create_group_with_admin. Dry-run is the default, the target is decided
 * from the connection URL, and production is refused unless the explicit flag and the confirmation string are both given.
 * Database: createFakeDb with the fake of migration 053's functions. Nothing here touches a network: the client is built by an injected factory.
 */
import { describe, it, expect } from 'vitest';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { membershipRpc, type MembershipRpcCall } from '../../routes/__tests__/helpers/fakeMembership.js';
import {
  PROD_CONFIRMATION,
  classifyTarget,
  decideApply,
  exitCodeFor,
  generateInviteCode,
  parseArgs,
  runCreateGroup,
  type CreateGroupOptions,
} from '../createGroup.js';
import { PROD_PROJECT_REF, STAGING_PROJECT_REF } from '../staging/stagingTarget.js';

const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const PROD_URL = `https://${PROD_PROJECT_REF}.supabase.co`;
const SERVICE_KEY = 'FAKE_SERVICE_ROLE_KEY_not_a_real_secret';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const GENERATED_CODE = 'ZZGEN4567';
const GIVEN_CODE = 'GIVEN12345';

const options = (over: Partial<CreateGroupOptions> = {}): CreateGroupOptions => ({
  apply: false,
  name: 'Staging Second Pack',
  showInviteCode: false,
  allowProd: false,
  ownerId: OWNER_ID,
  ...over,
});

function setup(opts: { users?: Row[]; groups?: Row[]; members?: Row[]; env?: NodeJS.ProcessEnv; rpcError?: { code: string; message: string; details?: string }; rpcThrows?: Error } = {}) {
  const tables: Record<string, Row[]> = {
    users: opts.users ?? [{ id: OWNER_ID, name: 'Second Admin', email: 'second-admin@staging.runquest.test', group_id: null }],
    groups: opts.groups ?? [],
    group_members: opts.members ?? [],
  };
  const calls: MembershipRpcCall[] = [];
  const rpc = membershipRpc(tables, calls);
  if (opts.rpcError) rpc.create_group_with_admin = () => ({ error: opts.rpcError });
  if (opts.rpcThrows) rpc.create_group_with_admin = () => { throw opts.rpcThrows; };
  const fake = createFakeDb(tables, { rpc });
  const created: Array<{ url: string; key: string }> = [];
  const lines: string[] = [];
  const run = (o: CreateGroupOptions, env: NodeJS.ProcessEnv = opts.env ?? { SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }) =>
    runCreateGroup({
      options: o,
      env,
      createDb: (url, key) => {
        created.push({ url, key });
        return fake.client as any;
      },
      log: (line) => void lines.push(line),
      today: '2026-10-18',
      generateCode: () => GENERATED_CODE,
    });
  return { run, db: fake.client as any, tables, calls, created, lines, output: () => lines.join('\n') };
}

describe('parseArgs', () => {
  it('is a dry-run unless --apply is given', () => {
    expect(parseArgs([`--owner-id=${OWNER_ID}`]).apply).toBe(false);
    expect(parseArgs([`--owner-id=${OWNER_ID}`, '--apply']).apply).toBe(true);
  });

  it('reads the name, the invite code, the owner and the production flags', () => {
    const parsed = parseArgs(['--owner-email=A@Staging.RunQuest.test', '--name=Pack Two', `--invite-code=${GIVEN_CODE}`, '--show-invite-code', '--allow-prod', `--confirm-prod=${PROD_CONFIRMATION}`]);
    expect(parsed).toMatchObject({
      ownerEmail: 'a@staging.runquest.test',
      name: 'Pack Two',
      inviteCode: GIVEN_CODE,
      showInviteCode: true,
      allowProd: true,
      confirmProd: PROD_CONFIRMATION,
    });
  });

  it('needs exactly one of --owner-id and --owner-email', () => {
    expect(() => parseArgs([])).toThrow(/exactly one/i);
    expect(() => parseArgs([`--owner-id=${OWNER_ID}`, '--owner-email=a@b.test'])).toThrow(/exactly one/i);
  });

  it('refuses an owner id that is not a uuid', () => {
    expect(() => parseArgs(['--owner-id=not-a-uuid'])).toThrow(/uuid/i);
  });

  it('does not echo an unknown argument, which could be a secret typed in the wrong place', () => {
    expect(() => parseArgs([`--owner-id=${OWNER_ID}`, '--service-key=SECRET-VALUE-123'])).toThrow(/^(?!.*SECRET-VALUE-123)/);
  });

  it('refuses an invite code that a join could never match, without echoing it', () => {
    const attempt = () => parseArgs([`--owner-id=${OWNER_ID}`, '--invite-code=lowercase1']);
    expect(attempt).toThrow(/invite code/i);
    expect(attempt).toThrow(/^(?!.*lowercase1)/);
  });

  it('refuses an empty name', () => {
    expect(() => parseArgs([`--owner-id=${OWNER_ID}`, '--name=   '])).toThrow(/name/i);
  });
});

describe('classifyTarget', () => {
  it('knows the staging project from its exact https host', () => {
    expect(classifyTarget(STAGING_URL)).toEqual({ kind: 'staging', host: `${STAGING_PROJECT_REF}.supabase.co` });
  });

  it('knows the production project', () => {
    expect(classifyTarget(PROD_URL)).toEqual({ kind: 'prod', host: `${PROD_PROJECT_REF}.supabase.co` });
  });

  it.each([
    ['upper case', `HTTPS://${PROD_PROJECT_REF.toUpperCase()}.SUPABASE.CO`],
    ['a path', `https://example.test/${PROD_PROJECT_REF}`],
    ['credentials naming staging in front of prod', `https://${STAGING_PROJECT_REF}.supabase.co@${PROD_PROJECT_REF}.supabase.co`],
    ['another domain suffix', `https://${PROD_PROJECT_REF}.supabase.red`],
    ['a database host', `https://db.${PROD_PROJECT_REF}.supabase.co`],
  ])('treats the production ref anywhere in the URL as production (%s)', (_name, url) => {
    expect(classifyTarget(url).kind).toBe('prod');
  });

  it.each([
    ['plain http', `http://${STAGING_PROJECT_REF}.supabase.co`],
    ['a port', `https://${STAGING_PROJECT_REF}.supabase.co:8443`],
    ['credentials', `https://user:pw@${STAGING_PROJECT_REF}.supabase.co`],
    ['another domain suffix', `https://${STAGING_PROJECT_REF}.example.test`],
    ['a longer label', `https://x${STAGING_PROJECT_REF}.supabase.co`],
    ['an unrelated project', 'https://abcdefghijklmnopqrst.supabase.co'],
    ['a local stack', 'http://127.0.0.1:54321'],
    ['text that is no URL', 'not a url'],
    ['an empty string', ''],
  ])('does not call it staging, only unknown (%s)', (_name, url) => {
    expect(classifyTarget(url).kind).toBe('unknown');
  });

  it('answers unknown for a missing URL', () => {
    expect(classifyTarget(undefined)).toEqual({ kind: 'unknown', host: 'unknown' });
  });
});

describe('decideApply', () => {
  const staging = classifyTarget(STAGING_URL);
  const prod = classifyTarget(PROD_URL);
  const unknown = classifyTarget('https://abcdefghijklmnopqrst.supabase.co');

  it('lets a dry-run read any target', () => {
    expect(decideApply(prod, options()).ok).toBe(true);
    expect(decideApply(unknown, options()).ok).toBe(true);
  });

  it('lets --apply write to staging', () => {
    expect(decideApply(staging, options({ apply: true })).ok).toBe(true);
  });

  it('refuses --apply against production without the flag', () => {
    const decision = decideApply(prod, options({ apply: true }));
    expect(decision).toMatchObject({ ok: false, outcome: 'refused_prod' });
  });

  it('refuses --apply against production with the flag but no confirmation', () => {
    expect(decideApply(prod, options({ apply: true, allowProd: true })).ok).toBe(false);
  });

  it('refuses --apply against production with the confirmation but no flag', () => {
    expect(decideApply(prod, options({ apply: true, confirmProd: PROD_CONFIRMATION })).ok).toBe(false);
  });

  it('refuses --apply against production with a wrong confirmation', () => {
    expect(decideApply(prod, options({ apply: true, allowProd: true, confirmProd: 'yes' })).ok).toBe(false);
  });

  it('allows --apply against production only with both the flag and the exact confirmation', () => {
    expect(decideApply(prod, options({ apply: true, allowProd: true, confirmProd: PROD_CONFIRMATION })).ok).toBe(true);
  });

  it('refuses --apply against a project it cannot identify, even with the production flags', () => {
    const decision = decideApply(unknown, options({ apply: true, allowProd: true, confirmProd: PROD_CONFIRMATION }));
    expect(decision).toMatchObject({ ok: false, outcome: 'refused_target' });
  });

  it('refuses --apply on staging when production flags are given, a sign that the URL is not the one meant', () => {
    expect(decideApply(staging, options({ apply: true, allowProd: true })).ok).toBe(false);
  });
});

describe('generateInviteCode', () => {
  it('makes an upper-case code a join can match, and a different one each time', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
    expect(codes.size).toBe(20);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{8,}$/);
  });
});

describe('runCreateGroup', () => {
  it('is a dry-run by default: prints the target host, reads the owner and writes nothing', async () => {
    const env = setup();
    const report = await env.run(options());

    expect(report.outcome).toBe('dry_run');
    expect(env.output()).toContain(`${STAGING_PROJECT_REF}.supabase.co`);
    expect(env.output()).toContain('Second Admin');
    expect(env.calls).toEqual([]);
    expect(env.tables.groups).toEqual([]);
    expect(env.tables.group_members).toEqual([]);
  });

  it('with --apply creates the group through create_group_with_admin with the owner as admin', async () => {
    const env = setup();
    const report = await env.run(options({ apply: true }));

    expect(report.outcome).toBe('created');
    expect(env.calls).toEqual([
      { name: 'create_group_with_admin', args: { p_name: 'Staging Second Pack', p_invite_code: GENERATED_CODE, p_owner_id: OWNER_ID, p_today: '2026-10-18' } },
    ]);
    expect(env.tables.group_members).toMatchObject([{ user_id: OWNER_ID, group_id: report.groupId, role: 'admin' }]);
    expect(env.tables.users[0].group_id).toBe(report.groupId);
  });

  it('finds the owner by e-mail address', async () => {
    const env = setup();
    const report = await env.run(options({ apply: true, ownerId: undefined, ownerEmail: 'second-admin@staging.runquest.test' }));
    expect(report.outcome).toBe('created');
    expect(env.calls[0].args).toMatchObject({ p_owner_id: OWNER_ID });
  });

  it('uses the invite code it was given', async () => {
    const env = setup();
    await env.run(options({ apply: true, inviteCode: GIVEN_CODE }));
    expect(env.calls[0].args).toMatchObject({ p_invite_code: GIVEN_CODE });
  });

  it('builds the client from the URL it classified, and from nothing else', async () => {
    const env = setup();
    await env.run(options());
    expect(env.created).toEqual([{ url: STAGING_URL, key: SERVICE_KEY }]);
  });

  it('does not print the invite code, a generated or a given one, by default', async () => {
    const generated = setup();
    await generated.run(options({ apply: true }));
    expect(generated.output()).not.toContain(GENERATED_CODE);

    const given = setup();
    const dry = await given.run(options({ inviteCode: GIVEN_CODE }));
    const applied = await given.run(options({ apply: true, inviteCode: GIVEN_CODE }));
    expect(given.output()).not.toContain(GIVEN_CODE);
    expect(dry.inviteCode).toBeUndefined();
    expect(applied.inviteCode).toBeUndefined();
  });

  it('prints the invite code once, on its own line, only with --show-invite-code', async () => {
    const env = setup();
    const report = await env.run(options({ apply: true, showInviteCode: true }));
    expect(report.inviteCode).toBe(GENERATED_CODE);
    expect(env.lines.filter((line) => line.includes(GENERATED_CODE))).toHaveLength(1);
  });

  it('does not make up an invite code in a dry-run', async () => {
    const env = setup();
    let generated = 0;
    await runCreateGroup({
      options: options(),
      env: { SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY },
      createDb: () => env.db,
      log: () => {},
      generateCode: () => (generated++, GENERATED_CODE),
    });
    expect(generated).toBe(0);
  });

  it('scrubs the invite code and the key from every line, even when the database echoes them in the group name', async () => {
    const env = setup();
    await env.run(options({ apply: true, name: `Pack ${GIVEN_CODE} ${SERVICE_KEY}`.slice(0, 60), inviteCode: GIVEN_CODE }));
    expect(env.output()).toContain('Created the group');
    expect(env.output()).not.toContain(GIVEN_CODE);
    expect(env.output()).not.toContain(SERVICE_KEY);
  });

  it('never prints the service role key', async () => {
    const env = setup();
    await env.run(options({ apply: true }));
    expect(env.output()).not.toContain(SERVICE_KEY);
  });

  describe('production and unknown targets', () => {
    const prodEnv = { SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };

    it('refuses --apply against production by default and makes no database client at all', async () => {
      const env = setup({ env: prodEnv });
      const report = await env.run(options({ apply: true }));

      expect(report.outcome).toBe('refused_prod');
      expect(env.created).toEqual([]);
      expect(env.calls).toEqual([]);
      expect(env.output()).toContain(`${PROD_PROJECT_REF}.supabase.co`);
    });

    it('refuses --apply against production with --allow-prod alone', async () => {
      const env = setup({ env: prodEnv });
      const report = await env.run(options({ apply: true, allowProd: true }));
      expect(report.outcome).toBe('refused_prod');
      expect(env.calls).toEqual([]);
    });

    it('creates in production only with --allow-prod and the exact confirmation', async () => {
      const env = setup({ env: prodEnv });
      const report = await env.run(options({ apply: true, allowProd: true, confirmProd: PROD_CONFIRMATION }));
      expect(report.outcome).toBe('created');
      expect(env.created).toEqual([{ url: PROD_URL, key: SERVICE_KEY }]);
    });

    it('lets a dry-run read production but writes nothing', async () => {
      const env = setup({ env: prodEnv });
      const report = await env.run(options());
      expect(report.outcome).toBe('dry_run');
      expect(env.calls).toEqual([]);
    });

    it('refuses --apply against a project that is neither staging nor production', async () => {
      const env = setup({ env: { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } });
      const report = await env.run(options({ apply: true }));
      expect(report.outcome).toBe('refused_target');
      expect(env.created).toEqual([]);
    });

    it('decides from the URL in the environment, whatever the options claim', async () => {
      const env = setup({ env: { SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co@${PROD_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } });
      const report = await env.run(options({ apply: true }));
      expect(report.outcome).toBe('refused_prod');
      expect(env.created).toEqual([]);
    });
  });

  describe('what must be in place first', () => {
    it('stops without SUPABASE_URL and names the variable', async () => {
      const env = setup({ env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } });
      const report = await env.run(options({ apply: true }));
      expect(report.outcome).toBe('missing_env');
      expect(env.output()).toContain('SUPABASE_URL');
      expect(env.created).toEqual([]);
    });

    it('stops without the service role key and names the variable', async () => {
      const env = setup({ env: { SUPABASE_URL: STAGING_URL } });
      const report = await env.run(options({ apply: true }));
      expect(report.outcome).toBe('missing_env');
      expect(env.output()).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(env.created).toEqual([]);
    });

    it('stops when the owner does not exist', async () => {
      const env = setup({ users: [] });
      const report = await env.run(options({ apply: true }));
      expect(report.outcome).toBe('owner_not_found');
      expect(env.calls).toEqual([]);
    });

    it('stops when the e-mail address belongs to more than one user', async () => {
      const users = [
        { id: 'a', name: 'A', email: 'dup@staging.runquest.test', group_id: null },
        { id: 'b', name: 'B', email: 'dup@staging.runquest.test', group_id: null },
      ];
      const env = setup({ users });
      const report = await env.run(options({ apply: true, ownerId: undefined, ownerEmail: 'dup@staging.runquest.test' }));
      expect(report.outcome).toBe('owner_ambiguous');
      expect(env.calls).toEqual([]);
    });

    it('stops, in a dry-run too, when the owner already has an active membership', async () => {
      const members = [{ id: 'm1', user_id: OWNER_ID, group_id: 'g-existing', role: 'member', left_at: null }];
      const env = setup({ members });

      const dry = await env.run(options());
      const applied = await env.run(options({ apply: true }));

      expect(dry.outcome).toBe('owner_has_membership');
      expect(applied.outcome).toBe('owner_has_membership');
      expect(env.calls).toEqual([]);
    });
  });

  describe('when the database refuses', () => {
    it('reports an invite code that is taken without printing it or the database text', async () => {
      const env = setup({ rpcError: { code: '23505', message: 'duplicate key value violates unique constraint "groups_invite_code_key"', details: `Key (invite_code)=(${GIVEN_CODE}) already exists.` } });
      const report = await env.run(options({ apply: true, inviteCode: GIVEN_CODE }));

      expect(report.outcome).toBe('invite_code_taken');
      expect(env.output()).not.toContain(GIVEN_CODE);
      expect(env.output()).not.toContain('duplicate key');
    });

    it('reports an error that is thrown, not returned, with its code only', async () => {
      const env = setup({ rpcThrows: new Error('connect ECONNREFUSED while writing Second Admin') });
      const report = await env.run(options({ apply: true }));

      expect(report.outcome).toBe('failed');
      expect(env.output()).toContain('ECONNREFUSED');
      expect(env.output()).not.toContain('while writing');
    });

    it('reports any other failure with the database code only', async () => {
      const env = setup({ rpcError: { code: '40P01', message: 'deadlock detected for row Second Admin' } });
      const report = await env.run(options({ apply: true }));

      expect(report.outcome).toBe('failed');
      expect(env.output()).toContain('40P01');
      expect(env.output()).not.toContain('deadlock detected');
    });
  });
});

describe('exitCodeFor', () => {
  it('is 0 for a dry-run and for a created group, and 1 for every refusal and failure', () => {
    expect(exitCodeFor({ outcome: 'dry_run' })).toBe(0);
    expect(exitCodeFor({ outcome: 'created' })).toBe(0);
    for (const outcome of ['refused_prod', 'refused_target', 'missing_env', 'owner_not_found', 'owner_ambiguous', 'owner_has_membership', 'invite_code_taken', 'failed'] as const) {
      expect(exitCodeFor({ outcome })).toBe(1);
    }
  });
});
