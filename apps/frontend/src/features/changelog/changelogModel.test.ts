import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RQ_ICON_NAMES } from '@/shared/components/icons';
import { changelog } from './changelogData';
import {
  CHANGE_KIND, CHANGELOG_VIEWS, DEFAULT_CHANGELOG_VIEW, announcedNotes, initialOpenVersion, latestRelease, releasePanelId,
  slugForVersion, toggleOpenVersion, versionLine,
} from './changelogModel';
import type { Release } from './changelogTypes';

// Variabel (inte literal) så att Vite inte skriver om new URL(...) till en asset-adress.
const PACKAGE_JSON = '../../../package.json';
const compare = (a: string, b: string) => {
  const [pa, pb] = [a, b].map((v) => v.split('.').map(Number));
  const index = pa.findIndex((n, i) => n !== pb[i]);
  return index === -1 ? 0 : pa[index] - pb[index];
};

const release = (version: string, extra: Partial<Release> = {}): Release => ({
  version, type: 'minor', date: '5 October 2026', title: `Release ${version}`, changes: [{ type: 'feature', description: `Change in ${version}` }], ...extra,
});

describe('versionLine', () => {
  it('bygger raden ur den senaste postens version och datum (inget hårdkodat nummer)', () => {
    expect(versionLine(release('2.2.0'))).toBe('Version 2.2.0 · released 5 October 2026');
    expect(versionLine(release('2.3.0', { date: '2 April 2027' }))).toBe('Version 2.3.0 · released 2 April 2027');
  });

  it('är tom utan poster i stället för att kasta', () => {
    expect(versionLine(latestRelease([]))).toBe('');
  });
});

describe('öppna releaser', () => {
  it('den senaste börjar öppen, ingen om listan är tom', () => {
    expect(initialOpenVersion([release('2.1.0'), release('2.0.0')])).toBe('2.1.0');
    expect(initialOpenVersion([])).toBeNull();
  });

  it('ett klick på den öppna stänger den, ett klick på en annan byter (en öppen åt gången, som prototypen)', () => {
    expect(toggleOpenVersion('2.1.0', '2.1.0')).toBeNull();
    expect(toggleOpenVersion('2.1.0', '2.0.0')).toBe('2.0.0');
    expect(toggleOpenVersion(null, '2.0.0')).toBe('2.0.0');
  });

  it('panel-id:t saknar punkter', () => {
    expect(releasePanelId('2.10.3')).toBe('fx-release-2-10-3');
  });
});

describe('annonserade poster (popupen)', () => {
  it('är bara poster med announce: true, nyaste först, med slug ur versionen', () => {
    const notes = announcedNotes([release('2.2.0'), release('2.1.0', { announce: true }), release('2.0.0', { announce: true })]);
    expect(notes.map((note) => note.slug)).toEqual(['patch_v2.1.0', 'patch_v2.0.0']);
    expect(notes[0]).toEqual({ slug: 'patch_v2.1.0', version: '2.1.0', title: 'Release 2.1.0', changes: [{ type: 'feature', description: 'Change in 2.1.0' }] });
  });

  it('slugen är stabil och härleds ur versionen', () => {
    expect(slugForVersion('2.0.0')).toBe('patch_v2.0.0');
  });
});

