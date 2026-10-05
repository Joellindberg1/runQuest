#!/usr/bin/env node
// Versionsvakt (docs/dokumentation.md, "Versioner"): användarversioner har tre delar (0.MINOR.PATCH) och är det gruppen ser
// (changelog.json, package.json); interna versioner har fyra delar (0.5.0.1) och finns bara i CHANGELOG.md och git-taggar, tills de
// rullas ihop till nästa användarversion.
//
// Regler:
//  1. rotens package.json version == apps/frontend/package.json version == de tre första delarna av översta `## v...` i CHANGELOG.md
//     (`v0.5.1.2` -> 0.5.1, `v0.5.2` -> 0.5.2)
//  2. CHANGELOG.md-rubriker: `vX.Y.Z` eller `vX.Y.Z.N` (N >= 1), strikt fallande (en fyrdelad sorteras efter sin tredelade bas)
//  3. changelog.json: endast tredelade versioner, strikt fallande, den översta <= package-versionen, och varje version som ligger inom
//     CHANGELOG.md:s spann (>= dess äldsta rubrik) finns som rubrik där (äldre versioner finns bara i changelog.json)
//  4. poster med `announce` har minst en ändring; typ följer versionsnumret, datum "5 October 2026", ändringstyper, features/workingOn
//  5. inga förreleaser (-rc.1); rubriker i kodstaket i CHANGELOG.md räknas inte
//
// Inga beroenden (körs före `npm ci`). Logiken är en ren funktion (checkVersions) — CLI:t längst ned är ett tunt skal.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Hela versionstoken efter 'v' (alla punktade delar + ett eventuellt förreleasesuffix), så att '## v0.6.0-rc.1' aldrig läses som 0.6.0.
const HEADING = /^##[ \t]+v(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.+-]*)?)(?![0-9A-Za-z.+-])/gm;
const PRERELEASE = /^\d+(?:\.\d+)+[-+][0-9A-Za-z.+-]*$/;
const FOUR_PARTS = /^\d+\.\d+\.\d+\.\d+$/;
const HEADING_VERSION = /^(\d+\.\d+\.\d+)(?:\.([1-9]\d*))?$/;
const FENCE = /^ {0,3}(```|~~~)/;
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE = new RegExp(`^\\d{1,2} (${MONTHS}) \\d{4}$`);
const CHANGE_TYPES = ['feature', 'improvement', 'bugfix'];
const RELEASE_TYPES = ['major', 'minor', 'patch'];

export const parseSemver = (text) => {
  const match = typeof text === 'string' ? SEMVER.exec(text) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

/** Negativt om a < b, 0 om lika, positivt om a > b. Båda måste vara giltig semver. */
export const compareSemver = (a, b) => {
  const [pa, pb] = [parseSemver(a), parseSemver(b)];
  for (let part = 0; part < 3; part += 1) if (pa[part] !== pb[part]) return pa[part] - pb[part];
  return 0;
};

/** Typen följer versionens eget nummer: x.0.0 = major, x.y.0 = minor, annars patch (0.1.0 räknas som minor). */
export const releaseTypeOf = (version) => {
  const [major, minor, patch] = parseSemver(version);
  if (patch > 0) return 'patch';
  if (minor > 0 || major === 0) return 'minor';
  return 'major';
};

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const label = (release, index) => (isText(release?.version) ? `changelog.json ${release.version}` : `changelog.json releases[${index}]`);

/**
 * En rubrikversion: `X.Y.Z` (användarversion) eller `X.Y.Z.N` med N >= 1 (intern). Returnerar den tredelade basen och N (0 för tredelad),
 * eller null om formen är fel (femdelad, N = 0, inledande nollor, ...).
 */
export const parseHeadingVersion = (token) => {
  const match = typeof token === 'string' ? HEADING_VERSION.exec(token) : null;
  return match && parseSemver(match[1]) ? { base: match[1], n: match[2] ? Number(match[2]) : 0 } : null;
};

/** Negativt om a < b: basen först, sedan intern räknare (v0.5.0.1 > v0.5.0). */
export const compareHeadings = (a, b) => {
  const [pa, pb] = [parseHeadingVersion(a), parseHeadingVersion(b)];
  return compareSemver(pa.base, pb.base) || pa.n - pb.n;
};

/** Förklaring till en användarversion som inte är ren X.Y.Z — förreleaser och fyrdelade får egna, tydliga besked. */
const notSemver = (version) => {
  const shown = `version ${JSON.stringify(version)}`;
  if (typeof version === 'string' && PRERELEASE.test(version)) {
    return `${shown} är en förrelease — förreleaser stöds inte, använd ren X.Y.Z (t.ex. ${version.split(/[-+]/)[0]}).`;
  }
  if (typeof version === 'string' && FOUR_PARTS.test(version)) {
    return `${shown} har fyra delar — användarversioner har tre (X.Y.Z). Fyrdelade versioner är interna och hör bara hemma i CHANGELOG.md och git-taggar.`;
  }
  return `${shown} är inte giltig semver (X.Y.Z).`;
};

/** Markdown utan kodstaket (``` / ~~~): rubriker i exempelkod är inte releaser. */
const withoutCodeFences = (markdown) => {
  let fence = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence === null && marker) fence = marker;
      else if (fence !== null && marker === fence) fence = null;
      else if (fence === null) return line;
      return '';
    })
    .join('\n');
};

