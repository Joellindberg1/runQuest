-- 048: user_settings — gles lagring av användarinställningar, en rad per (användare, nyckel). ADR 011 beslut 2 (B1, tabell) (RUN-184, v0.7.0).
-- Datum: 2026-10-14. APPLICERAD i prod 2026-10-15 (ägar-ja i chatten; Lead via Supabase MCP apply_migration,
-- name: 048_create_user_settings, och uppdaterar den här raden till APPLICERAD med datum).
--
-- Bakgrund: inställningarna (notify.<slag> med flera) lagras glest: bara uttryckligen satta värden finns som rader, saknad nyckel
-- betyder registrets default (SETTING_DEFINITIONS i packages/shared). Skäl för tabell i stället för en jsonb-kolumn på users:
--   - reglage trycks i följd; upsert på (user_id, key) är atomisk per nyckel, medan en JSON-kolumn ger read-modify-write av hela
--     objektet där samtidiga uppdateringar går förlorade;
--   - "återställ till default" är att radera raden;
--   - den känsliga tabellen users rörs inte.
-- Den här filen är bara tabellen. Rutten (GET/PUT /api/settings) och användningen kommer i senare leveranser.
--
-- Kolumner:
--   user_id     ägaren; on delete cascade, så en raderad användare tar sina inställningar med sig.
--   key         registernyckeln, 1-80 tecken (CHECK). Gränsen prövas mot de verkliga registernycklarna i userSettingsMigration.test.ts.
--   value       jsonb not null; typen (boolean eller enum-sträng) valideras i koden (sanitizePatch), inte i databasen, så att ett
--               nytt reglage inte kräver en migration. Ett uttryckligt värde som råkar vara lika med dagens default behålls.
--   updated_at  sätts vid insert; upsertens update-gren sätter den explicit (ingen trigger här).
--
-- Åtkomst: RLS på, inga policyer, revoke all från anon och authenticated. Tabellen läses och skrivs uteslutande av backend med
-- service role; PostgREST-anrop med anon- eller användarnyckel får ingenting.
--
-- Lås: create table tar inget lås på befintliga tabeller utom att främmande nyckeln mot users tar SHARE ROW EXCLUSIVE på users i
-- resten av transaktionen (millisekunder). Det blockerar skrivningar mot users (inte läsningar) och väntar själv bakom
-- pågående skrivande transaktioner på users. Första satsen, set local lock_timeout = '5s', gör att migrationen misslyckas i
-- stället för att köa skrivtrafiken mot users bakom en lång transaktion. set local gäller bara den pågående transaktionen
-- (apply_migration kör filen i en) och lämnar inget kvar i sessionen, så omkörning ger samma slutläge; körs filen utanför en
-- transaktion ger Postgres en varning och inställningen gör ingenting, men inget går sönder. Misslyckas den med lock_timeout: kör om.
-- Tabellen är ny och tom, så ingen validering av befintliga rader sker.
--
-- KÖRORDNING: additiv, applicera FÖRE backend-deployen i v0.7.0 (gammal kod känner inte till tabellen och märker ingenting).
-- Applicering och rutt hör till RUN-243.
--
-- Idempotent: create table if not exists; alter table ... enable row level security och revoke ger samma slutläge vid omkörning.
-- Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer).
--
-- Bevis efter apply (läsning, ändrar inget):
--   select relrowsecurity from pg_class where oid = 'public.user_settings'::regclass;   -- förväntat: true
--   select count(*) from pg_policies where tablename = 'user_settings';                 -- förväntat: 0
--   select has_table_privilege('anon', 'public.user_settings', 'select'),
--          has_table_privilege('authenticated', 'public.user_settings', 'select');       -- förväntat: false, false
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; raderar ALLA sparade användarinställningar, som då faller tillbaka
-- till registrets defaults). Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   drop table if exists public.user_settings;
-- Statiskt test: userSettingsMigration.test.ts.

set local lock_timeout = '5s';

create table if not exists public.user_settings (
  user_id    uuid        not null references public.users(id) on delete cascade,
  key        text        not null check (char_length(key) between 1 and 80),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_settings enable row level security;

revoke all on public.user_settings from anon, authenticated;
