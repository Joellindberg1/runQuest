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
--   2. extension_in_public: pg_net 0.14.0 ligger i schemat public. Enda användningen är pg_cron-jobbet jobid 1 (schema
--      `0 */3 * * *`), som gör net.http_post mot Edge Function .../functions/v1/strava-sync med en gammal anon-JWT (utfärdad
--      2025-06-11) i headern. Funktionen finns inte längre: alla svar de senaste 7 dagarna är 404, så jobbet "lyckas" var 3:e
--      timme utan att göra något. Strava-synken sköts av backend (stravaReconcile, webhooks, 12-timmarspollning). Åtgärd:
--      avregistrera jobbet (matchat på sin url-del, inte på ett hårdkodat jobid) och ta bort pg_net.
--   3. title_leaderboard_view saknar reloptions (alltså inte security_invoker), dvs. den körs med ägarens (postgres) rättigheter
--      och går förbi RLS på titles, title_leaderboard och users. Sedan 039 har ingen klientroll SELECT på vyn, så ingenting läcker
--      idag. Beslut: sätt security_invoker = true (försvar på djupet; se nedan).
--
-- FÖRE-LÄGE (Leads läsning av prod 2026-10-18)
--   - increment_event_xp: proconfig null (inget search_path), INVOKER.
--   - pg_net 0.14.0 i schemat public; pg_cron 1.6 i pg_catalog med exakt ett jobb (jobid 1, se ovan).
--   - title_leaderboard_view: reloptions null; anon och authenticated har inte SELECT (039). Enda läsare i koden:
--     titleLeaderboardService (supabase.client.from('title_leaderboard_view'), service role). Ingen funktion, vy eller trigger i
--     migrationerna läser vyn, och frontend har ingen Supabase-klient (RUN-105).
--   - handle_new_user(): anon har inte execute (039), ingen åtgärd här. INFO rls_enabled_no_policy på 30 tabeller är avsiktligt
--     (docs/permissions.md: inga policyer för klientroller), ingen åtgärd.
--
-- BESLUT PER PUNKT
--   1. Funktionen: se ovan. Kroppen ändras bara genom `public.users`; `+` och övriga operatorer slås upp i pg_catalog som alltid
--      ligger i sökvägen, så en tom search_path räcker.
--   2. Cron-jobbet avregistreras med cron.unschedule(jobid) för varje jobb vars command innehåller 'functions/v1/strava-sync'.
--      Migrationen skriver ut jobid, namn och schema som NOTICE, aldrig kommandot (det innehåller JWT:n). Att jobbet tas bort
--      raderar också den kopian av den gamla anon-nyckeln ur databasen. Där pg_cron eller jobbet saknas (staging har troligen
--      inget av dem) görs ingenting.
--   3. pg_net tas bort, inte flyttas. Skäl: (a) inget annat än jobbet använder den, och migrationen kontrollerar det själv innan
--      något tas bort (inga kvarvarande cron-jobb, inga funktioner utanför schemat net och supabase_functions som anropar
--      net.http_*, inga triggers som anropar en funktion som gör det); (b) pg_net är inte omplacerbar med ALTER EXTENSION ... SET
--      SCHEMA (kontrollera med frågan nedan), så en flytt vore ändå en borttagning plus ny installation; (c) en extension som
--      kan göra utgående HTTP-anrop från databasen och som ingen använder är bara yta. Behövs den igen: create extension pg_net
--      with schema extensions (se rollback). `drop extension` körs utan CASCADE: om något oväntat beror på den avbryts
--      migrationen i stället för att ta med det.
--      pg_cron lämnas kvar: den ligger i pg_catalog (ingen advisor-varning), är helt utan jobb efter detta steg och är harmlös.
--      Backend schemalägger i processen (server.ts), så den behövs inte, men att ta bort den är en separat, ägarens fråga.
--   4. security_invoker = true. Backend läser vyn med service role (BYPASSRLS, och Supabases standardbehörigheter ger service_role
--      SELECT på tabellerna i public), så läsningen fungerar som förut. Ingen annan läsare finns. Vinsten: om någon framtida
--      migration av misstag ger anon eller authenticated SELECT på vyn stoppar RLS på de underliggande tabellerna (inga policyer
--      för klientroller) ändå läsningen. OBS för ADR 012 (titlar per grupp): dess migration återskapar vyn med
--      `create or replace view`. CREATE OR REPLACE VIEW ersätter vyns alternativ med de som anges i satsen, även om listan är
--      tom, så den måste skriva `with (security_invoker = true)` eller förlorar vi detta. Schema-diffen (reloptions) visar det.
--
-- KÖRORDNING
-- Additiv och bakåtkompatibel; kan köras före eller efter en backend-deploy (appkoden är oförändrad). Inga beroenden till 053+
-- (men se ADR 012-noten ovan). Kör först i staging, kontrollera med frågorna nedan, sedan prod efter ägar-ja.
--
-- IDEMPOTENS
-- create or replace function, alter view ... set (...), och ett do-block som bara agerar när jobbet respektive extensionen finns.
-- En omkörning ändrar inget. Ingen egen begin/commit: apply_migration kör filen som en transaktion, och ett guard-fel (raise
-- exception) lämnar därför inget halvt ändrat.
--
-- KONTROLLFRÅGOR (read-only)
--   Före och efter, funktionen:   select p.proconfig, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result from pg_proc p where p.oid = 'public.increment_event_xp(uuid, integer)'::regprocedure;
--                                  (efter: proconfig = {search_path=""}, övrigt lika)
--   Före och efter, vyn:           select reloptions from pg_class where oid = 'public.title_leaderboard_view'::regclass;   (efter: {security_invoker=true})
--   Före och efter, cron:          select jobid, jobname, schedule, active from cron.job;   (efter: inga rader; hoppa över där cron-schemat saknas)
--   Före och efter, pg_net:        select e.extname, e.extversion, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pg_net', 'pg_cron');
--                                  (efter: bara pg_cron; före: se också select extrelocatable from pg_extension where extname = 'pg_net')
--   Efter, advisors:               get_advisors (security): inga function_search_path_mutable för increment_event_xp, ingen extension_in_public för pg_net.
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
--   3. pg_net, bara om den verkligen behövs igen. Den hamnar då i schemat extensions (inte public, där advisorn varnar):
--        create extension if not exists pg_net with schema extensions;
--   4. Cron-jobbet återskapas INTE. Det anropade Edge Function strava-sync, som inte längre finns (404 på alla anrop senaste 7
--      dagarna), så att återskapa det ger bara ett jobb som "lyckas" utan effekt var 3:e timme, och dess gamla anon-JWT ska inte
--      skrivas in igen (hemligheter hör inte hemma i migrationer; se docs/permissions.md). Jobbets schema var `0 */3 * * *` och
--      namn/jobid skrevs ut som NOTICE när 052 kördes.
-- Statiskt test: advisorFixesMigration052.test.ts.

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

