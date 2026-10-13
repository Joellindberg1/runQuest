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
  checkEmptySuites,
  checkFontFiles,
  checkGitignoreForVideo,
  checkMediaFiles,
  checkNoTrackedVideoOriginals,
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
    assert.deepEqual(checkFontFiles([font('bebas-neue-400.v1.woff2', 61_440), font('oswald-variable.v2.woff2'), licence]), []);
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
    for (const name of ['bebas-neue-400.woff2', 'bebas-neue-400.v1.ttf', 'bebas-neue-400.v1.woff', 'Bebas.v1.woff2', 'notes.txt']) {
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
