/**
 * backfillTreadmill.ts
 *
 * Hämtar trainer-fältet från Strava API för alla historiska rundor och
 * sätter is_treadmill på runs-tabellen.
 *
 * Kör med:  npm run backfill:treadmill --workspace=@runquest/backend
 *
 * Strava rate limit: 100 req / 15 min, 1000 req / dag.
 * Scriptet pausar automatiskt 15 min efter varje 90 förfrågningar.
 */

import 'dotenv/config';
import { getSupabaseClient } from '../config/database.js';

// ─── Konstanter ──────────────────────────────────────────────────────────────

const RATE_LIMIT_BATCH   = 90;          // requests innan vi pausar
const RATE_LIMIT_PAUSE   = 15 * 60 * 1000; // 15 min i ms
const REQUEST_DELAY_MS   = 500;         // ms mellan varje request

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function refreshToken(refreshToken: string, userId: string): Promise<string | null> {
  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Strava credentials saknas i .env');

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });

  if (!res.ok) {
    console.error(`  ❌ Token refresh misslyckades för ${userId}`);
    return null;
  }

  const data = await res.json() as any;
  const supabase = getSupabaseClient();
  await supabase
    .from('strava_tokens')
    .update({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
    })
    .eq('user_id', userId);

  return data.access_token;
}

async function fetchTrainerField(
  activityId: string,
  accessToken: string
): Promise<boolean | null> {
  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 429) {
    console.warn('  ⚠️  Rate limit träffad — pausar 15 min...');
    await sleep(RATE_LIMIT_PAUSE);
    // Försök igen
    const retry = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!retry.ok) return null;
    const data = await retry.json() as any;
    return data.trainer === true;
  }

  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.trainer === true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabaseClient();

  console.log('🏃 Backfill is_treadmill startar...\n');

  // 1. Hämta alla användare med Strava-koppling
  const { data: tokens, error: tokensError } = await supabase
    .from('strava_tokens')
    .select('user_id, access_token, refresh_token, expires_at, users(name)');

  if (tokensError || !tokens?.length) {
    console.error('❌ Kunde inte hämta strava_tokens:', tokensError?.message);
    process.exit(1);
  }

  console.log(`👥 Hittade ${tokens.length} Strava-anslutna användare\n`);

  let totalRequests = 0;
  let totalUpdated  = 0;

  for (const tokenRow of tokens) {
    const userId   = tokenRow.user_id;
    const userName = (tokenRow.users as any)?.name ?? userId;

    console.log(`─────────────────────────────────`);
    console.log(`👤 ${userName}`);

    // 2. Hämta access token, refresh om nödvändigt
    const now = Math.floor(Date.now() / 1000);
    let accessToken = tokenRow.access_token;

    if (tokenRow.expires_at && tokenRow.expires_at < now) {
      console.log('  🔄 Token utgången, refreshar...');
      const refreshed = await refreshToken(tokenRow.refresh_token, userId);
      if (!refreshed) {
        console.error('  ❌ Kunde inte refresha token, hoppar över användaren');
        continue;
      }
      accessToken = refreshed;
    }

    // 3. Hämta alla Strava-rundor för användaren
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select('id, external_id, date, is_treadmill')
      .eq('user_id', userId)
      .eq('source', 'strava')
      .not('external_id', 'is', null)
      .order('date', { ascending: false });

    if (runsError || !runs?.length) {
      console.log('  ℹ️  Inga Strava-rundor hittade');
      continue;
    }

    console.log(`  📋 ${runs.length} Strava-rundor att bearbeta`);

    let userUpdated  = 0;
    let userSkipped  = 0;
    let userErrors   = 0;

    for (const run of runs) {
      // Pausar automatiskt var 90:e request
      if (totalRequests > 0 && totalRequests % RATE_LIMIT_BATCH === 0) {
        console.log(`\n⏸️  ${RATE_LIMIT_BATCH} requests gjorda — pausar 15 min för rate limit...`);
        await sleep(RATE_LIMIT_PAUSE);
        console.log('▶️  Fortsätter...\n');
      }

      // 4. Hämta trainer-fältet från Strava
      const isTreadmill = await fetchTrainerField(run.external_id!, accessToken);
      totalRequests++;

      if (isTreadmill === null) {
        console.log(`  ⚠️  ${run.date} (${run.external_id}) — kunde inte hämta data`);
        userErrors++;
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // 5. Uppdatera databasen
      const { error: updateError } = await supabase
        .from('runs')
        .update({ is_treadmill: isTreadmill })
        .eq('id', run.id);

      if (updateError) {
        console.error(`  ❌ ${run.date} — DB-uppdatering misslyckades:`, updateError.message);
        userErrors++;
      } else {
        const label = isTreadmill ? '🏃 löpband' : '🌳 ute';
        console.log(`  ✅ ${run.date} — ${label}`);
        userUpdated++;
        totalUpdated++;
      }

      await sleep(REQUEST_DELAY_MS);
    }

    console.log(`  📊 ${userName}: ${userUpdated} uppdaterade, ${userSkipped} hoppade, ${userErrors} fel`);
    await sleep(2000); // extra paus mellan användare
  }

  console.log('\n═════════════════════════════════════');
  console.log(`✅ Backfill klar!`);
  console.log(`   Totalt uppdaterade rundor: ${totalUpdated}`);
  console.log(`   Totalt API-requests:       ${totalRequests}`);
  console.log('═════════════════════════════════════\n');
}

main().catch(err => {
  console.error('💥 Oväntat fel:', err);
  process.exit(1);
});
