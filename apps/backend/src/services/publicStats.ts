// Publik summering för landningssidan: antal löpare, avgjorda utmaningar och totala km.
// Endast tre heltal lämnar tjänsten — aldrig rader eller persondata. Läser via service role.
import { getSupabaseClient } from '../config/database.js';

export interface PublicStats {
  runners: number;
  challenges: number;
  km: number;
}

export const PUBLIC_STATS_TTL_MS = 5 * 60 * 1000;

/** 'completed' är challenges terminala status (challengeService sätter den vid avgörande); pending/active är pågående. */
const SETTLED_CHALLENGE_STATUS = 'completed';

// PostgREST kapar svar vid 1000 rader som standard, och aggregat (distance.sum()) är avstängda i Supabase
// om inte projektet slagit på dem. Därför summeras distance i sidor — ingen ny SQL-funktion/migration.
const PAGE_SIZE = 1000;

async function countRows(table: string, settledOnly = false): Promise<number> {
  let query = getSupabaseClient().from(table).select('id', { count: 'exact', head: true });
  if (settledOnly) query = query.eq('status', SETTLED_CHALLENGE_STATUS);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Summerar runs.distance över alla användare, i hundradelar (kolumnen är numeric(6,2)) så att flyttalsfel inte
 * ackumuleras. Keyset-paginering på id (inte offset): en offset exakt vid tabellens slut ger 416 från PostgREST,
 * och nya rader under läsningen förskjuter inte sidorna. Bara id (slumpad uuid) och distance hämtas.
 */
async function sumKm(): Promise<number> {
  let hundredths = 0;
  let after: string | null = null;
  for (;;) {
    let query = getSupabaseClient().from('runs').select('id, distance').order('id', { ascending: true }).limit(PAGE_SIZE);
    if (after !== null) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; distance: number | string | null }>;
    for (const r of rows) hundredths += Math.round(Number(r.distance ?? 0) * 100);
    if (rows.length < PAGE_SIZE) break;
    after = rows[rows.length - 1].id;
  }
  return Math.round(hundredths / 100);
}

async function loadStats(): Promise<PublicStats> {
  const [runners, challenges, km] = await Promise.all([countRows('users'), countRows('challenges', true), sumKm()]);
  return { runners, challenges, km };
}

let cached: { value: PublicStats; expiresAt: number } | null = null;
let inflight: Promise<PublicStats> | null = null;

/** Cachad i minnet (per process) i 5 min. Samtidiga anrop på kall cache delar en laddning; ett fel cachas aldrig. */
export function getPublicStats(): Promise<PublicStats> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) return Promise.resolve(cached.value);
  if (inflight) return inflight;
  inflight = loadStats()
    .then((value) => {
      cached = { value, expiresAt: Date.now() + PUBLIC_STATS_TTL_MS };
      return value;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Endast för tester. */
export function resetPublicStatsCache(): void {
  cached = null;
  inflight = null;
}
