import { describe, expect, it } from 'vitest';
import { signedInTarget } from './signedInTarget';

// Dit en inloggad besökare skickas från lean landningen. Samma adresser som fullappens Index ger (resolveLegacyRedirect på `/`, resolveNextPath på
// `/login`), med ett tillägg: aldrig landningen själv, annars laddar överlämningen om samma sida i en loop.
describe('signedInTarget', () => {
  it.each([
    ['/ without parameters', false, '', '/board'],
    ['/?tab=titles', false, '?tab=titles', '/titles'],
    ['/?tab=titles keeps the other parameters', false, '?tab=titles&utm_source=x', '/titles?utm_source=x'],
    ['/?tab=unknown', false, '?tab=unknown', '/board'],
    ['/?utm_source=x keeps the parameters', false, '?utm_source=x', '/board?utm_source=x'],
    ['/login without next', true, '', '/board'],
    ['/login?next= keeps path and search', true, '?next=%2Fduels%3Fsend%3D1', '/duels?send=1'],
    ['/login?next= pointing at another origin', true, '?next=%2F%2Fevil.example', '/board'],
    ['/login?next= pointing at /login', true, '?next=%2Flogin', '/board'],
    ['/login?next=/ would reload the landing', true, '?next=%2F', '/board'],
    ['/login?next=/?utm=x would reload the landing', true, '?next=%2F%3Futm%3Dx', '/board'],
    ['/login?next=/#section would reload the landing', true, '?next=%2F%23section', '/board'],
    ['/login?next=/landing is the landing file', true, '?next=%2Flanding', '/board'],
    ['/login?next=/landing.html is the landing file', true, '?next=%2Flanding.html', '/board'],
    ['/login?next=/landing.html?utm=x keeps nothing of it', true, '?next=%2Flanding.html%3Futm%3Dx', '/board'],
    ['/login?next=/Landing.HTML#top, any case', true, '?next=%2FLanding.HTML%23top', '/board'],
    ['/login?next=/landing/ with a trailing slash', true, '?next=%2Flanding%2F', '/board'],
    ['/login?next=// is not an address to leave for', true, '?next=%2F%2F', '/board'],
    ['/login?next=///x is not an address to leave for', true, '?next=%2F%2F%2Fx', '/board'],
    ['/login?next=/%2f is left as it is (the app shows its not-found page)', true, '?next=%2F%252f', '/%2f'],
    ['/login?next=/./ would reload the landing', true, '?next=%2F.%2F', '/board'],
  ])('%s', (_name, loginOpen, search, expected) => {
    expect(signedInTarget(loginOpen, search)).toBe(expected);
  });
});
