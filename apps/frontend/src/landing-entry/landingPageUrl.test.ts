import { describe, expect, it } from 'vitest';
import { landingPageUrl } from './landingPageUrl';

// Adressen som lean ingången rapporterar. Allt utom filadresserna är fullappens egen normalisering (normalizePageUrl, prövad där); här prövas bara tillägget.
describe('the address the lean landing reports', () => {
  it.each([
    ['/', '', '/'],
    ['/landing', '', '/'],
    ['/landing.html', '', '/'],
    ['/Landing.HTML', '', '/'],
    ['/landing.html/', '', '/'],
    ['/landing.html', '?utm_source=x&utm_medium=email', '/?utm_source=x&utm_medium=email'],
    ['/landing', '?utm_source=x&ref=anna', '/?utm_source=x'],
    ['/login', '?next=%2Ftitles', '/login'],
    ['/legal', '', '/legal'],
  ])('%s%s is reported as %s', (pathname, search, expected) => {
    expect(landingPageUrl(pathname, search)).toBe(expected);
  });
});
