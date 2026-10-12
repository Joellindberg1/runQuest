#!/usr/bin/env node
// CI-vakter (RUN-221). Två kontroller som annars bara fångas av mänsklig granskning:
//
//  1. Tom testsvit: varje workspace med ett `test`-skript måste ha minst en testfil. Ett workspace som tappar alla sina tester
//     (flytt, felaktig glob, borttagen mapp) ska fälla bygget, inte gå grönt på "0 tester".
//  2. TODO/FIXME-nyckel: varje `TODO`/`FIXME` i källkoden under apps/* och packages/* måste peka på en Jira-ticket,
//     t.ex. `TODO(RUN-123): ...` eller `FIXME RUN-123 ...`. Annars glöms de bort.
//
// Körs:  node scripts/ci-guards.mjs [empty-suites|todos|all]   (standard: all)
// Inga beroenden (körs före `npm ci`). Logiken är rena funktioner — CLI:t längst ned är ett tunt skal.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
const TEST_FILE = /\.(test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx|css)$/;

// Versaler med flit: "todo" som identifierare (todos, todoList) och i svensk löptext är inte markörer.
const MARKER = /\b(TODO|FIXME)\b/g;
// Godkänd nyckel direkt efter markören: `TODO(RUN-12)`, `TODO: RUN-12`, `TODO [RUN-12]`, `FIXME RUN-12`.
const TAGGED_TAIL = /^[\s:(\[]*RUN-\d+\b/;

/**
 * Kända, redan existerande TODO-rader som får stå otaggade tills de försvinner. Matchas på filsökväg + exakt radtext, så en ny
 * otaggad TODO i samma fil fäller fortfarande. Raderna finns på main men är borta på release/v0.6.1.1 (RUN-215 tog bort dem);
 * posten är ofarlig när raden saknas och ska tas bort när main har släppt förbi den.
 */
export const KNOWN_UNTAGGED = [
  {
    file: 'apps/backend/src/services/streakService.ts',
    text: 'TODO: replace with a shared backend logger utility when available',
  },
];

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
 * Rader som matchar KNOWN_UNTAGGED (samma fil + exakt radtext) hoppas över.
 */
export function checkTodos(files, known = KNOWN_UNTAGGED) {
  const errors = [];
  for (const { path, content } of files) {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (known.some((entry) => entry.file === path && line.includes(entry.text))) return;
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

function runCli(argv = process.argv.slice(2)) {
  const mode = argv[0] ?? 'all';
  if (!['all', 'empty-suites', 'todos'].includes(mode)) {
    console.error(`Okänt läge "${mode}". Använd: all | empty-suites | todos`);
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
  if (mode === 'all' || mode === 'todos') {
    const files = collectSourceFiles(root, workspaces);
    errors.push(...checkTodos(files));
    summary.push(`${files.length} källfiler utan otaggade TODO/FIXME`);
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

