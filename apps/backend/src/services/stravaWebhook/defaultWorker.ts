// The production worker: the real ports (supabaseAdapters.ts), the registered handlers and the app's one rate budget.
import { stravaRateBudget } from '../stravaRateBudget.js';
import { createStravaWebhookWorker, type StravaWebhookWorker } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from './handlers.js';
import { createRecompute, createRunStore, createStravaApi, createWebhookEventStore } from './supabaseAdapters.js';

export function createDefaultWebhookWorker(): StravaWebhookWorker {
  return createStravaWebhookWorker({
    store: createWebhookEventStore(),
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: createRecompute(),
    handlers: STRAVA_WEBHOOK_HANDLERS,
    budget: stravaRateBudget,
  });
}
