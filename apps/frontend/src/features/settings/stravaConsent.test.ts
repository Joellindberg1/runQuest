import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { STRAVA_CONSENT_STORAGE_KEY, rememberStravaConsent, takeStravaConsent } from './stravaConsent';

// Samtycket ges före OAuth-omdirigeringen och används efter den: sessionStorage bär versionen mellan de två stegen.
// Modulen körs i node-projektet, så lagringen är en liten fejk (eller en som kastar, när webbläsaren blockerar den).

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('sessionStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('stravaConsent', () => {
  it('remembers the approved version and hands it back exactly once', () => {
    rememberStravaConsent();

    expect(storage.getItem(STRAVA_CONSENT_STORAGE_KEY)).toBe(STRAVA_CONSENT_VERSION);
    expect(takeStravaConsent()).toBe(STRAVA_CONSENT_VERSION);
    expect(storage.getItem(STRAVA_CONSENT_STORAGE_KEY)).toBeNull();
    expect(takeStravaConsent()).toBeUndefined();
  });

  it('returns nothing when no consent was remembered', () => {
    expect(takeStravaConsent()).toBeUndefined();
  });

  it('returns nothing when the stored value is empty', () => {
    storage.setItem(STRAVA_CONSENT_STORAGE_KEY, '');
    expect(takeStravaConsent()).toBeUndefined();
  });

  it('survives blocked storage: remembering does not throw and nothing is handed back', () => {
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });

    expect(() => rememberStravaConsent()).not.toThrow();
    expect(takeStravaConsent()).toBeUndefined();
  });
});
