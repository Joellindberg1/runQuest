// Väntelista nivå 1: POST /api/waitlist (publik, ingen JWT). Adressen sparas i waitlist_signups (migration 044) och syns
// i Admin; inget mail skickas och ingen extern tjänst anropas. ADR 007 A: { success, ... } / { error }.
//
// Ingen e-postuppräkning: ny anmälan, dubblett, honeypot och tidsfälla ger exakt samma svar (200 { success: true }).
// Adressen loggas aldrig — varken i klartext eller i felmeddelanden (loggarna sparas i Railway).
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import {
  WAITLIST_CONSENT_VERSION,
  WAITLIST_EMAIL_MAX_LENGTH,
  WAITLIST_MIN_ELAPSED_MS,
  WAITLIST_SOURCE_LANDING,
  type WaitlistSignupResponse,
} from '@runquest/shared';
import { fail, ok } from '../utils/respond.js';

const router = express.Router();

/** 5 anmälningsförsök per 15 minuter och IP, på en egen räknare (delas inte med login). */
const waitlistRateLimiter = createRateLimiter(15 * 60 * 1000, 5);

const BODY_LIMIT = '1kb';
const LOCAL_PART_MAX = 64;
// Medvetet löst: något@domän.tld utan blanksteg/styrtecken. Verklig leverans prövas först när nivå 2 skickar mail.
const EMAIL_SHAPE = /^[^\s@\u0000-\u001f]+@[^\s@.\u0000-\u001f]+(?:\.[^\s@.\u0000-\u001f]+)+$/;

/** Trim + gemener, eller null om värdet inte är en rimlig e-postadress. */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > WAITLIST_EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(email)) return null;
  if (email.indexOf('@') > LOCAL_PART_MAX) return null;
  return email;
}

// Fältet är dolt för människor: allt utom saknat/tomt (även blanksteg) betyder att en bot har fyllt i det.
const isFilled = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

router.post('/', waitlistRateLimiter, express.json({ limit: BODY_LIMIT }), async (req, res): Promise<void> => {
  const body: Record<string, unknown> = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  // Samma svar för ny anmälan, dubblett, honeypot och tidsfälla (ingen e-postuppräkning): { success: true, data: null }.
  const accepted = (): void => ok<WaitlistSignupResponse>(res, null);

  // Botfällor först och tyst: en bot ska inte få ett 400 att lära sig av. Saknat elapsedMs är giltigt (klienter utan JS).
  if (isFilled(body.website)) { accepted(); return; }
  if (typeof body.elapsedMs === 'number' && body.elapsedMs < WAITLIST_MIN_ELAPSED_MS) { accepted(); return; }

  if (body.consent !== true) { fail(res, 400, 'Consent is required', 'consent_required'); return; }
  const email = normalizeEmail(body.email);
  if (!email) { fail(res, 400, 'A valid email address is required'); return; }

  // ON CONFLICT (email) DO NOTHING: en dubblett ger ingen andra rad och inget fel som skiljer sig från en ny anmälan.
  const { error } = await getSupabaseClient()
    .from('waitlist_signups')
    .upsert(
      { email, source: WAITLIST_SOURCE_LANDING, consent_version: WAITLIST_CONSENT_VERSION },
      { onConflict: 'email', ignoreDuplicates: true },
    );

  if (error) {
    // Bara felkoden: PostgREST-meddelandet och details kan innehålla adressen.
    logger.error(`❌ Waitlist signup failed (${errorCode(error)})`);
    // 23514 = CHECK-villkoren i 044 (normaliserad, ≤ 254): adressen kan inte lagras, oavsett vad den är -> inte en serverstörning.
    if (error.code === '23514') { fail(res, 400, 'A valid email address is required'); return; }
    fail(res, 500, 'Failed to join the waitlist');
    return;
  }

  accepted();
});

// Fel från body-parsern (för stor body, trasig JSON) tas av den centrala felhanteraren i createApp() (jsonErrorHandler): 413 payload_too_large och 400 invalid_json.

export default router;
