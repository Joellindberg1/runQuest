import { describe, expect, it } from 'vitest';
import { RQ_ICON_NAMES } from '@/shared/components/icons';
import { changelog } from './changelogData';
import {
  CHANGE_KIND, CHANGELOG_VIEWS, DEFAULT_CHANGELOG_VIEW, announcedNotes, initialOpenVersion, latestRelease, releasePanelId,
  slugForVersion, toggleOpenVersion, versionLine,
} from './changelogModel';
import type { Release } from './changelogTypes';

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
  it('har poster, nyaste först, och 2.2.0 överst', () => {
    expect(latestRelease(changelog.releases)?.version).toBe('2.2.0');
  });

  it('versionerna är unika, så slugarna är det också', () => {
    const slugs = changelog.releases.map((entry) => slugForVersion(entry.version));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('endast 2.0.0 annonseras (en popup, inte flera) och den har punkter att visa', () => {
    const notes = announcedNotes(changelog.releases);
    expect(notes.map((note) => note.slug)).toEqual(['patch_v2.0.0']);
    expect(notes[0].changes.length).toBeGreaterThanOrEqual(5);
    expect(notes[0].changes.length).toBeLessThanOrEqual(7);
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
    const text = JSON.stringify(changelog.releases.filter((entry) => entry.version.startsWith('2.')));
    expect(text).not.toMatch(/migration|endpoint|backend|API|Caddy|CI\b|refactor/i);
  });
});

describe('flikarna', () => {
  it('Features är standard, i prototypens ordning', () => {
    expect([...CHANGELOG_VIEWS]).toEqual(['features', 'working', 'releases']);
    expect(DEFAULT_CHANGELOG_VIEW).toBe('features');
  });
});
