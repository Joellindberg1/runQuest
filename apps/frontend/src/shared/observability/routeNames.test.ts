import { describe, expect, it } from 'vitest';
import { paths } from '@/paths';
import { UNKNOWN_ROUTE, isShellPath, routeNameOf } from './routeNames';

// Sidor utanför det inloggade skalet. Allt annat i `paths` är en skalsida och måste få ett routenamn.
const OUTSIDE_THE_SHELL: readonly string[] = [paths.landing, paths.login, paths.legal, paths.previewBoard, paths.previewDuels, paths.previewBadges, paths.legacyChallenges];

describe('routeNameOf', () => {
  it('names every logged-in page by its own path', () => {
    const strings = Object.values(paths).filter((value) => typeof value === 'string') as string[];
    const shellPages = strings.filter((value) => !OUTSIDE_THE_SHELL.includes(value) && value !== paths.runnerPattern);
    expect(shellPages.length).toBeGreaterThan(8);
    for (const page of shellPages) expect(routeNameOf(page)).toBe(page);
    expect(routeNameOf(paths.board)).toBe('/board');
  });

  it('names a runner page by its route, never by the id', () => {
    expect(routeNameOf('/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14')).toBe(paths.runnerPattern);
    expect(routeNameOf(paths.runner('Anna Andersson'))).toBe('/runner/:id');
    expect(routeNameOf('/runner/42/')).toBe('/runner/:id');
  });

  it('leaves out the query string, the fragment and a trailing slash', () => {
    expect(routeNameOf('/board?week=2026-10-12#top')).toBe('/board');
    expect(routeNameOf('/board/')).toBe('/board');
    expect(routeNameOf('/runner/abc?from=board')).toBe('/runner/:id');
  });

  it('names an address the way the router matches it, whatever its case, so fewer pages fall under the unknown name and none gets an id', () => {
    expect(routeNameOf('/Board')).toBe('/board');
    expect(routeNameOf('/RUNNER/abc')).toBe('/runner/:id');
    expect(routeNameOf('/board//')).toBe('/board');
    expect(routeNameOf('/RUNNER/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14/extra')).toBe(UNKNOWN_ROUTE);
  });

  it('gives one fixed name to anything it does not know, so a path can never leak into a name', () => {
    expect(routeNameOf('/something/else/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14')).toBe(UNKNOWN_ROUTE);
    expect(routeNameOf('/board/extra')).toBe(UNKNOWN_ROUTE);
    expect(routeNameOf('/runner/a/b')).toBe(UNKNOWN_ROUTE);
    expect(routeNameOf('/runner/')).toBe(UNKNOWN_ROUTE);
    expect(routeNameOf('')).toBe(UNKNOWN_ROUTE);
  });
});

describe('isShellPath', () => {
  it('is true for the logged-in pages and false for the landing, login, legal and preview pages', () => {
    expect(isShellPath('/board')).toBe(true);
    expect(isShellPath('/runner/abc')).toBe(true);
    for (const page of OUTSIDE_THE_SHELL) expect(isShellPath(page)).toBe(false);
    expect(isShellPath('/nowhere')).toBe(false);
  });
});
