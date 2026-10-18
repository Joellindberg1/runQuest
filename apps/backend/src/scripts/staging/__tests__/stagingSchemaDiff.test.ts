/**
 * staging/schemaFingerprint.ts and stagingSchemaDiff.ts: the fingerprint diff, the normalisation of function bodies and the known
 * differences. No real network: a fake prod and staging answer the catalog queries with prepared rows.
 */
import { describe, it, expect } from 'vitest';
import { createFakeManagementApi, isSelect } from '../../../test-utils/fakeManagementApi.js';
import {
  FINGERPRINT_CATEGORIES,
  FINGERPRINT_QUERIES,
  KNOWN_DIFFERENCES,
  NOT_COMPARED,
  buildFingerprint,
  diffFingerprints,
  formatDiff,
  hasUnexplainedDifferences,
  markKnown,
  normalizeSqlText,
  type FingerprintCategory,
} from '../schemaFingerprint.js';
import { exitCodeFor, parseArgs, runSchemaDiff } from '../stagingSchemaDiff.js';
import { PROD_PROJECT_REF, STAGING_PROJECT_REF, type Row } from '../stagingTarget.js';

const STAGING_TOKEN = 'sbp_staging_token_0123456789abcdef0123456789';
const PROD_TOKEN = 'sbp_prod_read_token_0123456789abcdef012345678';
const ENV = { SUPABASE_STAGING_ACCESS_TOKEN: STAGING_TOKEN, RUNQUEST_PROD_READ_TOKEN: PROD_TOKEN };

type Rows = Partial<Record<FingerprintCategory, Row[]>>;

const emptyRows = (): Record<FingerprintCategory, Row[]> => Object.fromEntries(FINGERPRINT_CATEGORIES.map((c) => [c, []])) as unknown as Record<FingerprintCategory, Row[]>;
const rows = (overrides: Rows) => ({ ...emptyRows(), ...overrides });
const side = (overrides: Rows) => buildFingerprint(rows(overrides));

const FUNCTION_LF = 'owner: postgres\nCREATE OR REPLACE FUNCTION public.f()\n RETURNS integer\nAS $$\nbegin\n  return 1;\nend;\n$$';
const FUNCTION_CRLF = 'owner: postgres\r\nCREATE OR REPLACE FUNCTION public.f()\r\n RETURNS integer\r\n\r\nAS $$\r\nbegin\r\n\r\n  return 1;\r\nend;\r\n$$\r\n';

describe('normalizeSqlText', () => {
  it('makes CRLF, blank lines and trailing whitespace disappear and nothing else', () => {
    expect(normalizeSqlText(FUNCTION_CRLF)).toBe(FUNCTION_LF);
    expect(normalizeSqlText('a  \n\n   \nb\n')).toBe('a\nb');
  });

  it('keeps a real difference in a function body', () => {
    expect(normalizeSqlText(FUNCTION_LF.replace('return 1', 'return 2'))).not.toBe(normalizeSqlText(FUNCTION_CRLF));
    expect(normalizeSqlText('  indented')).toBe('  indented');
  });
});

