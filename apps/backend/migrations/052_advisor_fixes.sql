-- 052: Supabase-säkerhetsråd (advisors): fast search_path på increment_event_xp, det döda cron-jobbet och pg_net bort,
-- security_invoker på title_leaderboard_view (RUN-226, säkerhetsgenomgång RUN-96).
-- Datum: 2026-10-18. Kräver ägar-ja per miljö: först staging (supabase-staging), sedan prod. Körs av Lead, aldrig av en builder.
--
-- SYFTE
-- Lead körde get_advisors (security) mot prod 2026-10-18. Två WARN som koden själv kan åtgärda, plus ett härdningsbeslut om vyn:
--   1. function_search_path_mutable: public.increment_event_xp(p_user_id uuid, p_xp integer) har ingen fast search_path. Den är en
--      SQL-funktion med säkerhetsläge INVOKER och tabellnamnet `users` utan schema (000_baseline.sql rad 465-473), så den slår
--      upp `users` via anroparens search_path. Åtgärd: `set search_path to ''` och fullt kvalificerade namn (public.users), som
--      övriga funktioner sedan 039/042. Signatur (uuid, integer), returtyp void, språk sql, säkerhetsläge (invoker) och
--      beteende (event_xp och total_xp ökar med p_xp för raden med id = p_user_id) är oförändrade. `create or replace`
--      behåller funktionens ägare, behörigheter (grants) och kommentar; migrationen ändrar inga behörigheter.
--   2. extension_in_public: pg_net 0.14.0 ligger i schemat public. Enda användningen är pg_cron-jobbet jobid 1 (`strava-sync-
--      every-3-hours`, schema `0 */3 * * *`, användare postgres), som gör net.http_post mot Edge Function strava-sync med en gammal
--      anon-JWT i headern. Funktionen finns inte längre: alla svar de senaste 7 dagarna är 404, så jobbet "lyckas" var 3:e timme
--      utan att göra något. Strava-synken sköts av backend (stravaReconcile, webhooks, 12-timmarspollning). Åtgärd: avregistrera
--      jobbet (matchat på sin url-del, inte på ett hårdkodat jobid) och försök ta bort pg_net (se ÄGARSTEG nedan).
--   3. title_leaderboard_view saknar reloptions (alltså inte security_invoker), dvs. den körs med ägarens (postgres) rättigheter
--      och går förbi RLS på titles, title_leaderboard och users. Sedan 039 har ingen klientroll SELECT på vyn, så ingenting läcker
--      idag. Beslut: sätt security_invoker = true (försvar på djupet; se nedan).
--
-- FÖRE-LÄGE (Leads läsning av prod och staging 2026-10-18)
--   Prod:
--   - increment_event_xp: proconfig null (inget search_path), INVOKER. Inga triggers på public.users.
--   - pg_net 0.14.0 i schemat public, relocatable = false, ÄGARE supabase_admin. pg_cron 1.6 i pg_catalog, ägare supabase_admin.
--     Migrationsrollen är `postgres` (rolsuper = false) och är INTE medlem i ägarrollen, så `drop extension pg_net` nekas
--     (insufficient_privilege) om den körs av migrationen. postgres ser alla cron-jobb (bypassrls).
--   - Exakt ett cron-jobb (synligt och matchande): jobid 1, jobname `strava-sync-every-3-hours`, username postgres.
--   - Enda funktionen utanför net, pg_catalog och information_schema vars kropp nämner net.http_ är
--     extensions.grant_pg_net_access, en EVENT TRIGGER-funktion (issue_pg_net_access, ddl_command_end) som tillhör plattformen
--     och inte anropar pg_net när pg_net saknas. Den räknas därför inte som användare (se nedan).
--   - title_leaderboard_view: reloptions null; anon och authenticated har inte SELECT (039). Enda läsare i koden:
--     titleLeaderboardService (supabase.client.from('title_leaderboard_view'), service role). Ingen funktion, vy eller trigger i
--     migrationerna läser vyn, och frontend har ingen Supabase-klient (RUN-105).
--   Staging: pg_net och pg_cron är INTE installerade och schemat cron saknas (cron.job finns inte). extensions.grant_pg_net_access
--     finns ändå (event trigger).
--   - handle_new_user(): anon har inte execute (039), ingen åtgärd här. INFO rls_enabled_no_policy på 30 tabeller är avsiktligt
--     (docs/permissions.md: inga policyer för klientroller), ingen åtgärd.
--
-- VAD KÖRNINGEN GÖR
--   Staging: funktionen och vyn ändras. Cron-steget hoppas över (cron.job saknas) och pg_net-steget hoppas över (pg_net ligger
--     inte i public). Det är det förväntade utfallet; inga NOTICE om cron eller pg_net skrivs.
--   Prod: funktionen och vyn ändras. Cron-jobbet (exakt ett matchande) avregistreras. Därefter försöker migrationen ta bort
--     pg_net i ett eget block: eftersom postgres inte äger extensionen förväntas `drop extension` nekas, och blocket skriver då en
--     NOTICE ("pg_net behålls") i stället för att fallera. 052 lyckas alltså med funktionen, vyn och cron-avregistreringen oavsett.
--
-- ÄGARSTEG (efter 052 i prod)
--   Om NOTICE säger att pg_net behölls (nekad, beroenden eller användare kvar) tar ägaren bort extensionen i dashboarden:
--   Database -> Extensions -> pg_net -> av. Dashboarden kör som ägarrollen. Lead verifierar därefter med fråga B nedan (inga
--   rader för pg_net) och med get_advisors (ingen extension_in_public för pg_net). Beslutet att inte göra dropen till ett
--   hårt krav i migrationen är avsiktligt: att låta ett nekat drop rulla tillbaka hela 052 vore sämre, eftersom funktionen och
--   vyn då inte blev åtgärdade. Ett nekat drop är ett förväntat utfall, inte ett fel.
--
-- BESLUT PER PUNKT
--   1. Funktionen: se ovan. Kroppen ändras bara genom `public.users`; `+` och övriga operatorer slås upp i pg_catalog som alltid
--      ligger i sökvägen, så en tom search_path räcker.
--   2. Cron-jobbet avregistreras med cron.unschedule(jobid), men bara när exakt ett jobb har ett command som innehåller
--      'functions/v1/strava-sync'. Matchar fler än ett hoppar migrationen över avregistreringen med en NOTICE (granska då
--      cron.job för hand); matchar inget görs ingenting. NOTICE skriver antal synliga jobb, antal träffar samt jobid, jobname och
--      schema, aldrig command (det innehåller JWT:n). Att jobbet tas bort raderar också den kopian av den gamla anon-nyckeln ur
--      databasen. Där pg_cron saknas (staging) görs ingenting.
--   3. pg_net tas bort, inte flyttas, och bara om den ligger i schemat public. Skäl: (a) inget annat än jobbet använder den, och
--      migrationen kontrollerar det själv innan dropen; (b) pg_net är inte omplacerbar (relocatable = false i prod), så en flytt
--      vore ändå en borttagning plus ny installation; (c) en extension som kan göra utgående HTTP-anrop från databasen och som
--      ingen använder är bara yta. Kontrollen räknar som användare: kvarvarande cron-jobb vars command matchar net\.http_, samt
--      funktioner utanför schemana net, extensions, pg_catalog och information_schema vars kropp matchar det. Undantag:
--      event trigger-funktioner (plattformens grant_pg_net_access) och funktioner i supabase_functions som ingen icke-intern
--      trigger anropar. Hittas användare hoppas dropen över med en NOTICE. `drop extension` körs utan CASCADE, i ett eget
--      underblock som fångar insufficient_privilege (postgres äger inte extensionen) och dependent_objects_still_exist; inget av
--      dem avbryter 052. Behövs pg_net igen: create extension pg_net with schema extensions (se rollback).
--      pg_cron lämnas kvar: den ligger i pg_catalog (ingen advisor-varning), är helt utan jobb efter detta steg och är harmlös.
--      Backend schemalägger i processen (server.ts), så den behövs inte, men att ta bort den är en separat, ägarens fråga.
--   4. security_invoker = true. Backend läser vyn med service role (BYPASSRLS, och Supabases standardbehörigheter ger service_role
--      SELECT på tabellerna i public), så läsningen fungerar som förut. Ingen annan läsare finns. Vinsten: om någon framtida
--      migration av misstag ger anon eller authenticated SELECT på vyn stoppar RLS på de underliggande tabellerna (inga policyer
--      för klientroller) ändå läsningen. OBS för ADR 012 (titlar per grupp): dess migration återskapar vyn med
--      `create or replace view`. CREATE OR REPLACE VIEW ersätter vyns alternativ med de som anges i satsen, även om listan är
--      tom, så den måste skriva `with (security_invoker = true)`. ADR 012 säger det, och ett statiskt test
--      (advisorFixesMigration052.test.ts) kräver det i varje migration över 052 som skapar vyn.
--
-- KÖRORDNING
-- Additiv och bakåtkompatibel; kan köras före eller efter en backend-deploy (appkoden är oförändrad). Kör först i staging,
-- kontrollera med frågorna nedan, sedan prod efter ägar-ja, sedan ägarsteget om NOTICE säger att pg_net behölls.
--
-- IDEMPOTENS
-- create or replace function, alter view ... set (...), och steg som bara agerar när jobbet respektive extensionen finns.
-- En omkörning ändrar inget. Hela migrationen är ett enda do-block (som 051): den är atomär även med psql -f utan omslutande
-- transaktion, och apply_migration kör den dessutom som en transaktion. Inga egna begin/commit.
--
-- SPARA-FÖRE-FRÅGOR (read-only, kör i varje miljö före 052 och spara utfallet; ingen av dem visar jobbets command)
--   A. Användare av pg_net utanför net/extensions/pg_catalog/information_schema, utan event trigger-funktioner (prod: inga rader):
--        select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosrc ~* 'net\.http_' and n.nspname not in ('net', 'extensions', 'pg_catalog', 'information_schema') and p.oid not in (select evtfoid from pg_event_trigger);
--        select p.proname, (p.oid in (select evtfoid from pg_event_trigger)) as is_event_trigger_fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosrc ~* 'net\.http_' and n.nspname = 'extensions';
--   B. Extensions, ägare och migrationsrollens rättigheter (prod: pg_net i public, ägare supabase_admin, relocatable false):
--        select e.extname, e.extversion, n.nspname, e.extrelocatable, pg_get_userbyid(e.extowner) as owner from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pg_net', 'pg_cron');
--        select current_user, r.rolsuper, pg_has_role(current_user, e.extowner, 'member') as is_owner_member from pg_roles r, pg_extension e where r.rolname = current_user and e.extname = 'pg_net';
--   D. Cron (hoppa över där cron-schemat saknas; prod: 1 synligt, 1 matchande, 1 net-användare):
--        select count(*) as visible, count(*) filter (where command ilike '%functions/v1/strava-sync%') as matching, count(*) filter (where command ~* 'net\.http_') as net_users from cron.job;
--        select jobid, jobname, schedule, username, active from cron.job;
--   E. Funktionen och vyn:
--        select p.proconfig, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result, p.provolatile, p.proacl from pg_proc p where p.oid = 'public.increment_event_xp(uuid, integer)'::regprocedure;
--        select reloptions from pg_class where oid = 'public.title_leaderboard_view'::regclass;
--   Efter 052: E ger proconfig = {search_path=""} och reloptions = {security_invoker=true}, övrigt lika. D ger 0 jobb. B ger inga
--   rader för pg_net när den är borttagen (annars gäller ägarsteget). get_advisors (security): ingen function_search_path_mutable
--   för increment_event_xp.
--
-- ROLLBACK (körs manuellt och bara efter ägar-ja; i den här ordningen)
--   1. Funktionen, identisk med 000_baseline.sql (utan fast search_path):
--        create or replace function public.increment_event_xp(p_user_id uuid, p_xp integer)
--         returns void
--         language sql
--        as $function$
--          update users
--          set event_xp = event_xp + p_xp,
--              total_xp  = total_xp  + p_xp
--          where id = p_user_id;
--        $function$;
--   2. Vyn, tillbaka till inga reloptions (som före 052):
--        alter view public.title_leaderboard_view reset (security_invoker);
--   3. pg_net, bara om den verkligen behövs igen och bara om den togs bort. Den hamnar då i schemat extensions (inte public, där
--      advisorn varnar). Aktiveras av ägaren i dashboarden om postgres saknar rättighet:
--        create extension if not exists pg_net with schema extensions;
--   4. Cron-jobbet återskapas INTE. Det anropade Edge Function strava-sync, som inte längre finns (404 på alla anrop senaste 7
--      dagarna), så att återskapa det ger bara ett jobb som "lyckas" utan effekt var 3:e timme, och dess gamla anon-JWT ska inte
--      skrivas in igen (hemligheter hör inte hemma i migrationer; se docs/permissions.md). Jobbets schema var `0 */3 * * *` och
--      jobid/jobname skrevs ut som NOTICE när 052 kördes.
-- Statiskt test: advisorFixesMigration052.test.ts.

