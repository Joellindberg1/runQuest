#!/usr/bin/env node
// CI-vakter (RUN-221). Två kontroller som annars bara fångas av mänsklig granskning:
//
//  1. Tom testsvit: varje workspace med ett `test`-skript måste ha minst en testfil. Ett workspace som tappar alla sina tester
//     (flytt, felaktig glob, borttagen mapp) ska fälla bygget, inte gå grönt på "0 tester".
//  2. TODO/FIXME-nyckel: varje `TODO`/`FIXME` i källkoden under apps/* och packages/* måste peka på en Jira-ticket,
//     t.ex. `TODO(RUN-123): ...` eller `FIXME RUN-123 ...`. Annars glöms de bort.
//     Vakten är textbaserad, den förstår inte kod: den läser rad för rad och ser inte skillnad på kommentar, sträng och regex.
//     Ett strängliteral eller ett regex som innehåller ordet TODO eller FIXME (versaler, helt ord) fäller alltså också. Kringgå det
//     genom att skriva `TODO(RUN-nnn)` på stället, eller välj ett annat ord (t.ex. "PLACEHOLDER" eller "att göra").
//
//  3. Jira-ID i testnamn (RUN-154): inget test- eller describe-namn får innehålla `RUN-nnn`. Namnet ska beskriva beteendet; spårbarheten
//     finns i commit-meddelandet, Jira-länken och `git blame`. Spec-/manifest-ID (T1, F9.12) får stå i describe-namnet, inte upprepas i it-namnen.
//     Vakten är textbaserad: den läser första strängargumentet till describe/it/test (även .each/.skip/.only) över radbrytningar,
//     men ser inte namn som byggs upp av variabler.
//
//  4. Filmens mediefiler (RUN-257): filerna i apps/frontend/public/media/ följer namnmönstret (med version), håller sina storleksgränser
//     och summan är högst 7 MiB; ingen .mp4/.mov är spårad i git utanför den mappen (originalet ligger utanför git); .gitignore
//     innehåller raderna som håller originalet utanför. Kontrollen hoppas över i `all` när repot saknar apps/frontend/public.
//
//  5. Självhostade typsnitt: filerna i apps/frontend/public/fonts/ är versionerade woff2 (namn.v<N>.woff2, riktig woff2-signatur), högst 60 KiB
//     styck, och licensfilen OFL.txt ligger bredvid. Integritetstexten lovar att inga typsnitt hämtas från Google; en stor eller felaktig fil
//     i den mappen är oftast ett tecken på att någon lagt dit fel sak.
//
//  6. Villkorligt gruppfilter i routes (RUN-258): en route får inte lägga på `.eq('group_id', …)` bara när group_id finns
//     (`if (groupId) { query = query.eq('group_id', groupId); }`). Då ger en token utan group_id ALLA gruppers rader i stället för tom
//     data (ADR 007 A6, fail-closed). Använd `groupIdOrRespondEmpty` (apps/backend/src/utils/groupScope.ts) och sätt filtret ovillkorligt.
//     Vakten är textbaserad och avsiktligt smal: den läser bara routes/*.ts (inte services, där `processAllUsersTitles` har ett uttryckligt
//     `allGroups`-val) och fångar `if (…groupId) { …eq('…group_id' …`. Fångas INTE: ternärer (`groupId ? q.eq(…) : q`), `&&`
//     (`groupId && q.eq(…)`), jämförelser som `if (groupId !== undefined)` / `if (groupId != null)`, eller andra former av samma tanke.
//
// Körs:  node scripts/ci-guards.mjs [empty-suites|todos|test-names|group-filter|media|fonts|all]   (standard: all)
// Inga beroenden (körs före `npm ci`). Logiken är rena funktioner — CLI:t längst ned är ett tunt skal.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const TEST_FILE = /\.(test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx|css)$/;