describe('den riktiga changelog.json', () => {
  it('har poster, nyaste först (strikt fallande) och den översta är inte nyare än package.json', () => {
    const versions = changelog.releases.map((entry) => entry.version);
    expect(versions.length).toBeGreaterThan(0);
    expect(latestRelease(changelog.releases)?.version).toBe(versions[0]);
    for (let index = 1; index < versions.length; index += 1) expect({ older: versions[index], newer: versions[index - 1], ok: compare(versions[index - 1], versions[index]) > 0 }).toEqual({ older: versions[index], newer: versions[index - 1], ok: true });
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL(PACKAGE_JSON, import.meta.url)), 'utf8')) as { version: string };
    expect(compare(versions[0], pkg.version)).toBeLessThanOrEqual(0);
  });

  it('versionerna är unika, så slugarna är det också', () => {
    const slugs = changelog.releases.map((entry) => slugForVersion(entry.version));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('varje annonserad post har 1–7 punkter att visa (popupen ska vara kort)', () => {
    for (const note of announcedNotes(changelog.releases)) {
      expect({ slug: note.slug, ok: note.changes.length >= 1 && note.changes.length <= 7 }).toEqual({ slug: note.slug, ok: true });
    }
  });

  it('varje ikonnamn i features och workingOn finns i ikonsetet (okänt namn faller annars tyst tillbaka på pokalen)', () => {
    for (const entry of [...changelog.features, ...changelog.workingOn]) {
      expect({ title: entry.title, known: RQ_ICON_NAMES.includes(entry.icon) }).toEqual({ title: entry.title, known: true });
    }
  });

  it('varje ändringstyp har en ikon och ett namn', () => {
    for (const entry of changelog.releases) for (const change of entry.changes) expect(CHANGE_KIND[change.type]).toBeDefined();
  });

  it('innehåller inga tekniska termer som gruppen inte har nytta av (docs/dokumentation.md: enkel engelska)', () => {
    const text = JSON.stringify(changelog.releases.filter((entry) => compare(entry.version, '0.5.0') >= 0)); // äldre poster (v0.1–0.4) är skrivna före riktlinjerna
    expect(text).not.toMatch(/\b(migration|endpoint|backend|refactor)\b/i);
    expect(text).not.toMatch(/\b(API|Caddy|CI)\b/); // skiftlägeskänsligt: "capital"/"rapid" är inte tekniska termer
  });
});

