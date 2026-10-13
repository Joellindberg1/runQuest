// API-kontrakt för väntelistan (nivå 1): POST /api/waitlist (publik) och GET /api/admin/waitlist (admin).
// Endast typer och konstanter.
import type { ApiSuccess } from './common.js';

/**
 * Vilken samtyckestext anmälaren godkände; sparas i waitlist_signups.consent_version.
 * PROVISORISK: den slutliga integritets-/samtyckestexten kommer i RUN-201 och ersätter då det här värdet.
 * Väntelisteformuläret (RUN-211) får inte publiceras innan dess.
 */
export const WAITLIST_CONSENT_VERSION = 'draft-2026-10-13';

/** Källa för anmälningar från landningssidan (waitlist_signups.source). */
export const WAITLIST_SOURCE_LANDING = 'landing';

/** Anmälningar snabbare än så här (ms från att formuläret visades) är bottar och sparas inte. */
export const WAITLIST_MIN_ELAPSED_MS = 2000;

/** Längsta tillåtna e-postadress (RFC 5321) — samma gräns som CHECK i waitlist_signups. */
export const WAITLIST_EMAIL_MAX_LENGTH = 254;

/** Body för POST /api/waitlist. `website` är honeypot-fältet (dolt i formuläret, ska vara tomt). */
export interface WaitlistSignupRequest {
  email: string;
  consent: true;
  website?: string;
  elapsedMs?: number;
}

/** Svar för POST /api/waitlist — identiskt för ny anmälan, dubblett, honeypot och tidsfälla (ingen e-postuppräkning). */
export type WaitlistSignupResponse = { success: true };

export interface AdminWaitlistEntry {
  id: string;
  email: string;
  created_at: string;
  source: string;
}

export interface AdminWaitlistData {
  entries: AdminWaitlistEntry[];
  total: number;
}

/** Svar för GET /api/admin/waitlist (nyast först). */
export type AdminWaitlistApiResponse = ApiSuccess<AdminWaitlistData>;
