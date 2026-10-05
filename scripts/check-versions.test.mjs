// Test av versionsvaktens logik (ren funktion) + en rökprov mot de riktiga filerna i repot.
// Körs med `node --test scripts/` (CI: frontend-jobbet).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkVersions, compareHeadings, compareSemver, isEntryPoint, parseHeadingVersion, parseSemver, releaseTypeOf } from './check-versions.mjs';

const release = (version, extra = {}) => ({
  version,
  type: releaseTypeOf(version),
  date: '5 October 2026',
  title: `Release ${version}`,
  changes: [{ type: 'feature', description: 'Something users notice.' }],
  ...extra,
});

const good = () => ({
  rootVersion: '0.5.2',
  frontendVersion: '0.5.2',
  // CRLF som i den riktiga filen
  changelogMd: '# Changelog\r\n\r\n## v0.5.2 — Nytt (2026-10-05)\r\n\r\n## v0.5.1 — Äldre (2026-10-04)\r\n\r\n## v0.5.0 — Äldst (2026-10-03)\r\n',
  changelog: {
    features: [{ title: 'Board', body: 'Ranking', icon: 'trophy' }],
    workingOn: [{ title: 'Badges', body: 'Soon', icon: 'trophy', details: ['One'] }],
    releases: [release('0.5.2'), release('0.5.1', { announce: true }), release('0.4.0')],
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
    for (const bad of ['2.1', 'v0.5.1', '0.5.1-rc.1', '00.5.1', '', undefined, 3]) assert.equal(parseSemver(bad), null, String(bad));
  });

  it('compareSemver jämför numeriskt, inte som text', () => {
    assert.ok(compareSemver('2.10.0', '2.9.0') > 0);
    assert.ok(compareSemver('0.4.2', '0.4.10') < 0);
    assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  });

  it('parseHeadingVersion: tre delar eller fyra med N >= 1, annars null', () => {
    assert.deepEqual(parseHeadingVersion('0.5.1'), { base: '0.5.1', n: 0 });
    assert.deepEqual(parseHeadingVersion('0.5.1.12'), { base: '0.5.1', n: 12 });
    for (const bad of ['0.5.1.0', '0.5.1.2.3', '0.5.1.01', '0.5', '0.5.1-rc.1', '', undefined]) assert.equal(parseHeadingVersion(bad), null, String(bad));
  });

  it('compareHeadings: basen först, sedan den interna räknaren (v0.5.0.1 är nyare än v0.5.0 men äldre än v0.5.1)', () => {
    assert.ok(compareHeadings('0.5.0.1', '0.5.0') > 0);
    assert.ok(compareHeadings('0.5.0.4', '0.5.0.10') < 0);
    assert.ok(compareHeadings('0.5.0.9', '0.5.1') < 0);
    assert.equal(compareHeadings('0.5.1.2', '0.5.1.2'), 0);
  });

  it('releaseTypeOf följer versionens eget nummer', () => {
    assert.deepEqual(['1.0.0', '0.5.0', '0.5.1', '0.1.0', '0.4.2'].map(releaseTypeOf), ['major', 'minor', 'patch', 'minor', 'patch']);
  });
});

