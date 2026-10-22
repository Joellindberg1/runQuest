-- 060: strava_tokens — databasen vägrar spara en token som inte är krypterad (CHECK-constraint på access_token och refresh_token).
-- ADR 013 beslut 8 och S6 (RUN-315, v0.8.1; Ö3 godkänd av ägaren 2026-10-17: "i en egen migration med ägarens ja, först när backfill är verifierad").
-- Datum: 2026-10-21. APPLICERAD i staging 2026-10-22 och i prod 2026-10-22 (ägar-ja i chatten; prod hade 6 rader, alla enc:v1:, backfillens dry-run 0 klartext). Kräver ägar-ja per miljö (docs/permissions.md: CHECK-migrationen för tokenkrypteringen är `ask`): först staging (supabase-staging, projekt
-- aormctqrmguvncxrigwy), sedan prod (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 060_strava_tokens_encrypted_check, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- ORDNING (fast, ADR 013 beslut 8 och 13; samma ordning står i docs/release.md, avsnitt 5)
--   1. Ägaren kör backfillen i prod (`backfill:strava-token-encryption`, dry-run, sedan --apply med ägar-ja), och i staging om staging har rader.
--   2. Hälsoblocket (GET /api/strava/webhook/health, token_encryption) visar plaintext_rows: 0 och unrecognised_rows: 0. Det är villkoret för att köra den här filen.
--   3. 060 appliceras med ägar-ja, staging först. Förkontrollen nedan stoppar om en enda rad ändå har klartext.
--   4. EFTER 060: koden som tar bort klartextläsningen (RUN-316) deployas. Tidigare inte: den koden läser ett värde utan enc:v1: som token_unreadable, så den får inte komma
--      före backfillen, och den ska heller inte komma före 060, eftersom 060 är det som gör att noll klartextrader stannar noll (ingen väg, ingen gammal instans och ingen manuell SQL-rad kan skriva klartext igen).
--   Koden som kör nu (v0.8.0 och v0.8.1 före RUN-316) skriver redan bara enc:v1:-värden och läser både enc:v1: och klartext. 060 är därför bakåtkompatibel mot den: inget i koden skriver något constrainten avvisar.
--
-- VAD MIGRATIONEN GÖR (i den här ordningen, allt i en transaktion; ett fel rullar tillbaka HELA migrationen)
--   1. lock_timeout 5 s (som 048 och 053-059): misslyckas hellre än att köa skrivtrafiken. Misslyckas den: kör om.
--   2. $preflight$: ändrar ingenting. Stoppar om public.strava_tokens saknas, om access_token eller refresh_token inte är text, om constrainten redan finns, eller om någon rad
--      har ett tokenvärde som inte börjar med enc:v1:. Den sista kontrollen räknar med count(*) (per kolumn och för raden i helhet) och läser aldrig ut, skriver aldrig ut och
--      sparar aldrig ett värde: felet säger bara antal. Docs/permissions.md: inga AI på Strava-innehåll.
--   3. $snapshot$: en temporär tabell med antalet rader och tabellens RLS-läge (RLS på eller av, antal policyer), för slutkontrollen. Inte "on commit drop", som 058 och 059.
--   4. alter table public.strava_tokens add constraint strava_tokens_tokens_encrypted_chk check ((access_token is null or access_token like 'enc:v1:%') and (refresh_token is null or refresh_token like 'enc:v1:%')) not valid.
--      Båda kolumnerna får vara null (000_baseline: access_token text, refresh_token text, utan not null; stravaTokenStore läser och skriver dem som null när en kolumn är tom). NOT VALID: constrainten
--      gäller för varje ny INSERT och UPDATE direkt, men raderna som redan finns skannas inte här.
--   5. alter table public.strava_tokens validate constraint strava_tokens_tokens_encrypted_chk: skannar de befintliga raderna och gör constrainten validerad. Hittar den en rad som bryter mot villkoret rullas HELA
--      migrationen tillbaka (förkontrollen ska ha stoppat redan i steg 2; steget fångar en rad som skrevs mellan förkontrollen och constrainten).
--   6. $postcheck$: constrainten finns, är en CHECK, är validerad och dess villkor nämner båda kolumnerna och 'enc:v1:%'; ingen rad bryter mot villkoret (count(*)); antalet rader, RLS-läget och antalet policyer är
--      oförändrade mot snapshoten; och ett PROV i motorn: en tillfällig tabell med tabellens CHECK-villkor (create temp table ... (like public.strava_tokens including defaults including constraints)) får fyra
--      värden som ska avvisas (klartext i access_token, klartext i refresh_token, ett tomt värde, enc:v2:) och två som ska godtas (enc:v1: i båda kolumnerna, null i båda). Avvisningen måste vara check_violation (23514)
--      och komma från constrainten strava_tokens_tokens_encrypted_chk. Det är beviset att "ett försök att spara en klartexttoken ger fel". Provet rör inga riktiga rader och läser ingen. Avviker något stoppar det och
--      rullar tillbaka allt. Därefter släpps de tillfälliga tabellerna.
--   Rörs INTE: kolumnernas namn och typ (klartexten och chiffertexten delar kolumn; "drop av klartext" betyder att klartext inte längre kan lagras, inte en drop column), index, främmande nycklar, RLS, policyer, grants.
--
-- LÅS
--   * set local lock_timeout = '5s': migrationen misslyckas efter 5 s hellre än att stå i kö bakom en annan transaktion (och släppa efter sig en kö av skrivningar). Misslyckas den: kör om.
--   * add constraint ... not valid tar ACCESS EXCLUSIVE på strava_tokens, men bara metadata (ingen skanning), och låset hålls till transaktionens slut.
--   * validate constraint tar SHARE UPDATE EXCLUSIVE (läsning och skrivning av tabellen pågår som vanligt; det blockerar bara andra schemaändringar och vacuum) och skannar tabellen.
--   * SANNING OM LÅSEN: båda stegen ligger i EN transaktion (apply_migration kör filen som en). ACCESS EXCLUSIVE från steg 4 hålls därför ända till commit, och den vanliga vinsten med not valid följt av validate
--     (att skanningen inte blockerar skrivningar) uppstår inte här. Det spelar ingen roll för strava_tokens, som har en handfull rader (en per Strava-kopplad användare; 6 aktiva användare): skanningen tar millisekunder.
--     De som kan vänta på låset är OAuth-callbacken och tokenförnyelsen, i millisekunder. Skulle tabellen någon gång vara stor: kör steg 4 och steg 5 som två separata apply (validate sist), så hålls det starka låset bara under steg 4.
--     Inga andra tabeller låses (constrainten har ingen främmande nyckel).
--
-- NÖDUTGÅNGEN `backfill:strava-token-encryption --decrypt` OCH 060
--   --decrypt --apply skriver klartext tillbaka (för att backa en release till kod som inte läser enc:v1:). Så länge constrainten gäller avvisar databasen varje sådan skrivning med check_violation (23514); skriptet rapporterar
--   `check_violation` per rad och ändrar inget. Ska nödutgången användas måste constrainten släppas FÖRST (rollbacken nedan, med ägar-ja), sedan --decrypt --apply, och constrainten läggas tillbaka (kör filen igen) när
--   releasen är på plats och --apply har krypterat om raderna.
--
-- ROLLBACK (återställer SCHEMAT; ingen data har ändrats av 060 och ingen data går förlorad). Kör som en transaktion med ägar-ja. Behövs bara för nödutgången ovan, eller om kod som skriver klartext av något skäl måste köras igen.
-- ROLLBACK-START
--   alter table public.strava_tokens drop constraint if exists strava_tokens_tokens_encrypted_chk;
-- ROLLBACK-END
--
-- KATALOGFRÅGOR (Lead kör efter apply i varje miljö; ingen läser ett tokenvärde, ADR 013 beslut 10)
-- Q1. Constrainten. Förväntat: en rad, convalidated true, definitionen nämner access_token, refresh_token och 'enc:v1:%' (Postgres visar LIKE som ~~).
-- Q1-START
--   select conname, contype, convalidated, pg_get_constraintdef(oid) as definition
--     from pg_constraint where conrelid = 'public.strava_tokens'::regclass and conname = 'strava_tokens_tokens_encrypted_chk';
-- Q1-END
-- Q2. Antal rader utanför villkoret. Förväntat: utanfor_villkoret 0 (och rader = antalet Strava-kopplingar; tabellen är oförändrad av 060).
-- Q2-START
--   select count(*) as rader,
--          count(*) filter (where not ((access_token is null or access_token like 'enc:v1:%') and (refresh_token is null or refresh_token like 'enc:v1:%'))) as utanfor_villkoret
--     from public.strava_tokens;
-- Q2-END
-- Q3. RLS och policyer oförändrade. Förväntat: rls true, policies 0 (038 och 039 stängde alla policyer; samma som före apply).
-- Q3-START
--   select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies from pg_class c where c.oid = 'public.strava_tokens'::regclass;
-- Q3-END
-- Q4. Provet om att databasen vägrar klartext, utan att röra en riktig rad: en tillfällig kopia av tabellens villkor. Kör de tre satserna som en körning (execute_sql). Förväntat: tredje satsen ger
-- ERROR 23514 (new row for relation "mig060_q4" violates check constraint "strava_tokens_tokens_encrypted_chk"); satsen före den (ett giltigt värde) går igenom. Allt rullas tillbaka.
-- Q4-START
--   begin;
--   create temp table mig060_q4 (like public.strava_tokens including defaults including constraints);
--   insert into pg_temp.mig060_q4 (user_id, access_token, refresh_token) values (gen_random_uuid(), 'enc:v1:stg-1:aaaa:bbbb:cccc', null);
--   insert into pg_temp.mig060_q4 (user_id, access_token) values (gen_random_uuid(), 'plaintext-token-for-the-probe-0123456789');
--   rollback;
-- Q4-END
-- Q5. Efter att RUN-316-koden är deployad (hälsoblocket, inte SQL): token_encryption.plaintext_rows och unrecognised_rows är 0 och förblir 0; unreadable_since_start rör sig inte av sig själv.
--
-- Statiskt test: stravaTokensEncryptedCheckMigration060.test.ts. Körning i en riktig Postgres-motor (PGlite) med påhittade rader: se slutrapporten för RUN-315.

set local lock_timeout = '5s';

do $preflight$
declare
  v_type text;
  v_col text;
  v_rows bigint;
  v_bad bigint;
  v_bad_access bigint;
  v_bad_refresh bigint;
begin
  if to_regclass('public.strava_tokens') is null then
    raise exception '060 preflight: public.strava_tokens saknas (000_baseline är inte körd?). Inget ändrat.';
  end if;

  for v_col in select unnest(array['access_token', 'refresh_token']) loop
    select data_type into v_type from information_schema.columns
     where table_schema = 'public' and table_name = 'strava_tokens' and column_name = v_col;
    if v_type is distinct from 'text' then
      raise exception '060 preflight: strava_tokens.% är % (väntade text). Villkoret vore inte det ADR 013 beskriver. Inget ändrat.', v_col, coalesce(v_type, 'saknas');
    end if;
  end loop;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.strava_tokens'::regclass and conname = 'strava_tokens_tokens_encrypted_chk'
  ) then
    raise exception '060 preflight: constrainten strava_tokens_tokens_encrypted_chk finns redan (060 är redan körd, helt eller delvis?). Kontrollera med Q1 i filens huvud; släpp den med rollbacken i huvudet om du vill köra om. Inget ändrat.';
  end if;

  -- Bara antal: ingen kolumn läses ut i en variabel och inget värde hamnar i ett felmeddelande.
  select count(*),
         count(*) filter (where not (access_token is null or access_token like 'enc:v1:%')),
         count(*) filter (where not (refresh_token is null or refresh_token like 'enc:v1:%')),
         count(*) filter (where not ((access_token is null or access_token like 'enc:v1:%') and (refresh_token is null or refresh_token like 'enc:v1:%')))
    into v_rows, v_bad_access, v_bad_refresh, v_bad
    from public.strava_tokens;

  if v_bad > 0 then
    raise exception '060 preflight: % rad(er) av % har ett tokenvärde som inte börjar med enc:v1: (access_token: %, refresh_token: %). Backfillen är inte klar: kör backfill:strava-token-encryption (dry-run, sedan --apply med ägar-ja) och kontrollera att hälsoblocket visar plaintext_rows: 0. Inget ändrat.',
      v_bad, v_rows, v_bad_access, v_bad_refresh;
  end if;
