/**
 * Process-nivå: unhandledRejection och uncaughtException når Sentry, och processen kraschar som förut (Railway startar om den).
 * Varje fall kör en egen node-process mot en lokal fejk-Sentry på loopback (ingen riktig Sentry, inga hemligheter ärvs).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const crashFixture = path.join(backendRoot, 'src/observability/__tests__/fixtures/crash.ts');
const sentryTestScript = path.join(backendRoot, 'src/scripts/sentryTest.ts');

let fake: http.Server;
let port: number;
let received: string[] = [];

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(body); res.setHeader('content-type', 'application/json'); res.end('{}'); });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => fake.close(() => r())));

/** Kör en TypeScript-fil i en ren process: bara PATH och de Sentry-variabler testet anger. */
function run(file: string, args: string[], env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', file, ...args], {
      cwd: backendRoot,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    });
    let output = '';
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

const dsn = () => `http://publickey@127.0.0.1:${port}/42`;

describe('process handlers', () => {
  it.each([
    ['rejection', 'crash-fixture unhandled rejection'],
    ['exception', 'crash-fixture uncaught exception'],
  ])('an unhandled %s is sent to Sentry and the process still exits non-zero', async (mode, message) => {
    received = [];
    const { code } = await run(crashFixture, [mode], { SENTRY_DSN: dsn(), SENTRY_ENVIRONMENT: 'staging' });
    expect(code).not.toBe(0);
    expect(received.join('\n')).toContain(message);
    expect(received.join('\n')).toContain('"environment":"staging"');
  }, 20_000);
});

describe('sentry:test script', () => {
  it('sends one test event tagged with the environment, then exits 0', async () => {
    received = [];
    const { code, output } = await run(sentryTestScript, [], { SENTRY_DSN: dsn(), SENTRY_ENVIRONMENT: 'staging' });
    expect(code).toBe(0);
    const body = received.join('\n');
    expect(body).toContain('"environment":"staging"');
    expect(body).toContain('sentry:test');
    expect(output).toContain('staging');
    expect(output).not.toContain('publickey');
  }, 20_000);

  it('refuses to run without a DSN and sends nothing', async () => {
    received = [];
    const { code, output } = await run(sentryTestScript, [], { SENTRY_DSN: '' });
    expect(code).toBe(1);
    expect(output).toContain('SENTRY_DSN');
    expect(received).toEqual([]);
  }, 20_000);
});
