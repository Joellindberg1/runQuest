import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Det riktiga SDK:t (ingen mock), med en fejkad transport och ett fejkat fetch: det som mäts är vad som faktiskt lämnar webbläsaren.
// jsdom har ingen PerformanceObserver, så LCP, CLS och INP mäts inte här; testet gäller namnet, innehållet och headers.

const RUNNER_ID = '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14';
const DSN = 'https://key@example.invalid/1';
const API_ORIGIN = 'https://api.runquest.dev';

interface TransactionPayload {
  transaction?: string;
  transaction_info?: unknown;
  contexts: { trace: { op: string } };
  spans?: unknown;
  breadcrumbs?: unknown;
  user?: unknown;
  measurements?: Record<string, { value: number }>;
}
type Envelope = [unknown, Array<[{ type: string }, TransactionPayload]>];
type FetchCall = { url: string; headers: Headers };

let transactions: TransactionPayload[];
let errorEvents: TransactionPayload[];
let requests: FetchCall[];
let report: ((error: unknown) => void) | undefined;

/** Varje klient skriver till sina egna listor: en sidladdning från ett tidigare test kan avslutas först när nästa test pågår. */
const transportInto = (transactionSink: TransactionPayload[], eventSink: TransactionPayload[]) => () => ({
  send: async (envelope: Envelope) => {
    for (const [header, payload] of envelope[1]) {
      if (header.type === 'transaction') transactionSink.push(payload);
      if (header.type === 'event') eventSink.push(payload);
    }
    return {};
  },
  flush: async () => true,
});

/** Nytt SDK och ny sentryClient per test: SDK:ts fetch-instrumentering installeras bara en gång per modulinstans. */
async function startFresh(options: { documentPath: string; tracesSampleRate?: number }) {
  vi.resetModules();
  transactions = [];
  errorEvents = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const Sentry = await import('@sentry/react');
  const { startSentry } = await import('./sentryClient');
  report = startSentry({ dsn: DSN, environment: 'test', transport: transportInto(transactions, errorEvents) as never, ...options });
  return Sentry;
}

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let Sentry: typeof import('@sentry/react') | undefined;
beforeEach(() => {
  transactions = [];
  requests = [];
  // Sentry slumpar fram ett tal (0 till 1) som provtagningen jämförs med; lågt tal = provtagen även vid 0,1.
  vi.spyOn(Math, 'random').mockReturnValue(0.01);
});
afterEach(async () => {
  // Sidladdningens span avslutas av en timer: avsluta det nu, så att dess transaktion går till det här testets transport och inte nästa.
  Sentry?.getActiveSpan()?.end();
  await Sentry?.flush(1000);
  await Sentry?.close(1000);
  Sentry = undefined;
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('API calls while performance tracing is on', () => {
  it('carry no sentry-trace or baggage header, to the app origin or to the API', async () => {
    window.history.replaceState({}, '', '/board');
    Sentry = await startFresh({ documentPath: '/board' });

    await fetch('/api/runs');
    await fetch(`${window.location.origin}/api/leaderboard/week`);
    await fetch(`${API_ORIGIN}/api/runs`, { headers: { Authorization: 'Bearer test' } });

    expect(requests).toHaveLength(3);
    for (const { headers } of requests) {
      expect(headers.has('sentry-trace')).toBe(false);
      expect(headers.has('baggage')).toBe(false);
    }
    expect(requests[2]?.headers.get('Authorization')).toBe('Bearer test');
  });
});

describe('error reports while performance tracing is on', () => {
  it('are not labelled with the page the tracing started on, since the error can have happened on another', async () => {
    window.history.replaceState({}, '', '/board');
    Sentry = await startFresh({ documentPath: '/' });

    report?.(new Error('boom'));
    await Sentry.flush(1000);

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.transaction).toBeUndefined();
  });
});

describe('page load transaction', () => {
  it('is named after the route and carries no id, address, element, breadcrumb or span', async () => {
    window.history.replaceState({}, '', `/runner/${RUNNER_ID}?tab=runs#top`);
    Sentry = await startFresh({ documentPath: `/runner/${RUNNER_ID}` });
    await fetch('/api/runs');

    expect(Sentry.getActiveSpan()?.isRecording()).toBe(true);
    // Webbvärdena sätts av webbläsaren på sidladdningens span; här sätts ett värde för hand för att se att det klarar rensningen.
    Sentry.setMeasurement('lcp', 1830, 'millisecond');
    await waitFor(() => transactions.length >= 1);

    const [transaction] = transactions;
    expect(transaction?.measurements?.lcp?.value).toBe(1830);
    expect(transaction?.transaction).toBe('/runner/:id');
    expect(transaction?.transaction_info).toEqual({ source: 'route' });
    expect(transaction?.contexts.trace.op).toBe('pageload');
    expect(transaction?.spans).toEqual([]);
    expect(transaction?.breadcrumbs).toBeUndefined();
    expect(transaction?.user).toBeUndefined();
    const json = JSON.stringify(transaction);
    for (const leaked of [RUNNER_ID, 'tab=runs', '#top', '/api/runs']) expect(json).not.toContain(leaked);
  });

  it('is not measured when the page was loaded on the landing page, since it would be the landing page that was measured', async () => {
    window.history.replaceState({}, '', '/board');
    Sentry = await startFresh({ documentPath: '/' });

    expect(Sentry.getActiveSpan()).toBeUndefined();
    expect(transactions).toEqual([]);
  });

  it('is not measured when the app has moved on to another page since the page loaded', async () => {
    window.history.replaceState({}, '', '/board');
    Sentry = await startFresh({ documentPath: '/profile' });

    expect(Sentry.getActiveSpan()).toBeUndefined();
    expect(transactions).toEqual([]);
  });

  it('is sampled at most one time in ten, whatever rate is asked for', async () => {
    window.history.replaceState({}, '', '/board');
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    Sentry = await startFresh({ documentPath: '/board', tracesSampleRate: 1 });

    expect(Sentry.getClient()?.getOptions().tracesSampleRate).toBe(0.1);
    // Ett slumptal över 0,1 ger ingen provtagning: sidladdningen spelas inte in.
    expect(Sentry.getActiveSpan()?.isRecording()).toBe(false);
  });
});
