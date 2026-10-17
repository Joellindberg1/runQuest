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
  checkEmptySuites,
  checkFontFiles,
  checkGitignoreForVideo,
  checkMediaFiles,
  checkNoTrackedVideoOriginals,
  checkRateBudgetHook,
  checkReconcileSchedulerStart,
  checkWebhookSchedulerStart,
  checkRawStravaFetch,
  checkTestNames,
  checkTodos,
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
