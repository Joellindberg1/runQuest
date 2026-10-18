import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Den riktiga @sentry/react och den riktiga beforeSend-kedjan i startSentry; bara transporten är fejkad (ingenting lämnar processen).
const sent = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

vi.mock('@sentry/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/react')>();
  const transport = () => ({
    send: async (envelope: unknown[]) => {
      const items = (envelope[1] ?? []) as Array<[{ type?: string }, Record<string, unknown>]>;
      for (const [header, payload] of items) if (header.type === 'event') sent.events.push(payload);
      return {};
    },
    flush: async () => true,
  });
  return { ...actual, init: (options: Record<string, unknown>) => actual.init({ ...options, transport } as never) };
});

import * as Sentry from '@sentry/react';
import { startSentry } from './sentryClient';

const DEBUG_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
type DebugIdRegistry = { _sentryDebugIds?: Record<string, string> };

beforeEach(() => {
  sent.events.length = 0;
  vi.stubGlobal('window', { localStorage: { length: 0, key: () => null, getItem: () => null }, location: { pathname: '/board' } });
});

afterEach(async () => {
  await Sentry.close();
  delete (globalThis as DebugIdRegistry)._sentryDebugIds;
  vi.unstubAllGlobals();
});

describe('startSentry with the real SDK', () => {
  it('sends events that still carry the release and the debug ids the source maps are matched on', async () => {
    const report = startSentry({ dsn: 'https://key@example.invalid/1', environment: 'staging', release: 'runquest@0.8.0+abcdef1' });
    // Bundlern registrerar debug-id per skript, nycklad på en stack från just det skriptet; SDK:t slår upp skriptet ur varje frame.
    const error = new Error('lookup failed for anna@example.com');
    (globalThis as DebugIdRegistry)._sentryDebugIds = { [error.stack ?? '']: DEBUG_ID };

    report(error);
    await Sentry.flush(2000);

    expect(sent.events).toHaveLength(1);
    const [event] = sent.events;
    expect(event?.release).toBe('runquest@0.8.0+abcdef1');
    expect(event?.debug_meta).toMatchObject({ images: [{ type: 'sourcemap', debug_id: DEBUG_ID }] });
    expect(JSON.stringify(event)).not.toContain('anna@example.com');
  });
});