end
$preflight$;

do $snapshot$
begin
  drop table if exists pg_temp.mig060_before;

  create temp table mig060_before as
    select (select count(*) from public.strava_tokens) as row_count,
           c.relrowsecurity as rls,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c where c.oid = 'public.strava_tokens'::regclass;
end
$snapshot$;

alter table public.strava_tokens
  add constraint strava_tokens_tokens_encrypted_chk
  check ((access_token is null or access_token like 'enc:v1:%') and (refresh_token is null or refresh_token like 'enc:v1:%'))
  not valid;

alter table public.strava_tokens
  validate constraint strava_tokens_tokens_encrypted_chk;

do $postcheck$
declare
  v_def text;
  v_valid boolean;
  v_type "char";
  v_bad bigint;
  v_case record;
  v_rejected boolean;
  v_constraint text;
begin
  select c.contype, c.convalidated, pg_get_constraintdef(c.oid) into v_type, v_valid, v_def
    from pg_constraint c
   where c.conrelid = 'public.strava_tokens'::regclass and c.conname = 'strava_tokens_tokens_encrypted_chk';
  if v_type is distinct from 'c' then
    raise exception '060 postcheck: constrainten strava_tokens_tokens_encrypted_chk saknas eller är inte en CHECK';
  end if;
  if v_valid is distinct from true then
    raise exception '060 postcheck: constrainten är inte validerad';
  end if;
  if position('access_token' in v_def) = 0 or position('refresh_token' in v_def) = 0 or position('enc:v1:%' in v_def) = 0 then
    raise exception '060 postcheck: constrainten har inte det väntade villkoret (båda kolumnerna och enc:v1:%%)';
  end if;

  select count(*) into v_bad from public.strava_tokens where not ((access_token is null or access_token like 'enc:v1:%') and (refresh_token is null or refresh_token like 'enc:v1:%'));
  if v_bad > 0 then
    raise exception '060 postcheck: % rader bryter fortfarande mot villkoret', v_bad;
  end if;

  if (select count(*) from public.strava_tokens) is distinct from (select row_count from mig060_before) then
    raise exception '060 postcheck: antalet rader i strava_tokens har ändrats av migrationen';
  end if;

  if exists (
    select 1 from mig060_before b, pg_class c
     where c.oid = 'public.strava_tokens'::regclass
       and (c.relrowsecurity is distinct from b.rls or (select count(*) from pg_policy p where p.polrelid = c.oid) is distinct from b.policies)
  ) then
    raise exception '060 postcheck: RLS-läget eller antalet policyer på strava_tokens har ändrats';
  end if;

  -- Provet i motorn, på en tillfällig tabell med tabellens egna CHECK-villkor (inga riktiga rader rörs eller läses).
  drop table if exists pg_temp.mig060_probe;
  create temp table mig060_probe (like public.strava_tokens including defaults including constraints);

  for v_case in
    select * from (values
      ('klartext i access_token',      'plain-access-0123456789012345', null::text,                          true),
      ('klartext i refresh_token',     null::text,                      'plain-refresh-012345678901234',      true),
      ('tomt värde i access_token',    '',                              null::text,                          true),
      ('fel version (enc:v2:)',        'enc:v2:stg-1:aaaa:bbbb:cccc',   null::text,                          true),
      ('enc:v1: i båda kolumnerna',    'enc:v1:stg-1:aaaa:bbbb:cccc',   'enc:v1:stg-1:dddd:eeee:ffff',       false),
      ('null i båda kolumnerna',       null::text,                      null::text,                          false)
    ) as t(label, access_value, refresh_value, must_reject)
  loop
    v_rejected := false;
    v_constraint := null;
    begin
      insert into pg_temp.mig060_probe (user_id, access_token, refresh_token) values (gen_random_uuid(), v_case.access_value, v_case.refresh_value);
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      v_rejected := true;
    end;
    if v_rejected is distinct from v_case.must_reject then
      raise exception '060 postcheck: provet "%" %', v_case.label, case when v_case.must_reject then 'avvisades inte av databasen' else 'avvisades trots att värdet är giltigt' end;
    end if;
    if v_rejected and v_constraint is distinct from 'strava_tokens_tokens_encrypted_chk' then
      raise exception '060 postcheck: provet "%" avvisades av en annan constraint (%)', v_case.label, coalesce(v_constraint, 'okänd');
    end if;
  end loop;

  drop table if exists pg_temp.mig060_probe;
  drop table if exists pg_temp.mig060_before;
end
$postcheck$;
