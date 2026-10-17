// Backendens bygge: `npm run build -w @runquest/backend` kör den här filen. Samma esbuild-inställningar som förut (en ESM-fil per ingång, paketen
// externa, @runquest/shared inbyggd ur källan) plus Sentry:
//  - releasen (scripts/sentry-build.mjs) bakas in som `__SENTRY_RELEASE__`, som observability/sentry.ts rapporterar under;
//  - med SENTRY_AUTH_TOKEN laddar @sentry/esbuild-plugin upp källkartan under samma release (projektet runquest-backend). Utan token
//    görs ingen uppladdning och inget nätverksanrop alls: bygget lokalt och i CI är oförändrat.
// Backendens dist/ serveras aldrig (Express har ingen statisk rutt för den), så kartan får ligga kvar bredvid server.js. Noden läser den
// inte utan --enable-source-maps, och den flaggan ska inte sättas (se observability/sentry.ts).
//
// Ingångarna: server.js är startkommandot (`node dist/server.js`). sentryTest.js är samma testhändelse som `npm run sentry:test`, men byggd,
// så att en testhändelse mot den uppladdade kartan kan visa src/-rader i stället för dist/ (`npm run sentry:test:built`).
import { build } from 'esbuild';
import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentSentryRelease, sentryUploadOptions, uploadNotice } from '../../scripts/sentry-build.mjs';

const BACKEND_DIR = dirname(fileURLToPath(import.meta.url));
const SENTRY_PROJECT = 'runquest-backend';

/** esbuild-inställningarna (och uppladdningsval) för ett bygge. Ren: bygger ingenting. */
export function backendBuildOptions({ env = process.env, outdir = 'dist' } = {}) {
  const release = currentSentryRelease(env);
  const upload = sentryUploadOptions({ env, project: SENTRY_PROJECT, release });
  return {
    upload,
    absWorkingDir: BACKEND_DIR,
    entryPoints: { server: 'src/server.ts', sentryTest: 'src/scripts/sentryTest.ts' },
    outdir: resolve(BACKEND_DIR, outdir),
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: true,
    packages: 'external',
    alias: { '@runquest/shared': resolve(BACKEND_DIR, '../../packages/shared/src/index.ts') },
    define: { __SENTRY_RELEASE__: JSON.stringify(release) },
    plugins: upload ? [sentryEsbuildPlugin(upload)] : [],
  };
}

export async function buildBackend({ env = process.env, outdir = 'dist', log = console.log } = {}) {
  const { upload, ...options } = backendBuildOptions({ env, outdir });
  rmSync(resolve(BACKEND_DIR, outdir), { recursive: true, force: true });
  log(uploadNotice(SENTRY_PROJECT, upload));
  await build(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildBackend();
}
