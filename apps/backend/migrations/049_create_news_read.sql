-- 049: news_read — läst per rad ovanför golvet users.news_last_seen_id. ADR 011 beslut 4 (B3, ny tabell) (RUN-185, v0.7.0).
-- Datum: 2026-10-14. EJ APPLICERAD i prod (kräver ägarens uttryckliga ja; Lead applicerar via Supabase MCP apply_migration,
-- name: 049_create_news_read, och uppdaterar den här raden till APPLICERAD med datum).
--
-- Bakgrund: läst-läget är per rad. Golvet users.news_last_seen_id (ADR 008, migration 034) behålls oförändrat: allt med
-- activity_log.id <= golvet räknas som läst. Rader ovanför golvet kvitteras en och en i den här tabellen (hover, fokus eller
-- touch i UI, via POST /api/news/read). Ingen backfill och ingen datamigrering: varje användare börjar utan news_read-rader, och
-- tom news_read + befintligt golv = dagens läge. "Mark all read" (POST /api/news/seen) höjer golvet och raderar sedan
-- rader <= nya golvet (pruning, best-effort; rader under golvet är inerta). Den här filen är bara tabellen; rutten och
-- oläst-beräkningen (isNotifiable) kommer i senare leveranser.
--
-- Kolumner (hela listan fästs av newsReadMigration.test.ts):
--   user_id      läsaren; on delete cascade, så en raderad användare tar sina kvitton med sig.
--   activity_id  den lästa raden, bigint (activity_log.id är bigint generated always as identity, 034); on delete cascade, så en
--                retractad rad (utmaning återkallad, badge förlorad, dagens rank_passed ångrad) städar sina kvitton av sig själv.
--   read_at      sätts vid insert (default now()).
--   Primärnyckel (user_id, activity_id): ett kvitto per användare och rad; upsert med ignoreDuplicates gör POST idempotent
--   och nyckelns ledande kolumn user_id täcker uppslaget "den här användarens kvitton".
--
-- Index news_read_activity_idx (activity_id): primärnyckeln börjar på user_id och hjälper inte när en activity_log-rad raderas.
-- Utan indexet måste varje cascade från activity_log (retract, retention) skanna hela news_read. Med det blir den ett indexuppslag.
--
-- Privat: vad en användare läst exponeras aldrig för andra. RLS på, inga policyer, revoke all från anon och authenticated.
-- Tabellen läses och skrivs uteslutande av backend med service role; PostgREST-anrop med anon- eller användarnyckel får ingenting.
--
-- Lås: två främmande nycklar, så create table tar SHARE ROW EXCLUSIVE på BÅDE users och activity_log i resten av transaktionen
-- (millisekunder, tabellen är ny och tom så ingen validering av befintliga rader sker). Det blockerar skrivningar (insert, update,
-- delete) mot de två tabellerna, inte läsningar, och migrationen väntar själv bakom pågående skrivande transaktioner. activity_log
-- skrivs vid varje rundlogg (titlar, levels, utmaningar, badges), så den tabellen är den känsliga: en lång transaktion där
-- kan annars få migrationens lås att köa och all skrivtrafik bakom sig. Första satsen, set local lock_timeout = '5s', gör att
-- migrationen misslyckas i stället. set local gäller bara den pågående transaktionen (apply_migration kör filen i en) och lämnar
-- inget kvar i sessionen, så omkörning ger samma slutläge; körs filen utanför en transaktion ger Postgres en varning och
-- inställningen gör ingenting, men inget går sönder. Misslyckas den med lock_timeout: kör om, helst när ingen runda loggas.
--
-- KÖRORDNING: additiv, applicera FÖRE backend-deployen i v0.7.0 (ADR 011 beslut 10, steg 2). Gammal kod känner inte till tabellen
-- och märker ingenting. Ny backend läser tabellen i GET /news och POST /news/read och ger 500 om den saknas.
-- Applicering och rutt hör till senare leveranser.
--
-- Idempotent: create table if not exists och create index if not exists; alter table ... enable row level security och revoke ger
-- samma slutläge vid omkörning. Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer).
--
-- Bevis efter apply (läsning, ändrar inget):
--   select relrowsecurity from pg_class where oid = 'public.news_read'::regclass;       -- förväntat: true
--   select count(*) from pg_policies where tablename = 'news_read';                     -- förväntat: 0
--   select has_table_privilege('anon', 'public.news_read', 'select'),
--          has_table_privilege('authenticated', 'public.news_read', 'select');          -- förväntat: false, false
--   select conname, confdeltype from pg_constraint
--     where conrelid = 'public.news_read'::regclass and contype = 'f' order by conname; -- förväntat: två rader, båda confdeltype 'c' (cascade)
--   select indexname from pg_indexes
--     where tablename = 'news_read' order by indexname;                                 -- förväntat: news_read_activity_idx, news_read_pkey
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; raderar ALLA läst-kvitton ovanför golvet, så rader som lästs
-- sedan senaste "Mark all read" blir olästa igen). Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   drop table if exists public.news_read;
-- Statiskt test: newsReadMigration.test.ts.

set local lock_timeout = '5s';

create table if not exists public.news_read (
  user_id     uuid        not null references public.users(id) on delete cascade,
  activity_id bigint      not null references public.activity_log(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (user_id, activity_id)
);

create index if not exists news_read_activity_idx on public.news_read (activity_id);

alter table public.news_read enable row level security;

revoke all on public.news_read from anon, authenticated;
