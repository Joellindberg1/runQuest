import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// public/strava-popup.html är OAuth-retursidan: Strava skickar tillbaka koden dit och sidan lämnar den vidare till
// fönstret som öppnade den. Provet kör sidans inline-skript mot en fejkad webbläsarmiljö och ser vad det gör.
const html = readFileSync(fileURLToPath(new URL('../../../public/strava-popup.html', import.meta.url)), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

const ORIGIN = 'https://app.example.test';

function runPopup(search: string, { withOpener }: { withOpener: boolean }) {
  vi.useFakeTimers();
  const consoleCalls: unknown[][] = [];
  const spy = (...args: unknown[]) => consoleCalls.push(args);
  const fakeConsole = { log: spy, info: spy, warn: spy, error: spy, debug: spy, trace: spy, dir: spy };
  const postMessage = vi.fn();
  const close = vi.fn();
  const win = { location: { search, origin: ORIGIN }, opener: withOpener ? { postMessage } : null, close };
  const doc = { body: { innerHTML: '' } };
  new Function('window', 'document', 'console', 'URLSearchParams', 'setTimeout', script)(win, doc, fakeConsole, URLSearchParams, setTimeout);
  vi.advanceTimersByTime(1000);
  vi.useRealTimers();
  return { consoleCalls, postMessage, close, doc };
}

describe('Strava popup page', () => {
  it('does not write the OAuth code or error to the console', () => {
    const { consoleCalls } = runPopup('?code=SECRET_AUTH_CODE_123&error=access_denied', { withOpener: true });
    expect(JSON.stringify(consoleCalls)).not.toContain('SECRET_AUTH_CODE_123');
    expect(JSON.stringify(consoleCalls)).not.toContain('access_denied');
    expect(consoleCalls).toEqual([]);
  });

  it('hands the code to the opener on the same origin and closes itself', () => {
    const { postMessage, close } = runPopup('?code=abc123', { withOpener: true });
    expect(postMessage).toHaveBeenCalledWith({ stravaConnected: true, code: 'abc123', error: null }, ORIGIN);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports a denied connection to the opener without a code', () => {
    const { postMessage } = runPopup('?error=access_denied', { withOpener: true });
    expect(postMessage).toHaveBeenCalledWith({ stravaConnected: false, code: null, error: 'access_denied' }, ORIGIN);
  });

  it('tells a window without an opener that it can be closed', () => {
    const { doc, close } = runPopup('?code=abc123', { withOpener: false });
    expect(doc.body.innerHTML).toContain('Du kan stänga detta fönster');
    expect(close).not.toHaveBeenCalled();
  });
});
