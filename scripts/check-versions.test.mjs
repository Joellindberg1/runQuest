// Test av versionsvaktens logik (ren funktion) + en rökprov mot de riktiga filerna i repot.
// Körs med `node --test scripts/` (CI: frontend-jobbet).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkVersions, compareSemver, isEntryPoint, parseSemver, releaseTypeOf } from './check-versions.mjs';

const release = (version, extra = {}) => ({
  version,
  type: releaseTypeOf(version),
  date: '5 October 2026',
  title: `Release ${version}`,
  changes: [{ type: 'feature', description: 'Something users notice.' }],
  ...extra,
});

const good = () => ({
  rootVersion: '2.2.0',
  frontendVersion: '2.2.0',
  // CRLF som i den riktiga filen
  changelogMd: '# Changelog\r\n\r\n## v2.2.0 — Nytt (2026-10-05)\r\n\r\n## v2.1.0 — Äldre (2026-10-04)\r\n',
  changelog: {
    features: [{ title: 'Board', body: 'Ranking', icon: 'trophy' }],
    workingOn: [{ title: 'Badges', body: 'Soon', icon: 'trophy', details: ['One'] }],
    releases: [release('2.2.0'), release('2.1.0', { announce: true }), release('0.4.0')],
  },
});

const errorsFor = (change) => {
  const input = good();
  change(input);
  return checkVersions(input);
};
const only = (errors, pattern) => errors.filter((error) => pattern.test(error));

describe('semver-hjälpare', () => {
  it('parseSemver tar bara X.Y.Z utan inledande nollor', () => {
    assert.deepEqual(parseSemver('2.10.3'), [2, 10, 3]);
    for (const bad of ['2.1', 'v2.1.0', '2.1.0-rc.1', '02.1.0', '', undefined, 3]) assert.equal(parseSemver(bad), null, String(bad));
  });

  it('compareSemver jämför numeriskt, inte som text', () => {
    assert.ok(compareSemver('2.10.0', '2.9.0') > 0);
    assert.ok(compareSemver('0.4.2', '0.4.10') < 0);
    assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  });

  it('releaseTypeOf följer versionens eget nummer', () => {
    assert.deepEqual(['2.0.0', '2.1.0', '2.1.1', '0.1.0', '0.4.2'].map(releaseTypeOf), ['major', 'minor', 'patch', 'minor', 'patch']);
  });
});

