/**
 * Sentry utan nätverk för tester: en fejkad transport fångar kuverten som skulle ha skickats, så testet ser exakt det som lämnar
 * processen (efter beforeSend). Samma upplägg som sentry.test.ts, men delbart mellan testfiler som driver riktiga larmkällor.
 */
import * as Sentry from '@sentry/node';
import { closeSentry, flushSentry, initSentry } from '../../sentry.js';

export type SentryEvent = Record<string, any>;

const FAKE_DSN = 'https://publickey@o1.ingest.de.sentry.io/42';

export interface FakeSentry {
  /** Händelserna som lämnat processen, i ordning. */
  sent: SentryEvent[];
  /** Väntar tills köade händelser nått transporten och returnerar `sent`. Skickar också väntande sammanfattningar (som flushSentry). */
  flush: () => Promise<SentryEvent[]>;
  /** Som `flush`, men rör inte spärren för kritiska larm: inga sammanfattningar skickas. */
  drain: () => Promise<SentryEvent[]>;
  stop: () => Promise<void>;
}

export function startFakeSentry(): FakeSentry {
  const sent: SentryEvent[] = [];
  const transport = () => ({
    send: async (envelope: [unknown, Array<[{ type: string }, SentryEvent]>]) => {
      for (const [header, payload] of envelope[1]) if (header.type === 'event') sent.push(payload);
      return {};
    },
    flush: async () => true,
  });
  process.setMaxListeners(50); // varje initSentry lägger till process-lyssnare
  initSentry({ SENTRY_DSN: FAKE_DSN, SENTRY_ENVIRONMENT: 'test' }, { transport: transport as never, processHandlers: false });
  return {
    sent,
    flush: async () => {
      await flushSentry();
      return sent;
    },
    drain: async () => {
      await Sentry.flush(2000);
      return sent;
    },
    stop: closeSentry,
  };
}
