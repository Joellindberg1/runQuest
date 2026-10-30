import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';
import { TOKEN } from './backendApi.calls.fixture';
import { SESSION_TOKEN_KEY } from './sessionStorageKeys';

// Skicket av en utmaning (POST /challenges/send) har en tidsgräns: utan den fastnar send-arket låst för gott när ett svar aldrig kommer.

/** En fetch som aldrig svarar, men som som i webbläsaren avbryts av sin signal. */
const silentFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }),
  );

let fetchMock: ReturnType<typeof silentFetch>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem(SESSION_TOKEN_KEY, TOKEN);
  fetchMock = silentFetch();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('a send that never gets an answer', () => {
  it('ends in a failure instead of hanging', async () => {
    let result: unknown;
    void backendApi.sendChallenge('token-1', 'user-2').then((settled) => { result = settled; });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toMatchObject({ success: false });
  });
});
