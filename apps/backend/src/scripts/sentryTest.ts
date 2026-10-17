/**
 * sentryTest.ts — skickar EN testhändelse till Sentry, så att man kan se att DSN och miljötagg stämmer efter en deploy.
 *
 * Körs:  npm run sentry:test --workspace=@runquest/backend
 *   Läser SENTRY_DSN och SENTRY_ENVIRONMENT ur miljön (eller apps/backend/.env). Utan SENTRY_DSN skickas ingenting och
 *   skriptet slutar med kod 1. Händelsen är ett meddelande på nivå info med taggen sentry_test=true; sök på den i Sentry.
 *   Skriver ut miljön och DSN-värdens host, aldrig själva DSN:en.
 *
 * Mot staging (Railway-CLI:n injicerar miljön, ingen lokal .env):
 *   railway run --service runquest-backend-staging -- npm run sentry:test --workspace=@runquest/backend
 *
 * Mot den byggda koden (bevis för källkartan, RUN-285): bygget skapar dist/sentryTest.js. Efter ett bygge som laddat upp kartan
 * (SENTRY_AUTH_TOKEN satt) skickar `npm run sentry:test:built --workspace=@runquest/backend` samma händelse från den byggda koden;
 * stacken i Sentry ska visa src/observability/sentry.ts och inte dist/sentryTest.js. Kräver SENTRY_DSN.
 * Skriptet är inte monterat i någon router och nås inte av servern.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { captureTestEvent, flushSentry, initSentry } from '../observability/sentry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const FLUSH_TIMEOUT_MS = 10_000;

async function main(): Promise<number> {
  if (!initSentry()) {
    console.error('SENTRY_DSN is not set: nothing was sent.');
    return 1;
  }
  const environment = process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || 'development';
  const host = new URL(process.env.SENTRY_DSN!.trim()).host;
  const eventId = captureTestEvent();
  const delivered = await flushSentry(FLUSH_TIMEOUT_MS);
  console.log(`Test event ${eventId} sent to ${host} (environment: ${environment}, delivered: ${delivered}).`);
  console.log('Search Sentry for the tag sentry_test:true.');
  return delivered ? 0 : 1;
}

process.exit(await main());