// Versaler med flit: "todo" som identifierare (todos, todoList) och i svensk löptext är inte markörer.
const MARKER = /\b(TODO|FIXME)\b/g;
// Godkänd nyckel direkt efter markören: `TODO(RUN-12)`, `TODO: RUN-12`, `TODO [RUN-12]`, `FIXME RUN-12`.
const TAGGED_TAIL = /^[\s:(\[]*RUN-\d+\b/;

/** Alla filer under `dir` (rekursivt), hoppar över node_modules, dist m.fl. Returnerar sökvägar relativt `root`, med snedstreck. */
export function walkFiles(root, dir, readDir = readdirSync, stat = statSync) {
  const found = [];
  for (const name of readDir(join(root, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const relative = `${dir}/${name}`;
    if (stat(join(root, relative)).isDirectory()) found.push(...walkFiles(root, relative, readDir, stat));
    else found.push(relative);
  }
  return found;
}

/** Workspaces enligt rotens package.json: "apps/*" -> alla undermappar med en package.json. Returnerar { dir, hasTestScript }. */
export function listWorkspaces(root) {
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const workspaces = [];
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith('/*')) throw new Error(`Okänt workspace-mönster "${pattern}" (bara "mapp/*" stöds).`);
    const parent = pattern.slice(0, -2);
    for (const name of readdirSync(join(root, parent)).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const manifest = join(root, parent, name, 'package.json');
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      } catch {
        continue; // ingen package.json -> inget workspace
      }
      workspaces.push({ dir: `${parent}/${name}`, hasTestScript: typeof pkg.scripts?.test === 'string' });
    }
  }
  return workspaces;
}

/**
 * Regel 1. `workspaces`: [{ dir, hasTestScript }], `filesByDir`: dir -> filsökvägar under den mappen.
 * Returnerar felmeddelanden (tom lista = ok).
 */
export function checkEmptySuites(workspaces, filesByDir) {
  const errors = [];
  for (const { dir, hasTestScript } of workspaces) {
    if (!hasTestScript) continue;
    const testFiles = (filesByDir[dir] ?? []).filter((file) => TEST_FILE.test(file));
    if (testFiles.length === 0) {
      errors.push(`${dir} har ett test-skript men inga testfiler (*.test.* / *.spec.*). En tom testsvit är grön utan att testa något.`);
    }
  }
  return errors;
}

/**
 * Regel 2. `files`: [{ path, content }] (path relativt repo-roten, snedstreck). Returnerar felmeddelanden "path:rad: text".
 */
export function checkTodos(files) {
  const errors = [];
  for (const { path, content } of files) {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(MARKER)) {
        const tail = line.slice(match.index + match[0].length);
        if (!TAGGED_TAIL.test(tail)) {
          errors.push(`${path}:${index + 1}: ${match[1]} utan RUN-nyckel (skriv t.ex. ${match[1]}(RUN-123): ...) — "${line.trim()}"`);
          break; // en rapport per rad räcker
        }
      }
    });
  }
  return errors;
}

