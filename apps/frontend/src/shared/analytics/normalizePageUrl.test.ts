import { describe, expect, it } from 'vitest';
import { paths } from '@/paths';
import { NOT_FOUND_PAGE, normalizePageUrl } from './normalizePageUrl';

const UUID = '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14';
const pathStrings = Object.values(paths).filter((value) => typeof value === 'string') as string[];
const staticPaths = pathStrings.filter((value) => !value.includes(':'));
const patternPaths = pathStrings.filter((value) => value.includes(':'));

describe('normalizePageUrl', () => {
  it('sends every page with a fixed address as that address', () => {
    expect(staticPaths.length).toBeGreaterThan(14);
    for (const page of staticPaths) expect(normalizePageUrl(page, '')).toBe(page);
  });

  it('sends a page with a dynamic segment as its route pattern, never with the real id', () => {
    expect(patternPaths).toEqual(['/runner/:id']);
    expect(normalizePageUrl(`/runner/${UUID}`, '')).toBe('/runner/:id');
    expect(normalizePageUrl(paths.runner('Anna Andersson'), '')).toBe('/runner/:id');
    expect(normalizePageUrl('/runner/42/', '')).toBe('/runner/:id');
  });

  it('matches the way the router does: ignoring case and a trailing slash', () => {
    expect(normalizePageUrl('/Board/', '')).toBe('/board');
    expect(normalizePageUrl('/RUNNER/abc', '')).toBe('/runner/:id');
  });

  it('gives one fixed label to every address that is not a known page, so a path can never leak', () => {
    for (const address of [`/profile/${UUID}`, `/events/${UUID}`, `/something/else/${UUID}`, '/board/extra', '/runner/a/b', '/runner/', '/strava-popup.html', '']) {
      expect(normalizePageUrl(address, '')).toBe(NOT_FOUND_PAGE);
    }
    expect(NOT_FOUND_PAGE).not.toContain(UUID);
  });

  it('drops every query parameter on the app pages', () => {
    expect(normalizePageUrl(paths.duels, `?send=1&opponent=${UUID}`)).toBe('/duels');
    expect(normalizePageUrl(`/runner/${UUID}`, '?from=board&token=abc')).toBe('/runner/:id');
    expect(normalizePageUrl(paths.login, `?next=%2Frunner%2F${UUID}`)).toBe('/login');
    expect(normalizePageUrl(paths.legal, '?utm_source=email&utm_medium=social')).toBe('/legal');
  });

  it('keeps only allow-listed utm_ campaign values on the landing page', () => {
    expect(normalizePageUrl(paths.landing, '?utm_source=instagram&utm_medium=social&utm_term=run')).toBe('/?utm_source=instagram&utm_medium=social');
    expect(normalizePageUrl(paths.landing, `?utm_source=whatsapp&next=%2Frunner%2F${UUID}&token=abc&id=${UUID}`)).toBe('/?utm_source=whatsapp');
    expect(normalizePageUrl(paths.landing, '?fbclid=abc&ref=anna')).toBe('/');
  });

  it('drops a utm_ value that is not on the allow-list', () => {
    expect(normalizePageUrl(paths.landing, `?utm_source=${UUID}&utm_medium=social`)).toBe('/?utm_medium=social');
    expect(normalizePageUrl(paths.landing, '?utm_source=a%2Fb&utm_medium=%3Cscript%3E&utm_campaign=')).toBe('/');
  });

  it('never carries the fragment', () => {
    expect(normalizePageUrl(paths.legal, '#privacy')).toBe('/legal');
    expect(normalizePageUrl(paths.landing, '?utm_source=email#section')).toBe('/?utm_source=email');
  });
});