do $do$
declare
  j record;
  visible_jobs integer;
  matching_jobs integer;
  net_cron_users text;
  net_function_users text;
begin
  create or replace function public.increment_event_xp(p_user_id uuid, p_xp integer)
   returns void
   language sql
   set search_path to ''
  as $function$
    update public.users
    set event_xp = event_xp + p_xp,
        total_xp  = total_xp  + p_xp
    where id = p_user_id;
  $function$;

  alter view public.title_leaderboard_view set (security_invoker = true);

  if to_regclass('cron.job') is not null then
    select count(*) into visible_jobs from cron.job;
    select count(*) into matching_jobs from cron.job where command ilike '%functions/v1/strava-sync%';
    raise notice '052: % synliga cron-jobb, % matchar strava-sync', visible_jobs, matching_jobs;
    if matching_jobs = 1 then
      for j in
        select jobid, jobname, schedule
          from cron.job
         where command ilike '%functions/v1/strava-sync%'
      loop
        raise notice '052 avregistrerar cron-jobb % (namn %, schema %)', j.jobid, j.jobname, j.schedule;
        perform cron.unschedule(j.jobid);
      end loop;
    elsif matching_jobs > 1 then
      raise notice '052 hoppar över avregistreringen: % jobb matchar, förväntat högst 1. Granska cron.job för hand.', matching_jobs;
    end if;
  end if;

  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_net' and n.nspname = 'public'
  ) then
    if to_regclass('cron.job') is not null then
      select string_agg(jobid::text || ' ' || coalesce(jobname, ''), ', ' order by jobid) into net_cron_users
        from cron.job
       where command ~* 'net\.http_';
    end if;

    select string_agg(distinct format('%I.%I', n.nspname, p.proname), ', ') into net_function_users
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prosrc ~* 'net\.http_'
       and n.nspname not in ('net', 'extensions', 'pg_catalog', 'information_schema')
       and p.oid not in (select evtfoid from pg_event_trigger)
       and (
         n.nspname <> 'supabase_functions'
         or exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)
       );

    if net_cron_users is not null or net_function_users is not null then
      raise notice '052 behåller pg_net: cron-jobb (%) eller funktioner (%) använder den fortfarande.', net_cron_users, net_function_users;
    else
      begin
        drop extension pg_net;
        raise notice '052 tog bort pg_net';
      exception when insufficient_privilege or dependent_objects_still_exist then
        raise notice '052 behåller pg_net (ägarsteg: dashboarden, Database -> Extensions): %', sqlerrm;
      end;
    end if;
  end if;
end
$do$;