do $$
declare
  j record;
  cron_users text;
  function_users text;
begin
  if to_regclass('cron.job') is not null then
    for j in
      select jobid, jobname, schedule
        from cron.job
       where command ilike '%functions/v1/strava-sync%'
    loop
      raise notice '052 avregistrerar cron-jobb % (namn %, schema %)', j.jobid, j.jobname, j.schedule;
      perform cron.unschedule(j.jobid);
    end loop;

    select string_agg(jobid::text, ', ' order by jobid) into cron_users
      from cron.job
     where command ~* 'net\.http_';
    if cron_users is not null then
      raise exception '052 avbryts: cron-jobb (%) använder fortfarande pg_net. Ta bort dem först, eller behåll pg_net.', cron_users;
    end if;
  end if;

  select string_agg(distinct format('%I.%I', n.nspname, p.proname), ', ') into function_users
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosrc ~* 'net\.http_'
     and n.nspname not in ('net', 'pg_catalog', 'information_schema')
     and (
       n.nspname <> 'supabase_functions'
       or exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)
     );
  if function_users is not null then
    raise exception '052 avbryts: funktioner (%) anropar net.http_* eller används av triggers. pg_net behålls tills de är borttagna.', function_users;
  end if;

  drop extension if exists pg_net;
end
$$;
