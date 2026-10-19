// Byggstegets Sentry-inställningar, delade av frontendbygget (apps/frontend/vite.config.ts) och backendbygget (apps/backend/build.mjs).
//
// Källkartor laddas upp till Sentry vid bygget och är aldrig publika. Utan SENTRY_AUTH_TOKEN (lokalt, i CI) görs ingen uppladdning
// och inget nätverksanrop alls: `sentryUploadOptions` ger då null och byggena hoppar över pluginet.
//
// Release: SDK:t (frontend och backend) och uppladdningen måste ha EXAKT samma namn, annars hittar Sentry inte kartan till en händelse.
// Namnet byggs en gång här och bakas in i bygget, så SDK:t aldrig räknar fram ett eget:
//   runquest@<version i rotens package.json>+<Railways commit-sha, 7 tecken>   (utan sha: runquest@<version>)
// Samma commit ger samma namn i frontend- och backendtjänsten (båda byggs av samma commit), och varje deploy får en egen release.
// Inga beroenden: filen läses också av node:test före `npm ci`.
import { readFileSync } from 'node:fs';

export const SENTRY_ORG = 'joel-lindberg';
// EU-regionen: uppladdningen går hit och inte till sentry.io.
export const SENTRY_URL = 'https://de.sentry.io';

const SHA = /^[0-9a-f]{7,40}$/i;

/** `runquest@0.8.0+abcdef1`. En sha som inte ser ut som en commit-sha lämnas utanför, så ett konstigt värde aldrig hamnar i namnet. */
export function sentryReleaseName(version, commitSha) {
  const sha = commitSha?.trim();
  return SHA.test(sha ?? '') ? `runquest@${version}+${sha.slice(0, 7).toLowerCase()}` : `runquest@${version}`;
}

/** Releasen för det här bygget: versionen ur rotens package.json (oberoende av arbetskatalog) och Railways commit-sha om den finns. */
export function currentSentryRelease(env = process.env) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return sentryReleaseName(version, env.RAILWAY_GIT_COMMIT_SHA);
}

/**
 * Inställningar till Sentrys bygg-plugin (vite/esbuild), eller null när SENTRY_AUTH_TOKEN saknas.
 * - telemetry av: pluginet skickar annars egna fel- och körningsdata till Sentry.
 * - setCommits och deploy av: ingen git-läsning (Railways bygge har ingen .git) och ingen koppling till ett förråd i Sentry.
 * - release.inject av: SDK:t får releasen explicit vid init, ingen andra källa som kan avvika.
 * - errorHandler: ett misslyckat upload (Sentry nere, fel token) får inte stoppa en deploy. Raden syns i byggloggen; kartorna
 *   tas bort ur dist ändå (frontend) och felet visar sig som osymboliserade stackar i Sentry tills nästa bygge.
 */
export function sentryUploadOptions({ env, project, release }) {
  const authToken = env.SENTRY_AUTH_TOKEN?.trim();
  if (!authToken) return null;
  return {
    org: SENTRY_ORG,
    url: SENTRY_URL,
    project,
    authToken,
    telemetry: false,
    release: { name: release, inject: false, setCommits: false, deploy: false },
    errorHandler: (error) => {
      // Felet kan citera förfrågan; token ska aldrig hamna i en bygglogg.
      const message = String(error?.message ?? error).split(authToken).join('[token]');
      console.warn(`[sentry] Source map upload for ${project} failed, the build continues without it: ${message}`);
    },
  };
}

/** En rad till byggloggen om vad som händer med källkartorna. */
export function uploadNotice(project, options) {
  return options
    ? `[sentry] Source maps for ${project} are uploaded as release ${options.release.name}.`
    : `[sentry] Source map upload for ${project} skipped: SENTRY_AUTH_TOKEN is not set.`;
}
