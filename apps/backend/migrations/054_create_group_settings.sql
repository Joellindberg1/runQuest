-- 054: group_settings — gles lagring av gruppinställningar, en rad per (grupp, nyckel). ADR 012 beslut 6 (RUN-296, v0.8.0).
-- Datum: 2026-10-18. Kräver ägar-ja per miljö: först staging (supabase-staging), sedan prod. Körs av Lead, aldrig av en builder.
-- (Nummer 054: 053 är group_members, RUN-294, som byggs på en annan gren. Den här filen beror inte på den.)
--
-- Bakgrund: gruppens admin ska kunna ändra gruppens inställningar (säsongslängd, XP-regelpaket m.fl. i senare ADR:er). Lagringen
-- är gles, som user_settings (048): bara uttryckligen satta värden finns som rader, saknad nyckel betyder registrets default
-- (SETTING_DEFINITIONS med scope 'group' i packages/shared). Skäl för tabell i stället för en jsonb-kolumn på groups:
--   - upsert på (group_id, key) är atomisk per nyckel, medan en JSON-kolumn ger read-modify-write av hela objektet;
--   - "återställ till default" är att radera raden;
--   - groups (som bär inbjudningskoden) rörs inte.
-- Den här filen är bara tabellen. Rutten (GET/PUT /api/groups/settings), rollkontrollen och registret kommer i senare stories.
-- Inga produktionsnycklar finns i v0.8.0, så tabellen är tom efter apply.
--
-- Kolumner:
--   group_id    gruppen; on delete cascade, så en nedlagd grupp tar sina inställningar med sig.
--   key         registernyckeln, 1-80 tecken (CHECK), samma gräns som user_settings.
--   value       jsonb not null; typen valideras i koden (sanitizePatch), inte i databasen, så att en ny nyckel inte kräver en
--               migration. Ett uttryckligt värde som råkar vara lika med dagens default behålls.
--   updated_by  vem som senast skrev raden. Nullable och on delete set null. Skäl: updated_by är spårbarhet, inte behörighet
--               (behörigheten prövas färskt i koden mot gruppmedlemskapet, ADR 012 beslut 6.4). Ett annat val än set null vore fel:
--                 - on delete cascade skulle radera gruppens inställningar när den admin som skrev dem raderas, trots att de
--                   tillhör gruppen och inte personen;
--                 - no action/restrict skulle få raderingen av ett användarkonto att stoppas av en inställning gruppen äger;
--                 - not null går inte ihop med set null, och en systemskrivning (skript, backfill) har ingen användare.
--               Efter set null är raden kvar och updated_by null; "okänd/raderad användare" är då ett giltigt, ärligt läge.
--   updated_at  sätts vid insert; upsertens update-gren sätter den explicit (ingen trigger här), som user_settings.
--
-- Åtkomst: RLS på, inga policyer, revoke all från anon och authenticated. Tabellen läses och skrivs uteslutande av backend med
-- service role; PostgREST-anrop med anon- eller användarnyckel får ingenting (docs/permissions.md).
--
-- Lås: create table tar inget lås på befintliga tabeller utom att de främmande nycklarna mot groups och users tar SHARE ROW
-- EXCLUSIVE på dem i resten av transaktionen (millisekunder). Det blockerar skrivningar mot groups och users (inte läsningar) och
-- väntar själv bakom pågående skrivande transaktioner. Första satsen, set local lock_timeout = '5s', gör att migrationen
-- misslyckas i stället för att köa skrivtrafiken bakom en lång transaktion. set local gäller bara den pågående transaktionen
-- (apply_migration kör filen i en) och lämnar inget kvar i sessionen, så omkörning ger samma slutläge; körs filen utanför en
-- transaktion ger Postgres en varning och inställningen gör ingenting, men inget går sönder. Misslyckas den med lock_timeout: kör om.
-- Tabellen är ny och tom, så ingen validering av befintliga rader sker.
--
-- KÖRORDNING: additiv, oberoende av 053 och av övriga ADR 012-migrationer. Applicera FÖRE backend-deployen i v0.8.0 (gammal
-- kod känner inte till tabellen och märker ingenting). Ingen kod läser eller skriver tabellen förrän S11 (RUN-296:s efterföljare).
--
-- Idempotent: create table if not exists; alter table ... enable row level security och revoke ger samma slutläge vid omkörning.
-- Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer).
--
-- Bevis efter apply (läsning, ändrar inget; Lead kör i staging):
--   select relrowsecurity from pg_class where oid = 'public.group_settings'::regclass;   -- förväntat: true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'group_settings';   -- förväntat: 0
--   select has_table_privilege('anon', 'public.group_settings', 'select'),
--          has_table_privilege('authenticated', 'public.group_settings', 'select');       -- förväntat: false, false
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.group_settings'::regclass order by conname;
--     -- förväntat: PRIMARY KEY (group_id, key); FK group_id -> groups(id) ON DELETE CASCADE; FK updated_by -> users(id) ON DELETE
--     --            SET NULL; CHECK char_length(key) between 1 and 80
--   select count(*) from public.group_settings;                                           -- förväntat: 0
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; raderar ALLA sparade gruppinställningar, som då faller tillbaka
-- till registrets defaults). Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   drop table if exists public.group_settings;
-- Statiskt test: groupSettingsMigration.test.ts.

set local lock_timeout = '5s';

create table if not exists public.group_settings (
  group_id   uuid        not null references public.groups(id) on delete cascade,
  key        text        not null check (char_length(key) between 1 and 80),
  value      jsonb       not null,
  updated_by uuid                 references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_id, key)
);

alter table public.group_settings enable row level security;

revoke all on public.group_settings from anon, authenticated;
