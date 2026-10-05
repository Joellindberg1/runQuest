#!/usr/bin/env node
// Versionsvakt (docs/dokumentation.md, "Versioner"): ett nummer för hela appen, och det som gruppen ser
// (changelog.json) ska hänga ihop med det utvecklarna ser (CHANGELOG.md, package.json).
//
// Regler:
//  1. rotens package.json version == apps/frontend/package.json version == översta `## vX.Y.Z` i CHANGELOG.md
//  2. changelog.json: versionerna är giltig semver, strikt fallande, den översta <= package-versionen
//  3. varje version i changelog.json som ligger inom CHANGELOG.md:s spann (>= dess äldsta rubrik) finns som rubrik där
//     (v0.x är äldre än CHANGELOG.md och finns bara i changelog.json)
//  4. poster med `announce` har minst en ändring
//  + formen: typ följer versionsnumret, datum "5 October 2026", ändringstyper, features/workingOn
//
// Inga beroenden (körs före `npm ci`). Logiken är en ren funktion (checkVersions) — CLI:t längst ned är ett tunt skal.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Hela versionstoken efter 'v' inklusive ett eventuellt förreleasesuffix, så att '## v2.3.0-rc.1' aldrig läses som 2.3.0.
const HEADING = /^##[ \t]+v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?)(?![0-9A-Za-z.+-])/gm;
const PRERELEASE = /^\d+\.\d+\.\d+[-+][0-9A-Za-z.+-]*$/;
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

/** Förklaring till en version som inte är ren X.Y.Z — förreleaser får ett eget, tydligt besked. */
const notSemver = (version) =>
  typeof version === 'string' && PRERELEASE.test(version)
    ? `version ${JSON.stringify(version)} är en förrelease — förreleaser stöds inte, använd ren X.Y.Z (t.ex. ${version.split(/[-+]/)[0]}).`
    : `version ${JSON.stringify(version)} är inte giltig semver (X.Y.Z).`;

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
  for (const version of found.filter((candidate) => !parseSemver(candidate))) {
    errors.push(`CHANGELOG.md: rubriken '## v${version}' är en förrelease — förreleaser stöds inte, använd ren X.Y.Z.`);
  }
  const headings = found.filter((candidate) => parseSemver(candidate));
  if (headings.length === 0) {
    errors.push("CHANGELOG.md: hittar ingen rubrik av formen '## vX.Y.Z'.");
    return headings;
  }
  if (headings[0] !== packageVersion) {
    errors.push(`CHANGELOG.md: översta rubriken är v${headings[0]}, men package.json har ${packageVersion}. Lägg en '## v${packageVersion}'-post överst (eller rätta versionen).`);
  }
  for (let index = 1; index < headings.length; index += 1) {
    if (compareSemver(headings[index - 1], headings[index]) <= 0) {
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
    const oldest = headings.reduce((lowest, version) => (compareSemver(version, lowest) < 0 ? version : lowest));
    for (const version of valid) {
      if (compareSemver(version, oldest) >= 0 && !headings.includes(version)) {
        errors.push(`changelog.json: version ${version} saknar rubrik '## v${version}' i CHANGELOG.md (versioner från v${oldest} och uppåt ska finnas där).`);
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