// describe/it/test, valfritt följt av .each/.skip/.only/... och en tabell i parentes (två parentesnivåer räcker för it.each([...])),
// sedan parentesen med namnet. Gruppen 2 är namnets text. (?<![\w.$]) hindrar träff på t.ex. `expect.it(` eller `submit(`.
const TEST_NAME_CALL =
  /(?<![\w.$])(?:describe|it|test)(?:\.(?:each|skip|only|todo|concurrent|sequential|fails|runIf|skipIf))*(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?\s*\(\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;
const JIRA_ID = /RUN-\d+/;

/**
 * Regel 3. `files`: [{ path, content }] (bara testfiler). Returnerar felmeddelanden "path:rad: text".
 */
export function checkTestNames(files) {
  const errors = [];
  for (const { path, content } of files) {
    for (const match of content.matchAll(TEST_NAME_CALL)) {
      if (!JIRA_ID.test(match[2])) continue;
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      errors.push(`${path}:${line}: Jira-ID i testnamn — beskriv beteendet i stället, ID:t hör hemma i commit-meddelandet — "${match[2]}"`);
    }
  }
  return errors;
}

// `if (groupId) {` / `if (req.user.group_id)` (aldrig `if (!groupId)`) följt, inom samma block, av ett filter på en group_id-kolumn
// (`.eq('group_id'`, `.eq('users.group_id'`, `.in('group_id'`). [^}] stoppar vid blockets slut, så ett senare, ovillkorligt filter ger inget falskt larm.
const CONDITIONAL_GROUP_FILTER =
  /\bif\s*\(\s*(?!!)[\w.!?]*group_?id\s*\)\s*\{?[^}]{0,400}?\.(?:eq|in)\(\s*(['"`])[\w.]*group_id\1/gi;
const ROUTE_FILE = /^apps\/[^/]+\/src\/routes\/[^/]+\.[cm]?[jt]sx?$/;

/**
 * Regel 6. `files`: [{ path, content }] (path relativt repo-roten, snedstreck). Bara routes/*.ts (inte testfiler) granskas.
 * Returnerar felmeddelanden "path:rad: text".
 */
export function checkConditionalGroupFilter(files) {
  const errors = [];
  for (const { path, content } of files) {
    if (!ROUTE_FILE.test(path) || TEST_FILE.test(path)) continue;
    for (const match of content.matchAll(CONDITIONAL_GROUP_FILTER)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      const header = match[0].split(/\r?\n/)[0].trim();
      errors.push(`${path}:${line}: villkorligt gruppfilter — en token utan group_id får alla gruppers rader (ADR 007 A6). Svara tom data med groupIdOrRespondEmpty och filtrera ovillkorligt — "${header}"`);
    }
  }
  return errors;
}

/** Källfiler att skanna efter TODO: src/ i varje workspace under apps/* och packages/*. */
export function collectSourceFiles(root, workspaces) {
  const files = [];
  for (const { dir } of workspaces) {
    let paths;
    try {
      paths = walkFiles(root, `${dir}/src`);
    } catch {
      continue; // workspace utan src/
    }
    for (const path of paths.filter((file) => SOURCE_FILE.test(file))) {
      files.push({ path, content: readFileSync(join(root, path), 'utf8') });
    }
  }
  return files;
}

const MEDIA_DIR = 'apps/frontend/public/media';
const MEDIA_SUM_LIMIT = 7 * 1024 * 1024;
// Namnmönster med version (`.v1`): en ny kodning får ett nytt namn, så den immutable-cachade filen aldrig skrivs över.
const MEDIA_RULES = [
  { pattern: /^landing-film-720\.v\d+\.mp4$/, limit: 4_194_304 },
  { pattern: /^landing-film-480\.v\d+\.mp4$/, limit: 2_621_440 },
  { pattern: /^landing-film-poster-720\.v\d+\.webp$/, limit: 61_440 },
  { pattern: /^landing-film-poster-480\.v\d+\.webp$/, limit: 30_720 },
];
const VIDEO_FILE = /\.(?:mp4|mov)$/i;
const REQUIRED_IGNORE_LINES = ['docs/design/*.mp4', 'docs/design/landing-media/'];

/** Regel 4a. `files`: [{ name, size }] för varje fil direkt i public/media. Returnerar felmeddelanden. */
export function checkMediaFiles(files) {
  const errors = [];
  let sum = 0;
  for (const { name, size } of files) {
    sum += size;
    const rule = MEDIA_RULES.find(({ pattern }) => pattern.test(name));
    if (!rule) {
      errors.push(`${MEDIA_DIR}/${name}: namnet följer inte mönstret landing-film-(720|480).v<N>.mp4 eller landing-film-poster-(720|480).v<N>.webp.`);
    } else if (size > rule.limit) {
      errors.push(`${MEDIA_DIR}/${name}: ${size} byte, gränsen är ${rule.limit} byte.`);
    }
  }
  if (sum > MEDIA_SUM_LIMIT) errors.push(`${MEDIA_DIR}: filerna är ${sum} byte tillsammans, gränsen är 7 MiB (${MEDIA_SUM_LIMIT} byte).`);
  return errors;
}

/** Regel 4b. `trackedPaths`: utdata från `git ls-files`. Videoorginal (.mp4/.mov) får inte vara spårade utanför public/media. */
export function checkNoTrackedVideoOriginals(trackedPaths) {
  return trackedPaths
    .filter((path) => VIDEO_FILE.test(path) && !path.startsWith(`${MEDIA_DIR}/`))
    .map((path) => `${path}: videofil spårad i git utanför ${MEDIA_DIR}/ (originalet ligger i ägarens OneDrive, inte i repot).`);
}

/** Regel 4c. `.gitignore` måste hålla originalet utanför git. */
export function checkGitignoreForVideo(content) {
  const lines = new Set(content.split(/\r?\n/).map((line) => line.trim()));
  return REQUIRED_IGNORE_LINES.filter((line) => !lines.has(line)).map((line) => `.gitignore saknar raden "${line}".`);
}

const FONTS_DIR = 'apps/frontend/public/fonts';
const FONT_SIZE_LIMIT = 60 * 1024;
// <familj>-<vikt>.v<N>.woff2, eller <familj>-<vikt>.latin-ext.v<N>.woff2 för latin-ext-delmängden.
const FONT_NAME = /^[a-z0-9][a-z0-9-]*(?:\.latin-ext)?\.v\d+\.woff2$/;
const FONT_LICENCE = 'OFL.txt';
const WOFF2_SIGNATURE = 'wOF2';

/** Regel 5. `files`: [{ name, size, magic }] för varje fil direkt i public/fonts; `magic` är filens fyra första tecken. Returnerar felmeddelanden. */
export function checkFontFiles(files) {
  const errors = [];
  const fonts = files.filter(({ name }) => name !== FONT_LICENCE);
  for (const { name, size, magic } of fonts) {
    if (!FONT_NAME.test(name)) {
      errors.push(`${FONTS_DIR}/${name}: namnet följer inte mönstret <namn>[.latin-ext].v<N>.woff2 (versionen i namnet håller den immutable-cachade filen sann).`);
    } else if (magic !== WOFF2_SIGNATURE) {
      errors.push(`${FONTS_DIR}/${name}: filen är inte woff2 (saknar signaturen "${WOFF2_SIGNATURE}").`);
    }
    if (size > FONT_SIZE_LIMIT) errors.push(`${FONTS_DIR}/${name}: ${size} byte, gränsen är ${FONT_SIZE_LIMIT} byte.`);
  }
  if (fonts.length > 0 && !files.some(({ name }) => name === FONT_LICENCE)) {
    errors.push(`${FONTS_DIR}/${FONT_LICENCE} saknas: typsnitten är OFL-licensierade och licenstexten ska ligga bredvid.`);
  }
  return errors;
}

function listFontFiles(root) {
  const dir = join(root, FONTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => {
    const path = join(dir, name);
    const head = Buffer.alloc(4);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, head, 0, 4, 0);
    } finally {
      closeSync(fd);
    }
    return { name, size: statSync(path).size, magic: head.toString('latin1') };
  });
}

function listMediaFiles(root) {
  const dir = join(root, MEDIA_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => ({ name, size: statSync(join(dir, name)).size }));
}

/** Spårade filer enligt git, eller null när katalogen inte är ett git-repo (t.ex. ett temporärt provrepo). */
function gitTrackedFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean);
  } catch {
    return null;
  }
}

