// Test av CI-vakternas logik (rena funktioner) + CLI-prov mot de riktiga filerna och mot temporära repon.
// Körs med `node --test scripts/ci-guards.test.mjs` (CI: frontend-jobbet).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkEmptySuites, checkTodos, isEntryPoint, listWorkspaces, walkFiles } from './ci-guards.mjs';

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

  const makeRepo = (name, { testFile = true, srcContent = 'export const a = 1;\n' } = {}) => {
    const root = join(temp, name);
    const ws = join(root, 'apps', 'one');
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['apps/*'] }));
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'one', scripts: { test: 'vitest run' } }));
    writeFileSync(join(ws, 'src', 'a.ts'), srcContent);
    if (testFile) writeFileSync(join(ws, 'src', 'a.test.ts'), 'export {};\n');
    return root;
  };

  it('exits 0 on the current repo (all, empty-suites, todos)', () => {
    for (const mode of ['all', 'empty-suites', 'todos']) {
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

  it('ignores TODOs in node_modules and dist', () => {
    const root = makeRepo('ignored');
    for (const dir of ['node_modules', 'dist']) {
      mkdirSync(join(root, 'apps', 'one', 'src', dir), { recursive: true });
      writeFileSync(join(root, 'apps', 'one', 'src', dir, 'x.ts'), '// TODO: vendored\n');
    }
    assert.equal(runCli('todos', root).status, 0);
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
