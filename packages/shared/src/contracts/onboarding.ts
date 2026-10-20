import type { DualEnvelope } from './common.js';

// API-kontrakt för GET /api/onboarding/status och POST /api/onboarding/mark-seen: slugarna användaren redan sett (förstagångsturen, "What's new"-popuper, sidoturer). Endast typer.

/** Svar för GET /api/onboarding/status: `{ success, seen, data: { seen } }` (steg 1 av kuvertbytet, ADR 007 Addendum 2026-10-20; `seen` på toppnivå tas bort i steg 2). */
export type OnboardingStatusResponse = DualEnvelope<{ seen: string[] }>;

/** Brödtext till POST /api/onboarding/mark-seen. Idempotent: samma slug igen ändrar inget. */
export interface OnboardingMarkSeenRequest {
  slug: string;
}

/** Svar för POST /api/onboarding/mark-seen: `{ success, ok: true, data: null }` (steg 1; `ok` på toppnivå tas bort i steg 2). */
export type OnboardingMarkSeenResponse = DualEnvelope<{ ok: true }, null>;
