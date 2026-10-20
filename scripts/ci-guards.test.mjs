// Test av CI-vakternas logik (rena funktioner) + CLI-prov mot de riktiga filerna och mot temporära repon.
// Körs med `node --test scripts/ci-guards.test.mjs` (CI: frontend-jobbet).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkConditionalGroupFilter,
  checkDocPaths,
  checkEmptySuites,
  checkErrorResponsesViaFail,
  checkFontFiles,
  checkGroupRoleMapping,
  checkGroupSettingsWrites,
  checkGitignoreForVideo,
  checkMediaFiles,
  checkNoFrontendSupabase,
  checkNoTrackedVideoOriginals,
  checkRateBudgetHook,
  checkReconcileSchedulerStart,
  checkRecoverySchedulerStart,
  checkStravaTokenPath,
  checkTokenKeyStartupCheck,
  checkDummyHashWarmup,
  checkWebhookSchedulerStart,
  checkRawStravaFetch,
  checkRouteResponseContracts,
  checkTestNames,
  checkTodos,
  checkTokenGroupIdReads,
  checkUsersGroupIdWrites,
  DOC_PATH_EXEMPT,
  ERROR_RESPONSE_EXEMPT_ROUTES,
  GROUP_SETTINGS_EXEMPT_FILES,
  isEntryPoint,
  listWorkspaces,
  walkFiles,
} from './ci-guards.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'ci-guards.mjs');
const repoRoot = join(here, '..');

const runCli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe('checkEmptySuites', () => {
  const workspaces = [
    { dir: 'apps/backend', hasTestScript: true },
    { dir: 'packages/types', hasTestScript: false },
  ];

  it('passes when every workspace with a test script has a test file', () => {
    assert.deepEqual(checkEmptySuites(workspaces, { 'apps/backend': ['apps/backend/src/a.test.ts'] }), []);
  });

  it('fails a workspace with a test script and zero test files', () => {
    const errors = checkEmptySuites(workspaces, { 'apps/backend': ['apps/backend/src/a.ts', 'apps/backend/src/b.ts'] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend/);
  });

  it('fails when the workspace has no files at all', () => {
    assert.equal(checkEmptySuites(workspaces, {}).length, 1);
  });

  it('ignores workspaces without a test script', () => {
    assert.deepEqual(checkEmptySuites([{ dir: 'packages/types', hasTestScript: false }], {}), []);
  });

  it('counts .spec and .tsx/.mjs test files but not files that merely contain "test" in the name', () => {
    for (const file of ['x.spec.ts', 'x.test.tsx', 'x.test.mjs']) {
      assert.deepEqual(checkEmptySuites(workspaces, { 'apps/backend': [file] }), [], file);
    }
    for (const file of ['testUtils.ts', 'test.ts', 'x.test.json', 'x.test.ts.snap']) {
      assert.equal(checkEmptySuites(workspaces, { 'apps/backend': [file] }).length, 1, file);
    }
  });
});

describe('checkTodos', () => {
  const scan = (content, path = 'apps/backend/src/x.ts') => checkTodos([{ path, content }]);

  it('fails an untagged TODO and reports file:line', () => {
    const errors = scan('const a = 1;\n// TODO: fix this\n');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^apps\/backend\/src\/x\.ts:2: TODO utan RUN-nyckel/);
  });

  it('fails an untagged FIXME and a TODO with a non-RUN key', () => {
    assert.equal(scan('// FIXME later').length, 1);
    assert.equal(scan('// TODO(ABC-12): later').length, 1);
    assert.equal(scan('// TODO RUN-: later').length, 1);
  });

  it('accepts the tagged forms', () => {
    for (const line of ['// TODO(RUN-123): x', '// TODO: RUN-123 x', '// TODO [RUN-123] x', '// FIXME RUN-9 x', '/* TODO(RUN-1) */']) {
      assert.deepEqual(scan(line), [], line);
    }
  });

  it('does not treat lowercase todo identifiers or words like TODOS as markers', () => {
    assert.deepEqual(scan('const todos = []; // todo list\nconst TODOS = 1;'), []);
  });

  it('fails a second, untagged marker on a line that also has a tagged one', () => {
    assert.equal(scan('// TODO(RUN-1) a; TODO b').length, 1);
  });

  it('handles CRLF files', () => {
    const errors = scan('a\r\n// TODO x\r\nb\r\n');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /:2:/);
  });

  it('is text based: a string literal or regex containing the marker also fails', () => {
    assert.equal(scan("const s = 'TODO: x';").length, 1);
    assert.equal(scan('const r = /FIXME/;').length, 1);
    assert.deepEqual(scan("const s = 'TODO(RUN-1)';"), []);
  });
});

describe('checkTestNames', () => {
  const scan = (content, path = 'apps/frontend/src/x.test.ts') => checkTestNames([{ path, content }]);

  it('fails a Jira ID in an it, test or describe name and reports file:line', () => {
    for (const call of ["it('klockan (RUN-141)', () => {});", "test('RUN-1: x', () => {});", 'describe("grupp RUN-22", () => {});', 'it(`mall RUN-9 ${x}`, () => {});']) {
      const errors = scan(`import { it } from 'vitest';\n${call}\n`);
      assert.equal(errors.length, 1, call);
      assert.match(errors[0], /^apps\/frontend\/src\/x\.test\.ts:2: Jira-ID i testnamn/, call);
    }
  });

  it('sees .skip/.only/.each variants and names that start on the next line', () => {
    for (const call of [
      "it.skip('a RUN-5', () => {});",
      "describe.only('a RUN-5', () => {});",
      "it.each([1, 2])('a RUN-5 %i', () => {});",
      "describe.each([['a', 1]])('a RUN-5 %s', () => {});",
      "it.each(rows.map((r) => [r.a]))('a RUN-5', () => {});",
      "it(\n    'a RUN-5',\n    () => {},\n  );",
    ]) {
      assert.equal(scan(call).length, 1, call);
    }
  });

  it('accepts names without a Jira ID, including spec IDs and ADR references', () => {
    for (const call of ["it('upgrade (T3)', () => {});", "describe('badgetexter (F9.12, ADR 009)', () => {});", "it('RUN är ett ord', () => {});", "it('RUN-', () => {});"]) {
      assert.deepEqual(scan(call), [], call);
    }
  });

  it('ignores RUN IDs outside the name: comments, bodies, other string arguments and non-test functions', () => {
    assert.deepEqual(scan("// RUN-1 fix\nit('beteende', () => { expect(x).toBe('RUN-2'); /* RUN-3 */ });\n"), []);
    assert.deepEqual(scan("const t = submit('RUN-4');\nexpect.it('RUN-5');\nmyit('RUN-6');\n"), []);
    assert.deepEqual(scan("it('beteende', () => {\n  expect(parse('RUN-7')).toBe(7);\n});\n"), []);
  });

  it('reports every offending name and handles CRLF', () => {
    const errors = scan("it('a RUN-1', () => {});\r\nit('b', () => {});\r\nit('c RUN-2', () => {});\r\n");
    assert.equal(errors.length, 2);
    assert.match(errors[1], /:3:/);
  });
});

