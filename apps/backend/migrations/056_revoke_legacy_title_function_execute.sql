-- 056: stäng EXECUTE på de tre gamla titelfunktionerna och på increment_event_xp för public, anon och authenticated; service_role behåller det
-- (ADR 012, ADR 002, v0.8.0).
-- Datum: 2026-10-18. APPLICERAD i staging 2026-10-18 och i prod 2026-10-19 (ägar-ja i chatten). Kräver ägar-ja per miljö: först staging (supabase-staging, projekt aormctqrmguvncxrigwy), sedan prod
-- (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 056_revoke_legacy_title_function_execute, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- ORDNING: efter 055 (som skapar omslagen över update_group_title_leaderboard och rör grants på sina egna nya funktioner). Ingen annan
-- migration krävs före, och den här ändrar ingenting 055 behöver. Kan köras före eller efter backend-deployen i v0.8.0: backend anropar
-- funktionerna med service_role, som behåller EXECUTE.
--
-- BAKGRUND
-- update_title_leaderboard(uuid), update_all_title_leaderboards(), trigger_update_title_leaderboard() och increment_event_xp(uuid, integer)
-- skapades i baslinjen utan egna grants. Postgres ger då PUBLIC execute på en ny funktion, och Supabases default privileges i schemat public
-- ger dessutom anon, authenticated och service_role execute. create or replace behåller grants: 042 och 055 skrev om de tre titelfunktionerna,
-- 052 skrev om increment_event_xp (fast search_path), och ingen av dem rörde grants, så ställningen är oförändrad sedan baslinjen. Verifierat i
-- staging 2026-10-18 av Lead: public, anon och authenticated har execute.
-- Alla fyra är SECURITY INVOKER och de tabeller de rör (title_leaderboard, user_titles, titles, groups, users) har RLS utan policyer för
-- klientroller, så ett anrop som anon eller authenticated gör ingenting nyttigt. Men /rest/v1/rpc/<namn> är anropbar med anon-nyckeln: ytan
-- finns, och en framtida policy eller SECURITY DEFINER-ändring skulle göra den farlig. Funktionerna hör inte hemma i den publika RPC-ytan.
-- 055 stängde samma sak på sina egna nya funktioner (update_group_title_leaderboard, update_group_title_leaderboards,
-- user_titles_fill_group_id); den här stänger de fyra äldre. Backend använder bara service_role: titleLeaderboardService och
-- calculateUserTotals anropar titelfunktionerna, eventService (checkEventQualification och settleCompetitionEvents) anropar increment_event_xp,
-- alla via getSupabaseClient() i config/database.ts, som skapas med service role-nyckeln.
--
-- VAD MIGRATIONEN GÖR
--   1. lock_timeout 5 s (som 048-055). REVOKE och GRANT tar bara en kort rad-lås på pg_proc, men samma rad som varje planering av ett
--      funktionsanrop läser; misslyckas hellre än att vänta. Ett fel rullar tillbaka allt, kör om.
--   2. revoke execute on function <var och en av de fyra, full signatur> from public, anon, authenticated.
--   3. grant execute on function <de fyra> to service_role. Idempotent om service_role redan har det; säkerställer att backend fungerar
--      även om default privileges i en miljö skulle saknas eller ändras.
--   4. $postcheck$: samma transaktion. Stoppar (och rullar därmed tillbaka) om PUBLIC, anon eller authenticated fortfarande kan köra någon av
--      de fyra, eller om service_role inte kan. has_function_privilege räknar in PUBLIC och ärvda rättigheter, så en rest via ett rollmedlemskap
--      hade synts här; PUBLIC kontrolleras också direkt i ACL:en (grantee 0).
--   Ingenting annat rörs: ingen funktionskropp, inga tabeller, inga andra funktioner (omslagets inre anrop till update_group_title_leaderboard(s)
--   kräver att anroparen har execute på dem, och det har service_role sedan 055), ingen data.
--
-- TRIGGERN OCH OMSLAGEN (varför ingenting går sönder)
--   - title_leaderboard_update_trigger (AFTER INSERT OR UPDATE OR DELETE på user_titles, kör trigger_update_title_leaderboard()) rörs inte.
--     Postgres kräver EXECUTE på en triggerfunktion bara när triggern SKAPAS (CREATE TRIGGER: den som skapar måste ha execute på
--     funktionen), inte varje gång den går av. Att den som skriver till user_titles saknar execute på triggerfunktionen påverkar alltså
--     inte att triggern körs. Triggern körs ändå med skrivarens rättigheter (funktionen är SECURITY INVOKER), och skrivaren behöver
--     execute på det triggerfunktionen anropar inuti, update_group_title_leaderboard. Det har bara service_role (055), och backend skriver
--     user_titles bara som service_role. En klientroll kunde inte skriva user_titles redan före den här migrationen (RLS utan policyer).
--   - update_title_leaderboard(uuid) och update_all_title_leaderboards() anropar update_group_title_leaderboard(s) inifrån som anroparen.
--     Som service_role (execute på alla) fungerar de som förut.
--   - increment_event_xp(uuid, integer) är en SQL-funktion som uppdaterar public.users; som service_role (bypassrls) fungerar den som förut.
--   Beviset i PGlite lämnades med leveransen (anon och authenticated nekas med 42501 på alla fyra; service_role anropar omslagen och
--   increment_event_xp; en insert i user_titles som service_role bygger om topplistan via triggern; rollbacken återställer ACL:en exakt).
--   I Supabase är beviset Leads katalogfråga efter apply (nedan).
--
-- UTGÅNGSLÄGE OCH ROLLBACK
--   Staging (verifierat 2026-10-18): PUBLIC, anon, authenticated och service_role har execute på de fyra.
--   Prod: PUBLIC har tappat execute på de fyra (drift utanför repot, RUN-226, Leads läsning 2026-10-17; samma fyra funktioner som
--   KNOWN_DIFFERENCES i schemaFingerprint.ts räknade upp). Det är alltså prods läge också för increment_event_xp. Kör fråga A före apply i
--   varje miljö och spara proacl per funktion; rollbacken ska ge exakt det utgångsläget tillbaka, och skillnaden mellan miljöerna är PUBLIC.
--   Kör ETT av de två blocken, som en transaktion (ett apply_migration-anrop eller begin; ... commit;). Rollback ger tillbaka yta som
--   rpc-vägen exponerar för anon-nyckeln, så kräv ägar-ja i prod.
-- ROLLBACK-START
--   set local lock_timeout = '5s';
-- Staging (PUBLIC fanns före):
--   grant execute on function public.update_title_leaderboard(uuid) to public, anon, authenticated, service_role;
--   grant execute on function public.update_all_title_leaderboards() to public, anon, authenticated, service_role;
--   grant execute on function public.trigger_update_title_leaderboard() to public, anon, authenticated, service_role;
--   grant execute on function public.increment_event_xp(uuid, integer) to public, anon, authenticated, service_role;
-- Prod (PUBLIC saknades före; kontrollera mot sparad proacl att anon och authenticated hade det):
--   grant execute on function public.update_title_leaderboard(uuid) to anon, authenticated, service_role;
--   grant execute on function public.update_all_title_leaderboards() to anon, authenticated, service_role;
--   grant execute on function public.trigger_update_title_leaderboard() to anon, authenticated, service_role;
--   grant execute on function public.increment_event_xp(uuid, integer) to anon, authenticated, service_role;
-- ROLLBACK-END
--
-- KATALOGFRÅGA (Lead kör före apply och efter apply i varje miljö)
-- Förväntat EFTER: public_execute, anon, authenticated alla false; service_role true; grantees = {postgres, service_role}
-- (ägaren postgres behåller sitt eget execute). Förväntat FÖRE i staging: public_execute true, anon true, authenticated true, service_role true.
-- Kolumnen proacl sparas före apply för en exakt rollback.
-- QUERY-START
--   select p.oid::regprocedure::text as fn,
--          exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role,
--          (select string_agg(coalesce(r.rolname, 'PUBLIC'), ', ' order by coalesce(r.rolname, 'PUBLIC')) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee where a.privilege_type = 'EXECUTE') as grantees,
--          p.proacl::text as proacl
--     from pg_proc p
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'increment_event_xp')
--    order by 1;
-- QUERY-END
-- Triggern ska vara kvar och påslagen (förväntat tgenabled = 'O'):
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.user_titles'::regclass and tgname = 'title_leaderboard_update_trigger';
-- Efter apply: get_advisors (security) i varje miljö. Förväntat: inga nya fynd (inga nya objekt; antalet funktioner som anon och
-- authenticated kan köra via /rpc minskar med fyra). Röken: en runda som service_role (backend) bygger om topplistan som förut, och en
-- event-utbetalning (increment_event_xp) går igenom.
-- Följdeffekt för schemaFingerprint.ts (justerat i samma leverans): efter 056 saknar de fyra PUBLIC execute i båda projekten, så regeln
-- prod-missing-public-execute och PROD_WITHOUT_PUBLIC_EXECUTE är borttagna. Mellan staging-apply och prod-apply skiljer anon- och
-- authenticated-execute (staging utan, prod med); den tillfälliga regeln temporary-056-client-execute-in-prod förklarar de åtta posterna och
-- tas bort när 056 är applicerad i prod.
-- Statiskt test: revokeTitleFunctionExecuteMigration056.test.ts.