describe('the fingerprint diff', () => {
  it('is empty for two equal schemas', () => {
    const same = rows({ columns: [{ key: 'users.id', value: '{"type":"uuid"}' }], functions: [{ key: 'public.f()', value: FUNCTION_LF }] });
    const diff = diffFingerprints(buildFingerprint(same), buildFingerprint(same));
    expect(diff.entries).toEqual([]);
    expect(hasUnexplainedDifferences(diff)).toBe(false);
  });

  it('treats two function bodies that differ only by CRLF and blank lines as equal and says so', () => {
    const diff = diffFingerprints(side({ functions: [{ key: 'public.f()', value: FUNCTION_CRLF }] }), side({ functions: [{ key: 'public.f()', value: FUNCTION_LF }] }));
    expect(diff.entries).toEqual([]);
    expect(diff.normalizedAway).toEqual([{ category: 'functions', key: 'public.f()' }]);
    expect(formatDiff(diff).join('\n')).toContain('Normalised away');
  });

  it('reports a real change in a function body and names the line', () => {
    const diff = diffFingerprints(
      side({ functions: [{ key: 'public.f()', value: FUNCTION_LF }] }),
      side({ functions: [{ key: 'public.f()', value: FUNCTION_LF.replace('return 1', 'return 2') }] }),
    );
    expect(diff.entries).toMatchObject([{ category: 'functions', key: 'public.f()', kind: 'different' }]);
    const text = formatDiff(diff).join('\n');
    expect(text).toContain('Unexplained differences: 1');
    expect(text).toContain('differs at line 6');
    expect(text).toContain('return 2');
    expect(hasUnexplainedDifferences(diff)).toBe(true);
  });

  it('reports a changed function owner', () => {
    const diff = diffFingerprints(side({ functions: [{ key: 'public.f()', value: FUNCTION_LF }] }), side({ functions: [{ key: 'public.f()', value: FUNCTION_LF.replace('postgres', 'supabase_admin') }] }));
    expect(diff.entries).toHaveLength(1);
    expect(formatDiff(diff).join('\n')).toContain('supabase_admin');
  });

  it('reports a changed relation owner or storage option', () => {
    const base = '{"kind":"v","options":null,"owner":"postgres","rls_enabled":false,"rls_forced":false}';
    expect(diffFingerprints(side({ relations: [{ key: 'v', value: base }] }), side({ relations: [{ key: 'v', value: base.replace('postgres', 'other') }] })).entries).toHaveLength(1);
    expect(diffFingerprints(side({ relations: [{ key: 'v', value: base }] }), side({ relations: [{ key: 'v', value: base.replace('null', '"{security_invoker=true}"') }] })).entries).toHaveLength(1);
  });

  it('reports objects that exist on one side only, in every category', () => {
    for (const category of FINGERPRINT_CATEGORIES) {
      const diff = diffFingerprints(side({ [category]: [{ key: 'a', value: 'x' }] }), side({ [category]: [{ key: 'b', value: 'x' }] }));
      expect(diff.entries.map((e) => [e.category, e.key, e.kind])).toEqual([
        [category, 'a', 'only_in_prod'],
        [category, 'b', 'only_in_staging'],
      ]);
    }
  });

  it('does not normalise policies: a changed using-expression is a difference', () => {
    const diff = diffFingerprints(side({ policies: [{ key: 'runs.p', value: '{"using":"a = b"}' }] }), side({ policies: [{ key: 'runs.p', value: '{"using":"a  =  b"}' }] }));
    expect(diff.entries).toHaveLength(1);
  });

  it('refuses a fingerprint with a duplicate or missing key rather than hiding a difference', () => {
    expect(() => buildFingerprint(rows({ columns: [{ key: 'a', value: '1' }, { key: 'a', value: '2' }] }))).toThrow(/twice/);
    expect(() => buildFingerprint(rows({ columns: [{ key: null, value: '1' }] }))).toThrow(/without a key/);
  });

  it('prints what it does not compare', () => {
    const text = formatDiff(diffFingerprints(side({}), side({}))).join('\n');
    expect(text).toContain('Not compared:');
    for (const item of ['storage and auth', 'default privileges', 'extensions', 'event triggers', 'constraints on domain types']) expect(text).toContain(item);
    expect(NOT_COMPARED.length).toBeGreaterThanOrEqual(4);
  });
});

