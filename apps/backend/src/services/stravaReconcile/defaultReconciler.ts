// The production reconciler: the real ports, the webhook handler's own ports and the app's one rate budget.
import { stravaRateBudget } from '../stravaRateBudget.js';
import { createStravaReconciler, type StravaReconciler } from '../stravaReconcile.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import { createRecalculationMarkStore } from '../recalculationMarks/supabaseStore.js';
import { createReconcilePorts } from './adapters.js';

export function createDefaultReconciler(): StravaReconciler {
  return createStravaReconciler({
    ports: createReconcilePorts(),
    strava: createStravaApi(),
    runs: createRunStore(),
    recompute: createRecompute(),
    marks: createRecalculationMarkStore(),
    budget: stravaRateBudget,
  });
}
