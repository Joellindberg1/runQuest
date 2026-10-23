// API-kontrakt för väntelistan (nivå 1): POST /api/waitlist (publik) och GET /api/admin/waitlist (admin).
// Endast typer och konstanter.
import type { ApiSuccess } from './common.js';
import { DATA_POLICY_VERSION } from '../legal/dataPolicy.js';

/**
 * Vilken samtyckestext anmälaren godkände; sparas i waitlist_signups.consent_version.
 * Alltid DATA_POLICY_VERSION (legal/dataPolicy.ts): versionen av den integritetstext som visades vid anmälan.
 */
export const WAITLIST_CONSENT_VERSION = DATA_POLICY_VERSION;

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
export type WaitlistSignupResponse = ApiSuccess<null>;

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