describe('known differences', () => {
  const grantKey = (signature: string, grantee = 'PUBLIC') => `${signature} -> ${grantee} EXECUTE`;
  const grantRows = (signatures: readonly string[], grantee = 'PUBLIC'): Row[] => signatures.map((s) => ({ key: grantKey(s, grantee), value: '{"grantable":false}' }));
  const FOUR_FUNCTIONS = [
    'public.increment_event_xp(p_user_id uuid, p_xp integer)',
    'public.trigger_update_title_leaderboard()',
    'public.update_all_title_leaderboards()',
    'public.update_title_leaderboard(p_title_id uuid)',
  ];
  const clientGrants = (): Row[] => [...grantRows(FOUR_FUNCTIONS, 'anon'), ...grantRows(FOUR_FUNCTIONS, 'authenticated')];
  /** What a project has on the four functions after 056: the owner and service_role only. */
  const after056 = (): Row[] => [...grantRows(FOUR_FUNCTIONS, 'postgres'), ...grantRows(FOUR_FUNCTIONS, 'service_role')];

  it('has no permanent rule: PUBLIC execute that only staging has is unexplained, since 056 closes it on the four functions in both projects', () => {
    const diff = diffFingerprints(side({}), side({ function_grants: grantRows(FOUR_FUNCTIONS) }));
    expect(diff.entries).toHaveLength(4);
    expect(markKnown(diff.entries).every((e) => !e.known)).toBe(true);
    expect(hasUnexplainedDifferences(diff)).toBe(true);
    expect(KNOWN_DIFFERENCES.map((r) => r.id)).toEqual(['temporary-056-client-execute-in-prod']);
  });

  it('does not treat the opposite direction, or another privilege, as known', () => {
    const prodOnlyPublic = diffFingerprints(side({ function_grants: grantRows(FOUR_FUNCTIONS) }), side({}));
    expect(hasUnexplainedDifferences(prodOnlyPublic)).toBe(true);
    const stagingOnlyAnon = diffFingerprints(side({}), side({ function_grants: grantRows(FOUR_FUNCTIONS, 'anon') }));
    expect(hasUnexplainedDifferences(stagingOnlyAnon)).toBe(true);
  });

  describe('temporary: anon and authenticated execute on the four functions, between the staging apply and the prod apply of 056', () => {
    it('marks the eight client grants that only prod still has as known, with the reason and the removal condition', () => {
      const diff = diffFingerprints(side({ function_grants: clientGrants() }), side({}));
      const marked = markKnown(diff.entries);
      expect(marked).toHaveLength(8);
      expect(marked.every((e) => e.kind === 'only_in_prod' && e.known?.includes('RUN-326') && e.known.includes('056'))).toBe(true);
      expect(hasUnexplainedDifferences(diff)).toBe(false);
      expect(formatDiff(diff).join('\n')).toContain('Known differences: 8');
    });

    it('is silent when prod has 056 too: two projects in the state after 056 give no entries, no known differences and no note about the rule', () => {
      const staging = side({ function_grants: after056() });
      const prod = side({ function_grants: after056() });
      expect(prod.raw.function_grants.size).toBe(8);
      const diff = diffFingerprints(prod, staging);
      expect(diff.entries).toHaveLength(0);
      expect(hasUnexplainedDifferences(diff)).toBe(false);
      const text = formatDiff(diff).join('\n');
      expect(text).toContain('Unexplained differences: none.');
      expect(text).not.toContain('Known differences');
      expect(text).not.toContain('Note: rule');
      expect(text).not.toContain('temporary-056');
    });

    it('explains the client grants while the other grants (owner, service_role) are equal on both sides', () => {
      const diff = diffFingerprints(side({ function_grants: [...after056(), ...clientGrants()] }), side({ function_grants: after056() }));
      expect(diff.entries).toHaveLength(8);
      expect(markKnown(diff.entries).every((e) => e.known)).toBe(true);
      expect(hasUnexplainedDifferences(diff)).toBe(false);
    });

    it('does not hide a client grant on another function, or a missing one of the eight', () => {
      const extra = diffFingerprints(side({ function_grants: [...clientGrants(), ...grantRows(['public.other()'], 'anon')] }), side({}));
      expect(markKnown(extra.entries).every((e) => !e.known)).toBe(true);
      expect(hasUnexplainedDifferences(extra)).toBe(true);
      const missing = diffFingerprints(side({ function_grants: clientGrants().slice(1) }), side({}));
      expect(markKnown(missing.entries).every((e) => !e.known)).toBe(true);
      expect(formatDiff(missing).join('\n')).toContain(`Not found: ${grantKey(FOUR_FUNCTIONS[0], 'anon')}`);
    });

    it('does not mark a grant that only staging has, or service_role on the four functions, as known', () => {
      expect(hasUnexplainedDifferences(diffFingerprints(side({}), side({ function_grants: clientGrants() })))).toBe(true);
      expect(hasUnexplainedDifferences(diffFingerprints(side({ function_grants: grantRows(FOUR_FUNCTIONS, 'service_role') }), side({})))).toBe(true);
    });

    it('is the only rule, and its text says when it is removed', () => {
      expect(KNOWN_DIFFERENCES).toHaveLength(1);
      expect(KNOWN_DIFFERENCES[0].explanation).toContain('removed when 056 is applied in prod');
    });
  });
});