describe('checkConditionalGroupFilter', () => {
  const ROUTE = 'apps/backend/src/routes/x.ts';
  const scan = (content, path = ROUTE) => checkConditionalGroupFilter([{ path, content }]);

  it('flags the exact pattern that served every group to a token without group_id', () => {
    const planted = [
      "    let query = supabase.from('users').select('id');",
      '',
      '    if (groupId) {',
      "      query = query.eq('group_id', groupId);",
      '    }',
      '',
    ].join('\n');
    const errors = scan(planted);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/routes\/x\.ts:3: villkorligt gruppfilter/);
  });

  it('flags the variants: brace-less if, CRLF, req.user group, joined column, .in()', () => {
    for (const code of [
      "if (groupId) query = query.eq('group_id', groupId);",
      "if (groupId) {\r\n  query = query.eq('group_id', groupId);\r\n}",
      "if (req.user!.group_id) { q = q.eq('group_id', req.user!.group_id); }",
      "if (group_id) { q = q.eq(\"users.group_id\", group_id); }",
      "if (groupId) { q = q.in('group_id', [groupId]); }",
      "if (  groupId  )\n  {\n    q = q.eq(`group_id`, groupId);\n  }",
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
  });

  it('passes the fail-closed forms used today', () => {
    for (const code of [
      "const groupId = groupIdOrRespondEmpty(req, res);\nif (!groupId) return;\nconst r = await supabase.from('users').eq('group_id', groupId);",
      "if (!groupId) {\n  res.json({ items: [] }); return;\n}\nconst q = supabase.from('x').eq('group_id', groupId);",
      "if (!groupId) { notFound(); return; }\nawait supabase.from('x').eq('group_id', groupId);",
      "groupId ? supabase.from('challenges').eq('group_id', groupId) : Promise.resolve({ data: [] })",
      "if (groupId && opponent.group_id !== groupId) { fail(); }",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('does not match a group check whose block ends before an unrelated, unconditional group filter', () => {
    const code = "if (groupId) {\n  log(groupId);\n}\nconst q = supabase.from('x').eq('group_id', groupId);";
    assert.deepEqual(scan(code), []);
  });

  it('only reads route files, never tests or services', () => {
    const bad = "if (groupId) { q = q.eq('group_id', groupId); }";
    assert.equal(scan(bad, 'apps/backend/src/routes/auth.ts').length, 1);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/__tests__/x.test.ts'), []);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/x.test.ts'), []);
    assert.deepEqual(scan(bad, 'apps/backend/src/services/enhancedTitleService.ts'), []);
  });

  it('reports every offending block with its own line number', () => {
    const code = "a;\nif (groupId) { q = q.eq('group_id', groupId); }\nb;\nif (groupId) {\n q = q.eq('group_id', groupId);\n}\n";
    const errors = scan(code);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /:2:/);
    assert.match(errors[1], /:4:/);
  });
});

describe('checkGroupRoleMapping', () => {
  const scan = (content, path = 'apps/backend/src/utils/groupAccess.ts') => checkGroupRoleMapping([{ path, content }]);

  it('flags a role compared with a role name instead of asking groupRoleCan', () => {
    for (const code of [
      "if (member.role === 'admin') allow();",
      'if (role !== "admin") return deny();',
      "const isAdmin = membership.role == 'admin';",
      "if ('admin' === membership.role) allow();",
      "if (role === 'member') hide();",
      "if (['admin'].includes(membership.role)) allow();",
      "if (  role   ===\n  'admin') allow();",
    ]) {
      const errors = scan(code);
      assert.equal(errors.length, 1, code);
      assert.match(errors[0], /apps\/backend\/src\/utils\/groupAccess\.ts:1: .*groupRoleCan/);
    }
  });

  it('passes the allowed forms: groupRoleCan, role values as data, database filters and unrelated roles', () => {
    for (const code of [
      "if (groupRoleCan(membership.role, 'settings.write')) allow();",
      "await rpc('join_group', { p_role: 'member' });",
      "const { data } = await db.from('group_members').select('role').eq('role', 'admin');",
      "quiet={kind.role === 'others'}",
      '<nav role="admin-menu" />',
      "const roleLabel = role === 'viewer' ? 'Viewer' : 'Other';",
      "// if (role === 'admin') är förbjudet — använd groupRoleCan\nconst x = 1;",
      "/* role === 'admin' */ const y = 2;",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('reports every offending line with its own line number', () => {
    const errors = scan("a;\nif (role === 'admin') x();\nb;\nif (m.role !== 'member') y();\n");
    assert.equal(errors.length, 2);
    assert.match(errors[0], /:2:/);
    assert.match(errors[1], /:4:/);
  });

  it('exempts the one file that maps roles, tests and test support, and ignores other places', () => {
    const bad = "if (role === 'admin') x();";
    assert.deepEqual(scan(bad, 'packages/shared/src/groupRoles.ts'), []);
    assert.deepEqual(scan(bad, 'packages/shared/src/__tests__/groupRoles.test.ts'), []);
    assert.deepEqual(scan(bad, 'apps/backend/src/utils/groupAccess.test.ts'), []);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/__tests__/helpers/x.ts'), []);
    assert.equal(scan(bad, 'apps/frontend/src/features/groups/groupModel.ts').length, 1);
    assert.equal(scan(bad, 'packages/shared/src/other.ts').length, 1);
    assert.deepEqual(scan(bad, 'apps/backend/migrations/x.ts'), []);
  });
});

describe('checkUsersGroupIdWrites', () => {
  const scan = (content, path = 'apps/backend/src/routes/groups.ts') => checkUsersGroupIdWrites([{ path, content }]);

  it('flags a supabase-js write to users that sets group_id, with or without other fields', () => {
    for (const code of [
      "await supabase.from('users').update({ group_id: group.id }).eq('id', userId);",
      "await supabase.from('users').update({ name, group_id: groupId, total_xp: 0 }).eq('id', userId);",
      "await supabase.from('users').update({\n  name,\n  group_id: groupId,\n}).eq('id', userId);",
      "await db.from('users').update({ group_id }).eq('id', id);",
      "await db.from('users').update({ total_xp: 0, group_id }).eq('id', id);",
      "await db.from('users').update({ 'group_id': groupId }).eq('id', id);",
      'await db.from("users").update({ ["group_id"]: groupId }).eq("id", id);',
      "await db.from('users').insert({ name, email, group_id: groupId }).select('id').single();",
      "await db.from('users').insert([{ name: 'a', group_id: groupId }, { name: 'b' }]);",
      "await db.from('users').upsert({ id, group_id: groupId }, { onConflict: 'id' });",
      "await db\n  .from('users')\n  .update({ group_id: null })\n  .in('id', ids);",
      "await db.from(`users`).update({ group_id: null }).eq('id', id);",
    ]) {
      const errors = scan(code);
      assert.equal(errors.length, 1, code);
      assert.match(errors[0], /apps\/backend\/src\/routes\/groups\.ts:\d+: .*join_group/);
    }
  });

  it('flags SQL text that updates or inserts users.group_id', () => {
    for (const code of [
      'await client.query("update public.users set group_id = $1 where id = $2");',
      'const sql = `update users set name = $1, group_id = $2 where id = $3`;',
      "const sql = 'UPDATE public.users u SET group_id = null WHERE u.id = 1';",
      "sql += `insert into public.users (id, name, email, password_hash, is_admin, group_id) values ($1, $2, $3, $4, $5, $6);`;",
      "const sql = 'insert into users (id, group_id) values (1, 2)';",
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
  });

  it('passes writes that do not set group_id and reads of group_id', () => {
    for (const code of [
      "await supabase.from('users').update({ password_hash }).eq('id', id);",
      "await supabase.from('users').update({ news_last_seen_id: target }).eq('id', id);",
      "await supabase.from('users').update(update).eq('id', user.id);",
      "await supabase.from('users').select('id, group_id').eq('group_id', groupId);",
      "await supabase.from('users').update({ challenge_active: false }).eq('group_id', groupId);",
      "await supabase.from('users').update({ name: group_id }).eq('id', id);",
      "await supabase.from('runs').insert({ user_id, group_id: groupId });",
      "await supabase.from('activity_log').insert({ group_id: groupId, actor_id });",
      "await supabase.from('group_members').update({ role }).eq('group_id', groupId);",
      "await supabase.from('users').delete().eq('group_id', groupId);",
      "await supabase.rpc('join_group', { p_user_id: id, p_group_id: groupId, p_role: 'member', p_today: today });",
      'const sql = "update public.users set password_hash = $1 where group_id = $2";',
      "const sql = 'insert into public.users (id, name) values (1, 2)';",
      "const sql = 'update public.groups set owner_id = $1 where id = $2';",
      "// await supabase.from('users').update({ group_id: x }) är förbjudet\nconst a = 1;",
      '/* update users set group_id = 1 */ const b = 2;',
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('reads the query chain of the users table, not what follows after it', () => {
    const code = "await db.from('users').select('id');\nawait db.from('runs').insert({ group_id: groupId });\n";
    assert.deepEqual(scan(code), []);
  });

  it('ends the chain at the next element of a Promise.all and at a statement without a semicolon', () => {
    for (const code of [
      "await Promise.all([db.from('users').select('id'), db.from('runs').insert({ user_id, group_id: g })]);",
      "const [a, b] = await Promise.all([\n  db.from('users').select('id'),\n  db.from('runs').insert({ user_id, group_id: g }),\n]);",
      "const users = db.from('users').select('id'), runs = db.from('runs').insert({ group_id: g });",
      "await db.from('users').select('id')\nawait db.from('runs').insert({ user_id, group_id: g })\n",
      "const { data } = await db.from('users').select('id')\n\nconst next = { group_id: g }\n",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('still reads a chain that continues on following lines and a write inside a Promise.all', () => {
    for (const code of [
      "await db\n  .from('users')\n  .select('id')\n  .update({ group_id: g });",
      "await db.from('users')\n  ?.update({ group_id: g });",
      "await Promise.all([db.from('users').select('id'), db.from('users').update({ group_id: g }).eq('id', 1)]);",
      "await db.from('users').update({ name })\n  .eq('id', 1)\n  .update({ group_id: g })\n",
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
  });

  it('keeps reading the chain across a line comment, a block comment, blank lines and CRLF between its lines', () => {
    const write = ".update({ group_id: g }).eq('id', 1);";
    for (const code of [
      `await db\n  .from('users')\n  // only active ones\n  ${write}`,
      `await db\n  .from('users')\n  /* only active ones */\n  ${write}`,
      `await db\n  .from('users')\n  /*\n   * several\n   * lines\n   */\n  ${write}`,
      `await db\r\n  .from('users')\r\n  // only active ones\r\n  ${write}`,
      `await db\r\n  .from('users')\r\n  /* only active ones */\r\n  ${write}`,
      `await db\n  .from('users')\n\n\n  ${write}`,
      `await db\n  .from('users')\n  /* ${'x'.repeat(400)} */\n  ${write}`,
      `await db\n  .from('users')\n${' '.repeat(400)}${write}`,
    ]) {
      assert.equal(scan(code).length, 1, JSON.stringify(code));
    }
  });

  it('reports each offending write with its own line number', () => {
    const errors = scan("a;\nawait db.from('users').update({ group_id: a }).eq('id', 1);\nb;\nawait db.from('users').insert({ group_id: b });\n");
    assert.equal(errors.length, 2);
    assert.match(errors[0], /:2:/);
    assert.match(errors[1], /:4:/);
  });

  it('checks all backend source including scripts, and skips tests, test support, and other workspaces', () => {
    const bad = "await db.from('users').update({ group_id: g }).eq('id', 1);";
    assert.equal(scan(bad, 'apps/backend/src/scripts/backfillSomething.ts').length, 1);
    assert.equal(scan(bad, 'apps/backend/src/services/membershipService.ts').length, 1);
    assert.equal(scan(bad, 'apps/backend/src/utils/membership.ts').length, 1);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/__tests__/helpers/fakeDb.ts'), []);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/groups.test.ts'), []);
    assert.deepEqual(scan(bad, 'apps/frontend/src/shared/x.ts'), []);
    assert.deepEqual(scan(bad, 'packages/shared/src/x.ts'), []);
  });

  it('no longer lets any script through by name: the staging seed script goes through the database functions too', () => {
    const sql = 'sql += `insert into public.users (id, name, group_id) values (1, 2, 3);`;';
    assert.equal(scan(sql, 'apps/backend/src/scripts/staging/stagingSeedGroup.ts').length, 1);
    assert.equal(scan(sql, 'apps/backend/src/scripts/createGroup.ts').length, 1);
  });
});

describe('checkGroupSettingsWrites', () => {
  const GATE = 'const groupId = await actingGroupForWriteOrRespond(req, res);\nif (!groupId) return;\n';
  const scan = (content, path = 'apps/backend/src/routes/groupSettings.ts', exempt) => checkGroupSettingsWrites([{ path, content }], exempt);

  it('flags a write to group_settings in a file that never asks for the acting group', () => {
    for (const code of [
      "await supabase.from('group_settings').upsert(rows, { onConflict: 'group_id,key' });",
      "await supabase.from('group_settings').insert({ group_id: groupId, key, value });",
      "await supabase.from('group_settings').update({ value }).eq('group_id', groupId).eq('key', key);",
      "await supabase.from('group_settings').delete().eq('group_id', groupId);",
      'await supabase\n  .from(`group_settings`)\n  .upsert(rows);',
      'await db.from("group_settings").upsert(rows);',
      "const TABLE = 'group_settings';\nawait db.from(TABLE).upsert(rows);",
      'await db.from(GROUP_SETTINGS_TABLE).upsert(rows);',
      "import { GROUP_SETTINGS_TABLE } from '../services/groupSettings.js';\nawait db\n  .from(GROUP_SETTINGS_TABLE)\n  .delete()\n  .eq('key', k);",
      "await db.from('group_settings' as const).upsert(rows);",
      "await db.from('group_settings' satisfies string).delete().eq('key', k);",
      "const TABLE = 'group_settings' as const;\nawait db.from(TABLE).delete().eq('key', k);",
      'const TABLE: string = "group_settings";\nawait db.from( TABLE ).delete().eq(\'key\', k);',
      'await client.query("insert into public.group_settings (group_id, key, value) values ($1, $2, $3)");',
      "const sql = 'UPDATE group_settings SET value = $1 WHERE group_id = $2';",
      'const sql = `delete from public."group_settings" where group_id = $1`;',
    ]) {
      const errors = scan(code);
      assert.equal(errors.length, 1, code);
      assert.match(errors[0], /apps\/backend\/src\/routes\/groupSettings\.ts:\d+: .*actingGroupForWriteOrRespond/);
    }
  });

  it('passes a write in a file that goes through actingGroupForWriteOrRespond or resolveActingGroupForWrite', () => {
    const write = "await supabase.from('group_settings').upsert(rows, { onConflict: 'group_id,key' });\n";
    assert.deepEqual(scan(GATE + write), []);
    assert.deepEqual(scan('const acting = await resolveActingGroupForWrite(userId);\nif (!acting.allowed) return;\n' + write), []);
    assert.deepEqual(scan("const TABLE = 'group_settings';\n" + GATE + "await db.from(TABLE).delete().eq('group_id', groupId);\n"), []);
  });

  it('does not count a mention, a definition or a call in a comment as the gate', () => {
    const write = "await supabase.from('group_settings').upsert(rows);\n";
    for (const gate of [
      '// await actingGroupForWriteOrRespond(req, res)\n',
      '/* resolveActingGroupForWrite(userId) */\n',
      "import { actingGroupForWriteOrRespond } from '../utils/groupAccess.js';\n",
      'export async function actingGroupForWriteOrRespond(req, res) { return null; }\n',
      'const gate = obj.actingGroupForWriteOrRespond(req, res);\n',
    ]) {
      assert.equal(scan(gate + write).length, 1, gate);
    }
  });

  it('flags a group id taken from the request, even in a file that has the gate', () => {
    for (const source of [
      "await supabase.from('group_settings').upsert({ group_id: req.body.group_id, key, value });",
      "await supabase.from('group_settings').delete().eq('group_id', req.params.groupId);",
      "await supabase.from('group_settings').upsert({ ...req.body });",
      "await supabase.from('group_settings').delete().eq('group_id', req.query.group);",
      "await supabase.from('group_settings').upsert({ key: req.get('x-key') });",
      "await supabase.from('group_settings').upsert({ key: req.cookies.key });",
      "const gid = req.get('x-group-id');\nawait supabase.from('group_settings').upsert({ group_id: gid, key });",
      "await supabase.from('group_settings').delete().eq('group_id', req.headers['x-group-id']);",
      "await supabase.from('group_settings').upsert({ group_id: req.user!.group_id, key });",
      "await supabase.from('group_settings').upsert({ group_id: req.user?.group_id, key });",
      "const groupId = req.user!.group_id;\nawait supabase.from('group_settings').upsert({ group_id: groupId, key });",
      "const groupId = req.params.groupId;\nawait supabase.from('group_settings').upsert({ group_id: groupId, key });",
      "const { group_id } = req.body;\nawait supabase.from('group_settings').upsert({ group_id, key });",
      "const gid = req.header('x-group-id'); const group_id = gid;\nawait supabase.from('group_settings').upsert({ group_id, key });",
      "const groupId = request.body.groupId;\nawait supabase.from('group_settings').delete().eq('group_id', groupId);",
    ]) {
      const errors = scan(GATE + source);
      assert.ok(errors.length >= 1, source);
      assert.match(errors[0], /apps\/backend\/src\/routes\/groupSettings\.ts:\d+: .*req/);
    }
  });

  it('passes request values that are not a group id: the actor and the body that is validated', () => {
    const code = GATE
      + 'const actorId = req.user!.user_id;\n'
      + "const patch = sanitizePatch(req.body, 'group', registry());\n"
      + "logger.info('saved', { user_id: actorId, group_id: groupId });\n"
      + "await supabase.from('group_settings').upsert(rows, { onConflict: 'group_id,key' });\n"
      + "await supabase.from('group_settings').delete().eq('group_id', groupId).in('key', patch.reset);\n";
    assert.deepEqual(scan(code), []);
  });

  it('ignores reads of group_settings and writes to other tables, with or without the gate', () => {
    for (const code of [
      "const { data } = await db.from('group_settings').select('key, value').eq('group_id', groupId);",
      "const { data } = await db.from(GROUP_SETTINGS_TABLE).select('key, value').eq('group_id', groupId);",
      "const { data } = await db.from('group_settings' as const).select('key');",
      "await db.from('user_settings').upsert(rows, { onConflict: 'user_id,key' });",
      "await db.from('groups').update({ name }).eq('id', groupId);",
      "const TABLE = 'user_settings';\nawait db.from(TABLE).delete().eq('user_id', userId);",
      "await db.from('group_settings').select('key').eq('group_id', req.params.groupId);",
      "// await db.from('group_settings').upsert(rows);\nconst a = 1;",
      "const sql = 'select * from group_settings where group_id = $1';",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('reads the query chain of group_settings, not what follows after it', () => {
    const code = "await db.from('group_settings').select('key');\nawait db.from('runs').insert({ group_id: groupId });\n";
    assert.deepEqual(scan(code), []);
  });

  it('reports each offending write with its own line number', () => {
    const errors = scan("a;\nawait db.from('group_settings').upsert(a);\nb;\nawait db.from('group_settings').delete().eq('k', 1);\n");
    assert.equal(errors.length, 2);
    assert.match(errors[0], /:2:/);
    assert.match(errors[1], /:4:/);
  });

  it('checks all backend source including scripts, and skips tests, test support, and other workspaces', () => {
    const bad = "await db.from('group_settings').upsert(rows);";
    assert.equal(scan(bad, 'apps/backend/src/scripts/seedSomething.ts').length, 1);
    assert.equal(scan(bad, 'apps/backend/src/services/groupSettings.ts').length, 1);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/__tests__/helpers/fakeDb.ts'), []);
    assert.deepEqual(scan(bad, 'apps/backend/src/routes/group-settings.test.ts'), []);
    assert.deepEqual(scan(bad, 'apps/frontend/src/shared/x.ts'), []);
    assert.deepEqual(scan(bad, 'packages/shared/src/x.ts'), []);
  });

  it('lets a file on the allowlist through, by exact name, and nothing else', () => {
    const bad = "await db.from('group_settings').upsert(rows);";
    const exempt = new Map([['apps/backend/src/scripts/seedSomething.ts', 'seeds the staging pretend group; no acting user exists']]);
    assert.deepEqual(scan(bad, 'apps/backend/src/scripts/seedSomething.ts', exempt), []);
    assert.equal(scan(bad, 'apps/backend/src/scripts/seedOther.ts', exempt).length, 1);
  });

  it('has no files on the real allowlist: every write goes through the gate', () => {
    assert.equal(GROUP_SETTINGS_EXEMPT_FILES.size, 0);
  });
});

describe('checkWebhookSchedulerStart', () => {
  const server = (content) => [{ path: 'apps/backend/src/server.ts', content }];
  const prod = (inside) => `import x from 'x';\nserver.on('listening', () => {\n  if (process.env.NODE_ENV === 'production') {\n${inside}\n  } else {\n    logger.info('dev');\n  }\n});\n`;

  it('passes when the call is directly in the production block', () => {
    assert.deepEqual(checkWebhookSchedulerStart(server(prod('    startStravaScheduler();\n    startStravaWebhookScheduler();'))), []);
    assert.deepEqual(checkWebhookSchedulerStart(server(prod("    logger.info('a { b');\n    startStravaWebhookScheduler()"))), []);
  });

  it('flags a server.ts where the start line is removed', () => {
    const errors = checkWebhookSchedulerStart(server(prod('    startStravaScheduler();')));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/server\.ts: startStravaWebhookScheduler\(\) måste anropas direkt i produktionsblocket/);
  });

  it('flags a call outside the production block, in its else branch, in a nested callback, or only in a comment or string', () => {
    const cases = [
      "startStravaWebhookScheduler();\nif (process.env.NODE_ENV === 'production') {\n  startStravaScheduler();\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  startStravaScheduler();\n} else {\n  startStravaWebhookScheduler();\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  setTimeout(() => {\n    startStravaWebhookScheduler();\n  }, 1);\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  // startStravaWebhookScheduler();\n  /* startStravaWebhookScheduler(); */\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  logger.info('startStravaWebhookScheduler()');\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  startStravaWebhookSchedulerLater();\n  other.startStravaWebhookScheduler();\n}\n",
    ];
    for (const code of cases) assert.equal(checkWebhookSchedulerStart(server(code)).length, 1, code);
  });

  it('flags a server.ts without a production block', () => {
    const errors = checkWebhookSchedulerStart(server('startStravaWebhookScheduler();\n'));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /saknar produktionsblocket/);
  });

  it('flags a backend without server.ts and leaves a repo without backend sources alone', () => {
    assert.equal(checkWebhookSchedulerStart([{ path: 'apps/backend/src/app.ts', content: '' }]).length, 1);
    assert.deepEqual(checkWebhookSchedulerStart([{ path: 'apps/one/src/a.ts', content: '' }]), []);
  });
});

describe('checkReconcileSchedulerStart', () => {
  const server = (content) => [{ path: 'apps/backend/src/server.ts', content }];
  const prod = (inside) => `import x from 'x';\nserver.on('listening', () => {\n  if (process.env.NODE_ENV === 'production') {\n${inside}\n  }\n});\n`;

  it('passes when the call is directly in the production block, beside the other schedulers', () => {
    assert.deepEqual(checkReconcileSchedulerStart(server(prod('    startStravaWebhookScheduler();\n    startStravaReconcileScheduler();'))), []);
  });

  it('flags a server.ts where the start line is removed, and does not take the webhook scheduler for it', () => {
    const errors = checkReconcileSchedulerStart(server(prod('    startStravaWebhookScheduler();')));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/server\.ts: startStravaReconcileScheduler\(\) måste anropas direkt i produktionsblocket/);
  });

  it('flags a call outside the production block, in a nested callback, or only in a comment or string', () => {
    const cases = [
      "startStravaReconcileScheduler();\nif (process.env.NODE_ENV === 'production') {\n  startStravaScheduler();\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  setTimeout(() => {\n    startStravaReconcileScheduler();\n  }, 1);\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  // startStravaReconcileScheduler();\n  logger.info('startStravaReconcileScheduler()');\n}\n",
    ];
    for (const code of cases) assert.equal(checkReconcileSchedulerStart(server(code)).length, 1, code);
  });

  it('flags a backend without server.ts and leaves a repo without backend sources alone', () => {
    assert.equal(checkReconcileSchedulerStart([{ path: 'apps/backend/src/app.ts', content: '' }]).length, 1);
    assert.deepEqual(checkReconcileSchedulerStart([{ path: 'apps/one/src/a.ts', content: '' }]), []);
  });
});

describe('checkRecoverySchedulerStart', () => {
  const server = (content) => [{ path: 'apps/backend/src/server.ts', content }];
  const prod = (inside) => `import x from 'x';\nserver.on('listening', () => {\n  if (process.env.NODE_ENV === 'production') {\n${inside}\n  }\n});\n`;

  it('passes when the call is directly in the production block, beside the other schedulers', () => {
    assert.deepEqual(checkRecoverySchedulerStart(server(prod('    startStravaReconcileScheduler();\n    startRecalculationRecoveryScheduler();'))), []);
  });

  it('flags a server.ts where the start line is removed, and does not take the reconcile scheduler for it', () => {
    const errors = checkRecoverySchedulerStart(server(prod('    startStravaReconcileScheduler();')));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/server\.ts: startRecalculationRecoveryScheduler\(\) måste anropas direkt i produktionsblocket/);
  });

  it('flags a call outside the production block, in a nested callback, or only in a comment or string', () => {
    const cases = [
      "startRecalculationRecoveryScheduler();\nif (process.env.NODE_ENV === 'production') {\n  startStravaScheduler();\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  setTimeout(() => {\n    startRecalculationRecoveryScheduler();\n  }, 1);\n}\n",
      "if (process.env.NODE_ENV === 'production') {\n  // startRecalculationRecoveryScheduler();\n  logger.info('startRecalculationRecoveryScheduler()');\n}\n",
    ];
    for (const code of cases) assert.equal(checkRecoverySchedulerStart(server(code)).length, 1, code);
  });

  it('flags a backend without server.ts and leaves a repo without backend sources alone', () => {
    assert.equal(checkRecoverySchedulerStart([{ path: 'apps/backend/src/app.ts', content: '' }]).length, 1);
    assert.deepEqual(checkRecoverySchedulerStart([{ path: 'apps/one/src/a.ts', content: '' }]), []);
  });
});

describe('checkNoFrontendSupabase', () => {
  const scan = (content, path = 'apps/frontend/src/shared/services/backendApi.ts') => checkNoFrontendSupabase([{ path, content }]);

  it('passes frontend code that only talks to the backend API', () => {
    assert.deepEqual(scan("const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';\n"), []);
  });

  it('flags a read of the Supabase URL or the publishable key, in code, in the env example and in the type declarations', () => {
    assert.equal(scan('const url = import.meta.env.VITE_SUPABASE_URL;\n').length, 1);
    assert.equal(scan('VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n', 'apps/frontend/.env.example').length, 1);
    assert.equal(scan('readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;\n', 'apps/frontend/src/vite-env.d.ts').length, 1);
    assert.match(scan('\n\nconst k = import.meta.env.VITE_SUPABASE_ANON_KEY;\n')[0], /^apps\/frontend\/src\/shared\/services\/backendApi\.ts:3: /);
  });

  it('flags the Supabase client package, as an import and as a dependency', () => {
    assert.equal(scan("import { createClient } from '@supabase/supabase-js';\n").length, 1);
    assert.equal(scan('{ "dependencies": { "@supabase/supabase-js": "^2.0.0" } }', 'apps/frontend/package.json').length, 1);
  });

  it('leaves the backend and other workspaces alone', () => {
    assert.deepEqual(scan('const url = process.env.SUPABASE_URL;\n', 'apps/backend/src/config.ts'), []);
    assert.deepEqual(scan("import { createClient } from '@supabase/supabase-js';\n", 'apps/backend/src/db.ts'), []);
  });
});

describe('checkRouteResponseContracts', () => {
  const CONTRACTS = {
    path: 'packages/shared/src/contracts/things.ts',
    content: [
      'export interface Thing { id: string }',
      'export interface ThingResponse { success: true; data: Thing }',
      'export type ThingListApiResponse = { success: true; data: Thing[] };',
      'export interface ApiError { error: string }',
      'export interface OffsetPageMeta { total: number }',
    ].join('\n'),
  };
  const ROUTE = 'apps/backend/src/routes/things.ts';
  const scan = (content, path = ROUTE, exempt) => checkRouteResponseContracts([CONTRACTS, { path, content }], exempt);

  it('passes a route that answers with satisfies against a Response contract', () => {
    assert.deepEqual(scan("router.get('/a', auth, async (_req, res) => {\n  res.json({ success: true, data: thing } satisfies ThingResponse);\n});\n"), []);
  });

  it('passes a route whose body is annotated with a Response contract, with ApiResponse names and across several routes', () => {
    const content = [
      "router.get('/a', auth, async (_req, res) => {",
      '  const body: ThingResponse = { success: true, data: thing };',
      '  res.json(body);',
      '});',
      "router.put('/b', auth, async (_req, res) => {",
      '  const empty: ThingListApiResponse = { success: true, data: [] };',
      '  res.json(empty);',
      '});',
    ].join('\n');
    assert.deepEqual(scan(content), []);
  });

  it('passes a route that answers through ok or okWithLegacy with a Response contract as the type parameter', () => {
    assert.deepEqual(scan("router.get('/a', auth, async (_req, res) => {\n  ok<ThingResponse>(res, thing);\n});\n"), []);
    assert.deepEqual(scan("router.get('/a', auth, async (_req, res) => {\n  okWithLegacy<ThingResponse>(res, { thing }, { thing });\n});\n"), []);
    assert.equal(scan("router.get('/a', auth, async (_req, res) => {\n  ok(res, thing);\n});\n").length, 1);
    assert.equal(scan("router.get('/a', auth, async (_req, res) => {\n  ok<LocalThing>(res, thing);\n});\n").length, 1);
  });

  it('flags a route that sends an untyped object, with its line, verb and path', () => {
    const errors = scan("\nrouter.post('/a', auth, async (_req, res) => {\n  res.json({ success: true });\n});\n");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^apps\/backend\/src\/routes\/things\.ts:2: POST \/a skriver inget svar mot en kontraktstyp/);
  });

  it('flags only the untyped route among several, and a route is not rescued by the type in the next one', () => {
    const content = [
      "router.get('/typed', auth, async (_req, res) => {",
      '  res.json({ success: true, data: thing } satisfies ThingResponse);',
      '});',
      "router.get('/untyped', auth, async (_req, res) => {",
      '  res.json({ ok: true });',
      '});',
      "router.get('/typed-too', auth, async (_req, res) => {",
      '  res.json({ success: true, data: thing } satisfies ThingResponse);',
      '});',
    ].join('\n');
    const errors = scan(content);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /:4: GET \/untyped /);
  });

  it('does not count an error-only type, a type that is not a Response contract, a local type or a cast', () => {
    for (const body of [
      "res.status(400).json({ error: 'x' } satisfies ApiError);",
      'const meta: OffsetPageMeta = { total: 1 }; res.json({ meta });',
      'const body: LocalThing = { id: 1 }; res.json(body);',
      'res.json({ success: true } as ThingResponse);',
      'res.json({ success: true, data: thing } satisfies ThingResponseDraft);',
    ]) {
      assert.equal(scan(`router.get('/a', auth, async (_req, res) => {\n  ${body}\n});\n`).length, 1, body);
    }
  });

  it('ignores a contract name that only appears in a comment', () => {
    const content = "// svarar med ThingResponse\nrouter.get('/a', auth, async (_req, res) => {\n  // satisfies ThingResponse\n  res.json({});\n});\n";
    assert.equal(scan(content).length, 1);
  });

  it('reads routes registered over several lines and on the root alias', () => {
    const multiline = "router.post(\n  '/profile-picture',\n  auth,\n  async (req, res) => {\n    res.json({ ok: true });\n  },\n);\n";
    assert.match(scan(multiline)[0], /:1: POST \/profile-picture /);
    assert.equal(scan("root.post('/read', auth, async (req, res) => {\n  res.json({});\n});\n").length, 1);
    assert.deepEqual(scan("root.post('/read', auth, async (req, res) => {\n  res.json({ success: true, data: thing } satisfies ThingResponse);\n});\n"), []);
  });

  it('exempts the Strava webhook protocol routes (GET and POST /) but not its health route', () => {
    const webhook = 'apps/backend/src/routes/stravaWebhook.ts';
    const content = [
      "router.get('/', (req, res) => { res.json({ 'hub.challenge': 'x' }); });",
      "router.get('/health', auth, async (_req, res) => { res.json({ success: true }); });",
      "router.post('/', json, async (req, res) => { res.status(200).json({ received: true }); });",
    ].join('\n');
    const errors = scan(content, webhook);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /:2: GET \/health /);
    assert.equal(scan("router.get('/', (req, res) => {});", 'apps/backend/src/routes/other.ts').length, 1);
  });

  it('leaves files outside routes/ and test files alone', () => {
    const untyped = "router.get('/a', auth, async (_req, res) => { res.json({}); });\n";
    assert.deepEqual(scan(untyped, 'apps/backend/src/app.ts'), []);
    assert.deepEqual(scan(untyped, 'apps/backend/src/routes/things.test.ts'), []);
    assert.deepEqual(scan(untyped, 'apps/frontend/src/routes/things.ts'), []);
  });

  it('has nothing to compare against without contracts', () => {
    assert.deepEqual(checkRouteResponseContracts([{ path: ROUTE, content: "router.get('/a', auth, (_req, res) => { res.json({}); });\n" }]), []);
  });
});

describe('checkErrorResponsesViaFail', () => {
  const ROUTE = 'apps/backend/src/routes/things.ts';
  const scan = (content, path = ROUTE, exempt) => checkErrorResponsesViaFail([{ path, content }], exempt);

  it('passes a route that answers its errors through fail and its successes through ok', () => {
    const content = [
      "router.get('/a', async (_req, res) => {",
      "  if (bad) { fail(res, 400, 'Bad input'); return; }",
      '  res.status(201).json({ success: true });',
      '  ok(res, data);',
      '});',
    ].join('\n');
    assert.deepEqual(scan(content), []);
  });

  it('flags res.status(4xx|5xx|207).json with its line', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 503, 207]) {
      const errors = scan(`\nres.status(${status}).json({ error: 'x' });\n`);
      assert.equal(errors.length, 1, String(status));
      assert.match(errors[0], /^apps\/backend\/src\/routes\/things\.ts:2: /);
    }
  });

  it('flags the same call spread over several lines, with a typed body and in a one-line early return', () => {
    const multiline = scan("res\n  .status(500)\n  .json({ error: 'x' } satisfies ApiError);");
    assert.match(multiline[0], /things\.ts:2: /); // raden med .status(500); .json({ error … }) på nästa rad ger en rad till
    assert.equal(scan("res.status(500).json({ error: 'x' } satisfies ApiError);").length, 1);
    assert.equal(scan("if (!x) { res.status(404).json({ error: 'x' }); return; }").length, 1);
  });

  it('flags res.status(...) with anything but a literal status, res.sendStatus and an error body without a status', () => {
    assert.equal(scan('res.status(code).json(body);').length, 1);
    assert.equal(scan('res.status(error.status ?? 500).json(body);').length, 1);
    assert.equal(scan('res.sendStatus(404);').length, 1);
    assert.equal(scan("res.json({ error: 'x' });").length, 1);
    assert.equal(scan("res.json({ success: false, error: 'x' });").length, 1);
  });

  it('leaves 2xx statuses, a comment and respond.ts itself alone', () => {
    assert.deepEqual(scan('res.status(200).json(body);\nres.status(201).json(body);'), []);
    assert.deepEqual(scan("// res.status(500).json({ error: 'x' }) var förut\n/* res.status(404).json() */"), []);
    assert.deepEqual(scan("res.status(500).json({ error: 'x' });", 'apps/backend/src/utils/respond.ts'), []);
  });

  it('covers routes, middleware, utils and app.ts but not tests or other apps', () => {
    const bad = "res.status(500).json({ error: 'x' });";
    for (const path of ['apps/backend/src/routes/a.ts', 'apps/backend/src/middleware/a.ts', 'apps/backend/src/utils/a.ts', 'apps/backend/src/app.ts']) {
      assert.equal(scan(bad, path).length, 1, path);
    }
    for (const path of ['apps/backend/src/routes/a.test.ts', 'apps/backend/src/routes/__tests__/a.ts', 'apps/backend/src/test-utils/a.ts', 'apps/frontend/src/routes/a.ts', 'apps/backend/src/services/a.ts']) {
      assert.deepEqual(scan(bad, path), [], path);
    }
  });

  describe('the Strava webhook exemption', () => {
    const WEBHOOK = 'apps/backend/src/routes/stravaWebhook.ts';
    const webhook = [
      'export function createStravaWebhookRouter() {',
      '  const router = express.Router();',
      "  router.get('/', (req, res) => {",
      "    res.status(403).json({ error: 'Forbidden' });",
      '  });',
      "  router.get('/health', authenticateJWT, requireAdmin, async (_req, res) => {",
      "    res.status(500).json({ success: false, error: 'Failed to read webhook health' });",
      '  });',
      "  router.post('/', express.json(), async (req, res) => {",
      "    res.status(400).json({ error: 'Invalid event' });",
      '  });',
      '  router.use((err, _req, res, next) => {',
      "    if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large' }); return; }",
      '    next(err);',
      '  });',
      '  return router;',
      '}',
    ].join('\n');

    it('exempts exactly the two Strava protocol routes (ADR 007 Addendum 2026-10-20 punkt 4), GET / and POST /, and nothing else', () => {
      assert.deepEqual([...ERROR_RESPONSE_EXEMPT_ROUTES.keys()], [WEBHOOK]);
      assert.deepEqual([...ERROR_RESPONSE_EXEMPT_ROUTES.get(WEBHOOK)].sort(), ['GET /', 'POST /']);
    });

    it('lets the protocol routes (and the router error handler that follows POST /) through and catches a hand-written answer in /health', () => {
      const errors = scan(webhook, WEBHOOK);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /stravaWebhook\.ts:7: ett felsvar skrivs för hand/);
    });

    it('catches a hand-written answer in a webhook route that is not one of the two, and in code before the first route', () => {
      assert.equal(scan(webhook.replace("router.get('/health'", "router.put('/other'"), WEBHOOK).length, 1);
      assert.equal(scan("res.status(500).json({ error: 'x' });\n" + webhook, WEBHOOK).length, 2);
    });

    it('does not exempt the other route files', () => {
      assert.equal(scan("res.status(403).json({ error: 'x' });", 'apps/backend/src/routes/strava.ts').length, 1);
      assert.equal(scan("router.get('/', (req, res) => { res.status(403).json({ error: 'x' }); });", 'apps/backend/src/routes/other.ts').length, 1);
    });
  });
});

describe('checkDummyHashWarmup', () => {
  const server = (content) => [{ path: 'apps/backend/src/server.ts', content }];

  it('passes when server.ts calls warmUpDummyPasswordHash() at the top level', () => {
    assert.deepEqual(checkDummyHashWarmup(server("import { x } from './x.js';\nwarmUpDummyPasswordHash();\nconst app = 1;\n")), []);
    assert.deepEqual(checkDummyHashWarmup(server('warmUpDummyPasswordHash()\r\n')), []);
  });

  it('flags a server.ts without the call', () => {
    const errors = checkDummyHashWarmup(server("import { warmUpDummyPasswordHash } from './utils/passwordHash.js';\nconst app = 1;\n"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/server\.ts: saknar ett anrop av warmUpDummyPasswordHash\(\)/);
  });

  it('flags a call that is only in a comment, indented inside a block or callback, or a different function', () => {
    for (const code of [
      '// warmUpDummyPasswordHash();\n',
      "if (process.env.NODE_ENV === 'production') {\n  warmUpDummyPasswordHash();\n}\n",
      "server.on('listening', () => {\n  warmUpDummyPasswordHash();\n});\n",
      'warmUpDummyPasswordHashLater();\n',
    ]) {
      assert.equal(checkDummyHashWarmup(server(code)).length, 1, code);
    }
  });

  it('flags a backend without server.ts and leaves a repo without backend sources alone', () => {
    assert.equal(checkDummyHashWarmup([{ path: 'apps/backend/src/app.ts', content: '' }]).length, 1);
    assert.deepEqual(checkDummyHashWarmup([{ path: 'apps/one/src/a.ts', content: '' }]), []);
  });
});

describe('checkTokenKeyStartupCheck', () => {
  const server = (content) => [{ path: 'apps/backend/src/server.ts', content }];

  it('passes when server.ts calls reportTokenKeyAtStartup() at the top level', () => {
    assert.deepEqual(checkTokenKeyStartupCheck(server("import { x } from './x.js';\nreportTokenKeyAtStartup();\nconst app = 1;\n")), []);
    assert.deepEqual(checkTokenKeyStartupCheck(server('reportTokenKeyAtStartup()\r\n')), []);
  });

  it('flags a server.ts without the call', () => {
    const errors = checkTokenKeyStartupCheck(server("import { reportTokenKeyAtStartup } from './services/tokenKeyStartup.js';\nconst app = 1;\n"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/server\.ts: saknar ett anrop av reportTokenKeyAtStartup\(\)/);
  });

  it('flags a call that is only in a comment, indented inside a block or callback, or a different function', () => {
    for (const code of [
      '// reportTokenKeyAtStartup();\n',
      "if (process.env.NODE_ENV === 'production') {\n  reportTokenKeyAtStartup();\n}\n",
      "server.on('listening', () => {\n  reportTokenKeyAtStartup();\n});\n",
      'reportTokenKeyAtStartupLater();\n',
    ]) {
      assert.equal(checkTokenKeyStartupCheck(server(code)).length, 1, code);
    }
  });

  it('flags a backend without server.ts and leaves a repo without backend sources alone', () => {
    assert.equal(checkTokenKeyStartupCheck([{ path: 'apps/backend/src/app.ts', content: '' }]).length, 1);
    assert.deepEqual(checkTokenKeyStartupCheck([{ path: 'apps/one/src/a.ts', content: '' }]), []);
  });
});

describe('checkRateBudgetHook', () => {
  const server = (content) => [{ path: 'apps/backend/src/server.ts', content }];

  it('passes when server.ts calls registerStravaRateBudget() at the top level', () => {
    assert.deepEqual(checkRateBudgetHook(server("import { x } from './x.js';\nregisterStravaRateBudget();\nconst app = 1;\n")), []);
    assert.deepEqual(checkRateBudgetHook(server('registerStravaRateBudget()\r\n')), []);
  });

  it('flags a server.ts without the call', () => {
    const errors = checkRateBudgetHook(server("import { registerStravaRateBudget } from './services/stravaRateBudget.js';\nconst app = 1;\n"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/server\.ts: saknar ett anrop av registerStravaRateBudget\(\)/);
  });

  it('flags a call that is only in a comment, indented inside a callback, or a different function', () => {
    for (const code of [
      '// registerStravaRateBudget();\n',
      "server.on('listening', () => {\n  registerStravaRateBudget();\n});\n",
      'registerStravaRateBudgetLater();\n',
    ]) {
      assert.equal(checkRateBudgetHook(server(code)).length, 1, code);
    }
  });

  it('flags a backend without server.ts and leaves a repo without backend sources alone', () => {
    assert.equal(checkRateBudgetHook([{ path: 'apps/backend/src/app.ts', content: '' }]).length, 1);
    assert.deepEqual(checkRateBudgetHook([{ path: 'apps/one/src/a.ts', content: '' }]), []);
  });
});

describe('checkRawStravaFetch', () => {
  const scan = (content, path = 'apps/backend/src/routes/x.ts') => checkRawStravaFetch([{ path, content }]);

  it('flags a raw fetch against strava.com outside stravaClient and reports file:line', () => {
    const errors = scan("a;\nconst res = await fetch('https://www.strava.com/oauth/token', { method: 'POST' });\n");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/routes\/x\.ts:2: anrop mot Strava utanför stravaClient/);
  });

  it('flags the variants: globalThis.fetch, a space before the parenthesis, a URL held in a constant, every call', () => {
    for (const code of [
      "await globalThis.fetch('https://www.strava.com/api/v3/athlete');",
      "await fetch ('https://www.strava.com/api/v3/athlete');",
      "const URL = 'https://www.strava.com/api/v3';\nawait fetch(`${URL}/athlete`);",
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
    assert.equal(scan("fetch('https://www.strava.com/a');\nfetch('https://www.strava.com/b');").length, 2);
  });

  it('passes stravaFetch, other fetch-like names and fetches in files that do not mention strava.com', () => {
    for (const code of [
      "await stravaFetch('https://www.strava.com/oauth/token');",
      "await fetchDetailedActivity(id, token);",
      "await fetchAthleteActivities(token, after);",
      "await fetch('https://api.open-meteo.com/v1/forecast');",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('lets stravaClient.ts, tests and test-utils call fetch', () => {
    const raw = "await fetch('https://www.strava.com/oauth/token');";
    assert.deepEqual(scan(raw, 'apps/backend/src/services/stravaClient.ts'), []);
    assert.deepEqual(scan(raw, 'apps/backend/src/services/__tests__/stravaClient.test.ts'), []);
    assert.deepEqual(scan(raw, 'apps/backend/src/test-utils/fakeStrava.ts'), []);
    assert.deepEqual(scan(raw, 'apps/backend/src/routes/x.test.ts'), []);
  });

  it('only reads the backend', () => {
    assert.deepEqual(scan("await fetch('https://www.strava.com/oauth/token');", 'apps/frontend/src/x.ts'), []);
  });
});

describe('checkStravaTokenPath', () => {
  const scan = (content, path = 'apps/backend/src/routes/x.ts') => checkStravaTokenPath([{ path, content }]);

  it('flags a select of a token column on strava_tokens outside stravaTokenStore and reports file:line', () => {
    const errors = scan("a;\nconst { data } = await db.from('strava_tokens').select('user_id, access_token').eq('user_id', id);\n");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/backend\/src\/routes\/x\.ts:2: .*stravaTokenStore/);
  });

  it('keeps reading the chain across a line comment, a block comment, blank lines and CRLF between its lines, and reports the right line', () => {
    const reads = [
      ".select('access_token')",
      ".select('*')",
      '.select()',
      ".select('user_id').not('refresh_token', 'is', 'x')",
      '.upsert({ ...tokens })',
      '.update({ ...tokens })',
      ".insert({ user_id, access_token: 'x' })",
    ];
    for (const read of reads) {
      for (const code of [
        `await db\n  .from('strava_tokens')\n  // only active ones\n  ${read};`,
        `await db\n  .from('strava_tokens')\n  /* only active ones */\n  ${read};`,
        `await db\n  .from('strava_tokens')\n  /*\n   * several\n   * lines\n   */\n  ${read};`,
        `await db\r\n  .from('strava_tokens')\r\n  // only active ones\r\n  ${read};`,
        `await db\r\n  .from('strava_tokens')\r\n  /* only active ones */\r\n  ${read};`,
        `await db\n  .from('strava_tokens')\n\n\n  ${read};`,
        `await db\n  .from('strava_tokens')\n  /* ${'x'.repeat(400)} */\n  ${read};`,
      ]) {
        const errors = scan(code);
        assert.equal(errors.length, 1, JSON.stringify(code));
        assert.match(errors[0], /x\.ts:2:/);
      }
    }
  });

  it('does not let a comment mentioning a token column flag a chain that reads none', () => {
    assert.deepEqual(scan("await db\n  .from('strava_tokens')\n  // never select access_token here\n  .select('user_id');"), []);
    assert.deepEqual(scan("await db.from('strava_tokens').select('user_id'); // access_token is in the store\n"), []);
  });

  it('still flags a token read inside a Promise.all or before a following statement, and ignores what comes after the chain', () => {
    assert.equal(scan("await Promise.all([db.from('strava_tokens').select('access_token'), db.from('users').select('id')]);").length, 1);
    assert.equal(scan("await Promise.all([db.from('users').select('id'), db.from('strava_tokens').select('refresh_token').eq('user_id', id)]);").length, 1);
    assert.equal(scan("await db.from('strava_tokens').select('access_token')\nawait other()\n").length, 1);
    assert.deepEqual(scan("await Promise.all([db.from('strava_tokens').select('user_id'), db.from('x').select('access_token')]);"), []);
    assert.deepEqual(scan("await db.from('strava_tokens').select('user_id')\nconst t = { access_token: 1 }\n"), []);
  });

  it('flags the variants: refresh_token, a multi-line template select, select(*) and select(), a filter, an update, an upsert, an insert', () => {
    for (const code of [
      "await db.from('strava_tokens').select('refresh_token').eq('user_id', id);",
      "await db\n  .from('strava_tokens')\n  .select(`\n    user_id,\n    access_token,\n    users!inner(name)\n  `)\n  .eq('sync_paused', false);",
      "await db.from('strava_tokens').select('*');",
      "await db.from('strava_tokens').select();",
      "await db.from(\"strava_tokens\").select(\"\");",
      "await db.from('strava_tokens').select('user_id').eq('refresh_token', old);",
      "await db.from('strava_tokens').update({ refresh_token: next }).eq('user_id', id);",
      "await db.from('strava_tokens').upsert({ user_id: id, access_token: a });",
      "await db.from('strava_tokens').insert({ user_id: id, access_token: a });",
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
    assert.equal(scan("await db.from('strava_tokens').select('access_token');\nawait db.from('strava_tokens').select('refresh_token');").length, 2);
  });

  it('flags a star anywhere in the select list, a select argument that is not a literal, and a spread into a write', () => {
    for (const code of [
      "await db.from('strava_tokens').select('user_id, *');",
      "await db.from('strava_tokens').select('*, users(name)');",
      "await db.from('strava_tokens').select(\"user_id,*\");",
      "await db.from('strava_tokens').select(columns);",
      "await db.from('strava_tokens').select(COLUMNS.join(', '));",
      "await db.from('strava_tokens').select(`user_id, ${extra}`);",
      "await db.from('strava_tokens').upsert({ user_id: id, ...tokens });",
      "await db.from('strava_tokens').insert({ ...tokens, user_id: id });",
      "await db.from('strava_tokens').update({ ...next, sync_paused: false }).eq('user_id', id);",
      "await db.from('strava_tokens').upsert([{ user_id: id, ...tokens }]);",
    ]) {
      assert.equal(scan(code).length, 1, code);
    }
  });

  it('passes a literal template select, a star inside a string that is not the select, and writes without a spread', () => {
    for (const code of [
      "await db.from('strava_tokens').select(`\n  user_id,\n  users!inner(name)\n`).eq('sync_paused', false);",
      "await db.from('strava_tokens').select('user_id').eq('note', '*');",
      "await db.from('strava_tokens').update({ sync_paused: true, paused_at: now }).eq('user_id', id);",
      "await db.from('strava_tokens').delete().eq('user_id', id);",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('passes reads of other columns, the has-a-token filter, writes of other columns, and chains on other tables', () => {
    for (const code of [
      "await db.from('strava_tokens').select('user_id, sync_paused, paused_at').eq('user_id', id).maybeSingle();",
      "await db.from('strava_tokens').select('user_id, users!inner(name)').not('access_token', 'is', null).eq('sync_paused', false);",
      "await db.from('strava_tokens').update({ sync_paused: true }).eq('user_id', id);",
      "await db.from('strava_tokens').delete().eq('user_id', id);",
      "await db.from('strava_webhook_events').select('access_token');",
      "const token = tokenData.access_token;\nawait db.from('runs').select('id');",
      "// the old code read access_token and refresh_token here\nawait db.from('strava_tokens').select('user_id'); // not access_token",
      "await db.from('strava_tokens').select('user_id');\nconst body = { access_token: x };",
    ]) {
      assert.deepEqual(scan(code), [], code);
    }
  });

  it('does not exempt the token backfill: it goes through stravaTokenStore like everything else', () => {
    const raw = "await db.from('strava_tokens').select('access_token, refresh_token');";
    assert.equal(scan(raw, 'apps/backend/src/scripts/backfillStravaTokenEncryption.ts').length, 1);
  });

  it('lets stravaTokenStore.ts, tests and test-utils touch the token columns', () => {
    const raw = "await db.from('strava_tokens').select('access_token, refresh_token');";
    assert.deepEqual(scan(raw, 'apps/backend/src/services/stravaTokenStore.ts'), []);
    assert.deepEqual(scan(raw, 'apps/backend/src/services/__tests__/x.test.ts'), []);
    assert.deepEqual(scan(raw, 'apps/backend/src/test-utils/fakeStrava.ts'), []);
  });

  it('only reads the backend', () => {
    assert.deepEqual(scan("await db.from('strava_tokens').select('access_token');", 'apps/frontend/src/x.ts'), []);
  });

  it('stops a chain at the end of its statement, so a later token mention on its own is not blamed on it', () => {
    assert.deepEqual(scan("await db.from('strava_tokens').select('user_id');\nawait other.update({ refresh_token: x });"), []);
    assert.deepEqual(scan("const rows = await readAll('l', (from, to) =>\n  db.from('strava_tokens').select('user_id').range(from, to),\n);\nconst refresh_token = 1;"), []);
  });
});

describe('checkMediaFiles', () => {
  const LIMITS = {
    'landing-film-720.v1.mp4': 4_194_304,
    'landing-film-480.v1.mp4': 2_621_440,
    'landing-film-poster-720.v1.webp': 61_440,
    'landing-film-poster-480.v1.webp': 30_720,
  };

  it('passes every file at exactly its limit when the sum stays under 7 MiB', () => {
    assert.deepEqual(checkMediaFiles([{ name: 'landing-film-720.v1.mp4', size: 4_194_304 }, { name: 'landing-film-480.v1.mp4', size: 2_621_440 }]), []);
    assert.deepEqual(checkMediaFiles(Object.keys(LIMITS).map((name) => ({ name, size: 1 }))), []);
  });

  it('fails each file one byte over its limit and names the file', () => {
    for (const [name, limit] of Object.entries(LIMITS)) {
      const errors = checkMediaFiles([{ name, size: limit + 1 }]);
      assert.equal(errors.length, 1, name);
      assert.ok(errors[0].includes(name), errors[0]);
    }
  });

  it('fails a file whose name does not follow the versioned pattern', () => {
    for (const name of ['landing-film-1080.v1.mp4', 'landing-film-720.mp4', 'landing-film-720.vx.mp4', 'trailer.mp4', 'landing-film-poster-720.v1.png', 'notes.txt']) {
      assert.equal(checkMediaFiles([{ name, size: 1 }]).length, 1, name);
    }
  });

  it('accepts a new version number for a re-encoded file', () => {
    assert.deepEqual(checkMediaFiles([{ name: 'landing-film-720.v2.mp4', size: 1 }, { name: 'landing-film-poster-480.v12.webp', size: 1 }]), []);
  });

  it('fails when the sum is over 7 MiB even though every file is within its own limit', () => {
    const errors = checkMediaFiles([
      { name: 'landing-film-720.v1.mp4', size: 4_194_304 },
      { name: 'landing-film-720.v2.mp4', size: 4_194_304 },
    ]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /7 MiB/);
  });

  it('passes an empty folder', () => {
    assert.deepEqual(checkMediaFiles([]), []);
  });
});

describe('checkFontFiles', () => {
  const font = (name, size = 20_000, magic = 'wOF2') => ({ name, size, magic });
  const licence = { name: 'OFL.txt', size: 4_000, magic: 'The' };

  it('passes versioned woff2 files at exactly the size limit, next to the licence', () => {
    assert.deepEqual(checkFontFiles([font('bebas-neue-400.v1.woff2', 61_440), font('oswald-variable.v2.woff2'), font('bebas-neue-400.latin-ext.v1.woff2'), licence]), []);
  });

  it('fails a font one byte over the limit and names the file', () => {
    const errors = checkFontFiles([font('bebas-neue-400.v1.woff2', 61_441), licence]);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('bebas-neue-400.v1.woff2'), errors[0]);
  });

  it('fails a file that is not woff2 even when its name says so', () => {
    const errors = checkFontFiles([font('bebas-neue-400.v1.woff2', 20_000, '\x00\x01\x00\x00'), licence]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /woff2/);
  });

  it('fails names without a version or with another extension', () => {
    for (const name of ['bebas-neue-400.woff2', 'bebas-neue-400.v1.ttf', 'bebas-neue-400.v1.woff', 'Bebas.v1.woff2', 'bebas-neue-400.latin-ext.woff2', 'bebas-neue-400.cyrillic.v1.woff2', 'notes.txt']) {
      assert.equal(checkFontFiles([font(name), licence]).length, 1, name);
    }
  });

  it('fails when fonts are present but the licence file is missing', () => {
    const errors = checkFontFiles([font('bebas-neue-400.v1.woff2')]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /OFL.txt/);
  });

  it('passes an empty folder', () => {
    assert.deepEqual(checkFontFiles([]), []);
  });
});

describe('checkNoTrackedVideoOriginals', () => {
  it('passes video only under apps/frontend/public/media/', () => {
    assert.deepEqual(checkNoTrackedVideoOriginals(['apps/frontend/public/media/landing-film-720.v1.mp4', 'apps/frontend/src/a.ts']), []);
  });

  it('fails an .mp4 or .mov anywhere else, in any letter case', () => {
    const errors = checkNoTrackedVideoOriginals([
      'docs/design/RunQuest Mixed (1).mp4',
      'docs/x/clip.MOV',
      'apps/frontend/public/other/clip.mp4',
    ]);
    assert.equal(errors.length, 3);
  });

  it('ignores other file types, also in docs/design', () => {
    assert.deepEqual(checkNoTrackedVideoOriginals(['docs/design/landing-media/readme.txt', 'docs/design/poster.webp']), []);
  });
});

describe('checkGitignoreForVideo', () => {
  it('passes when both lines are present, with CRLF and surrounding lines', () => {
    assert.deepEqual(checkGitignoreForVideo('node_modules/\r\ndocs/design/*.mp4\r\ndocs/design/landing-media/\r\n'), []);
  });

  it('names each missing line', () => {
    assert.equal(checkGitignoreForVideo('docs/design/*.mp4\n').length, 1);
    assert.equal(checkGitignoreForVideo('docs/design/landing-media/\n').length, 1);
    assert.equal(checkGitignoreForVideo('').length, 2);
  });

  it('does not count a commented-out line', () => {
    assert.equal(checkGitignoreForVideo('# docs/design/*.mp4\ndocs/design/landing-media/\n').length, 1);
  });
});

describe('checkDocPaths', () => {
  const tracked = [
    'README.md',
    'apps/backend/src/routes/runs.ts',
    'apps/frontend/src/features/badges/badges.css',
    'apps/frontend/src/features/badges/README.md',
    'docs/release.md',
    'docs/archive/roadmap.md',
    'scripts/ci-guards.mjs',
  ];
  const doc = (path, content) => ({ path, content });
  const check = (docs, exempt = []) => checkDocPaths(docs, tracked, exempt);

  it('accepts a full path, a path from a subfolder and a bare file name that exist', () => {
    const content = 'See `scripts/ci-guards.mjs`, `routes/runs.ts`, `badges.css` and `docs/release.md`.\n';
    assert.deepEqual(check([doc('README.md', content)]), []);
  });

  it('names the document, the line and the path of a reference to a file that does not exist', () => {
    const errors = check([doc('docs/release.md', 'Intro\nThe check lives in `scripts/gone.mjs:12`.\n')]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^docs\/release\.md:2: scripts\/gone\.mjs finns inte/);
  });

  it('rejects a reference to a document that was moved to docs/archive', () => {
    assert.equal(check([doc('README.md', 'See `docs/roadmap.md`.\n')]).length, 1);
    assert.deepEqual(check([doc('README.md', 'See `docs/archive/roadmap.md`.\n')]), []);
  });

  it('checks directories by their name and rejects one that holds no tracked file', () => {
    assert.deepEqual(check([doc('README.md', '`docs/archive/` and `features/badges/`\n')]), []);
    assert.equal(check([doc('README.md', '`docs/nowhere/`\n')]).length, 1);
  });

  it('skips spans that are not file paths: URLs, absolute URL paths, globs, placeholders, calls and bare extensions', () => {
    const content = ['`https://runquest.dev/a.html`', '`/api/runs.json`', '`src/**/*.test.ts`', '`<name>.ts`', '`run(x).ts`', '`.js`', '`a b.ts`', '`~/.config/x.json`', '`../up.md`'].join(' ');
    assert.deepEqual(check([doc('README.md', content)]), []);
  });

  it('reads README.md, STATE.md, docs/*.md and a feature README, and nothing else', () => {
    const bad = 'See `missing.ts`.\n';
    for (const path of ['README.md', 'STATE.md', 'docs/e2e.md', 'apps/frontend/src/features/badges/README.md']) {
      assert.equal(check([doc(path, bad)]).length, 1, path);
    }
    for (const path of ['docs/adr/001-teststrategi.md', 'docs/archive/old.md', 'docs/design/x.md', 'CHANGELOG.md', 'apps/backend/README.md']) {
      assert.deepEqual(check([doc(path, bad)]), [], path);
    }
  });

  it('lets an exempt reference through, only in the document the exemption names', () => {
    const exempt = [{ doc: 'docs/release.md', pattern: /^dist\/landing\.html$/, reason: 'build output' }];
    const content = 'The page is `dist/landing.html`.\n';
    assert.deepEqual(check([doc('docs/release.md', content)], exempt), []);
    assert.equal(check([doc('README.md', content)], exempt).length, 2); // the missing path, and the exemption that no longer matches
  });

  it('fails an exemption that no longer matches any reference, so the list cannot grow stale', () => {
    const errors = check([doc('README.md', 'Nothing to see.\n')], [{ pattern: /^old\.ts$/, reason: 'a file that was removed' }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /träffar ingen hänvisning längre/);
  });

  it('keeps every exemption in DOC_PATH_EXEMPT explained', () => {
    for (const entry of DOC_PATH_EXEMPT) assert.ok(entry.reason.length > 10, String(entry.pattern));
  });
});

describe('checkTokenGroupIdReads', () => {
  const ROUTE = 'apps/backend/src/routes/things.ts';
  const scan = (content, path = ROUTE) => checkTokenGroupIdReads([{ path, content }]);

  it('flags every direct read of the group in the token, with its line', () => {
    for (const read of ['req.user!.group_id', 'req.user?.group_id', 'req.user.group_id', 'req.user!?.group_id', "req.user!['group_id']", 'req . user ! . group_id', '(req.user as AuthUser).group_id', '(req.user as any)?.group_id', '(req.user!).group_id', '(req as AuthenticatedRequest).user.group_id', '(req as any).user!.group_id']) {
      const errors = scan(`\nconst groupId = ${read};\n`);
      assert.equal(errors.length, 1, read);
      assert.match(errors[0], /^apps\/backend\/src\/routes\/things\.ts:2: /, read);
    }
  });

  it('flags a read through an alias of req.user or of req in the same file', () => {
    assert.equal(scan('const u = req.user!;\nconst g = u.group_id;').length, 1);
    assert.equal(scan('const u = req.user as AuthUser;\nconst g = u?.group_id;').length, 1);
    assert.equal(scan('let me: AuthUser = req.user!;\nuse(me!.group_id);').length, 1);
    assert.equal(scan('const { user } = req;\nconst g = user.group_id;').length, 1);
    assert.equal(scan('const { user: me } = req;\nconst g = me.group_id;').length, 1);
    assert.equal(scan('const r = req;\nconst g = r.user!.group_id;').length, 1);
    const twice = scan('const u = req.user;\nuse(u.group_id);\nuse(u.group_id);');
    assert.deepEqual(twice.map((error) => error.split(': ')[0]), ['apps/backend/src/routes/things.ts:2', 'apps/backend/src/routes/things.ts:3']);
  });

  it('flags destructuring of group_id out of req.user, out of req, or out of an alias', () => {
    assert.equal(scan('const { group_id } = req.user;').length, 1);
    assert.equal(scan('const { group_id: g } = req.user!;').length, 1);
    assert.equal(scan('const { user_id, group_id } = req.user!;').length, 1);
    assert.equal(scan('const {\n  user_id,\n  group_id: g,\n} = req.user!;').length, 1);
    assert.equal(scan('const { user: { group_id } } = req;').length, 1);
    assert.equal(scan('const u = req.user;\nconst { group_id } = u;').length, 1);
    assert.equal(scan('({ group_id } = req.user!);').length, 1);
  });

  it('covers routes, services (also nested), middleware and utils', () => {
    const bad = 'const g = req.user!.group_id;';
    for (const path of ['apps/backend/src/routes/a.ts', 'apps/backend/src/services/a.ts', 'apps/backend/src/services/stravaWebhook/handlers/a.ts', 'apps/backend/src/middleware/admin.ts', 'apps/backend/src/utils/a.ts']) {
      assert.equal(scan(bad, path).length, 1, path);
    }
    assert.equal(scan('a(req.user!.group_id, req.user?.group_id);').length, 1);
  });

  it('leaves groupScope.ts, auth.ts (which sets group_id), tests, other folders and other apps alone', () => {
    const bad = 'const g = req.user!.group_id;';
    for (const path of ['apps/backend/src/utils/groupScope.ts', 'apps/backend/src/middleware/auth.ts', 'apps/backend/src/routes/a.test.ts', 'apps/backend/src/routes/__tests__/a.ts', 'apps/backend/src/services/test-utils/a.ts', 'apps/backend/src/scripts/a.ts', 'apps/frontend/src/routes/a.ts']) {
      assert.deepEqual(scan(bad, path), [], path);
    }
  });

  it('lets through reads of group_id that do not come from the token, other token fields, the helpers and comments', () => {
    const content = [
      'const g = row.group_id;',
      'const { group_id } = row;',
      'const { group_id: g2 } = data;',
      'const g3 = user.group_id;', // en användarrad ur databasen, inget alias av req.user
      'const { user_id, name } = req.user!;',
      'const me = req.user!.user_id;',
      'const u = req.user!;\nuse(u.user_id);',
      'const g4 = req.body.group_id;',
      'const g5 = tokenGroupId(req);',
      'const g6 = groupIdOrRespondEmpty(req, res);',
      'const g7 = (row as TitleRow).group_id;\nconst g8 = (req.body as Body).group_id;',
      '// const g = req.user!.group_id; var förut\n/* req.user.group_id */',
    ].join('\n');
    assert.deepEqual(scan(content), []);
  });

  it('uses an alias only in the file that declares it', () => {
    assert.deepEqual(checkTokenGroupIdReads([
      { path: 'apps/backend/src/routes/a.ts', content: 'const u = req.user;\n' },
      { path: 'apps/backend/src/routes/b.ts', content: 'const g = u.group_id;\n' },
    ]), []);
  });
});

describe('walkFiles / listWorkspaces', () => {
  it('skips node_modules and dist, and returns slash-separated relative paths', () => {
    const fs = { '/r/p': ['src', 'node_modules', 'dist'], '/r/p/src': ['a.ts', 'sub'], '/r/p/src/sub': ['b.ts'] };
    const readDir = (path) => fs[path.split('\\').join('/')] ?? [];
    const stat = (path) => ({ isDirectory: () => ['/r/p/src', '/r/p/src/sub'].includes(path.split('\\').join('/')) });
    assert.deepEqual(walkFiles('/r', 'p', readDir, stat).sort(), ['p/src/a.ts', 'p/src/sub/b.ts']);
  });

  it('reads the real repo workspaces', () => {
    const workspaces = listWorkspaces(repoRoot);
    const byDir = Object.fromEntries(workspaces.map((workspace) => [workspace.dir, workspace.hasTestScript]));
    assert.equal(byDir['apps/backend'], true);
    assert.equal(byDir['apps/frontend'], true);
    assert.equal(byDir['packages/shared'], true);
    assert.equal(byDir['packages/types'], false);
  });
});

describe('CLI', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ci-guards-'));
  after(() => rmSync(temp, { recursive: true, force: true }));

  const makeRepo = (name, { testFile = true, srcContent = 'export const a = 1;\n', testContent = 'export {};\n' } = {}) => {
    const root = join(temp, name);
    const ws = join(root, 'apps', 'one');
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'one', scripts: { test: 'vitest run' } }));
    writeFileSync(join(ws, 'src', 'a.ts'), srcContent);
    if (testFile) writeFileSync(join(ws, 'src', 'a.test.ts'), testContent);
    return root;
  };

  it('exits 0 on the current repo (all, empty-suites, todos, test-names)', () => {
    for (const mode of ['all', 'empty-suites', 'todos', 'test-names']) {
      const result = runCli(mode);
      assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    }
  });

  it('exits 0 on a clean temp repo', () => {
    assert.equal(runCli('all', makeRepo('clean')).status, 0);
  });

  it('exits 1 when a workspace has no test files', () => {
    const result = runCli('empty-suites', makeRepo('empty', { testFile: false }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /apps\/one/);
  });

  it('exits 1 on an untagged TODO and 0 once it is tagged', () => {
    const bad = runCli('todos', makeRepo('todo-bad', { srcContent: '// TODO: fix\n' }));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /apps\/one\/src\/a\.ts:1/);
    assert.equal(runCli('todos', makeRepo('todo-good', { srcContent: '// TODO(RUN-221): fix\n' })).status, 0);
  });

  it('exits 1 on a Jira ID in a test name (also under all) and 0 once the name describes behaviour', () => {
    const bad = makeRepo('names-bad', { testContent: "describe('klockan (RUN-141)', () => { it('går rätt', () => {}); });\n" });
    for (const mode of ['test-names', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/one\/src\/a\.test\.ts:1: Jira-ID i testnamn/);
    }
    assert.equal(runCli('test-names', makeRepo('names-good', { testContent: "describe('klockan (T2)', () => { it('går rätt', () => {}); });\n" })).status, 0);
  });

  it('does not flag a Jira ID in a non-test source file when checking test names', () => {
    assert.equal(runCli('test-names', makeRepo('names-src', { srcContent: "export const t = it('RUN-1');\n" })).status, 0);
  });

  it('exits 1 on a planted conditional group filter in a route (also under all) and 0 once it is unconditional', () => {
    const makeRoute = (name, content) => {
      const root = makeRepo(name);
      mkdirSync(join(root, 'apps', 'one', 'src', 'routes'), { recursive: true });
      writeFileSync(join(root, 'apps', 'one', 'src', 'routes', 'planted.ts'), content);
      return root;
    };
    const bad = makeRoute('group-bad', "if (groupId) {\n  query = query.eq('group_id', groupId);\n}\n");
    for (const mode of ['group-filter', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/one\/src\/routes\/planted\.ts:1: villkorligt gruppfilter/);
    }
    const good = makeRoute('group-good', "if (!groupId) return;\nquery = query.eq('group_id', groupId);\n");
    assert.equal(runCli('group-filter', good).status, 0);
  });

  it('exits 1 on a planted raw Strava fetch in the backend (also under all) and 0 once it uses stravaFetch', () => {
    const makeBackend = (name, content) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src', 'routes'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'routes', 'planted.ts'), content);
      return root;
    };
    const bad = makeBackend('fetch-bad', "await fetch('https://www.strava.com/oauth/token');\n");
    for (const mode of ['strava-fetch', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/routes\/planted\.ts:1: anrop mot Strava/);
    }
    assert.equal(runCli('strava-fetch', makeBackend('fetch-good', "await stravaFetch('https://www.strava.com/oauth/token');\n")).status, 0);
  });

  it('exits 1 on a token column read outside stravaTokenStore (also under all) and 0 once it is gone', () => {
    const makeBackend = (name, content) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src', 'routes'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'routes', 'planted.ts'), content);
      return root;
    };
    const bad = makeBackend('token-path-bad', "await db.from('strava_tokens').select('user_id, access_token');\n");
    for (const mode of ['strava-token-path', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/routes\/planted\.ts:1: .*stravaTokenStore/);
    }
    assert.equal(runCli('strava-token-path', makeBackend('token-path-good', "await db.from('strava_tokens').select('user_id');\n")).status, 0);
  });

  it('exits 0 on the current repo in strava-token-path mode', () => {
    const result = runCli('strava-token-path');
    assert.equal(result.status, 0, result.stderr);
  });

  it('exits 1 when server.ts lacks the rate budget call (also under all) and 0 once it is planted', () => {
    const makeBackend = (name, serverContent) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'server.ts'), serverContent);
      return root;
    };
    const bad = makeBackend('hook-bad', 'const app = 1;\n');
    for (const mode of ['rate-budget-hook', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/server\.ts: saknar ett anrop av registerStravaRateBudget/);
    }
    assert.equal(runCli('rate-budget-hook', makeBackend('hook-good', 'registerStravaRateBudget();\n')).status, 0);
  });

  it('exits 1 on a role compared with a role name (also under all) and 0 once it asks groupRoleCan', () => {
    const makeRoleRepo = (name, content) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src', 'utils'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'utils', 'planted.ts'), content);
      return root;
    };
    const bad = makeRoleRepo('role-bad', "if (membership.role === 'admin') allow();\n");
    for (const mode of ['group-role-mapping', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/utils\/planted\.ts:1: .*groupRoleCan/);
    }
    assert.equal(runCli('group-role-mapping', makeRoleRepo('role-good', "if (groupRoleCan(membership.role, 'settings.write')) allow();\n")).status, 0);
  });

  it('exits 0 on the current repo in group-role-mapping mode', () => {
    const result = runCli('group-role-mapping');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /groupRoleCan/);
  });

  it('exits 1 when server.ts lacks the token key check (also under all) and 0 once it is planted', () => {
    const makeBackend = (name, serverContent) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'server.ts'), serverContent);
      return root;
    };
    const bad = makeBackend('key-check-bad', 'registerStravaRateBudget();\n');
    for (const mode of ['token-key-startup', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/server\.ts: saknar ett anrop av reportTokenKeyAtStartup/);
    }
    assert.equal(runCli('token-key-startup', makeBackend('key-check-good', 'reportTokenKeyAtStartup();\n')).status, 0);
  });

  it('exits 1 when server.ts lacks the dummy hash warm-up (also under all) and 0 once it is planted', () => {
    const makeBackend = (name, serverContent) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'server.ts'), serverContent);
      return root;
    };
    const bad = makeBackend('warmup-bad', 'registerStravaRateBudget();\n');
    for (const mode of ['dummy-hash-warmup', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/server\.ts: saknar ett anrop av warmUpDummyPasswordHash/);
    }
    assert.equal(runCli('dummy-hash-warmup', makeBackend('warmup-good', 'warmUpDummyPasswordHash();\n')).status, 0);
  });

  it('exits 0 on the current repo in dummy-hash-warmup mode', () => {
    const result = runCli('dummy-hash-warmup');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dummy-hashen/);
  });

  it('exits 0 on the current repo in token-key-startup mode', () => {
    const result = runCli('token-key-startup');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /tokennyckeln/);
  });

  it('exits 1 when server.ts does not start the webhook worker in the production block (also under all) and 0 once it does', () => {
    const makeBackend = (name, serverContent) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'server.ts'), serverContent);
      return root;
    };
    const bad = makeBackend('webhook-bad', "registerStravaRateBudget();\nstartStravaWebhookScheduler();\nif (process.env.NODE_ENV === 'production') {\n  startStravaScheduler();\n}\n");
    for (const mode of ['webhook-scheduler-start', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /startStravaWebhookScheduler\(\) måste anropas direkt i produktionsblocket/);
    }
    const good = makeBackend('webhook-good', "registerStravaRateBudget();\nif (process.env.NODE_ENV === 'production') {\n  startStravaWebhookScheduler();\n}\n");
    assert.equal(runCli('webhook-scheduler-start', good).status, 0);
  });

  it('exits 1 when server.ts does not start the nightly reconcile in the production block (also under all) and 0 once it does', () => {
    const makeBackend = (name, serverContent) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'server.ts'), serverContent);
      return root;
    };
    const bad = makeBackend('reconcile-bad', "registerStravaRateBudget();\nif (process.env.NODE_ENV === 'production') {\n  startStravaWebhookScheduler();\n}\n");
    for (const mode of ['reconcile-scheduler-start', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /startStravaReconcileScheduler\(\) måste anropas direkt i produktionsblocket/);
    }
    const good = makeBackend('reconcile-good', "registerStravaRateBudget();\nif (process.env.NODE_ENV === 'production') {\n  startStravaWebhookScheduler();\n  startStravaReconcileScheduler();\n}\n");
    assert.equal(runCli('reconcile-scheduler-start', good).status, 0);
  });

  it('exits 1 when frontend code reads a Supabase variable (also under all) and 0 once it is gone', () => {
    const makeFrontend = (name, envExample) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'frontend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'frontend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, '.env.example'), envExample);
      return root;
    };
    const bad = makeFrontend('supabase-bad', 'VITE_API_URL=x\nVITE_SUPABASE_URL=https://example.invalid\n');
    for (const mode of ['frontend-supabase', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/frontend\/\.env\.example:2: /);
    }
    assert.equal(runCli('frontend-supabase', makeFrontend('supabase-good', 'VITE_API_URL=x\n')).status, 0);
  });

  it('exits 0 on the current repo in frontend-supabase mode', () => {
    const result = runCli('frontend-supabase');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Supabase/);
  });

  it('exits 1 when server.ts does not start the recalculation recovery in the production block (also under all) and 0 once it does', () => {
    const makeBackend = (name, serverContent) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'server.ts'), serverContent);
      return root;
    };
    const bad = makeBackend('recovery-bad', "registerStravaRateBudget();\nif (process.env.NODE_ENV === 'production') {\n  startStravaReconcileScheduler();\n}\n");
    for (const mode of ['recovery-scheduler-start', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /startRecalculationRecoveryScheduler\(\) måste anropas direkt i produktionsblocket/);
    }
    const good = makeBackend('recovery-good', "registerStravaRateBudget();\nif (process.env.NODE_ENV === 'production') {\n  startStravaReconcileScheduler();\n  startRecalculationRecoveryScheduler();\n}\n");
    assert.equal(runCli('recovery-scheduler-start', good).status, 0);
  });

  it('exits 0 on the current repo in recovery-scheduler-start mode', () => {
    const result = runCli('recovery-scheduler-start');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /omräkningsåterhämtningen/);
  });

  it('exits 0 on the current repo in reconcile-scheduler-start mode', () => {
    const result = runCli('reconcile-scheduler-start');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Strava-avstämningen/);
  });

  it('exits 0 on the current repo in webhook-scheduler-start mode', () => {
    const result = runCli('webhook-scheduler-start');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /webhook-workern/);
  });

  it('exits 0 on the current repo in rate-budget-hook mode', () => {
    const result = runCli('rate-budget-hook');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /server\.ts/);
  });

  it('exits 0 on the current repo in strava-fetch mode', () => {
    const result = runCli('strava-fetch');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /stravaFetch/);
  });

  it('exits 1 on a direct write to users.group_id (also under all) and 0 once it goes through join_group', () => {
    const makeBackend = (name, content) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src', 'utils'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'utils', 'planted.ts'), content);
      return root;
    };
    const bad = makeBackend('ugid-bad', "export const f = (db) => db.from('users').update({ group_id: 1 }).eq('id', 2);\n");
    for (const mode of ['users-group-id', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/utils\/planted\.ts:1: .*join_group/);
    }
    assert.equal(runCli('users-group-id', makeBackend('ugid-good', "export const f = (db) => db.rpc('join_group', {});\n")).status, 0);
  });

  it('exits 1 on a group_settings write that skips the acting-group gate (also under all) and 0 once it goes through it', () => {
    const makeBackend = (name, content) => {
      const root = join(temp, name);
      const ws = join(root, 'apps', 'backend');
      mkdirSync(join(ws, 'src', 'routes'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(ws, 'src', 'routes', 'planted.ts'), content);
      return root;
    };
    const bad = makeBackend('gsw-bad', "export const f = (db) => db.from('group_settings').upsert([]);\n");
    for (const mode of ['group-settings-writes', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/routes\/planted\.ts:1: .*actingGroupForWriteOrRespond/);
    }
    const good = makeBackend('gsw-good', "export const f = async (db, req, res) => { const g = await actingGroupForWriteOrRespond(req, res); return db.from('group_settings').upsert([{ group_id: g }]); };\n");
    assert.equal(runCli('group-settings-writes', good).status, 0);
  });

  it('exits 0 on the current repo in group-settings-writes mode', () => {
    const result = runCli('group-settings-writes');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /group_settings/);
  });

  it('exits 0 on the current repo in users-group-id mode', () => {
    const result = runCli('users-group-id');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /group_id/);
  });

  it('does not flag the same code outside routes/', () => {
    const root = makeRepo('group-service', { srcContent: "if (groupId) { q = q.eq('group_id', groupId); }\n" });
    assert.equal(runCli('group-filter', root).status, 0);
  });

  it('exits 0 on the current repo in group-filter mode', () => {
    const result = runCli('group-filter');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gruppfilter/);
  });

  it('ignores TODOs in node_modules and dist', () => {
    const root = makeRepo('ignored');
    for (const dir of ['node_modules', 'dist']) {
      mkdirSync(join(root, 'apps', 'one', 'src', dir), { recursive: true });
      writeFileSync(join(root, 'apps', 'one', 'src', dir, 'x.ts'), '// TODO: vendored\n');
    }
    assert.equal(runCli('todos', root).status, 0);
  });

  it('exits 0 on the real repo in media mode, and all skips the media check in a repo without apps/frontend/public', () => {
    const real = runCli('media');
    assert.equal(real.status, 0, real.stderr);
    assert.match(real.stdout, /mediafiler/);
    assert.equal(runCli('all', makeRepo('no-frontend')).status, 0);
  });

  it('exits 1 in media mode, also under all, when a media file is over its limit', () => {
    const root = makeRepo('media-bad');
    const media = join(root, 'apps', 'frontend', 'public', 'media');
    mkdirSync(media, { recursive: true });
    writeFileSync(join(media, 'landing-film-poster-480.v1.webp'), Buffer.alloc(30_721));
    writeFileSync(join(root, '.gitignore'), 'docs/design/*.mp4\ndocs/design/landing-media/\n');
    for (const mode of ['media', 'all']) {
      const result = runCli(mode, root);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /landing-film-poster-480\.v1\.webp/);
    }
  });

  it('exits 1 in a git repo when a video original is tracked or .gitignore lacks the lines, and 0 once both are fine', () => {
    const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
    const makeGitRepo = (name, { ignore, trackVideo }) => {
      const root = makeRepo(name);
      mkdirSync(join(root, 'apps', 'frontend', 'public', 'media'), { recursive: true });
      mkdirSync(join(root, 'docs', 'design'), { recursive: true });
      writeFileSync(join(root, '.gitignore'), ignore);
      writeFileSync(join(root, 'docs', 'design', 'original.mp4'), 'x');
      assert.equal(git(root, 'init', '-q').status, 0);
      assert.equal(git(root, 'add', '-f', '.gitignore', trackVideo ? 'docs/design/original.mp4' : 'package.json').status, 0);
      return root;
    };
    const fullIgnore = 'docs/design/*.mp4\ndocs/design/landing-media/\n';

    const tracked = runCli('media', makeGitRepo('git-tracked', { ignore: fullIgnore, trackVideo: true }));
    assert.equal(tracked.status, 1);
    assert.match(tracked.stderr, /docs\/design\/original\.mp4: videofil spårad i git/);

    const noIgnore = runCli('media', makeGitRepo('git-no-ignore', { ignore: 'node_modules/\n', trackVideo: false }));
    assert.equal(noIgnore.status, 1);
    assert.match(noIgnore.stderr, /\.gitignore saknar raden "docs\/design\/\*\.mp4"/);
    assert.match(noIgnore.stderr, /\.gitignore saknar raden "docs\/design\/landing-media\/"/);

    const clean = runCli('media', makeGitRepo('git-clean', { ignore: fullIgnore, trackVideo: false }));
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /inga videooriginal i git/);
  });

  it('exits 0 on the real repo in fonts mode and 1 when a planted font is too big or not woff2', () => {
    const real = runCli('fonts');
    assert.equal(real.status, 0, real.stderr);
    assert.match(real.stdout, /typsnittsfiler/);

    const fontsDir = (name) => {
      const root = makeRepo(name);
      const dir = join(root, 'apps', 'frontend', 'public', 'fonts');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'OFL.txt'), 'licence');
      return { root, dir };
    };
    const big = fontsDir('fonts-big');
    writeFileSync(join(big.dir, 'huge.v1.woff2'), Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(61_440)]));
    const wrongType = fontsDir('fonts-wrong');
    writeFileSync(join(wrongType.dir, 'fake.v1.woff2'), Buffer.from('<!doctype html>'));
    for (const { root, dir } of [big, wrongType]) {
      for (const mode of ['fonts', 'all']) {
        const result = runCli(mode, root);
        assert.equal(result.status, 1, `${mode} ${dir}`);
        assert.match(result.stderr, /.v1.woff2/);
      }
    }
    const ok = fontsDir('fonts-ok');
    writeFileSync(join(ok.dir, 'fine.v1.woff2'), Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(100)]));
    assert.equal(runCli('fonts', ok.root).status, 0);
  });

  it('exits 0 on the current repo in token-group-id mode', () => {
    const result = runCli('token-group-id');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gruppen i token läses bara i groupScope/);
  });

  it('exits 1 on a planted read of the group in the token (also under all) and 0 once it goes through groupScope', () => {
    const bad = makeRepo('token-group-bad');
    mkdirSync(join(bad, 'apps', 'one', 'src', 'routes'), { recursive: true });
    writeFileSync(join(bad, 'apps', 'one', 'src', 'routes', 'things.ts'), 'const g = req.user!.group_id;\n');
    assert.equal(runCli('token-group-id', bad).status, 0, 'only apps/backend is covered');
    const backendBad = join(temp, 'token-group-backend');
    mkdirSync(join(backendBad, 'apps', 'backend', 'src', 'routes'), { recursive: true });
    writeFileSync(join(backendBad, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
    writeFileSync(join(backendBad, 'apps', 'backend', 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
    writeFileSync(join(backendBad, 'apps', 'backend', 'src', 'a.test.ts'), 'export {};\n');
    writeFileSync(join(backendBad, 'apps', 'backend', 'src', 'routes', 'things.ts'), 'const g = req.user!.group_id;\n');
    for (const mode of ['token-group-id', 'all']) {
      const result = runCli(mode, backendBad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/routes\/things\.ts:1: /);
    }
    writeFileSync(join(backendBad, 'apps', 'backend', 'src', 'routes', 'things.ts'), 'const g = tokenGroupId(req);\n');
    assert.equal(runCli('token-group-id', backendBad).status, 0);
  });

  it('exits 0 on the current repo in route-contracts mode', () => {
    const result = runCli('route-contracts');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /varje route svarar mot en kontraktstyp/);
  });

  it('exits 1 on a planted untyped route (also under all) and 0 once it answers with a shared contract', () => {
    const makeRepoWithRoute = (name, route) => {
      const root = join(temp, name);
      const backend = join(root, 'apps', 'backend');
      const contracts = join(root, 'packages', 'shared', 'src', 'contracts');
      mkdirSync(join(backend, 'src', 'routes'), { recursive: true });
      mkdirSync(contracts, { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*', 'packages/*'] }));
      writeFileSync(join(backend, 'package.json'), JSON.stringify({ name: 'backend', scripts: { test: 'vitest run' } }));
      writeFileSync(join(backend, 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(root, 'packages', 'shared', 'package.json'), JSON.stringify({ name: 'shared', scripts: { test: 'vitest run' } }));
      writeFileSync(join(root, 'packages', 'shared', 'src', 'a.test.ts'), 'export {};\n');
      writeFileSync(join(contracts, 'things.ts'), 'export interface ThingResponse { success: true }\n');
      writeFileSync(join(backend, 'src', 'routes', 'things.ts'), route);
      return root;
    };
    const bad = makeRepoWithRoute('contract-bad', "router.get('/a', auth, async (_req, res) => {\n  res.json({ success: true });\n});\n");
    for (const mode of ['route-contracts', 'all']) {
      const result = runCli(mode, bad);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /apps\/backend\/src\/routes\/things\.ts:1: GET \/a skriver inget svar mot en kontraktstyp/);
    }
    const good = makeRepoWithRoute('contract-good', "router.get('/a', auth, async (_req, res) => {\n  res.json({ success: true } satisfies ThingResponse);\n});\n");
    assert.equal(runCli('route-contracts', good).status, 0);
  });

  it('exits 0 on the current repo for doc-paths: no document refers to a file that is not tracked', () => {
    const result = runCli('doc-paths');
    assert.equal(result.status, 0, result.stderr);
  });

  it('exits 1 on a temp repo whose README names a file that is not tracked (also under all)', () => {
    const root = join(temp, 'doc-paths-bad');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r' }));
    writeFileSync(join(root, 'README.md'), 'See `scripts/gone.mjs`.\n');
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', 'package.json', 'README.md'], { cwd: root });
    for (const mode of ['doc-paths', 'all']) {
      const result = runCli(mode, root);
      assert.equal(result.status, 1, mode);
      assert.match(result.stderr, /README\.md:1: scripts\/gone\.mjs finns inte/);
    }
  });

  it('rejects an unknown mode', () => {
    assert.equal(runCli('nope').status, 2);
  });
});

describe('isEntryPoint', () => {
  it('is true for the script path and false for another file', () => {
    assert.equal(isEntryPoint(script, new URL(`file:///${script.split('\\').join('/')}`).href), true);
    assert.equal(isEntryPoint(join(here, 'check-versions.mjs'), new URL(`file:///${script.split('\\').join('/')}`).href), false);
    assert.equal(isEntryPoint(undefined), false);
  });
});
