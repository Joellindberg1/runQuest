import { describe, expect, it } from 'vitest';
import { legacyChallengesTarget, resolveLegacyRedirect } from './legacyRedirects';
import { resolveNextPath } from './safeNext';

// ADR 006 beslut 7 — tabelldrivet.
describe('resolveLegacyRedirect', () => {
  it.each([
    ['', '/board'],
    ['?tab=leaderboard', '/board'],
    ['?tab=titles', '/titles'],
    ['?tab=profile', '/profile'],
    ['?tab=log-run', '/log'],
    ['?tab=okänd', '/board'],
    ['?tab=', '/board'],
  ])('%s → %s', (search, target) => {
    expect(resolveLegacyRedirect(search)).toBe(target);
  });

  it('bevarar övriga sökparametrar men tar bort tab', () => {
    expect(resolveLegacyRedirect('?tab=titles&utm=mail')).toBe('/titles?utm=mail');
    expect(resolveLegacyRedirect('?utm=mail')).toBe('/board?utm=mail');
  });
});

describe('legacyChallengesTarget', () => {
  it('/challenges → /duels med sökparametrar intakta', () => {
    expect(legacyChallengesTarget('')).toBe('/duels');
    expect(legacyChallengesTarget('?x=1')).toBe('/duels?x=1');
  });
});

describe('resolveNextPath (efter login)', () => {
  it('godtar interna adresser', () => {
    expect(resolveNextPath('?next=%2Fduels%3Fview%3Dlive')).toBe('/duels?view=live');
  });

  it.each([
    [''],
    ['?next=https://evil.example'],
    ['?next=//evil.example'],
    ['?next=%2F%5Cevil.example'],
    ['?next=%2Flogin'],
    ['?next=duels'],
    // Kontrolltecken: webbläsaren strippar tab/LF/CR ur URL:er, så "/<tab>/evil.com" blir "//evil.com" (SecurityError i replaceState).
    ['?next=%2F%09%2Fevil.com'],
    ['?next=%2F%0A%2Fevil.com'],
    ['?next=%2F%0D%2Fevil.com'],
    ['?next=%2F%09%09%09%2Fevil.com'],
    ['?next=%2F%09%0A%0D%2Fevil.com'],
    ['?next=%2F%09%5Cevil.com'],
    ['?next=%2F%00%2Fevil.com'],
    ['?next=%2F%7F%2Fevil.com'],
    ['?next=%2Fduels%09'],
    ['?next=%2Fduels%0A'],
    ['?next=%2Fduels%0D%0Aset-cookie'],
    ['?next=%252F%2509%252Fevil.com'],
  ])('%s → /board (ingen öppen redirect)', (search) => {
    expect(resolveNextPath(search)).toBe('/board');
  });

  it('literala kontrolltecken (inte bara kodade) avvisas lika', () => {
    expect(resolveNextPath(`?next=/\t/evil.com`)).toBe('/board');
    expect(resolveNextPath(`?next=/\n/evil.com`)).toBe('/board');
    expect(resolveNextPath(`?next=/\r/evil.com`)).toBe('/board');
  });

  it('resultatet har alltid samma origin som sidan, även för udda men giltiga adresser', () => {
    for (const search of ['?next=%2Fduels%3Fview%3Dlive', '?next=%2Frunner%2Fu-1%23top', '?next=%2F%3Ftab%3Dtitles']) {
      const result = resolveNextPath(search);
      expect(new URL(result, window.location.origin).origin).toBe(window.location.origin);
      expect(result).not.toBe('/board');
    }
  });
});