describe('the catalog queries', () => {
  it('cover columns, functions with bodies and owners, policies, indexes, constraints, grants, function grants, RLS and triggers', () => {
    expect(Object.keys(FINGERPRINT_QUERIES).sort()).toEqual([...FINGERPRINT_CATEGORIES].sort());
    expect(FINGERPRINT_QUERIES.functions).toContain('pg_get_functiondef');
    expect(FINGERPRINT_QUERIES.functions).toContain('proowner');
    expect(FINGERPRINT_QUERIES.function_grants).toContain('acldefault');
    expect(FINGERPRINT_QUERIES.relations).toContain('relrowsecurity');
    expect(FINGERPRINT_QUERIES.relations).toContain('reloptions');
    expect(FINGERPRINT_QUERIES.relations).toContain('relowner');
    expect(FINGERPRINT_QUERIES.triggers).toContain('pg_get_triggerdef');
    expect(FINGERPRINT_QUERIES.policies).toContain('pg_policies');
    expect(FINGERPRINT_QUERIES.indexes).toContain('pg_indexes');
    expect(FINGERPRINT_QUERIES.constraints).toContain('pg_get_constraintdef');
    expect(FINGERPRINT_QUERIES.table_grants).toContain('aclexplode');
  });

  it('give acldefault its object type as "char", not as text', () => {
    // First real run: a CASE of two string literals is text, and acldefault(text, oid) does not exist.
    expect(FINGERPRINT_QUERIES.table_grants).toContain(`case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end`);
    expect(FINGERPRINT_QUERIES.function_grants).toContain(`acldefault('f'::"char", p.proowner)`);
    expect(Object.values(FINGERPRINT_QUERIES).filter((sql) => sql.includes('acldefault'))).toHaveLength(2);
  });

  it('do not depend on the search path of the session or on what the reading role may see', () => {
    for (const sql of Object.values(FINGERPRINT_QUERIES)) {
      expect(sql).not.toContain('::regclass::text');
      expect(sql).not.toContain('::regprocedure');
      expect(sql).not.toContain('information_schema');
    }
  });

  it('are plain selects', () => {
    expect(Object.values(FINGERPRINT_QUERIES).every((sql) => isSelect(sql))).toBe(true);
  });
});

