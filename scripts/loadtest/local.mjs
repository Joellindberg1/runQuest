#!/usr/bin/env node
// Provkörning av lasttestet mot en fejkserver på 127.0.0.1 (ingen riktig tjänst, inga riktiga konton). Visar hur utskriften ser ut
// och bevisar att verktyget fungerar innan det riktas mot staging:  npm run loadtest:local
// Fejkserverns inloggningsuppgifter är påhittade och finns bara i den här processen.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { startFakeServer } from './fakeServer.mjs';
import { executeLoadtest } from './run.mjs';

export async function runLocal(env = process.env, log = console.log) {
  const users = [
    { login: 'fake-user-1@example.invalid', password: 'FAKE_LOCAL_PASSWORD_1_not_real' },
    { login: 'fake-user-2@example.invalid', password: 'FAKE_LOCAL_PASSWORD_2_not_real' },
    { login: 'fake-user-3@example.invalid', password: 'FAKE_LOCAL_PASSWORD_3_not_real' },
  ];
  const server = await startFakeServer({ users, latencyMs: Number(env.LOADTEST_LOCAL_LATENCY_MS ?? 25) });
  try {
    const config = loadConfig({
      LOADTEST_BASE_URL: server.url,
      LOADTEST_USERS: JSON.stringify(users),
      LOADTEST_VUS: env.LOADTEST_VUS ?? '8',
      LOADTEST_DURATION_S: env.LOADTEST_DURATION_S ?? '10',
      LOADTEST_THINK_MS: env.LOADTEST_THINK_MS ?? '200',
      LOADTEST_OUT_DIR: env.LOADTEST_OUT_DIR ?? mkdtempSync(join(tmpdir(), 'runquest-loadtest-')),
    });
    const outcome = await executeLoadtest({ config, log });
    log(`Fejkserverns räknare: ${server.state.requests.length} anrop, ${server.state.stravaHits} Strava-träffar, ${server.state.runs.size} rundor kvar.`);
    return outcome;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runLocal();
}
