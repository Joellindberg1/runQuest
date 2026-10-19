import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLegacyRedirect, TAB_TARGETS } from '@/app-shell/legacyRedirects';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from '@/shared/services/sessionStorageKeys';
import { backendApi } from '@/shared/services/backendApi';
import { isLandingAddress } from './landingAddress';
import { sessionHintScript } from './sessionHint';
import { signedInTarget } from './signedInTarget';

// Sessionstipset i landing.html (ADR 006, addendum 2026-10-19, punkt 4): ett litet skript som körs före första ritning och skickar en inloggad besökare
// vidare med location.replace. Det körs här som i webbläsaren, mot en låtsas-window i en egen kontext (inget delat med testet), och målet jämförs med
// resolveLegacyRedirect och med lean routerns signedInTarget: skriptet och routern får inte glida isär.

type StorageLike = Pick<Storage, 'getItem'>;

const SIGNED_IN = { [SESSION_TOKEN_KEY]: 'fake-token', [SESSION_USER_KEY]: '{"id":"u1"}' };
const storageOf = (entries: Record<string, string>): StorageLike => ({ getItem: (key) => entries[key] ?? null });

interface Visit {
  /** Adresserna som skriptet skickade besökaren till med location.replace, i ordning. */
  replaced: string[];
  /** Det skriptet kastade ut ur sig; ska aldrig finnas (ett kast i head skulle synas som ett fel i konsolen för alla besökare). */
  thrown: unknown;
}

/** Kör skriptet som webbläsaren gör: globala `location` och `localStorage` i en ren kontext. `storage` är en funktion så att en blockerad lagring kan kasta vid åtkomsten. */
function visit({ storage, search = '' }: { storage: () => StorageLike; search?: string }): Visit {
  const replaced: string[] = [];
  const sandbox: Record<string, unknown> = {
    location: { search, replace: (target: string) => replaced.push(target) },
    URLSearchParams,
  };
  Object.defineProperty(sandbox, 'localStorage', { get: storage });
  let thrown: unknown;
  try {
    runInNewContext(sessionHintScript(), sandbox);
  } catch (error) {
    thrown = error;
  }
  return { replaced, thrown };
}

const SEARCHES = [
  '',
  '?',
  '?tab=leaderboard',
  '?tab=titles',
  '?tab=profile',
  '?tab=log-run',
  '?tab=unknown',
  '?tab=',
  '?tab=Titles',
  '?tab=titles&tab=profile',
  '?tab=titles&utm_source=mail',
  '?utm_source=mail&tab=profile&x=1',
  '?utm_source=mail',
  '?a=1&a=2',
  '?q=a%20b&r=%C3%A5',
  '?q=a+b',
  '?tab=constructor',
  '?tab=toString',
  '?tab=__proto__',
  '?tab=hasOwnProperty',
  '?next=%2Fduels',
  '?next=//evil.example',
  '?next=https://evil.example',
  '?redirect=//evil.example/x',
  '?tab=//evil.example',
  '?tab=%2F%2Fevil.example',
  '?tab=https://evil.example',
  '?url=javascript:alert(1)',
];

describe('the session hint in landing.html', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe('with both session keys stored', () => {
    it.each(SEARCHES)('%s: one replace, to the address resolveLegacyRedirect gives', (search) => {
      const { replaced, thrown } = visit({ storage: () => storageOf(SIGNED_IN), search });
      expect(thrown).toBeUndefined();
      expect(replaced).toEqual([resolveLegacyRedirect(search)]);
    });

    it.each(SEARCHES)('%s: the same address as the lean router hands a signed-in visitor, never a landing address, always a path on this origin', (search) => {
      const [target] = visit({ storage: () => storageOf(SIGNED_IN), search }).replaced;
      expect(target).toBe(signedInTarget(false, search));
      expect(isLandingAddress(target)).toBe(false);
      expect(target).toMatch(/^\/(?![/\\])/);
    });

    it('sends every old tab to its new route, from the table the router uses', () => {
      for (const [tab, route] of Object.entries(TAB_TARGETS)) {
        expect(visit({ storage: () => storageOf(SIGNED_IN), search: `?tab=${tab}` }).replaced).toEqual([route]);
      }
      expect(Object.keys(TAB_TARGETS).length).toBeGreaterThan(0);
    });

    it('never targets the landing file itself, whatever the tab is', () => {
      for (const route of [...Object.values(TAB_TARGETS), '/board']) expect(isLandingAddress(route), route).toBe(false);
    });
  });

  describe('without a complete session', () => {
    it.each([
      ['no keys', {}],
      ['the token only', { [SESSION_TOKEN_KEY]: 'fake-token' }],
      ['the user only', { [SESSION_USER_KEY]: '{"id":"u1"}' }],
      ['an empty token', { [SESSION_TOKEN_KEY]: '', [SESSION_USER_KEY]: '{"id":"u1"}' }],
      ['an empty user', { [SESSION_TOKEN_KEY]: 'fake-token', [SESSION_USER_KEY]: '' }],
      ['other keys only', { theme: 'dark', runquest_session: 'x' }],
    ])('does nothing with %s', (_name, entries) => {
      const { replaced, thrown } = visit({ storage: () => storageOf(entries), search: '?tab=titles' });
      expect(thrown).toBeUndefined();
      expect(replaced).toEqual([]);
    });

    it('does nothing when reaching localStorage throws (storage blocked)', () => {
      const { replaced, thrown } = visit({
        storage: () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
      expect(thrown).toBeUndefined();
      expect(replaced).toEqual([]);
    });

    it('does nothing when reading a key throws (storage disabled after access)', () => {
      const { replaced, thrown } = visit({
        storage: () => ({
          getItem: () => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          },
        }),
      });
      expect(thrown).toBeUndefined();
      expect(replaced).toEqual([]);
    });
  });

  describe('against the session backendApi stores', () => {
    it('redirects after a login and not after a logout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ token: 'fake-test-token', user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      expect(visit({ storage: () => localStorage }).replaced).toEqual([]);

      await backendApi.login('Anna', 'fake-password');
      expect(visit({ storage: () => localStorage }).replaced).toEqual(['/board']);

      backendApi.logout();
      expect(visit({ storage: () => localStorage }).replaced).toEqual([]);
    });
  });

  describe('the script text', () => {
    const script = sessionHintScript();

    it('is small, so it costs next to nothing in the head', () => {
      expect(script.length).toBeLessThan(700);
    });

    it('can sit in a script element: no closing tag, no comment opener', () => {
      expect(script).not.toMatch(/<\/script|<!--/i);
    });

    it('reads exactly the two session keys', () => {
      expect([...script.matchAll(/getItem\(("[^"]+")\)/g)].map((match) => JSON.parse(match[1]))).toEqual([SESSION_TOKEN_KEY, SESSION_USER_KEY]);
    });
  });
});