describe('staging:schema-diff run', () => {
  /** Answers each catalog query with the rows of the side the request is for. Both sides are read through the read-only endpoint. */
  function world(prodRows: Rows, stagingRows: Rows) {
    return createFakeManagementApi((call) => {
      if (call.path !== '/database/query/read-only') return undefined;
      const sql = String(call.body?.query ?? '');
      const category = FINGERPRINT_CATEGORIES.find((c) => FINGERPRINT_QUERIES[c] === sql);
      if (!category) return undefined;
      const source = call.ref === PROD_PROJECT_REF ? prodRows : call.ref === STAGING_PROJECT_REF ? stagingRows : undefined;
      return source ? { body: source[category] ?? [] } : undefined;
    });
  }
  const go = async (api: { fetchImpl: typeof fetch }, flags: { readProd?: boolean } = { readProd: true }, env: NodeJS.ProcessEnv = ENV) => {
    const printed: string[] = [];
    const report = await runSchemaDiff({ readProd: flags.readProd ?? false, env, fetchImpl: api.fetchImpl, log: (l) => printed.push(l) });
    return { report, printed };
  };

  it('parses --read-prod and nothing else', () => {
    expect(parseArgs([])).toEqual({ readProd: false });
    expect(parseArgs(['--read-prod'])).toEqual({ readProd: true });
    expect(() => parseArgs(['--apply'])).toThrow(/Unknown argument/);
  });

  it('prints the plan and makes no request at all without --read-prod', async () => {
    const api = world({}, {});
    const { report, printed } = await go(api, { readProd: false });
    expect(report.outcome).toBe('plan_only');
    expect(api.calls).toHaveLength(0);
    expect(printed.join('\n')).toContain('No --read-prod');
    expect(printed.join('\n')).toContain('Not compared:');
    expect(exitCodeFor(report)).toBe(0);
  });

  it('exits 0 for equal schemas, with the CRLF noise normalised away, and only reads', async () => {
    const api = world({ functions: [{ key: 'public.f()', value: FUNCTION_CRLF }] }, { functions: [{ key: 'public.f()', value: FUNCTION_LF }] });
    const { report, printed } = await go(api);
    expect(report.outcome).toBe('same');
    expect(exitCodeFor(report)).toBe(0);
    expect(api.writes()).toHaveLength(0);
    expect(api.callsTo(PROD_PROJECT_REF)).toHaveLength(FINGERPRINT_CATEGORIES.length);
    expect(api.callsTo(STAGING_PROJECT_REF)).toHaveLength(FINGERPRINT_CATEGORIES.length);
    expect(api.calls.every((c) => c.path === '/database/query/read-only')).toBe(true);
    expect(printed.join('\n')).toContain('Unexplained differences: none.');
  });

  it('sends prod only statements from the fixed list', async () => {
    const api = world({}, {});
    await go(api);
    const sent = api.callsTo(PROD_PROJECT_REF).map((c) => c.body?.query);
    expect(sent.sort()).toEqual(Object.values(FINGERPRINT_QUERIES).sort());
  });

  it('exits 1 and prints the difference when the schemas differ', async () => {
    const api = world({ columns: [{ key: 'users.name', value: '{"type":"text"}' }] }, {});
    const { report, printed } = await go(api);
    expect(report.outcome).toBe('differs');
    expect(exitCodeFor(report)).toBe(1);
    expect(printed.join('\n')).toContain('[columns] users.name: only in prod');
  });

  it('prints both hosts and no token', async () => {
    const { printed } = await go(world({}, {}));
    const text = printed.join('\n');
    expect(text).toContain(`db.${PROD_PROJECT_REF}.supabase.co`);
    expect(text).toContain(`db.${STAGING_PROJECT_REF}.supabase.co`);
    expect(text).not.toContain(STAGING_TOKEN);
    expect(text).not.toContain(PROD_TOKEN);
  });

  it('fails without a comparison when a schema cannot be read', async () => {
    const api = createFakeManagementApi((call) => (call.ref === PROD_PROJECT_REF ? { status: 500, body: 'down' } : { body: [] }));
    const { report } = await go(api);
    expect(report.outcome).toBe('failed');
    expect(exitCodeFor(report)).toBe(1);
  });

  it('refuses without both tokens and sends nothing; the general Supabase token does not count', async () => {
    const envs: NodeJS.ProcessEnv[] = [
      { SUPABASE_STAGING_ACCESS_TOKEN: STAGING_TOKEN },
      { RUNQUEST_PROD_READ_TOKEN: PROD_TOKEN },
      { SUPABASE_STAGING_ACCESS_TOKEN: STAGING_TOKEN, SUPABASE_ACCESS_TOKEN: PROD_TOKEN },
    ];
    for (const env of envs) {
      const api = world({}, {});
      const { report } = await go(api, { readProd: true }, env);
      expect(report.outcome).toBe('missing_env');
      expect(api.calls).toHaveLength(0);
    }
  });
});
