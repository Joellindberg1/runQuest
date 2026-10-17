/**
 * Backendens källkartor: bygget bär releasen som SDK:t rapporterar, kartan pekar på src/ och en riktig stack från den byggda koden går att
 * översätta tillbaka dit. Ingen riktig Sentry: bygget körs utan token (ingen uppladdning), och stacken fångas av en lokal fejk på loopback.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { SourceMap } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentSentryRelease } from '../../../../../scripts/sentry-build.mjs';
// @ts-expect-error byggskripten är .mjs utan typer
import { backendBuildOptions, buildBackend } from '../../../build.mjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Under node_modules/.cache så att paketen (@sentry/node m.fl., som bygget lämnar externa) hittas när den byggda koden körs.
const outdir = path.resolve(backendRoot, '../../node_modules/.cache', `rq-backend-sourcemaps-${process.pid}`);
const RELEASE_ENV = { RAILWAY_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567' };
const FAKE_TOKEN = 'FAKE_TEST_TOKEN_1_not_a_real_secret';

let fake: http.Server;
let port: number;
let received: string[] = [];
const logged: string[] = [];

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(body); res.setHeader('content-type', 'application/json'); res.end('{}'); });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  port = (fake.address() as { port: number }).port;
  mkdirSync(outdir, { recursive: true });
  await buildBackend({ env: RELEASE_ENV, outdir, log: (line: string) => logged.push(line) });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => fake.close(() => r()));
  rmSync(outdir, { recursive: true, force: true });
});

function run(file: string, env: Record<string, string>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    // Utan --enable-source-maps, som i produktion (`node dist/server.js`).
    const child = spawn(process.execPath, [file], { cwd: backendRoot, env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env } });
    child.on('error', reject);
    child.on('close', resolve);
  });
}

describe('the backend build', () => {
  it('builds the server, and a source map that points at the TypeScript files, without a Sentry token', () => {
    expect(existsSync(path.join(outdir, 'server.js'))).toBe(true);
    const map = JSON.parse(readFileSync(path.join(outdir, 'server.js.map'), 'utf8'));

    expect(map.sources.some((source: string) => /(^|\/)src\/server\.ts$/.test(source))).toBe(true);
    expect(map.sources.some((source: string) => source.includes('packages/shared/src/'))).toBe(true);
    expect(map.sourcesContent.length).toBe(map.sources.length);
    expect(logged.join('\n')).toMatch(/skipped: SENTRY_AUTH_TOKEN is not set/);
  });

  it('adds the Sentry upload plugin only when a token is set', () => {
    const without = backendBuildOptions({ env: RELEASE_ENV, outdir });
    const withToken = backendBuildOptions({ env: { ...RELEASE_ENV, SENTRY_AUTH_TOKEN: FAKE_TOKEN }, outdir });

    expect(without.plugins ?? []).toHaveLength(0);
    expect(withToken.plugins).toHaveLength(1);
  });

  it('silences the upload plugin\'s default-export warning only when the plugin is in the build', () => {
    const without = backendBuildOptions({ env: RELEASE_ENV, outdir });
    const withToken = backendBuildOptions({ env: { ...RELEASE_ENV, SENTRY_AUTH_TOKEN: FAKE_TOKEN }, outdir });

    expect(without.logOverride).toEqual({});
    expect(withToken.logOverride).toEqual({ 'import-is-undefined': 'silent' });
  });

  it('keeps the start command and the map file name: node dist/server.js', () => {
    const options = backendBuildOptions({ env: {}, outdir: 'dist' });

    expect(options.entryPoints).toMatchObject({ server: 'src/server.ts' });
    expect(options.sourcemap).toBe(true);
    expect(options.format).toBe('esm');
  });

  it('a stack from the built code resolves to src/ through the map, under the release the SDK reports', async () => {
    received = [];
    const code = await run(path.join(outdir, 'sentryTest.js'), { SENTRY_DSN: `http://publickey@127.0.0.1:${port}/42`, SENTRY_ENVIRONMENT: 'staging' });
    expect(code).toBe(0);

    const envelopeLines = received.join('\n').split('\n');
    const event = envelopeLines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((part) => part?.exception);
    expect(event.release).toBe(currentSentryRelease(RELEASE_ENV));
    expect(event.release).toMatch(/^runquest@\d+\.\d+\.\d+\+0123456$/);

    // Sentry får bygget-filens rader (utan --enable-source-maps) och översätter dem med den uppladdade kartan; här görs samma översättning lokalt.
    const frames = event.exception.values[0].stacktrace.frames as Array<{ filename: string; lineno: number; colno: number; function?: string }>;
    const top = frames[frames.length - 1];
    expect(top.filename).toMatch(/sentryTest\.js$/);
    const builtMap = new SourceMap(JSON.parse(readFileSync(path.join(outdir, 'sentryTest.js.map'), 'utf8')));
    const origin = builtMap.findEntry(top.lineno - 1, top.colno - 1) as { originalSource: string; originalLine: number };
    const originalPath = origin.originalSource.startsWith('file:') ? fileURLToPath(origin.originalSource) : path.resolve(outdir, origin.originalSource);
    expect(path.relative(backendRoot, originalPath).split(path.sep).join('/')).toBe('src/observability/sentry.ts');
    const sourceLines = readFileSync(pathToFileURL(originalPath), 'utf8').split(/\r?\n/);
    expect(sourceLines[origin.originalLine]).toContain('new Error');
  }, 30_000);
});
