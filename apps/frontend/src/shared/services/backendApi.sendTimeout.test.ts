import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi, SEND_CHALLENGE_TIMEOUT_MS } from './backendApi';
import { TOKEN, callRows } from './backendApi.calls.fixture';
import { SESSION_TOKEN_KEY } from './sessionStorageKeys';

// Skicket av en utmaning (POST /challenges/send) har en tidsgräns: utan den fastnar send-arket låst för gott när ett svar aldrig kommer.
// Det är det enda anropet med en tidsgräns; alla andra väntar som förut.

const MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * MINUTE_MS;

/** En fetch som aldrig svarar, men som i webbläsaren avbryts av sin signal. Löftets resolve sparas så att ett sent svar går att släppa fram. */
function silentFetch() {
  const answers: Array<(response: Response) => void> = [];
  const fetchMock = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        answers.push(resolve);
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      }),
  );
  return { fetchMock, answers };
}

const created = () => new Response(JSON.stringify({ success: true, data: { challenge_id: 'c1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof silentFetch>['fetchMock'];
let answers: ReturnType<typeof silentFetch>['answers'];

/** Startar anropet och ger ett ställe att läsa utfallet från: `undefined` så länge anropet inte är klart. */
function start(call: () => Promise<unknown>) {
  const outcome: { settled: boolean; result?: unknown } = { settled: false };
  void call().then((result) => { outcome.settled = true; outcome.result = result; });
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem(SESSION_TOKEN_KEY, TOKEN);
  ({ fetchMock, answers } = silentFetch());
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
    const outcome = start(() => backendApi.sendChallenge('token-1', 'user-2'));

    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(outcome.result).toMatchObject({ success: false });
  });

  it('waits the whole time limit, then gives up and reports that nothing was heard back', async () => {
    const outcome = start(() => backendApi.sendChallenge('token-1', 'user-2'));

    await vi.advanceTimersByTimeAsync(SEND_CHALLENGE_TIMEOUT_MS - 1);
    expect(outcome.settled, 'still waiting just before the limit').toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.result).toMatchObject({ success: false, reason: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted, 'the request was cancelled').toBe(true);
  });

  it('gives up too when the answer started but its body never finishes', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
        } as Response),
    );
    const outcome = start(() => backendApi.sendChallenge('token-1', 'user-2'));

    await vi.advanceTimersByTimeAsync(SEND_CHALLENGE_TIMEOUT_MS);

    expect(outcome.result).toMatchObject({ success: false, reason: 'timeout' });
  });

  it('an answer that comes after the time limit changes nothing and starts no second send', async () => {
    const outcome = start(() => backendApi.sendChallenge('token-1', 'user-2'));
    await vi.advanceTimersByTimeAsync(SEND_CHALLENGE_TIMEOUT_MS);
    const first = outcome.result;
    expect(first).toMatchObject({ success: false, reason: 'timeout' });

    answers[0]?.(created());
    await vi.advanceTimersByTimeAsync(MINUTE_MS);

    expect(outcome.result, 'the outcome is still the failure').toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops the timer when the answer comes in time, so a finished send is never cancelled afterwards', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(created()));
    const outcome = start(() => backendApi.sendChallenge('token-1', 'user-2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.result).toEqual({ success: true, data: { challenge_id: 'c1' } });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(false);
  });
});

describe('a send that does not reach the server', () => {
  it('reports a network failure with the reason network, and the text is still the browser own', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await backendApi.sendChallenge('token-1', 'user-2')).toEqual({ success: false, error: 'Failed to fetch', reason: 'network' });
  });

  it('gives the server own error text and no reason when the server answered', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'Opponent already has an active or pending challenge' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    expect(await backendApi.sendChallenge('token-1', 'user-2')).toEqual({ success: false, error: 'Opponent already has an active or pending challenge' });
  });
});

describe('no other call has a time limit', () => {
  const others = callRows(backendApi).filter((row) => row.name !== 'sendChallenge');

  it.each(others)('$name waits as long as it takes and carries no abort signal', async ({ call }) => {
    const outcome = start(call);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(fetchMock, 'the call reached fetch').toHaveBeenCalled();
    expect(outcome.settled, 'still waiting after ten minutes').toBe(false);
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).signal).toBeUndefined();
  });

  it.each([
    ['getPublicStats', () => backendApi.getPublicStats()],
    ['joinWaitlist', () => backendApi.joinWaitlist({ email: 'anna@example.com', consent: true })],
  ])('%s, which skips the shared request path, waits as long as it takes too', async (_name, call) => {
    const outcome = start(call);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(outcome.settled).toBe(false);
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).signal).toBeUndefined();
  });

  it('a network error on another call is classified as before: the same result shape, no reason', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Failed to fetch' });
  });
});