function checkChangelogMd(markdown, packageVersion, errors) {
  const found = [...withoutCodeFences(markdown).matchAll(HEADING)].map((match) => match[1]);
  const headings = [];
  for (const token of found) {
    if (parseHeadingVersion(token)) headings.push(token);
    else if (PRERELEASE.test(token)) errors.push(`CHANGELOG.md: rubriken '## v${token}' är en förrelease — förreleaser stöds inte, använd ren X.Y.Z.`);
    else errors.push(`CHANGELOG.md: rubriken '## v${token}' har fel form — använd vX.Y.Z (användarversion) eller vX.Y.Z.N med N >= 1 (intern version).`);
  }
  if (headings.length === 0) {
    errors.push("CHANGELOG.md: hittar ingen rubrik av formen '## vX.Y.Z' eller '## vX.Y.Z.N'.");
    return headings;
  }
  const topBase = parseHeadingVersion(headings[0]).base;
  if (topBase !== packageVersion) {
    errors.push(`CHANGELOG.md: översta rubriken är v${headings[0]}, vars tre första delar (${topBase}) ska vara package.json-versionen ${packageVersion}. Lägg en '## v${packageVersion}'-post överst (eller rätta versionen i package.json).`);
  }
  for (let index = 1; index < headings.length; index += 1) {
    if (compareHeadings(headings[index - 1], headings[index]) <= 0) {
      errors.push(`CHANGELOG.md: rubrikerna ska vara strikt fallande, men v${headings[index]} står efter v${headings[index - 1]}.`);
    }
  }
  return headings;
}

function checkRelease(release, index, errors) {
  const name = label(release, index);
  if (release === null || typeof release !== 'object') {
    errors.push(`${name}: posten är inte ett objekt.`);
    return;
  }
  if (!RELEASE_TYPES.includes(release.type)) errors.push(`${name}: type måste vara ${RELEASE_TYPES.join(' | ')} (fick ${JSON.stringify(release.type)}).`);
  else if (parseSemver(release.version) && release.type !== releaseTypeOf(release.version)) {
    errors.push(`${name}: type är '${release.type}', men versionsnumret ger '${releaseTypeOf(release.version)}'.`);
  }
  if (!isText(release.title)) errors.push(`${name}: title saknas.`);
  if (typeof release.date !== 'string' || !DATE.test(release.date)) {
    errors.push(`${name}: date ska skrivas som '5 October 2026' (fick ${JSON.stringify(release.date)}).`);
  }
  if (release.announce !== undefined && release.announce !== true) errors.push(`${name}: announce är antingen utelämnat eller true.`);
  if (!Array.isArray(release.changes)) {
    errors.push(`${name}: changes måste vara en lista.`);
    return;
  }
  if (release.announce === true && release.changes.length === 0) {
    errors.push(`${name}: posten har announce: true men inga ändringar — popupen skulle bli tom.`);
  }
  release.changes.forEach((change, position) => {
    if (!CHANGE_TYPES.includes(change?.type)) errors.push(`${name}: changes[${position}].type måste vara ${CHANGE_TYPES.join(' | ')}.`);
    if (!isText(change?.description)) errors.push(`${name}: changes[${position}].description saknas.`);
  });
}

function checkCatalogue(changelog, errors) {
  if (!Array.isArray(changelog.features)) errors.push('changelog.json: features måste vara en lista.');
  else {
    changelog.features.forEach((feature, position) => {
      for (const field of ['title', 'body', 'icon']) {
        if (!isText(feature?.[field])) errors.push(`changelog.json: features[${position}].${field} saknas.`);
      }
    });
  }
  if (!Array.isArray(changelog.workingOn)) errors.push('changelog.json: workingOn måste vara en lista.');
  else {
    changelog.workingOn.forEach((item, position) => {
      for (const field of ['title', 'body', 'icon']) {
        if (!isText(item?.[field])) errors.push(`changelog.json: workingOn[${position}].${field} saknas.`);
      }
      if (!Array.isArray(item?.details) || !item.details.every(isText)) errors.push(`changelog.json: workingOn[${position}].details måste vara en lista med text.`);
    });
  }
}