function runCli(argv = process.argv.slice(2)) {
  const mode = argv[0] ?? 'all';
  if (!['all', 'empty-suites', 'todos', 'test-names', 'group-filter', 'media', 'fonts'].includes(mode)) {
    console.error(`Okänt läge "${mode}". Använd: all | empty-suites | todos | test-names | group-filter | media | fonts`);
    process.exit(2);
  }
  const root = argv[1] ? resolve(argv[1]) : join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspaces = listWorkspaces(root);
  const errors = [];
  const summary = [];

  if (mode === 'all' || mode === 'empty-suites') {
    const filesByDir = {};
    for (const { dir } of workspaces) filesByDir[dir] = walkFiles(root, dir);
    errors.push(...checkEmptySuites(workspaces, filesByDir));
    const tested = workspaces.filter((workspace) => workspace.hasTestScript).map((workspace) => workspace.dir);
    summary.push(`testsviter finns i ${tested.join(', ')}`);
  }
  if (mode === 'all' || mode === 'todos' || mode === 'test-names' || mode === 'group-filter') {
    const files = collectSourceFiles(root, workspaces);
    if (mode === 'all' || mode === 'group-filter') {
      errors.push(...checkConditionalGroupFilter(files));
      summary.push('inga villkorliga gruppfilter i routes');
    }
    if (mode === 'all' || mode === 'todos') {
      errors.push(...checkTodos(files));
      summary.push(`${files.length} källfiler utan otaggade TODO/FIXME`);
    }
    if (mode === 'all' || mode === 'test-names') {
      const testFiles = files.filter(({ path }) => TEST_FILE.test(path));
      errors.push(...checkTestNames(testFiles));
      summary.push(`${testFiles.length} testfiler utan Jira-ID i testnamn`);
    }
  }

  if (mode === 'media' || (mode === 'all' && existsSync(join(root, 'apps/frontend/public')))) {
    const files = listMediaFiles(root);
    errors.push(...checkMediaFiles(files));
    const ignorePath = join(root, '.gitignore');
    errors.push(...checkGitignoreForVideo(existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : ''));
    const tracked = gitTrackedFiles(root);
    if (tracked) errors.push(...checkNoTrackedVideoOriginals(tracked));
    summary.push(`${files.length} mediafiler inom storleksgränserna${tracked ? ', inga videooriginal i git' : ' (git ls-files ej tillgängligt: spårningskontrollen hoppades över)'}`);
  }

  if (mode === 'fonts' || (mode === 'all' && existsSync(join(root, 'apps/frontend/public')))) {
    const files = listFontFiles(root);
    errors.push(...checkFontFiles(files));
    summary.push(`${files.filter(({ name }) => name !== FONT_LICENCE).length} typsnittsfiler som woff2 inom storleksgränsen`);
  }

  if (errors.length > 0) {
    console.error(`CI-vakten fann ${errors.length} problem:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`CI-vakterna är gröna: ${summary.join('; ')}.`);
}

/** Är den här filen den som kördes och inte en import från testet? Samma resonemang som i check-versions.mjs. */
export function isEntryPoint(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  const real = (path) => realpathSync.native(path);
  try {
    return real(resolve(argv1)) === real(fileURLToPath(moduleUrl));
  } catch {
    // Går något inte att läsa, anta att vi är entry: hellre en kontroll för mycket än en tyst grön.
    return true;
  }
}

if (isEntryPoint()) runCli();

