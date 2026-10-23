-- 059: user_boosts.start_date och end_date — boostens fönster sparas på raden (RUN-355, ägarbeslut 2026-10-20, v0.8.1).
-- Datum: 2026-10-20. APPLICERAD i staging 2026-10-20 och i prod 2026-10-22 (ägar-ja i chatten; prod: 8 rader backfyllda, Q1–Q3 kontrollerade). Kräver ägar-ja per miljö: först staging (supabase-staging, projekt aormctqrmguvncxrigwy), sedan prod
-- (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 059_user_boosts_window, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- BAKGRUND
-- En dagsboost har hittills räknats ut ur created_at och expires_at: reprocessRunsFromDate tog UTC-dygnet av båda (created_at.slice(0, 10) och
-- expires_at.slice(0, 10)), och expires_at sattes som nu + n * 24 h. Det gav n + 1 kalenderdagar och en startdag som kunde vara dagen före den lokala för en
-- boost skapad 00-02 svensk tid. Ägaren har bestämt att en NY boost ska ge exakt det som står (en 3-dagarsboost gäller 3 kalenderdagar i gruppens tidszon, från
-- 00:00 dagen efter duellens sista dag) och att GAMLA boostar behåller sina dagar och sin XP. Fönstret kan då inte längre räknas ur två tidsstämplar: det sparas
-- per boost, och XP-omräkningen och boostkortet läser det sparade.
--
-- VAD MIGRATIONEN GÖR (i den här ordningen, allt i en transaktion; ett fel rullar tillbaka HELA migrationen)
--   1. lock_timeout 5 s (som 048 och 053-058): misslyckas hellre än att köa skrivtrafiken. Misslyckas den: kör om.
--   2. $preflight$: ändrar ingenting. Stoppar om public.user_boosts saknas, om created_at eller expires_at inte är timestamptz, eller om start_date/end_date redan
--      finns med en annan typ än date.
--   3. alter table public.user_boosts add column if not exists start_date date, add column if not exists end_date date. Båda NULL-bara och utan default: en rad som
--      skrivs av äldre kod under en deploy får NULL och läses då med det gamla UTC-fönstret (shared/boostWindow), alltså samma resultat som backfyllet.
--   4. $snapshot$: temporära tabeller med de rader som ska backfyllas (mig059_todo: id för varje rad där start_date är NULL), en kopia av alla ÖVRIGA kolumner
--      (mig059_before) och tabellens RLS-läge. Inte "on commit drop", som 058.
--   5. Backfyll, bara rader där start_date är NULL (idempotent: en andra körning rör ingenting som redan har ett fönster, och en ny boost med sparat fönster rörs aldrig):
--        start_date = UTC-dagen av created_at, end_date = UTC-dagen av expires_at (NULL när expires_at är NULL).
--      Det är EXAKT vad koden räknade förut: created_at.slice(0, 10) och expires_at.slice(0, 10) på PostgREST:s UTC-text. `at time zone 'UTC'` gör att sessionens
--      TimeZone inte spelar roll. En körboost får samma start_date som förut (created_at-dagen; körboostar använde bara startdagen) och end_date NULL när expires_at är NULL.
--      Därför ger reprocessRunsFromDate BITIDENTISK XP för varje befintlig boost, även en skapad 00-02 svensk tid, jämfört med koden före 059 (a430bf43).
--   6. $postcheck$: kolumnerna finns som date och NULL-bara; ingen rad saknar start_date; varje backfylld rad har start_date = UTC-dagen av created_at (jämförd mot
--      to_char i UTC, ett oberoende uttryck) och end_date = UTC-dagen av expires_at; ingen backfylld rad har end_date före start_date; antalet rader är oförändrat och
--      alla övriga kolumner är IDENTISKA med snapshoten (EXCEPT i båda riktningarna); RLS-läget och policyerna är oförändrade. Avviker något stoppar det och rullar
--      tillbaka allt. Därefter släpps snapshot-tabellerna.
--   Rörs INTE: expires_at (behålls, bakåtkompatibelt, och sätts konsekvent för nya boostar), övriga kolumner, index, främmande nycklar, RLS och policyer, grants.
--
-- NYA BOOSTAR (koden i samma leverans, settleChallenge)
--   start_date = duellens end_date + 1 (00:00 dagen efter duellens sista dag i gruppens tidszon); dagsboost: end_date = start_date + n − 1, expires_at = lokal midnatt efter end_date;
--   körboost: end_date NULL (de n första rundorna från start_date), expires_at NULL.
--
-- KÖRORDNING (expand, ADR 002 beslut 3): additiv, kör FÖRE deployen av v0.8.1-koden. Koden läser och skriver kolumnerna; saknas de misslyckas boost-läsningen i
-- reprocessRunsFromDate (ett läsfel kastas, RUN-215), så applicera 059 först i varje miljö. Äldre kod (v0.8.0) känner inte till kolumnerna och påverkas inte.
--
-- LÅS: alter table add column tar ACCESS EXCLUSIVE på user_boosts i resten av transaktionen (en liten tabell, några rader per avgjord duell). Inga främmande nycklar
-- läggs till, så inga andra tabeller låses. set local lock_timeout = '5s' får migrationen att misslyckas i stället för att köa. Misslyckas den: kör om.
--
-- ROLLBACK (återställer SCHEMAT; sparade fönster för boostar som skapats efter apply går förlorade och de läses därefter med det gamla UTC-fönstret). Kör som en transaktion,
-- och bara efter att koden som läser kolumnerna är tillbakarullad (annars misslyckas boost-läsningen):
-- ROLLBACK-START
--   alter table public.user_boosts drop column if exists end_date, drop column if exists start_date;
-- ROLLBACK-END
--
-- KATALOGFRÅGOR (Lead kör efter apply i varje miljö)
-- Q1. Kolumnerna. Förväntat: start_date date och end_date date, båda is_nullable YES, ingen default.
-- Q1-START
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns where table_schema = 'public' and table_name = 'user_boosts' and column_name in ('start_date', 'end_date') order by column_name;
-- Q1-END
-- Q2. Backfyllet. Förväntat: 0 rader utan start_date, och 0 befintliga rader där fönstret avviker från UTC-dagarna (nya boostar efter apply har ett annat fönster med flit,
-- så kör den här före första avgörandet efter deployen, eller begränsa till created_at < apply-tidpunkten).
-- Q2-START
--   select count(*) filter (where start_date is null) as utan_fonster,
--          count(*) filter (where start_date is distinct from to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')::date
--                              or end_date is distinct from to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD')::date) as avviker,
--          count(*) as rader
--     from public.user_boosts where created_at < now();
-- Q2-END
-- Q3. RLS och policyer oförändrade. Förväntat: rls true (samma som före apply), policies samma antal som före.
-- Q3-START
--   select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies from pg_class c where c.oid = 'public.user_boosts'::regclass;
-- Q3-END
-- Q4. Efter första avgörandet med ny kod: en ny dagsboost ska ha end_date − start_date + 1 = längden (3 för en 3-dagarsboost). Förväntat: antal_dagar = längden på duellens belöning.
-- Q4-START
--   select id, type, delta, start_date, end_date, expires_at, (end_date - start_date + 1) as antal_dagar
--     from public.user_boosts order by created_at desc limit 5;
-- Q4-END
-- Statiskt test: userBoostsWindowMigration059.test.ts. Körning i en riktig Postgres-motor (PGlite) med gamla boostar i glappet 00-02: se slutrapporten för RUN-355.

set local lock_timeout = '5s';

do $preflight$
declare
  v_type text;
  v_col text;
begin
  if to_regclass('public.user_boosts') is null then
    raise exception '059 preflight: public.user_boosts saknas (005 är inte körd?). Inget ändrat.';
  end if;

  for v_col in select unnest(array['created_at', 'expires_at']) loop
    select data_type into v_type from information_schema.columns
     where table_schema = 'public' and table_name = 'user_boosts' and column_name = v_col;
    if v_type is distinct from 'timestamp with time zone' then
      raise exception '059 preflight: user_boosts.% är % (väntade timestamp with time zone). Backfyllet vore inte det gamla UTC-fönstret. Inget ändrat.', v_col, coalesce(v_type, 'saknas');
    end if;
  end loop;

  for v_col in select unnest(array['start_date', 'end_date']) loop
    select data_type into v_type from information_schema.columns
     where table_schema = 'public' and table_name = 'user_boosts' and column_name = v_col;
    if v_type is not null and v_type <> 'date' then
      raise exception '059 preflight: user_boosts.% finns redan som % (väntade date eller att den saknas). Fråga ägaren. Inget ändrat.', v_col, v_type;
    end if;
  end loop;
end
$preflight$;

alter table public.user_boosts
  add column if not exists start_date date,
  add column if not exists end_date date;

do $snapshot$
begin
  drop table if exists pg_temp.mig059_todo;
  drop table if exists pg_temp.mig059_before;
  drop table if exists pg_temp.mig059_rls;

  create temp table mig059_todo as
    select id from public.user_boosts where start_date is null;

  create temp table mig059_before as
    select id, user_id, challenge_id, outcome, type, delta, remaining, expires_at, created_at from public.user_boosts;

  create temp table mig059_rls as
    select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c where c.oid = 'public.user_boosts'::regclass;
end
$snapshot$;

update public.user_boosts b
   set start_date = (b.created_at at time zone 'UTC')::date,
       end_date = (b.expires_at at time zone 'UTC')::date
 where b.start_date is null;

do $postcheck$
declare
  v_type text;
  v_nullable text;
  v_col text;
  v_bad bigint;
begin
  for v_col in select unnest(array['start_date', 'end_date']) loop
    select data_type, is_nullable into v_type, v_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'user_boosts' and column_name = v_col;
    if v_type is distinct from 'date' or v_nullable is distinct from 'YES' then
      raise exception '059 postcheck: user_boosts.% är % (nullable %), väntade date NULL-bar', v_col, coalesce(v_type, 'saknas'), v_nullable;
    end if;
  end loop;

  select count(*) into v_bad from public.user_boosts where start_date is null;
  if v_bad > 0 then
    raise exception '059 postcheck: % rader saknar fortfarande start_date', v_bad;
  end if;

  select count(*) into v_bad
    from public.user_boosts b join mig059_todo t on t.id = b.id
   where b.start_date is distinct from to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD')::date
      or b.end_date is distinct from to_char(b.expires_at at time zone 'UTC', 'YYYY-MM-DD')::date;
  if v_bad > 0 then
    raise exception '059 postcheck: % backfyllda rader har ett fönster som avviker från UTC-dagarna', v_bad;
  end if;

  select count(*) into v_bad
    from public.user_boosts b join mig059_todo t on t.id = b.id
   where b.end_date is not null and b.end_date < b.start_date;
  if v_bad > 0 then
    raise exception '059 postcheck: % backfyllda rader har end_date före start_date', v_bad;
  end if;

  if exists (
    (select id, user_id, challenge_id, outcome, type, delta, remaining, expires_at, created_at from public.user_boosts
     except select id, user_id, challenge_id, outcome, type, delta, remaining, expires_at, created_at from mig059_before)
    union all
    (select id, user_id, challenge_id, outcome, type, delta, remaining, expires_at, created_at from mig059_before
     except select id, user_id, challenge_id, outcome, type, delta, remaining, expires_at, created_at from public.user_boosts)
  ) then
    raise exception '059 postcheck: övriga kolumner i user_boosts avviker från snapshoten (rader tillagda, borttagna eller ändrade)';
  end if;

  if exists (
    select 1 from mig059_rls r, pg_class c
     where c.oid = 'public.user_boosts'::regclass
       and (r.rls is distinct from c.relrowsecurity or r.policies is distinct from (select count(*) from pg_policy p where p.polrelid = c.oid))
  ) then
    raise exception '059 postcheck: RLS-läget eller policyerna på user_boosts ändrades';
  end if;

  drop table mig059_todo;
  drop table mig059_before;
  drop table mig059_rls;
end
$postcheck$;