/**
 * Ren kontroll av alla versionsregler. Returnerar en lista felmeddelanden (tom = grönt).
 * @param {{ rootVersion: unknown, frontendVersion: unknown, changelogMd: string, changelog: unknown }} input
 * @returns {string[]}
 */
export function checkVersions({ rootVersion, frontendVersion, changelogMd, changelog }) {
  const errors = [];

  // 1. package.json (båda) och CHANGELOG.md
  for (const [file, version] of [['package.json', rootVersion], ['apps/frontend/package.json', frontendVersion]]) {
    if (!parseSemver(version)) errors.push(`${file}: ${notSemver(version)}`);
  }
  if (parseSemver(rootVersion) && parseSemver(frontendVersion) && rootVersion !== frontendVersion) {
    errors.push(`Versionerna skiljer sig: package.json har ${rootVersion}, apps/frontend/package.json har ${frontendVersion}. De ska vara samma.`);
  }
  const packageVersion = parseSemver(rootVersion) ? rootVersion : null;
  const headings = checkChangelogMd(changelogMd, packageVersion ?? String(rootVersion), errors);

  // 2–4. changelog.json
  if (changelog === null || typeof changelog !== 'object' || !Array.isArray(changelog.releases)) {
    errors.push('changelog.json: toppnivån ska vara { features, workingOn, releases } där releases är en lista.');
    return errors;
  }
  checkCatalogue(changelog, errors);

  const { releases } = changelog;
  releases.forEach((release, index) => checkRelease(release, index, errors));

  const versions = releases.map((release) => release?.version);
  versions.forEach((version, index) => {
    if (!parseSemver(version)) errors.push(`changelog.json releases[${index}]: ${notSemver(version)}`);
  });
  const valid = versions.filter((version) => parseSemver(version));
  const seen = new Set();
  for (let index = 0; index < valid.length; index += 1) {
    if (seen.has(valid[index])) errors.push(`changelog.json: version ${valid[index]} förekommer två gånger.`);
    seen.add(valid[index]);
    if (index > 0 && compareSemver(valid[index - 1], valid[index]) < 0) {
      errors.push(`changelog.json: nyaste först, strikt fallande — ${valid[index]} står efter ${valid[index - 1]}.`);
    }
  }
  if (packageVersion && valid.length > 0 && compareSemver(valid[0], packageVersion) > 0) {
    errors.push(`changelog.json: översta versionen ${valid[0]} är nyare än package.json (${packageVersion}). Bumpa package.json eller ta bort posten.`);
  }

  if (headings.length > 0) {
    const oldest = headings.reduce((lowest, version) => (compareHeadings(version, lowest) < 0 ? version : lowest));
    const oldestBase = parseHeadingVersion(oldest).base;
    for (const version of valid) {
      if (compareSemver(version, oldestBase) >= 0 && !headings.includes(version)) {
        errors.push(`changelog.json: version ${version} saknar rubrik '## v${version}' i CHANGELOG.md (användarversioner från v${oldestBase} och uppåt ska finnas där).`);
      }
    }
  }
  return errors;
}

function runCli() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (relative) => readFileSync(join(root, relative), 'utf8');
  const input = {
    rootVersion: JSON.parse(read('package.json')).version,
    frontendVersion: JSON.parse(read('apps/frontend/package.json')).version,
    changelogMd: read('CHANGELOG.md'),
    changelog: JSON.parse(read('apps/frontend/src/data/changelog.json')),
  };
  const errors = checkVersions(input);
  if (errors.length > 0) {
    console.error(`Versionsvakten fann ${errors.length} problem:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
    console.error('\nReglerna står i docs/dokumentation.md ("Versioner" och releasechecklistan).');
    process.exit(1);
  }
  const announced = input.changelog.releases.filter((release) => release.announce).map((release) => release.version);
  console.log(`Versionerna stämmer: v${input.rootVersion}, ${input.changelog.releases.length} poster i changelog.json (popup: ${announced.join(', ') || 'ingen'}).`);
}

/**
 * Är den här filen den som kördes (`node scripts/check-versions.mjs`) och inte en import från testet? Jämförs som verkliga sökvägar
 * (realpath löser symlänkar, junctions och Windows-skiftläge) — en miss här skulle få skriptet att avsluta med 0 utan att ha kontrollerat något.
 */
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