set local lock_timeout = '5s';

revoke execute on function public.update_title_leaderboard(uuid) from public, anon, authenticated;
revoke execute on function public.update_all_title_leaderboards() from public, anon, authenticated;
revoke execute on function public.trigger_update_title_leaderboard() from public, anon, authenticated;
revoke execute on function public.increment_event_xp(uuid, integer) from public, anon, authenticated;

grant execute on function public.update_title_leaderboard(uuid) to service_role;
grant execute on function public.update_all_title_leaderboards() to service_role;
grant execute on function public.trigger_update_title_leaderboard() to service_role;
grant execute on function public.increment_event_xp(uuid, integer) to service_role;

-- Efterkontroll i samma transaktion: ett kvarvarande klientexecute eller ett saknat service_role-execute stoppar migrationen.
do $postcheck$
declare
  v_fn      regprocedure;
  v_problem text := '';
begin
  foreach v_fn in array array[
    'public.update_title_leaderboard(uuid)'::regprocedure,
    'public.update_all_title_leaderboards()'::regprocedure,
    'public.trigger_update_title_leaderboard()'::regprocedure,
    'public.increment_event_xp(uuid, integer)'::regprocedure
  ] loop
    if exists (
      select 1
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      v_problem := v_problem || format(' %s: PUBLIC can still execute;', v_fn);
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      v_problem := v_problem || format(' %s: anon can still execute;', v_fn);
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      v_problem := v_problem || format(' %s: authenticated can still execute;', v_fn);
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      v_problem := v_problem || format(' %s: service_role cannot execute;', v_fn);
    end if;
  end loop;

  if v_problem <> '' then
    raise exception 'migration 056 stopped:%', v_problem;
  end if;
end;
$postcheck$;
