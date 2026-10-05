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
  ])('%s → /board (ingen öppen redirect)', (search) => {
    expect(resolveNextPath(search)).toBe('/board');
  });
});
