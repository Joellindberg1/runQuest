/**
 * scripts/stravaWebhookSubscription.ts (ADR 010 decisions 2 and 16): view / create / delete of the one Strava push subscription.
 * create and delete are dry-runs unless --apply is given. Network: installFakeStravaFetch only, so a request the test did not
 * configure fails it. No database is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { logger } from '../../utils/logger.js';
import { installFakeStravaFetch, stravaError, stravaSubscription, type FakeStrava } from '../../test-utils/fakeStrava.js';
import {
  STRAVA_WEBHOOK_CALLBACK_URL,
  exitCodeFor,
  missingEnv,
  parseArgs,
  runSubscription,
  type SubscriptionCommand,
  type SubscriptionReport,
} from '../stravaWebhookSubscription.js';

const CLIENT_ID = '123456';
const CLIENT_SECRET = 'client-secret-0f9e8d7c6b5a';
const VERIFY_TOKEN = 'verify-token-0123456789abcdef0123456789abcdef';
const ACCESS_TOKEN = 'access-token-should-never-be-printed';

const ENV: NodeJS.ProcessEnv = {
  STRAVA_CLIENT_ID: CLIENT_ID,
  STRAVA_CLIENT_SECRET: CLIENT_SECRET,
  STRAVA_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
};

let strava: FakeStrava | undefined;
let lines: string[];
let consoleOutput: string[];
let loggerOutput: string[];
const log = (line: string) => void lines.push(line);
const output = () => lines.join('\n');

beforeEach(() => {
  lines = [];
  consoleOutput = [];
  loggerOutput = [];
  const capture = (sink: string[]) => (...args: unknown[]) => void sink.push(args.map(String).join(' '));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(capture(consoleOutput));
  for (const method of ['info', 'warn', 'error', 'debug'] as const) vi.spyOn(logger, method).mockImplementation(capture(loggerOutput));
});
afterEach(() => {
  strava?.restore();
  strava = undefined;
  vi.restoreAllMocks();
});

const EXISTING = stravaSubscription({ id: 777, callback_url: STRAVA_WEBHOOK_CALLBACK_URL });

function run(command: SubscriptionCommand, extra: { apply?: boolean; id?: number; env?: NodeJS.ProcessEnv } = {}): Promise<SubscriptionReport> {
  return runSubscription({ command, apply: extra.apply ?? false, id: extra.id, env: extra.env ?? ENV, log });
}

describe('callback url and arguments', () => {
  it('the callback url is the public https url of the webhook route', () => {
    const url = new URL(STRAVA_WEBHOOK_CALLBACK_URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('api.runquest.dev');
    expect(url.pathname).toBe('/api/strava/webhook');
    expect(url.search).toBe('');
  });

  it('parseArgs defaults to view and reads the command, --apply and --id', () => {
    expect(parseArgs([])).toEqual({ command: 'view', apply: false, id: undefined });
    expect(parseArgs(['create', '--apply'])).toEqual({ command: 'create', apply: true, id: undefined });
    expect(parseArgs(['delete', '--id', '777'])).toEqual({ command: 'delete', apply: false, id: 777 });
    expect(parseArgs(['delete', '--id=777', '--apply'])).toEqual({ command: 'delete', apply: true, id: 777 });
  });

  it('parseArgs rejects unknown arguments, a bad id and flags that do not fit the command', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/i);
    expect(() => parseArgs(['--client-secret=abc123xyz'])).toThrow(expect.objectContaining({ message: expect.not.stringContaining('abc123xyz') }));
    expect(() => parseArgs(['remove'])).toThrow(/unknown/i);
    expect(() => parseArgs(['delete', '--id', 'abc'])).toThrow(/--id/);
    expect(() => parseArgs(['delete', '--id'])).toThrow(/--id/);
    expect(() => parseArgs(['view', '--apply'])).toThrow(/--apply/);
    expect(() => parseArgs(['create', '--id', '5'])).toThrow(/--id/);
    expect(() => parseArgs(['view', 'create'])).toThrow(/one command/i);
  });
});

describe('view', () => {
  it('view lists the existing subscription without any write request', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [EXISTING], create: { id: 1 }, delete: null } });

    const report = await run('view');

    expect(strava.requests.map((r) => r.method)).toEqual(['GET']);
    expect(strava.calls.pushSubscriptionsCreate).toBe(0);
    expect(strava.calls.pushSubscriptionsDelete).toBe(0);
    expect(strava.requests[0].query).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    expect(report.subscriptions.map((s) => [s.id, s.callback_url])).toEqual([[777, STRAVA_WEBHOOK_CALLBACK_URL]]);
    expect(output()).toContain('777');
    expect(output()).toContain(STRAVA_WEBHOOK_CALLBACK_URL);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('view says so when no subscription exists and when the callback url is not the expected one', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [] } });
    const empty = await run('view');
    expect(output()).toMatch(/no subscription/i);
    expect(exitCodeFor(empty)).toBe(0);

    lines = [];
    strava.restore();
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [stravaSubscription({ id: 5, callback_url: 'https://old.example.test/hook' })] } });
    await run('view');
    expect(output()).toContain('https://old.example.test/hook');
    expect(output()).toMatch(/differs/i);
  });

  it('view fails with exit code 1 when Strava answers with an error', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: stravaError(401) } });
    const report = await run('view');
    expect(output()).toContain('401');
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('create', () => {
  it('create dry-run makes no POST and prints the callback url', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [], create: { id: 888 } } });

    const report = await run('create');

    expect(strava.calls.pushSubscriptionsCreate).toBe(0);
    expect(strava.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(output()).toContain(STRAVA_WEBHOOK_CALLBACK_URL);
    expect(output()).toContain('www.strava.com');
    expect(output()).toMatch(/dry-run/i);
    expect(output()).toContain('--apply');
    expect(report.outcome).toBe('would_create');
    expect(report.subscriptionId).toBeUndefined();
    expect(exitCodeFor(report)).toBe(0);
  });

  it('create --apply posts client id, client secret, callback url and verify token', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [], create: { id: 888 } } });

    const report = await run('create', { apply: true });

    expect(strava.calls.pushSubscriptionsCreate).toBe(1);
    const post = strava.requests.find((r) => r.method === 'POST');
    expect(post?.url).toBe('https://www.strava.com/api/v3/push_subscriptions');
    expect(post?.body).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      callback_url: STRAVA_WEBHOOK_CALLBACK_URL,
      verify_token: VERIFY_TOKEN,
    });
    expect(report.outcome).toBe('created');
    expect(report.subscriptionId).toBe(888);
    expect(output()).toContain('STRAVA_WEBHOOK_SUBSCRIPTION_ID=888');
    expect(output()).toMatch(/railway/i);
    expect(output()).toMatch(/owner/i);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('create refuses when a subscription already exists', async () => {
    for (const apply of [true, false]) {
      lines = [];
      strava = installFakeStravaFetch({ pushSubscriptions: { list: [EXISTING], create: { id: 888 } } });

      const report = await run('create', { apply });

      expect(strava.calls.pushSubscriptionsCreate).toBe(0);
      expect(report.outcome).toBe('refused_exists');
      expect(output()).toContain('777');
      expect(output()).toMatch(/already exists/i);
      expect(exitCodeFor(report)).toBe(1);
      strava.restore();
    }
  });

  it('create refuses when the existing subscriptions cannot be listed, so it never creates a second one blindly', async () => {
    const unreadable: Array<[string, unknown]> = [
      ['an error answer', stravaError(500)],
      ['a 200 that is not a list', {}],
      ['a list with a row without an id', [{ callback_url: STRAVA_WEBHOOK_CALLBACK_URL }]],
      ['a list with a row whose id is not a positive whole number', [{ id: 'abc', callback_url: STRAVA_WEBHOOK_CALLBACK_URL }]],
    ];
    for (const [name, list] of unreadable) {
      strava = installFakeStravaFetch({ pushSubscriptions: { list: list as never, create: { id: 888 } } });
      const report = await run('create', { apply: true });
      expect(strava.calls.pushSubscriptionsCreate, name).toBe(0);
      expect(report.outcome, name).toBe('failed');
      expect(exitCodeFor(report), name).toBe(1);
      strava.restore();
    }
  });

  it('create sends the POST as a form body and every call carries a timeout signal', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [], create: { id: 888 } } });
    const fake = globalThis.fetch;
    const seen: Array<{ method: string; body: unknown; signal: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', body: init?.body, signal: init?.signal });
      return fake(input, init);
    }) as typeof fetch;
    try {
      await run('create', { apply: true });
    } finally {
      globalThis.fetch = fake;
    }
    const post = seen.find((s) => s.method === 'POST');
    expect(post?.body).toBeInstanceOf(URLSearchParams);
    expect(seen.map((s) => s.method)).toEqual(['GET', 'POST']);
    expect(seen.every((s) => s.signal instanceof AbortSignal)).toBe(true);
  });

  it('create that gets no answer says to check with view instead of claiming nothing was created', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    try {
      const report = await run('create', { apply: true });
      expect(report.outcome).toBe('failed');
      expect(output()).toMatch(/check with view/i);
      expect(output()).not.toMatch(/nothing was created/i);
      expect(exitCodeFor(report)).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('create refuses a verify token shorter than 32 characters, also as a dry-run, before any request', async () => {
    strava = installFakeStravaFetch({});
    for (const apply of [false, true]) {
      const report = await run('create', { apply, env: { ...ENV, STRAVA_WEBHOOK_VERIFY_TOKEN: 'a'.repeat(31) } });
      expect(report.outcome).toBe('refused_weak_token');
      expect(exitCodeFor(report)).toBe(1);
    }
    expect(strava.requests).toEqual([]);
    expect(output()).toMatch(/32/);
    expect(output()).not.toContain('a'.repeat(31));
  });

  it('create accepts a verify token of exactly 32 characters', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [], create: { id: 5 } } });
    const report = await run('create', { apply: true, env: { ...ENV, STRAVA_WEBHOOK_VERIFY_TOKEN: 'b'.repeat(32) } });
    expect(report.outcome).toBe('created');
  });

  it('create reports a refusal from Strava (for instance a callback that did not answer) and sets no id', async () => {
    strava = installFakeStravaFetch({
      pushSubscriptions: {
        list: [],
        create: stravaError(400, { body: { message: 'Bad Request', errors: [{ resource: 'PushSubscription', field: 'callback url', code: 'GET to callback URL does not return 200' }] } }),
      },
    });

    const report = await run('create', { apply: true });

    expect(report.outcome).toBe('failed');
    expect(report.subscriptionId).toBeUndefined();
    expect(output()).toContain('400');
    expect(output()).toContain('GET to callback URL does not return 200');
    expect(output()).not.toContain('STRAVA_WEBHOOK_SUBSCRIPTION_ID=');
    expect(exitCodeFor(report)).toBe(1);
  });

  it('create reports a created subscription whose answer has no usable id and points to view', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [], create: {} as { id: number } } });
    const report = await run('create', { apply: true });
    expect(report.outcome).toBe('failed');
    expect(output()).toMatch(/run .*view/i);
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('delete', () => {
  it('delete dry-run makes no request and delete --apply is required to send it', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [EXISTING], delete: null } });

    const dryRun = await run('delete', { id: 777 });

    expect(strava.requests).toEqual([]);
    expect(dryRun.outcome).toBe('would_delete');
    expect(output()).toMatch(/dry-run/i);
    expect(output()).toContain('https://www.strava.com/api/v3/push_subscriptions/777');
    expect(output()).toContain('--apply');
    expect(exitCodeFor(dryRun)).toBe(0);

    const applied = await run('delete', { id: 777, apply: true });

    expect(strava.requests).toHaveLength(1);
    expect(strava.requests[0].method).toBe('DELETE');
    expect(strava.requests[0].url.startsWith('https://www.strava.com/api/v3/push_subscriptions/777?')).toBe(true);
    expect(strava.requests[0].query).toEqual({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    expect(applied.outcome).toBe('deleted');
    expect(exitCodeFor(applied)).toBe(0);
  });

  it('delete without --id finds the id with a read-only GET and a dry-run still sends no DELETE', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [EXISTING], delete: null } });

    const report = await run('delete');

    expect(strava.requests.map((r) => r.method)).toEqual(['GET']);
    expect(report.outcome).toBe('would_delete');
    expect(report.subscriptionId).toBe(777);
    expect(output()).toContain('/push_subscriptions/777');
  });

  it('delete --apply without --id deletes the one subscription that view lists', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [EXISTING], delete: null } });

    const report = await run('delete', { apply: true });

    expect(strava.requests.map((r) => r.method)).toEqual(['GET', 'DELETE']);
    expect(strava.requests[1].url).toContain('/push_subscriptions/777?');
    expect(report.outcome).toBe('deleted');
    expect(report.subscriptionId).toBe(777);
    expect(output()).toMatch(/STRAVA_WEBHOOK_SUBSCRIPTION_ID/);
  });

  it('delete reports nothing to delete and exits 0 when no subscription exists', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [], delete: null } });

    const report = await run('delete', { apply: true });

    expect(strava.calls.pushSubscriptionsDelete).toBe(0);
    expect(report.outcome).toBe('nothing_to_delete');
    expect(output()).toMatch(/nothing to delete/i);
    expect(exitCodeFor(report)).toBe(0);
  });

  it('delete without --id refuses when several subscriptions are listed and names them', async () => {
    strava = installFakeStravaFetch({
      pushSubscriptions: { list: [stravaSubscription({ id: 11 }), stravaSubscription({ id: 12 })], delete: null },
    });

    const report = await run('delete', { apply: true });

    expect(strava.calls.pushSubscriptionsDelete).toBe(0);
    expect(report.outcome).toBe('ambiguous');
    expect(output()).toContain('11');
    expect(output()).toContain('12');
    expect(output()).toContain('--id');
    expect(exitCodeFor(report)).toBe(1);
  });

  it('delete --apply fails with exit code 1 when Strava refuses the DELETE', async () => {
    strava = installFakeStravaFetch({ pushSubscriptions: { list: [EXISTING], delete: stravaError(404) } });
    const report = await run('delete', { id: 999, apply: true });
    expect(report.outcome).toBe('failed');
    expect(output()).toContain('404');
    expect(exitCodeFor(report)).toBe(1);
  });
});

describe('environment', () => {
  it('script refuses to run when a required env variable is missing', async () => {
    strava = installFakeStravaFetch({});
    const cases: Array<[SubscriptionCommand, string]> = [
      ['view', 'STRAVA_CLIENT_ID'],
      ['view', 'STRAVA_CLIENT_SECRET'],
      ['delete', 'STRAVA_CLIENT_ID'],
      ['create', 'STRAVA_CLIENT_SECRET'],
      ['create', 'STRAVA_WEBHOOK_VERIFY_TOKEN'],
    ];
    for (const [command, name] of cases) {
      lines = [];
      const env = { ...ENV, [name]: undefined };

      const report = await run(command, { apply: command !== 'view', id: command === 'delete' ? 777 : undefined, env });

      expect(report.outcome).toBe('missing_env');
      expect(output()).toContain(name);
      expect(exitCodeFor(report)).toBe(1);
    }
    expect(strava.requests).toEqual([]);
  });

  it('an empty env variable counts as missing, and view and delete do not need the verify token', () => {
    expect(missingEnv('view', { ...ENV, STRAVA_CLIENT_SECRET: '' })).toEqual(['STRAVA_CLIENT_SECRET']);
    expect(missingEnv('view', { STRAVA_CLIENT_ID: CLIENT_ID, STRAVA_CLIENT_SECRET: CLIENT_SECRET })).toEqual([]);
    expect(missingEnv('delete', { STRAVA_CLIENT_ID: CLIENT_ID, STRAVA_CLIENT_SECRET: CLIENT_SECRET })).toEqual([]);
    expect(missingEnv('create', {})).toEqual(['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_WEBHOOK_VERIFY_TOKEN']);
  });
});

describe('secrets', () => {
  it('script output never contains the client secret or the verify token', async () => {
    // Every path, including the ones where Strava echoes the credentials back (in the message and in other fields)
    // and a network failure whose message names them. The access token stands for any other token that may turn up in an answer.
    const echo = { message: `rejected ${CLIENT_SECRET} / ${VERIFY_TOKEN}`, access_token: ACCESS_TOKEN, errors: [{ code: `bad ${VERIFY_TOKEN}`, field: CLIENT_SECRET }] };
    const scenarios: Array<{ name: string; routes: Parameters<typeof installFakeStravaFetch>[0]; command: SubscriptionCommand; apply: boolean; id?: number }> = [
      { name: 'view', routes: { pushSubscriptions: { list: [EXISTING] } }, command: 'view', apply: false },
      { name: 'view failing', routes: { pushSubscriptions: { list: stravaError(401, { body: echo }) } }, command: 'view', apply: false },
      { name: 'create dry-run', routes: { pushSubscriptions: { list: [] } }, command: 'create', apply: false },
      { name: 'create --apply', routes: { pushSubscriptions: { list: [], create: { id: 42 } } }, command: 'create', apply: true },
      { name: 'create refused by Strava', routes: { pushSubscriptions: { list: [], create: stravaError(400, { body: echo }) } }, command: 'create', apply: true },
      { name: 'create existing', routes: { pushSubscriptions: { list: [EXISTING] } }, command: 'create', apply: true },
      { name: 'delete dry-run', routes: { pushSubscriptions: { list: [EXISTING] } }, command: 'delete', apply: false },
      { name: 'delete --apply', routes: { pushSubscriptions: { list: [EXISTING], delete: null } }, command: 'delete', apply: true, id: 777 },
      { name: 'delete refused by Strava', routes: { pushSubscriptions: { delete: stravaError(403, { body: echo }) } }, command: 'delete', apply: true, id: 777 },
    ];

    for (const scenario of scenarios) {
      lines = [];
      consoleOutput.length = 0;
      loggerOutput.length = 0;
      strava = installFakeStravaFetch(scenario.routes);

      const report = await run(scenario.command, { apply: scenario.apply, id: scenario.id });

      const everything = [output(), consoleOutput.join('\n'), loggerOutput.join('\n'), JSON.stringify(report)].join('\n');
      for (const secret of [CLIENT_SECRET, VERIFY_TOKEN, ACCESS_TOKEN]) {
        expect(everything, `${scenario.name} leaked ${secret}`).not.toContain(secret);
      }
      strava.restore();
    }
  });

  it('a secret at the length boundary of a message leaves no part of itself in the output', async () => {
    const secret = 'Zq7!kP2xW9mR4tY8';
    const token = 'Vt5#nB8wL3jH6dF1cX9sG2aE4yU7iO0p';
    const env = { ...ENV, STRAVA_CLIENT_SECRET: secret, STRAVA_WEBHOOK_VERIFY_TOKEN: token };
    // Where the secret starts: just inside and just past the old 300 character cut, and past the cap of a printed line.
    for (const fill of [280, 296, 299, 300, 301, 590, 597, 600]) {
      for (const secretValue of [secret, token]) {
        const message = `${'a'.repeat(fill)}${secretValue}`;
        const scenarios: Array<() => Promise<SubscriptionReport>> = [
          async () => {
            strava = installFakeStravaFetch({ pushSubscriptions: { list: [], create: stravaError(400, { body: { message } }) } });
            return run('create', { apply: true, env });
          },
          async () => {
            strava = installFakeStravaFetch({ pushSubscriptions: { list: stravaError(500, { body: { message } }) } });
            return run('view', { env });
          },
          async () => {
            const original = globalThis.fetch;
            globalThis.fetch = (async () => {
              throw new Error(message);
            }) as typeof fetch;
            try {
              return await run('view', { env });
            } finally {
              globalThis.fetch = original;
            }
          },
        ];
        for (const scenario of scenarios) {
          lines = [];
          const report = await scenario();
          const everything = [output(), consoleOutput.join('\n'), JSON.stringify(report.lines)].join('\n');
          for (const value of [secret, token]) {
            for (let i = 0; i + 4 <= value.length; i++) {
              expect(everything, `fill ${fill}: leaked "${value.slice(i, i + 4)}"`).not.toContain(value.slice(i, i + 4));
            }
          }
          strava?.restore();
          strava = undefined;
        }
      }
    }
  });

  it('script output never contains a secret that appears in a network error', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error(`connect ECONNREFUSED while sending ${CLIENT_SECRET} and ${VERIFY_TOKEN}`);
    }) as typeof fetch;
    try {
      const report = await run('create', { apply: true });
      const everything = [output(), consoleOutput.join('\n'), loggerOutput.join('\n'), JSON.stringify(report)].join('\n');
      expect(report.outcome).toBe('failed');
      expect(everything).not.toContain(CLIENT_SECRET);
      expect(everything).not.toContain(VERIFY_TOKEN);
      expect(exitCodeFor(report)).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('running the script', () => {
  const scriptPath = fileURLToPath(new URL('../stravaWebhookSubscription.ts', import.meta.url));
  const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

  /** Runs the real script in a process of its own, in an empty directory (so no .env is found) with only the given env. */
  function runScript(args: string[], env: Record<string, string>) {
    const cwd = mkdtempSync(join(tmpdir(), 'strava-webhook-'));
    try {
      return spawnSync(process.execPath, ['--import', tsxLoader, scriptPath, ...args], {
        cwd,
        env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
        encoding: 'utf8',
        timeout: 60_000,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  it('an unknown argument gives exit code 1 and sends nothing', () => {
    const result = runScript(['--bogus'], { STRAVA_CLIENT_ID: CLIENT_ID, STRAVA_CLIENT_SECRET: CLIENT_SECRET });
    expect(result.stderr).toMatch(/unknown argument/i);
    expect(result.stderr).not.toContain('--bogus');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('importing the module does not run main', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'strava-webhook-'));
    try {
      const result = spawnSync(
        process.execPath,
        ['--import', tsxLoader, '--input-type=module', '-e', 'await import(process.env.MODULE_URL); console.log(`exitCode=${process.exitCode}`);'],
        { cwd, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', MODULE_URL: pathToFileURL(scriptPath).href }, encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe('exitCode=undefined');
      expect(result.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('a missing env variable gives exit code 1 before any request', () => {
    const result = runScript(['create', '--apply'], { STRAVA_CLIENT_ID: CLIENT_ID });
    expect(result.stdout).toContain('STRAVA_CLIENT_SECRET');
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('Would send');
  });
});