describe('changelog: v0.6.0', () => {
  const v060 = changelog.releases.find((entry) => entry.version === '0.6.0');

  it('changelog: v0.6.0 listar badges som levererat', () => {
    expect(v060).toBeDefined();
    expect(v060?.type).toBe('minor');
    expect(v060?.announce).toBe(true);
    expect(v060?.changes.some((change) => change.type === 'feature' && /badges/i.test(change.description))).toBe(true);
    // Levererat = ett kort under Features, inte längre under Working on.
    expect(changelog.features.map((feature) => feature.title)).toContain('Badges');
    expect(changelog.workingOn.map((item) => item.title)).not.toContain('Badges');
  });

  it('titeltrösklarna i texten är de motorerna använder (läses ur motorfilerna: 12 m/s, 5 °C, december–februari)', () => {
    // Motorfilerna läses som text (som playbookFacts) — frontend importerar ingen backendkod.
    const engine = (file: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../backend/src/titleEngines', file), 'utf8');
    const storm = Number(/STORM_GUST_MS\s*=\s*(\d+)/.exec(engine('stormRunCount.ts'))?.[1]);
    const ice = Number(/ICE_TEMP_C\s*=\s*(\d+)/.exec(engine('coldRunCount.ts'))?.[1]);
    expect({ storm: Number.isFinite(storm), ice: Number.isFinite(ice) }).toEqual({ storm: true, ice: true });
    // winterWindow: från 1 december till 1 mars (exklusiv) = december–februari.
    const utils = engine('_utils.ts');
    expect(utils).toContain('-12-01');
    expect(utils).toContain('-03-01');

    const text = v060?.changes.map((change) => change.description).join(' ') ?? '';
    expect(text).toMatch(new RegExp(`Stormborn[^.]*${storm} m/s`));
    expect(text).toMatch(new RegExp(`Iceborn[^.]*${ice} °C`));
    expect(text).toMatch(/Winter Warrior[^.]*December to February/);
  });

  it('badge-, login- och vimpelpunkterna nämner knappar och ställen som finns kvar i koden (texten driftar inte från UI:t)', () => {
    const source = (file: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..', file), 'utf8');
    const text = v060?.changes.map((change) => change.description).join(' ') ?? '';
    const claims: Array<[RegExp, string, string]> = [
      [/SAVE DISPLAY/, 'features/badges/components/BadgeDisplayStrip.tsx', 'SAVE DISPLAY'],
      [/tap Show on a badge/, 'features/badges/components/BadgeSeriesCard.tsx', "'Show'"],
      [/All badges →/, 'features/badges/components/BadgeSummary.tsx', 'All badges'],
      [/on a wide screen open Badges in the side menu; on your phone tap All badges → on your Profile/, 'app-shell/SideNav.tsx', "label: 'Badges'"],
      [/Log out takes you back to the start page/, 'app-shell/AvatarMenu.tsx', 'paths.landing'],
      [/Signing in now opens as a popup over the start page/, 'pages/Index.tsx', '<LoginDialog'],
      [/pennants instead of shields, on the Board and in Duels/, 'features/leaderboard/components/BoardParts.tsx', 'PENNANT_PATH'],
      [/pennants instead of shields, on the Board and in Duels/, 'features/challenges/components/TierRibbon.tsx', 'PENNANT_PATH'],
      [/next to Head to head/, 'features/runner/components/RunnerCard.tsx', 'HeadToHeadPanel'],
    ];
    for (const [claim, file, evidence] of claims) {
      expect({ claim: claim.source, written: claim.test(text), file, found: source(file).includes(evidence) }).toEqual({ claim: claim.source, written: true, file, found: true });
    }
    expect(text).not.toMatch(/picker|collection on Profile/i); // väljaren och profilsamlingen finns inte längre
  });

  it('innehåller inga interna ticketnummer i texterna gruppen ser', () => {
    expect(JSON.stringify(changelog)).not.toMatch(/\bRUN-\d+/);
  });
});

describe('announcedNotes', () => {
  // Popupen och Features-kortet kommer med frontend-deployen, men Stravas prenumeration skapas först efter den. Därför har posten ingen announce
  // (guarden kräver true eller utelämnat, så nyckeln utelämnas) tills webhooks är verifierade. RUN-265 sätter announce: true och vänder det
  // här testet tillbaka till originalnamnet 'v0.7.0-posten med announce är med och slugen är unik' (posten ska då finnas i announcedNotes, en gång).
  it('v0.7.0-posten finns men annonseras inte förrän webhooks är verifierade', () => {
    const posts = changelog.releases.filter((entry) => entry.version === '0.7.0');
    expect(posts).toHaveLength(1);
    expect(Boolean(posts[0].announce)).toBe(false);
    expect(announcedNotes(changelog.releases).map((note) => note.slug)).not.toContain(slugForVersion('0.7.0'));
  });
});

describe('changelog: v0.7.0', () => {
  const v070 = changelog.releases.find((entry) => entry.version === '0.7.0');
  const text = v070?.changes.map((change) => change.description).join(' ') ?? '';

  it('är en minor-post som pekar på Settings → Notifications för den som inte besöker Pack News', () => {
    expect(v070?.type).toBe('minor');
    expect(text).toContain('Settings → Notifications');
  });

  it('beskriver läs-gesten (hovra, tryck, Enter eller Space) och att fokus inte räknas, samt Involves me och Ranks', () => {
    expect(text).toMatch(/mouse over a row, tap it, or press Enter or Space/);
    expect(text).toMatch(/Tabbing onto a row does not count/);
    expect(text).toContain('Involves me');
    expect(text).toContain('Ranks');
  });

  it('Notifications är levererat: ett kort under Features och inte längre under Working on', () => {
    expect(changelog.features.map((feature) => feature.title)).toContain('Notifications');
    expect(changelog.workingOn.map((item) => item.title)).not.toContain('Notifications');
  });

  it('Working on har ägarens två kort, och inget annat', () => {
    expect(changelog.workingOn.map((item) => item.title)).toEqual(['Seasons and trophies', 'Group settings']);
  });

  it('Strava-texten är ärlig: reservkontroll minst var 12:e timme, 48 timmar för ändringar och raderingar, och att Disconnect raderar och inte går att ångra', () => {
    expect(text).toContain('checks Strava for new runs at least every 12 hours');
    expect(text).toContain('runs you delete or make private on Strava are still removed here');
    expect(text).toContain('within 48 hours');
    expect(text).toContain('Pause sync');
    expect(text).toMatch(/Disconnect asks Strava to revoke RunQuest's access and deletes the runs imported from Strava, and it cannot be undone/);
  });

  it('inget Strava-påstående lovar att runda kommer direkt', () => {
    const stravaTexts = [
      text,
      ...changelog.features.filter((feature) => feature.title === 'Strava').map((feature) => feature.body),
    ].join(' ');
    expect(stravaTexts).not.toMatch(/instant|within minutes|right away|immediately|real[- ]time/i);
  });

  it('Strava-kortet under Features lovar inga webhooks förrän webhooks är verifierade', () => {
    const strava = changelog.features.find((feature) => feature.title === 'Strava');
    expect(strava?.body).toBe('Your runs are imported automatically');
  });
});

describe('flikarna', () => {
  it('Features är standard, i prototypens ordning', () => {
    expect([...CHANGELOG_VIEWS]).toEqual(['features', 'working', 'releases']);
    expect(DEFAULT_CHANGELOG_VIEW).toBe('features');
  });
});
