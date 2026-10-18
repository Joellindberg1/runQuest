-- 057: recalculation_marks — en beständig markering per användare: "behöver omräkning från datum X" (RUN-322, ADR 010 beslut 8.5 och D12, v0.8.0).
-- Datum: 2026-10-18. EJ APPLICERAD. Kräver ägar-ja per miljö: först staging (supabase-staging, projekt aormctqrmguvncxrigwy), sedan prod
-- (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 057_create_recalculation_marks, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- BAKGRUND
-- Den nattliga avstämningen mot Strava (och "Koppla bort") raderar en Stravarunda och räknar sedan om streak och XP för de senare
-- rundorna (reprocessRunsFromDate) och användarens totaler (calculateUserTotals). Dör processen mellan raderingen och omräkningen, eller
-- misslyckas omräkningen, är rundan borta och ingen jämförelse hittar något nästa natt: XP och streak ligger fel tills något annat råkar
-- räkna om bakåt. Webhook-workern har sin omförsökskö (attempts); avstämningen har ingen. Markeringen här är den kön.
--
-- SÅ ANVÄNDS DEN (apps/backend/src/services/recalculationMarks/)
--   1. FÖRE en radering eller ändring som kräver omräkning anropar koden mark_recalculation(användare, datum). Datumet är det
--      tidigaste datum vars rundor kan ändras (den raderade rundans datum; vid en datumändring det tidigaste av gammalt och nytt).
--   2. Koden gör ändringen och räknar om. Lyckas BÅDA stegen rensar den markeringen med clear_recalculation_mark(användare, version),
--      där version är det mark_recalculation gav den.
--   3. Ett jobb (vid start och varje natt före avstämningen) läser markeringar som blivit kvar, räknar om från deras datum och rensar dem.
--
-- TABELLEN recalculation_marks (en rad per användare)
--   user_id    primärnyckel; främmande nyckel mot users, on delete cascade (en raderad användare tar sin markering med sig).
--   from_date  tidigaste datum som behöver räknas om från. Flera markeringar för samma användare slås ihop till det TIDIGASTE (least).
--   version    ett nummer ur sekvensen recalculation_mark_version_seq (nextval) vid VARJE mark_recalculation, både när raden skapas och när den
--              uppdateras. Sekvensen går bara framåt och återanvänder aldrig ett nummer, så versionen är unik över hela livstiden, även när
--              raden rensas och senare skapas på nytt. Det är det som gör att en markering aldrig rensas av misstag (se nedan). Luckor i
--              numren är normala (en rullad transaktion eller en konflikt tar ett nummer) och betyder ingenting.
--   marked_at  när raden senast skrevs (default now()); jobbet tar äldsta först.
--
-- SEKVENSEN recalculation_mark_version_seq
--   Varför inte "version + 1": en räknare som börjar om på 1 när raden raderats ger ett ABA-fel. Jobbet läser version 1, en omräkning rensar
--   version 1 (raden är borta), en ny radering markerar och får en NY rad med version 1, och jobbet rensar "version 1" och tar bort den nya
--   markeringen utan att räkna om. Med en sekvens är den nya markeringens version alltid högre än alla tidigare.
--   Rättigheter: usage bara för service_role; revoke all från public, anon och authenticated (funktionerna är INVOKER, så anroparen
--   behöver usage). Sekvensen har inget eget upplägg i övrigt och rörs bara av mark_recalculation.
--
-- FUNKTIONERNA (plpgsql, set search_path to '', säkerhetsläge INVOKER, bara service_role får köra dem; som claim_strava_webhook_events, 046)
--   mark_recalculation(p_user_id uuid, p_from_date date) returns bigint
--     Idempotent upsert: ny rad, annars from_date = least(gammal, ny). Båda vägarna sätter version = nextval(sekvensen). Returnerar versionen.
--     Ett NULL-argument ger 22004; en användare som inte finns ger 23503 (främmande nyckeln).
--   clear_recalculation_mark(p_user_id uuid, p_version bigint) returns boolean
--     Raderar raden BARA om versionen fortfarande är p_version, alltså om ingen nyare markering skrivits sedan koden fick sin version.
--     Returnerar true om en rad raderades. false betyder "en nyare markering finns (eller raden var redan borta)": raden lämnas, och
--     jobbet tar den. Det är därför versionen finns: en omräkning som lyckades för datum X får inte sudda en markering för datum Y < X
--     som skrevs medan den pågick.
--
-- RLS OCH RÄTTIGHETER (samma baslinje som 046/048/049/053/054)
--   RLS på, inga policyer, revoke all från anon och authenticated: bara service_role (backend) når tabellen. Execute på funktionerna dras
--   in från public, anon och authenticated och ges bara till service_role. $postcheck$ bevisar det i samma transaktion.
--
-- KÖRORDNING: additiv, applicera FÖRE backend-deployen i v0.8.0. Ny kod anropar funktionerna; saknas de misslyckas avstämningens
-- raderingar säkert (en rad som inte kunde markeras raderas inte och loggas med felkod) medan "Koppla bort" går vidare som förut,
-- eftersom den har sin egen återhämtning (token-raden finns kvar tills allt är klart). Gammal kod (v0.7.x) känner inte till tabellen.
--
-- Lås: create table tar SHARE ROW EXCLUSIVE på users i resten av transaktionen (främmande nyckeln): skrivningar mot users blockeras i
-- millisekunder. set local lock_timeout = '5s' får migrationen att misslyckas i stället för att köa skrivtrafiken. Misslyckas den: kör om.
--
-- ROLLBACK (ingen data i tabellen är värd att spara: en markering är bara en påminnelse om en omräkning, och jobbet bygger inte om
-- den ur något annat). Kör som en transaktion; koden som anropar funktionerna ska vara tillbakarullad först (annars misslyckas
-- avstämningens raderingar säkert, se ovan):
-- ROLLBACK-START
--   drop function if exists public.clear_recalculation_mark(uuid, bigint);
--   drop function if exists public.mark_recalculation(uuid, date);
--   drop table if exists public.recalculation_marks;
--   drop sequence if exists public.recalculation_mark_version_seq;
-- ROLLBACK-END
--
-- KATALOGFRÅGOR (Lead kör efter apply i varje miljö)
-- Q1. Tabellen, RLS, inga policyer, inga klienträttigheter. Förväntat: rls true, policies 0, anon_privs 0, authenticated_privs 0, rader 0.
-- Q1-START
--   select c.relrowsecurity as rls,
--          (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
--          (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'recalculation_marks' and g.grantee = 'anon') as anon_privs,
--          (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'recalculation_marks' and g.grantee = 'authenticated') as authenticated_privs,
--          (select count(*) from public.recalculation_marks) as rader
--     from pg_class c where c.oid = 'public.recalculation_marks'::regclass;
-- Q1-END
-- Q2. Kolumnerna. Förväntat: user_id uuid, from_date date, version bigint (default nextval('recalculation_mark_version_seq'::regclass)), marked_at timestamptz (default now()), alla not null.
-- Q2-START
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'recalculation_marks' order by ordinal_position;
-- Q2-END
-- Q3. Främmande nyckeln. Förväntat: en rad, confdeltype 'c' (cascade), mot public.users.
-- Q3-START
--   select conname, confrelid::regclass::text as refs, confdeltype from pg_constraint
--    where conrelid = 'public.recalculation_marks'::regclass and contype = 'f';
-- Q3-END
-- Q4. Funktionsrättigheterna. Förväntat: public_execute, anon, authenticated alla false; service_role true; security_definer false.
-- Q4-START
--   select p.oid::regprocedure::text as fn,
--          exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role,
--          p.prosecdef as security_definer
--     from pg_proc p
--    where p.pronamespace = 'public'::regnamespace and p.proname in ('mark_recalculation', 'clear_recalculation_mark') order by 1;
-- Q4-END
-- Q4b. Sekvensens rättigheter. Förväntat: en rad; public_usage, anon, authenticated false; service_role true.
-- Q4b-START
--   select c.oid::regclass::text as seq,
--          exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a where a.grantee = 0 and a.privilege_type = 'USAGE') as public_usage,
--          has_sequence_privilege('anon', c.oid, 'usage') as anon,
--          has_sequence_privilege('authenticated', c.oid, 'usage') as authenticated,
--          has_sequence_privilege('service_role', c.oid, 'usage') as service_role
--     from pg_class c where c.oid = 'public.recalculation_mark_version_seq'::regclass;
-- Q4b-END
-- Q5. Efter att jobbet kört (eller i vanlig drift): markeringar som blivit kvar. Förväntat: 0 rader i normal drift; en rad äldre än
-- några minuter betyder att en omräkning inte har lyckats än (jobbet försöker vid start och varje natt 04:05 Europe/Stockholm).
-- Q5-START
--   select user_id, from_date, version, marked_at, now() - marked_at as age from public.recalculation_marks order by marked_at;
-- Q5-END
-- Efter apply: get_advisors (security) i varje miljö. Förväntat: inga nya fynd (RLS på, ingen exponerad funktion för anon/authenticated).
-- Statiskt test: recalculationMarksMigration057.test.ts.

set local lock_timeout = '5s';

create sequence if not exists public.recalculation_mark_version_seq;

revoke all on sequence public.recalculation_mark_version_seq from public, anon, authenticated;
grant usage on sequence public.recalculation_mark_version_seq to service_role;

create table if not exists public.recalculation_marks (
  user_id   uuid        primary key references public.users(id) on delete cascade,
  from_date date        not null,
  version   bigint      not null default nextval('public.recalculation_mark_version_seq'),
  marked_at timestamptz not null default now()
);

alter table public.recalculation_marks enable row level security;

revoke all on public.recalculation_marks from anon, authenticated;

create or replace function public.mark_recalculation(p_user_id uuid, p_from_date date)
 returns bigint
 language plpgsql
 set search_path to ''
as $function$
declare
  v_version bigint;
begin
  if p_user_id is null or p_from_date is null then
    raise exception 'mark_recalculation: p_user_id and p_from_date are required' using errcode = '22004';
  end if;

  -- version ur sekvensen på båda vägarna: aldrig ett återanvänt nummer, även när raden rensats och skapas på nytt (ABA).
  insert into public.recalculation_marks as m (user_id, from_date, version)
  values (p_user_id, p_from_date, nextval('public.recalculation_mark_version_seq'))
  on conflict (user_id) do update
     set from_date = least(m.from_date, excluded.from_date),
         version   = nextval('public.recalculation_mark_version_seq'),
         marked_at = now()
  returning m.version into v_version;

  return v_version;
end;
$function$;

create or replace function public.clear_recalculation_mark(p_user_id uuid, p_version bigint)
 returns boolean
 language plpgsql
 set search_path to ''
as $function$
begin
  delete from public.recalculation_marks
   where user_id = p_user_id
     and version = p_version;
  return found;
end;
$function$;

revoke execute on function public.mark_recalculation(uuid, date) from public, anon, authenticated;
revoke execute on function public.clear_recalculation_mark(uuid, bigint) from public, anon, authenticated;
grant execute on function public.mark_recalculation(uuid, date) to service_role;
grant execute on function public.clear_recalculation_mark(uuid, bigint) to service_role;

-- Efterkontroll i samma transaktion: ett fel rullar tillbaka hela migrationen.
do $postcheck$
declare
  v_fn      regprocedure;
  v_problem text := '';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.recalculation_marks'::regclass) then
    v_problem := v_problem || ' RLS is off;';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.recalculation_marks'::regclass) then
    v_problem := v_problem || ' a policy exists;';
  end if;
  if has_table_privilege('anon', 'public.recalculation_marks', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.recalculation_marks', 'select,insert,update,delete') then
    v_problem := v_problem || ' anon or authenticated can reach the table;';
  end if;
  if exists (
    select 1
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
     where c.oid = 'public.recalculation_mark_version_seq'::regclass and a.grantee = 0
  ) then
    v_problem := v_problem || ' PUBLIC can use the version sequence;';
  end if;
  if has_sequence_privilege('anon', 'public.recalculation_mark_version_seq', 'usage,select,update')
     or has_sequence_privilege('authenticated', 'public.recalculation_mark_version_seq', 'usage,select,update') then
    v_problem := v_problem || ' anon or authenticated can use the version sequence;';
  end if;
  if not has_sequence_privilege('service_role', 'public.recalculation_mark_version_seq', 'usage') then
    v_problem := v_problem || ' service_role cannot use the version sequence;';
  end if;

  foreach v_fn in array array[
    'public.mark_recalculation(uuid, date)'::regprocedure,
    'public.clear_recalculation_mark(uuid, bigint)'::regprocedure
  ] loop
    if exists (
      select 1
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      v_problem := v_problem || format(' %s: PUBLIC can execute;', v_fn);
    end if;
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      v_problem := v_problem || format(' %s: anon or authenticated can execute;', v_fn);
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      v_problem := v_problem || format(' %s: service_role cannot execute;', v_fn);
    end if;
  end loop;

  if v_problem <> '' then
    raise exception 'migration 057 stopped:%', v_problem;
  end if;
end;
$postcheck$;
