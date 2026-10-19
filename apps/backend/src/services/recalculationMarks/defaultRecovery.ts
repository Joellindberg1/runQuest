// The production recovery job: the real mark store and the real recalculation (the Recompute port the webhook worker and the reconcile use).
import { createRecompute } from '../stravaWebhook/supabaseAdapters.js';
import { createRecalculationRecovery, type RecalculationRecovery } from './recovery.js';
import { createRecalculationMarkStore } from './supabaseStore.js';

export function createDefaultRecovery(): RecalculationRecovery {
  return createRecalculationRecovery({ store: createRecalculationMarkStore(), recompute: createRecompute() });
}