describe('checkVersions', () => {
  it('godkänner en konsekvent uppsättning (och CRLF i CHANGELOG.md)', () => {
    assert.deepEqual(checkVersions(good()), []);
  });

  it('fäller när rotens och frontendens version skiljer sig', () => {
    const errors = errorsFor((input) => { input.frontendVersion = '0.5.1'; });
    assert.equal(only(errors, /Versionerna skiljer sig.*0\.5\.2.*0\.5\.1/).length, 1);
  });

  it('fäller när översta rubriken i CHANGELOG.md inte är package-versionen', () => {
    const errors = errorsFor((input) => { input.changelogMd = '## v0.5.1 — Äldre\n'; });
    assert.equal(only(errors, /översta rubriken är v0\.5\.1.*\(0\.5\.1\) ska vara package\.json-versionen 0\.5\.2/).length, 1);
  });

  it('fäller när CHANGELOG.md saknar rubriker eller har dem i fel ordning', () => {
    assert.equal(only(errorsFor((input) => { input.changelogMd = '# Changelog\n'; }), /hittar ingen rubrik/).length, 1);
    const wrongOrder = errorsFor((input) => { input.changelogMd = '## v0.5.2\n## v0.5.0\n## v0.5.1\n'; });
    assert.equal(only(wrongOrder, /strikt fallande.*v0\.5\.1 står efter v0\.5\.0/).length, 1);
  });

  it('förreleaser stöds inte: tydligt besked i package.json, changelog.json och CHANGELOG.md, och rubriken läses inte som 0.5.3', () => {
    const pkg = errorsFor((input) => { input.rootVersion = '0.5.3-rc.1'; });
    assert.equal(only(pkg, /package\.json: version "0\.5\.3-rc\.1" är en förrelease — förreleaser stöds inte/).length, 1);
    assert.equal(only(pkg, /inte giltig semver/).length, 0);

    const json = errorsFor((input) => { input.changelog.releases[0].version = '0.5.2-beta.2'; });
    assert.equal(only(json, /releases\[0\]: version "0\.5\.2-beta\.2" är en förrelease/).length, 1);

    const md = errorsFor((input) => { input.changelogMd = '## v0.5.3-rc.1 — Kandidat\n\n## v0.5.2 — Nytt\n\n## v0.5.1 — Äldre\n'; });
    assert.equal(only(md, /rubriken '## v0\.5\.3-rc\.1' är en förrelease/).length, 1);
    // 0.5.2 är fortfarande översta riktiga rubriken — rc-rubriken räknas inte som 0.5.3
    assert.equal(only(md, /översta rubriken/).length, 0);
  });

  describe('interna versioner (fyra delar, bara i CHANGELOG.md)', () => {
    // CHANGELOG-toppen v0.5.1.2 betyder att package.json är 0.5.1 (de tre första delarna)
    const internal = (md, version = '0.5.1') => errorsFor((input) => {
      input.rootVersion = version;
      input.frontendVersion = version;
      input.changelogMd = md;
      input.changelog.releases = [release('0.5.1', { announce: true }), release('0.5.0'), release('0.4.0')];
    });

    it('godkänns: package.json = de tre första delarna av översta rubriken, och en fyrdelad sorteras efter sin bas', () => {
      assert.deepEqual(internal('## v0.5.1.2\n\n## v0.5.1.1\n\n## v0.5.1\n\n## v0.5.0.4\n\n## v0.5.0.1\n\n## v0.5.0\n'), []);
      assert.deepEqual(internal('## v0.5.1\n\n## v0.5.0.1\n\n## v0.5.0\n'), []);
    });

    it('fäller när de tre första delarna av översta rubriken inte är package-versionen', () => {
      const errors = internal('## v0.5.2.1\n\n## v0.5.1\n\n## v0.5.0\n');
      assert.equal(only(errors, /översta rubriken är v0\.5\.2\.1, vars tre första delar \(0\.5\.2\) ska vara package\.json-versionen 0\.5\.1/).length, 1);
    });

    it('fäller fel ordning: en fyrdelad hör ovanför sin tredelade bas, aldrig under', () => {
      const errors = internal('## v0.5.1\n\n## v0.5.1.1\n\n## v0.5.0\n');
      assert.equal(only(errors, /strikt fallande, men v0\.5\.1\.1 står efter v0\.5\.1\./).length, 1);
      assert.equal(only(internal('## v0.5.1\n\n## v0.5.0\n\n## v0.5.0.1\n'), /v0\.5\.0\.1 står efter v0\.5\.0\./).length, 1);
      assert.equal(only(internal('## v0.5.1.1\n\n## v0.5.1.1\n\n## v0.5.1\n\n## v0.5.0\n'), /v0\.5\.1\.1 står efter v0\.5\.1\.1/).length, 1);
    });

    it('fäller fel form på rubriken: N = 0, fler än fyra delar, inledande nollor', () => {
      for (const bad of ['0.5.1.0', '0.5.1.2.3', '0.5.1.02', '0.5']) {
        const errors = internal(`## v0.5.1\n\n## v${bad}\n\n## v0.5.0\n`);
        assert.equal(only(errors, new RegExp(`'## v${bad.replace(/\./g, '\\.')}' har fel form`)).length, 1, bad);
      }
    });

    it('användarversioner är tredelade: en fyrdelad version i package.json eller changelog.json fäller med eget besked', () => {
      const pkg = errorsFor((input) => { input.rootVersion = '0.5.2.1'; });
      assert.equal(only(pkg, /package\.json: version "0\.5\.2\.1" har fyra delar — användarversioner har tre/).length, 1);
      const json = errorsFor((input) => { input.changelog.releases[0].version = '0.5.2.1'; });
      assert.equal(only(json, /releases\[0\]: version "0\.5\.2\.1" har fyra delar/).length, 1);
    });

    it('kräver tredelad rubrik för varje changelog.json-version: v0.5.1.1 ersätter inte v0.5.1', () => {
      const errors = internal('## v0.5.1.1\n\n## v0.5.0\n');
      assert.equal(only(errors, /0\.5\.1 saknar rubrik '## v0\.5\.1'/).length, 1);
    });
  });

  it('rubriker inuti kodstaket i CHANGELOG.md är inte releaser', () => {
    const markdown = '# Changelog\n\n```md\n## v9.9.9 — exempel\n```\n\n## v0.5.2 — Nytt\n\n~~~\n## v0.0.1\n~~~\n\n## v0.5.1 — Äldre\n';
    assert.deepEqual(errorsFor((input) => { input.changelogMd = markdown; }), []);
    // och ett olåst staket stjäl inte resten av filen tyst: rubriken före staketet räknas
    const top = errorsFor((input) => { input.changelogMd = '```\n## v0.5.2\n```\n## v0.5.1\n'; });
    assert.equal(only(top, /översta rubriken är v0\.5\.1/).length, 1);
  });

  it('fäller ogiltig semver i package.json och i changelog.json', () => {
    assert.equal(only(errorsFor((input) => { input.rootVersion = '2.2'; }), /package\.json: version "2\.2" är inte giltig semver/).length, 1);
    const errors = errorsFor((input) => { input.changelog.releases[2].version = '0.4'; });
    assert.equal(only(errors, /releases\[2\]: version "0\.4" är inte giltig semver/).length, 1);
  });

  it('fäller changelog.json som inte är strikt fallande (ordning och dubletter)', () => {
    const unordered = errorsFor((input) => { input.changelog.releases.reverse(); });
    assert.ok(only(unordered, /strikt fallande — 0\.5\.1 står efter 0\.4\.0/).length >= 1);
    const duplicate = errorsFor((input) => { input.changelog.releases.splice(1, 0, release('0.5.2')); });
    assert.equal(only(duplicate, /0\.5\.2 förekommer två gånger/).length, 1);
  });

  it('fäller när changelog.json är nyare än package.json', () => {
    const errors = errorsFor((input) => {
      input.changelog.releases.unshift(release('0.5.3'));
    });
    assert.equal(only(errors, /översta versionen 0\.5\.3 är nyare än package\.json \(0\.5\.2\)/).length, 1);
    assert.equal(only(errors, /0\.5\.3 saknar rubrik/).length, 1);
  });

  it('kräver rubrik i CHANGELOG.md för versioner inom dess spann, men inte för äldre (v0.x)', () => {
    const missing = errorsFor((input) => { input.changelogMd = '## v0.5.2 — Nytt\n\n## v0.5.0 — Äldre\n'; });
    assert.equal(only(missing, /0\.5\.1 saknar rubrik '## v0\.5\.1'/).length, 1);
    assert.equal(only(checkVersions(good()), /0\.4\.0/).length, 0);
  });

  it('kräver minst en ändring på poster med announce', () => {
    const errors = errorsFor((input) => { input.changelog.releases[1].changes = []; });
    assert.equal(only(errors, /0\.5\.1: posten har announce: true men inga ändringar/).length, 1);
    // utan announce är en tom lista inte vaktens sak
    assert.deepEqual(errorsFor((input) => { input.changelog.releases[0].changes = []; }), []);
  });

  it('announce är utelämnat eller true — aldrig false', () => {
    assert.equal(only(errorsFor((input) => { input.changelog.releases[0].announce = false; }), /announce är antingen utelämnat eller true/).length, 1);
  });

  it('typen måste följa versionsnumret', () => {
    const errors = errorsFor((input) => { input.changelog.releases[0].type = 'major'; });
    assert.equal(only(errors, /0\.5\.2: type är 'major', men versionsnumret ger 'patch'/).length, 1);
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