describe('checkVersions', () => {
  it('godkänner en konsekvent uppsättning (och CRLF i CHANGELOG.md)', () => {
    assert.deepEqual(checkVersions(good()), []);
  });

  it('fäller när rotens och frontendens version skiljer sig', () => {
    const errors = errorsFor((input) => { input.frontendVersion = '2.1.0'; });
    assert.equal(only(errors, /Versionerna skiljer sig.*2\.2\.0.*2\.1\.0/).length, 1);
  });

  it('fäller när översta rubriken i CHANGELOG.md inte är package-versionen', () => {
    const errors = errorsFor((input) => { input.changelogMd = '## v2.1.0 — Äldre\n'; });
    assert.equal(only(errors, /översta rubriken är v2\.1\.0.*package\.json har 2\.2\.0/).length, 1);
  });

  it('fäller när CHANGELOG.md saknar rubriker eller har dem i fel ordning', () => {
    assert.equal(only(errorsFor((input) => { input.changelogMd = '# Changelog\n'; }), /hittar ingen rubrik/).length, 1);
    const wrongOrder = errorsFor((input) => { input.changelogMd = '## v2.2.0\n## v2.0.0\n## v2.1.0\n'; });
    assert.equal(only(wrongOrder, /strikt fallande.*v2\.1\.0 står efter v2\.0\.0/).length, 1);
  });

  it('förreleaser stöds inte: tydligt besked i package.json, changelog.json och CHANGELOG.md, och rubriken läses inte som 2.3.0', () => {
    const pkg = errorsFor((input) => { input.rootVersion = '2.3.0-rc.1'; });
    assert.equal(only(pkg, /package\.json: version "2\.3\.0-rc\.1" är en förrelease — förreleaser stöds inte/).length, 1);
    assert.equal(only(pkg, /inte giltig semver/).length, 0);

    const json = errorsFor((input) => { input.changelog.releases[0].version = '2.2.0-beta.2'; });
    assert.equal(only(json, /releases\[0\]: version "2\.2\.0-beta\.2" är en förrelease/).length, 1);

    const md = errorsFor((input) => { input.changelogMd = '## v2.3.0-rc.1 — Kandidat\n\n## v2.2.0 — Nytt\n\n## v2.1.0 — Äldre\n'; });
    assert.equal(only(md, /rubriken '## v2\.3\.0-rc\.1' är en förrelease/).length, 1);
    // 2.2.0 är fortfarande översta riktiga rubriken — rc-rubriken räknas inte som 2.3.0
    assert.equal(only(md, /översta rubriken/).length, 0);
  });

  it('rubriker inuti kodstaket i CHANGELOG.md är inte releaser', () => {
    const markdown = '# Changelog\n\n```md\n## v9.9.9 — exempel\n```\n\n## v2.2.0 — Nytt\n\n~~~\n## v0.0.1\n~~~\n\n## v2.1.0 — Äldre\n';
    assert.deepEqual(errorsFor((input) => { input.changelogMd = markdown; }), []);
    // och ett olåst staket stjäl inte resten av filen tyst: rubriken före staketet räknas
    const top = errorsFor((input) => { input.changelogMd = '```\n## v2.2.0\n```\n## v2.1.0\n'; });
    assert.equal(only(top, /översta rubriken är v2\.1\.0/).length, 1);
  });

  it('fäller ogiltig semver i package.json och i changelog.json', () => {
    assert.equal(only(errorsFor((input) => { input.rootVersion = '2.2'; }), /package\.json: version "2\.2" är inte giltig semver/).length, 1);
    const errors = errorsFor((input) => { input.changelog.releases[2].version = '0.4'; });
    assert.equal(only(errors, /releases\[2\]: version "0\.4" är inte giltig semver/).length, 1);
  });

  it('fäller changelog.json som inte är strikt fallande (ordning och dubletter)', () => {
    const unordered = errorsFor((input) => { input.changelog.releases.reverse(); });
    assert.ok(only(unordered, /strikt fallande — 2\.1\.0 står efter 0\.4\.0/).length >= 1);
    const duplicate = errorsFor((input) => { input.changelog.releases.splice(1, 0, release('2.2.0')); });
    assert.equal(only(duplicate, /2\.2\.0 förekommer två gånger/).length, 1);
  });

  it('fäller när changelog.json är nyare än package.json', () => {
    const errors = errorsFor((input) => {
      input.changelog.releases.unshift(release('2.3.0'));
    });
    assert.equal(only(errors, /översta versionen 2\.3\.0 är nyare än package\.json \(2\.2\.0\)/).length, 1);
    assert.equal(only(errors, /2\.3\.0 saknar rubrik/).length, 1);
  });

  it('kräver rubrik i CHANGELOG.md för versioner inom dess spann, men inte för äldre (v0.x)', () => {
    const missing = errorsFor((input) => { input.changelog.releases.splice(2, 0, release('2.1.1')); });
    assert.equal(only(missing, /2\.1\.1 saknar rubrik '## v2\.1\.1'/).length, 1);
    assert.equal(only(checkVersions(good()), /0\.4\.0/).length, 0);
  });

  it('kräver minst en ändring på poster med announce', () => {
    const errors = errorsFor((input) => { input.changelog.releases[1].changes = []; });
    assert.equal(only(errors, /2\.1\.0: posten har announce: true men inga ändringar/).length, 1);
    // utan announce är en tom lista inte vaktens sak
    assert.deepEqual(errorsFor((input) => { input.changelog.releases[0].changes = []; }), []);
  });

  it('announce är utelämnat eller true — aldrig false', () => {
    assert.equal(only(errorsFor((input) => { input.changelog.releases[0].announce = false; }), /announce är antingen utelämnat eller true/).length, 1);
  });

  it('typen måste följa versionsnumret', () => {
    const errors = errorsFor((input) => { input.changelog.releases[0].type = 'major'; });
    assert.equal(only(errors, /2\.2\.0: type är 'major', men versionsnumret ger 'minor'/).length, 1);
  });

  it('datumet ska ha formen "5 October 2026"', () => {
    for (const date of ['2026-10-05', '5 oct 2026', '05/10/2026', undefined]) {
      const errors = errorsFor((input) => { input.changelog.releases[0].date = date; });
      assert.equal(only(errors, /date ska skrivas som '5 October 2026'/).length, 1, String(date));
    }
  });

  it('ändringar behöver giltig typ och text', () => {
    const errors = errorsFor((input) => { input.changelog.releases[0].changes = [{ type: 'fix', description: '' }]; });
    assert.equal(only(errors, /changes\[0\]\.type måste vara/).length, 1);
    assert.equal(only(errors, /changes\[0\]\.description saknas/).length, 1);
  });

  it('features och workingOn kontrolleras (titel, text, ikon, detaljer)', () => {
    const errors = errorsFor((input) => {
      input.changelog.features[0].icon = '';
      input.changelog.workingOn[0].details = 'one';
    });
    assert.equal(only(errors, /features\[0\]\.icon saknas/).length, 1);
    assert.equal(only(errors, /workingOn\[0\]\.details måste vara en lista/).length, 1);
  });

  it('en changelog.json utan { releases } ger ett tydligt fel i stället för ett kast', () => {
    const errors = errorsFor((input) => { input.changelog = []; });
    assert.equal(only(errors, /toppnivån ska vara \{ features, workingOn, releases \}/).length, 1);
  });
});

describe('isEntryPoint', () => {
  const self = fileURLToPath(import.meta.url);
  const script = join(dirname(self), 'check-versions.mjs');

  it('känner igen skriptet som entry oavsett hur sökvägen skrivs (relativ, andra snedstreck, annat skiftläge på Windows)', () => {
    const url = pathToFileURL(script).href;
    assert.equal(isEntryPoint(script, url), true);
    assert.equal(isEntryPoint(join(dirname(script), '..', 'scripts', 'check-versions.mjs'), url), true);
    if (process.platform === 'win32') assert.equal(isEntryPoint(script.toUpperCase(), url), true);
  });

  it('är falskt när något annat körs (testet importerar skriptet) eller inget argument finns', () => {
    assert.equal(isEntryPoint(self, pathToFileURL(script).href), false);
    assert.equal(isEntryPoint(undefined, pathToFileURL(script).href), false);
  });
});

describe('CLI mot de riktiga filerna', () => {
  it('repots versioner stämmer (samma kontroll som CI)', () => {
    const script = join(dirname(fileURLToPath(import.meta.url)), 'check-versions.mjs');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    assert.match(output, /Versionerna stämmer: v\d+\.\d+\.\d+/);
  });
});
