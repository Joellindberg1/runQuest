-- 042: update_title_leaderboard serialiseras per titel med pg_advisory_xact_lock (RUN-158, intern v0.6.1.1).
-- Datum: 2026-10-12. APPLICERAD i prod 2026-10-12 (ägar-ja) via Supabase MCP apply_migration
-- (name: 042_title_leaderboard_advisory_lock) efter ägar-ja. (040 är reserverat för RUN-112, 041 är körd.)
--
-- Problem: update_title_leaderboard(p_title_id) bygger om den delade title_leaderboard för EN titel med
-- DELETE + INSERT ... SELECT, och triggern title_leaderboard_update_trigger (migration 001, efter varje
-- insert/update/delete på user_titles) anropar den. Två transaktioner som bygger om SAMMA titel samtidigt
-- (READ COMMITTED) ser var sin ögonblicksbild: båda raderar de rader de ser och försöker sätta in sin topp 10,
-- och den andra krockar på unika nyckeln (title_id, position) med 23505. RUN-157 gjorde appens egen
-- omräkning sekventiell, men samtidiga anrop från olika förfrågningar (Strava-synk, rundloggning, admin
-- reprocess-all) kan fortfarande mötas i databasen.
--
-- Åtgärd: första satsen i funktionen tar pg_advisory_xact_lock med en nyckel härledd ur title_id. Samtidiga
-- ombyggnader av SAMMA titel köar då upp sig; ombyggnader av OLIKA titlar blockerar inte varandra (nyckeln är
-- per titel). Låset släpps automatiskt vid transaktionens slut (xact-varianten), så inget kan läcka. I
-- READ COMMITTED tar varje sats i plpgsql-funktionen en ny ögonblicksbild, så den som väntat på låset ser den
-- förres committade rader när dess DELETE/INSERT körs — slutläget är den senaste ombyggnaden, utan 23505.
--
-- Bevarat oförändrat: signatur (uuid -> void), språk plpgsql, `set search_path to ''` (som i prod, se
-- 000_baseline.sql), kroppen i övrigt (DELETE, INSERT topp 10 med ROW_NUMBER, UPDATE av titles) och triggern
-- title_leaderboard_update_trigger/trigger_update_title_leaderboard. create or replace behåller funktionens
-- befintliga behörigheter (grants) och kommentar. Ingen policyändring, inga tabeller/kolumner/index/data rörs.
--
-- Nyckel: hashtextextended('title_leaderboard:' || p_title_id::text, 0) ger en bigint; prefixet håller nyckeln
-- skild från andra framtida advisory-lås i projektet (inga advisory-lås används idag).
--
-- KÖRORDNING: additiv och bakåtkompatibel, så den kan köras FÖRE eller EFTER en backend-deploy; appkoden i
-- RUN-158 (ärligt svar från reprocess-all, logger.warn) beror inte på låset och låset beror inte på appkoden.
--
-- Känd kvarvarande risk (accepterad): update_all_title_leaderboards() anropar funktionen för alla titlar i EN
-- transaktion och håller därför alla titellås tills den committar; en enskild ombyggnad som kommer under tiden
-- väntar. Ett deadlock vore bara möjligt för en transaktion som själv låser flera titlar i en annan ordning än
-- update_all (t.ex. en bulk-DML över flera titlar på user_titles) — appen gör inga sådana; Postgres avbryter då
-- en av dem med 40P01 i stället för att hänga.
--
-- Idempotent: create or replace — en omkörning ger samma slutläge.
-- Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer).
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja): återställ funktionen utan låset, identisk med
-- 000_baseline.sql:
--   create or replace function public.update_title_leaderboard(p_title_id uuid)
--    returns void
--    language plpgsql
--    set search_path to ''
--   as $function$
--   begin
--       delete from public.title_leaderboard where title_id = p_title_id;
--
--       insert into public.title_leaderboard (title_id, user_id, position, value, earned_at)
--       select
--           p_title_id,
--           ut.user_id,
--           row_number() over (order by ut.value desc, ut.earned_at asc) as position,
--           ut.value,
--           ut.earned_at
--       from public.user_titles ut
--       where ut.title_id = p_title_id
--         and ut.value is not null
--       order by ut.value desc, ut.earned_at asc
--       limit 10;
--
--       update public.titles
--       set
--           current_holder_id = (
--               select user_id from public.title_leaderboard
--               where title_id = p_title_id and position = 1
--           ),
--           current_value = (
--               select value from public.title_leaderboard
--               where title_id = p_title_id and position = 1
--           ),
--           updated_at = now()
--       where id = p_title_id;
--   end;
--   $function$;
-- Statiskt test: titleLeaderboardLockMigration.test.ts.

create or replace function public.update_title_leaderboard(p_title_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
begin
    -- Måste vara första satsen: allt nedan ska köras först när ingen annan ombyggnad av samma titel pågår.
    perform pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || p_title_id::text, 0));

    delete from public.title_leaderboard where title_id = p_title_id;

    insert into public.title_leaderboard (title_id, user_id, position, value, earned_at)
    select
        p_title_id,
        ut.user_id,
        row_number() over (order by ut.value desc, ut.earned_at asc) as position,
        ut.value,
        ut.earned_at
    from public.user_titles ut
    where ut.title_id = p_title_id
      and ut.value is not null
    order by ut.value desc, ut.earned_at asc
    limit 10;

    update public.titles
    set
        current_holder_id = (
            select user_id from public.title_leaderboard
            where title_id = p_title_id and position = 1
        ),
        current_value = (
            select value from public.title_leaderboard
            where title_id = p_title_id and position = 1
        ),
        updated_at = now()
    where id = p_title_id;
end;
$function$;
