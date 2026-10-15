-- 045: strava_tokens får Strava-identitet, samtyckeslogg och pausflagga — "Migration A" i ADR 010 (RUN-164, v0.7.0).
-- Datum: 2026-10-14. APPLICERAD i prod 2026-10-15 (ägar-ja i chatten; Lead via Supabase MCP apply_migration,
-- name: 045_strava_athlete_consent_pause, och uppdaterar den här raden till APPLICERAD med datum).
--
-- Bakgrund: en Strava-webhook-händelse bär bara owner_id (Stravas athlete-id). strava_tokens saknar den identiteten, så
-- ingen händelse går att koppla till en RunQuest-användare, och POST /api/strava/callback kastar tokenData.athlete
-- (ADR 010 beslut 4). Samtyckeslogg (D3, beslut 12) och pausflagga för "Pausa synk" (beslut 7.5) ingår här för att hålla
-- det till en migration.
--
-- Kolumner (alla på public.strava_tokens):
--   strava_athlete_id bigint          Stravas athlete-id. Null för de sex befintliga kopplingarna tills skriptet
--                                     backfillStravaAthleteIds fyllt i det (egen ask) och för kopplingar där Strava inte
--                                     skickade något athlete-objekt.
--   consent_version   text            vilken samtyckestext användaren godkände. Null = kopplad före samtyckesloggen
--                                     (de sex, godkända muntligt via ägaren, D4). Ingen omkoppling.
--   consented_at      timestamptz     när samtycket gavs (sätts av servern). Null av samma skäl.
--   sync_paused       boolean not null default false
--                                     "Pausa synk". Default false ger de sex befintliga kopplingarna false utan backfill.
--   paused_at         timestamptz     när synken pausades; null när den inte är pausad.
--
-- Unikt partiellt index strava_tokens_athlete_id_key på (strava_athlete_id) där det inte är null: samma Strava-konto kan
-- inte höra till två RunQuest-användare (kolliderande insert/upsert ger 23505, som callbacken svarar 409 på). Rader utan
-- athlete-id ingår inte i indexet och krockar aldrig med varandra.
--
-- Åtkomst: RLS på, inga policyer (RLS-baslinjen enligt permissions.md gäller oförändrad). Migrationen rör inga policyer,
-- grants eller RLS-inställningar; tabellen läses och skrivs uteslutande via backend (service role).
--
-- KÖRORDNING: applicera DENNA migration FÖRE deploy av backend-koden i v0.7.0 (ADR 010: A, B och C körs alla före
-- backend-deployen). Den nya callbacken skriver strava_athlete_id och sync_paused; saknas kolumnerna misslyckas varje
-- anslutning av Strava (PostgREST: okänd kolumn). Migrationen är additiv och bakåtkompatibel — den gamla koden ignorerar
-- kolumnerna och sync_paused har default false — så den kan inte skada en backend som ännu inte deployats. Rollback av
-- backend-koden kräver ingen rollback av migrationen.
--
-- Idempotent: add column if not exists + create unique index if not exists — en omkörning ger samma slutläge. Ingen egen
-- begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer). Ingen data ändras.
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; tar bort sparade athlete-id, samtycken och pausflaggor, inga
-- rundor). Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   drop index if exists public.strava_tokens_athlete_id_key;
--   alter table public.strava_tokens drop column if exists paused_at;
--   alter table public.strava_tokens drop column if exists sync_paused;
--   alter table public.strava_tokens drop column if exists consented_at;
--   alter table public.strava_tokens drop column if exists consent_version;
--   alter table public.strava_tokens drop column if exists strava_athlete_id;
-- Statiskt test: stravaAthleteMigration045.test.ts.

alter table public.strava_tokens
  add column if not exists strava_athlete_id bigint;

alter table public.strava_tokens
  add column if not exists consent_version text;

alter table public.strava_tokens
  add column if not exists consented_at timestamptz;

alter table public.strava_tokens
  add column if not exists sync_paused boolean not null default false;

alter table public.strava_tokens
  add column if not exists paused_at timestamptz;

create unique index if not exists strava_tokens_athlete_id_key
  on public.strava_tokens (strava_athlete_id)
  where strava_athlete_id is not null;
