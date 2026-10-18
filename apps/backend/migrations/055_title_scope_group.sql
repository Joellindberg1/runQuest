-- 055: titelscope per grupp — user_titles och title_leaderboard får group_id; topp 10 per grupp; omslagsfunktioner, shim och vy. ADR 012 beslut 1 och 3 (RUN-295, S2, v0.8.0).
-- Datum: 2026-10-18. EJ APPLICERAD. Kräver ägar-ja per miljö: först staging (supabase-staging, projekt aormctqrmguvncxrigwy), sedan prod
-- (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 055_title_scope_group, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- ORDNING: kräver 053 (group_members). Appliceras 053 -> 054 (group_settings, oberoende av den här) -> 055, alla FÖRE backend-deployen i v0.8.0
-- och först i staging. Ingen migration efter deploy.
--
-- BAKGRUND
-- Idag är titelvärden och rankingen globala: user_titles har unik nyckel (user_id, title_id) och title_leaderboard är topp 10 över ALLA
-- grupper (unika (title_id, position) och (title_id, user_id)). Ägarbeslut F3 (2026-10-16) gör en titel till en funktion av (användare, grupp):
-- samma person kan ha olika värden i två grupper eftersom rundfönstren skiljer, och rankingen är per grupp. Utan group_id på user_titles skulle en
-- framtida flermedlemskaps-migration skriva om den mest skrivna titeltabellen och dess race-känsliga rebuild. Därför kommer group_id nu, med
-- exakt ett resultat i dag: Wolfpack har en grupp, så migrationen är beteendeneutral (samma rader, samma innehavare, samma värden).
-- Den här filen är bara datamodellen, funktionerna och beviset. Applikationskoden (S6 processGroupTitles, S7 gruppfiltrerade läsvägar, S8
-- Pack News per grupp) kommer i senare leveranser; v0.7.x-koden fungerar mot den nya databasen utan ändring (se BAKÅTKOMPATIBILITET).
--
-- VAD MIGRATIONEN GÖR (i den här ordningen, allt i en transaktion; ett fel rullar tillbaka HELA migrationen)
--   1. lock_timeout 5 s (som 048 och 053): misslyckas hellre än att köa skrivtrafiken bakom en lång transaktion. Misslyckas den: kör om.
--   2. $preflight$: ändrar och raderar ingenting. Stoppar vid (a) att group_members saknas (053 inte körd), (b) fler än en grupp med medlemmar,
--      (c) någon titelinnehavare (user_titles eller title_leaderboard) vars användare saknar grupp, (d) någon innehavare utan aktivt medlemskap i
--      sin grupp (053:s backfill saknas eller glappar; rebuilden räknar bara aktiva medlemmar), (e) att något ANNAT än update_title_leaderboard
--      (funktion, vy, materialiserad vy, policy eller trigger) läser titles.current_holder_id, som rebuilden slutar skriva. (b)-(d) gäller bara
--      första körningen (user_titles saknar group_id); (a) och (e) gäller alltid. Ett stopp betyder: fråga ägaren, ändra inte data för att få
--      migrationen att gå igenom.
--   3. $snapshot$: före-snapshot som temporära tabeller (mig055_before_tl = title_leaderboard, mig055_before_ut = user_titles) och flaggan
--      mig055_run.first_run. Inte "on commit drop", så att en körning utan omslutande transaktion inte släpper dem direkt.
--   4. group_id (nullbar) på user_titles och title_leaderboard, främmande nyckel till groups, on delete cascade.
--   5. Rebuild-triggern title_leaderboard_update_trigger stängs AV på user_titles medan group_id fylls. Annars skulle backfillens UPDATE av varje
--      rad utlösa en ombyggnad per rad med den gamla funktionen. Den sätts på igen före den avslutande ombyggnaden (steg 11).
--   6. Backfill: group_id = users.group_id för rader som saknar grupp (förkontrollen har bevisat att alla har en). Därefter NOT NULL.
--   7. Unika nycklar: user_titles (user_id, group_id, title_id); title_leaderboard (group_id, title_id, position) och (group_id, title_id,
--      user_id). De tre nya skapas bara om de saknas, de tre gamla globala nycklarna släpps efteråt. Primärnycklarna och CHECK position 1-10
--      rörs inte (topp 10 gäller nu per grupp, eftersom nyckeln är per grupp). Index (group_id, title_id, value desc) på user_titles
--      (täcker också främmande nyckeln); title_leaderboards nya nyckel börjar på group_id och täcker dess främmande nyckel.
--   8. Funktionerna (alla plpgsql, set search_path to '', säkerhetsläge INVOKER; se FUNKTIONERNA).
--   9. BEFORE INSERT-shim på user_titles (se BAKÅTKOMPATIBILITET), och rebuild-triggern sätts på igen.
--  10. Vyn title_leaderboard_view återskapas med security_invoker = true och group_id sist.
--  11. select update_all_title_leaderboards(): bygger om alla grupper och titlar med de nya funktionerna (bevisar att tillståndet är konsekvent).
--  12. $postcheck$: 0 rader utan group_id, ingen unik nyckel på de två tabellerna utan group_id kvar, och på första körningen jämförs före-snapshoten
--      med tillståndet efter ombyggnaden med EXCEPT i båda riktningarna (innehavare, positioner, värden, earned_at); ett avvikande resultat stoppar
--      och rullar tillbaka. Därefter släpps snapshot-tabellerna (de enda drop table-satserna i filen; de är temporära och skapas av den här körningen).
--
-- FUNKTIONERNA
--   update_group_title_leaderboard(p_group_id uuid, p_title_id uuid) returns void   -- NY
--     Kräver båda argumenten (22004). Första data-satsen är pg_advisory_xact_lock på 'title_leaderboard:<grupp>:<titel>' (som 042, men per grupp och
--     titel): samtidiga ombyggnader av SAMMA lista köar, olika listor blockerar inte varandra, låset släpps vid transaktionens slut. Lämnar en
--     grupp som inte längre finns ifred (kaskadraderar en grupp sina user_titles utlöser triggern en ombyggnad för en grupp som redan är borta;
--     utan den kontrollen skulle insatsen bryta mot främmande nyckeln). Raderar och bygger om BARA den gruppens lista för titeln: topp 10 ur
--     user_titles med group_id = gruppen, value inte null och ett aktivt medlemskap (group_members.left_at is null), ordning value desc,
--     earned_at asc, user_id asc (sista nyckeln ny: skillnad bara vid exakt lika värde och tidpunkt). Stämplar titles.updated_at (äldre kod läser
--     klockan) men skriver INTE titles.current_holder_id/current_value: ingen läser dem och med flera grupper betyder de ingenting (ADR 012 1.5).
--   update_group_title_leaderboards(p_group_id uuid) returns void                    -- NY, alla titlar för en grupp (id-ordning)
--   update_title_leaderboard(p_title_id uuid) returns void                          -- OFÖRÄNDRAD signatur, omslag: alla grupper (id-ordning)
--   update_all_title_leaderboards() returns void                                    -- OFÖRÄNDRAD signatur, omslag: alla grupper och titlar
--   trigger_update_title_leaderboard() returns trigger                              -- OFÖRÄNDRAD signatur: tar gruppen direkt ur NEW/OLD.group_id
--     (ingen uppslagning, så en kaskadraderad användare fungerar). En UPDATE som flyttar en rad mellan grupp eller titel bygger även om den gamla
--     listan; ingen kod gör det i dag.
--   user_titles_fill_group_id() returns trigger                                     -- NY, shimmen
--   Låsordning: alla slingor tar låsen i ordningen (grupp-id, titel-id), så att update_all, update_group_title_leaderboards och omslaget per
--   titel aldrig kan ta samma lås i olika ordning (deadlock). Känd kvarvarande risk, accepterad (som 042): update_all håller alla lås till sin
--   transaktion committar; en enskild ombyggnad som kommer under tiden väntar.
--   Säkerhetsläge INVOKER är medvetet (som 046 och 053): service_role kringgår RLS ändå, och migrationen körs som postgres. Execute dras in från
--   public, anon och authenticated och ges bara till service_role för de TRE NYA funktionerna. De tre gamla behåller sina befintliga behörigheter
--   (create or replace rör dem inte); migrationen ändrar inga andra grants.
--
-- BAKÅTKOMPATIBILITET (v0.7.x-koden mot den nya databasen)
--   * v0.7.x infogar i user_titles utan group_id. BEFORE INSERT-triggern user_titles_group_id_shim fyller group_id ur users.group_id. Har användaren
--     ingen grupp förblir group_id null och NOT NULL stoppar insatsen (23502): ingen titel utan grupp (F2), fail-closed. Shimmen tas bort i v0.8.1
--     (contract-migration) när S6 skriver group_id själv.
--   * v0.7.x anropar rpc update_title_leaderboard(uuid) och update_all_title_leaderboards() med samma signaturer; de bygger nu om alla grupper.
--   * Vyn har samma 13 kolumner i samma ordning plus group_id sist; äldre kod väljer kolumner efter namn och märker ingenting.
--   * Med en grupp ger allt samma rader som förut. Under fönstret mellan migration och deploy skriver äldre POST /groups/join och POST /auth/users
--     bara users.group_id utan medlemskap (se 053): en sådan användares titlar sparas men räknas inte in i rankingen förrän 053:s backfill körs om
--     (den är idempotent) och rankingen byggs om. Release-röken kör konsistenskontrollen från 053.
--   * Ny kod mot gammal databas fungerar inte (kolumn och funktioner saknas): därför före deploy.
--
-- LÅS OCH TID: alter table tar ACCESS EXCLUSIVE på user_titles och title_leaderboard under migrationen (tabellerna har tiotals rader), så skrivningar
-- till titlar väntar i millisekunder. Främmande nycklarna tar SHARE ROW EXCLUSIVE på groups. lock_timeout (steg 1) gör att den misslyckas i stället
-- för att köa.
--
-- IDEMPOTENS: add column if not exists, create or replace, drop ... if exists, nycklarna bara om de saknas, create index if not exists. En omkörning
-- ger samma slutläge; på en omkörning hoppas stoppen (b)-(d) och före/efter-jämförelsen över (första körningen), medan (a) och (e) och de övriga
-- kontrollerna gäller. Ingen egen begin/commit (apply_migration kör filen som en transaktion).
--
-- BEVIS (läsning, ändrar inget; Lead kör i staging och i prod, FÖRE och EFTER). Samma frågor har körts mot en riktig Postgres (PGlite) av buildern.
-- QUERIES-START
--   -- A1. FÖRE: förkontrollen (förväntat prod: 1, 0, 0, 0, 0; staging: 1, 0, 0, 0, 0 med 'Staging Pack')
--   select (select count(distinct group_id) from public.users where group_id is not null) as grupper_med_medlemmar,
--          (select count(*) from public.user_titles ut join public.users u on u.id = ut.user_id where u.group_id is null) as user_titles_utan_grupp,
--          (select count(*) from public.title_leaderboard tl join public.users u on u.id = tl.user_id where u.group_id is null) as leaderboard_utan_grupp,
--          (select count(*) from public.user_titles ut join public.users u on u.id = ut.user_id where not exists (select 1 from public.group_members m where m.user_id = u.id and m.group_id = u.group_id and m.left_at is null)) as user_titles_utan_medlemskap,
--          (select count(*) from public.title_leaderboard tl join public.users u on u.id = tl.user_id where not exists (select 1 from public.group_members m where m.user_id = u.id and m.group_id = u.group_id and m.left_at is null)) as leaderboard_utan_medlemskap;
--   -- A2. FÖRE: läsare av titles.current_holder_id utom update_title_leaderboard (förväntat: 0 rader)
--   select 'function ' || p.proname as laser from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'update_title_leaderboard' and p.prosrc ~ 'current_holder_id'
--   union all select 'view ' || v.viewname from pg_views v where v.schemaname = 'public' and v.definition ~ 'current_holder_id'
--   union all select 'materialized view ' || m.matviewname from pg_matviews m where m.schemaname = 'public' and m.definition ~ 'current_holder_id'
--   union all select 'policy ' || pol.policyname from pg_policies pol where pol.schemaname = 'public' and coalesce(pol.qual, '') || coalesce(pol.with_check, '') ~ 'current_holder_id'
--   union all select 'trigger ' || t.tgname from pg_trigger t where not t.tgisinternal and pg_get_triggerdef(t.oid) ~ 'current_holder_id';
--   -- A3. FÖRE: innehavare (position 1) i klartext, spara utfallet och jämför med D1 efter apply (förväntat: identiskt)
--   select t.name as titel, u.name as innehavare, tl.value from public.title_leaderboard tl join public.titles t on t.id = tl.title_id join public.users u on u.id = tl.user_id where tl."position" = 1 order by t.name;
--   -- A4. FÖRE: hela listan som JSON. Spara värdet; det klistras in som <FORE_TL_JSON> i B1 (listan: title_id, user_id, position, value, earned_at)
--   select jsonb_agg(to_jsonb(s) order by s.title_id, s."position") as fore_title_leaderboard from (select title_id, user_id, "position", value, earned_at from public.title_leaderboard) s;
--   -- A5. FÖRE: user_titles som JSON. Spara värdet; det klistras in som <FORE_UT_JSON> i B2
--   select jsonb_agg(to_jsonb(s) order by s.user_id, s.title_id) as fore_user_titles from (select user_id, title_id, value, earned_at from public.user_titles) s;
--   -- A6. FÖRE: radantal och fingeravtryck (jämförs med C1 efter apply, förväntat identiskt)
--   select (select count(*) from public.title_leaderboard) as leaderboard_rader, (select count(*) from public.user_titles) as user_titles_rader, (select md5(string_agg(concat_ws('|', title_id, user_id, "position", value, earned_at), ',' order by title_id, "position")) from public.title_leaderboard) as leaderboard_md5, (select md5(string_agg(concat_ws('|', user_id, title_id, value, earned_at), ',' order by user_id, title_id)) from public.user_titles) as user_titles_md5;
--   -- B1. EFTER: EXCEPT i båda riktningarna mot A4 (förväntat: 0 och 0). Byt <FORE_TL_JSON> mot A4:s värde
--   with fore as (select * from jsonb_to_recordset('<FORE_TL_JSON>'::jsonb) as f(title_id uuid, user_id uuid, "position" integer, value numeric, earned_at timestamptz))
--   select 'efter minus fore' as riktning, count(*) as avvikande_rader from (select title_id, user_id, "position", value, earned_at from public.title_leaderboard except select title_id, user_id, "position", value, earned_at from fore) d
--   union all select 'fore minus efter', count(*) from (select title_id, user_id, "position", value, earned_at from fore except select title_id, user_id, "position", value, earned_at from public.title_leaderboard) d;
--   -- B2. EFTER: samma för user_titles mot A5 (förväntat: 0 och 0). Byt <FORE_UT_JSON> mot A5:s värde
--   with fore as (select * from jsonb_to_recordset('<FORE_UT_JSON>'::jsonb) as f(user_id uuid, title_id uuid, value numeric, earned_at timestamptz))
--   select 'efter minus fore' as riktning, count(*) as avvikande_rader from (select user_id, title_id, value, earned_at from public.user_titles except select user_id, title_id, value, earned_at from fore) d
--   union all select 'fore minus efter', count(*) from (select user_id, title_id, value, earned_at from fore except select user_id, title_id, value, earned_at from public.user_titles) d;
--   -- C1. EFTER: radantal och fingeravtryck, samma som A6 (förväntat identiskt)
--   select (select count(*) from public.title_leaderboard) as leaderboard_rader, (select count(*) from public.user_titles) as user_titles_rader, (select md5(string_agg(concat_ws('|', title_id, user_id, "position", value, earned_at), ',' order by title_id, "position")) from public.title_leaderboard) as leaderboard_md5, (select md5(string_agg(concat_ws('|', user_id, title_id, value, earned_at), ',' order by user_id, title_id)) from public.user_titles) as user_titles_md5;
--   -- C2. EFTER: inga rader utan grupp, en grupp i listan, längsta lista högst 10 (förväntat: 0, 0, 1, högst 10)
--   select (select count(*) from public.user_titles where group_id is null) as user_titles_utan_grupp, (select count(*) from public.title_leaderboard where group_id is null) as leaderboard_utan_grupp, (select count(distinct group_id) from public.title_leaderboard) as grupper_i_leaderboard, (select max(c) from (select count(*) as c from public.title_leaderboard group by group_id, title_id) x) as storsta_lista;
--   -- D1. EFTER: innehavare (position 1) i klartext, samma som A3 (förväntat identiskt)
--   select t.name as titel, u.name as innehavare, tl.value from public.title_leaderboard tl join public.titles t on t.id = tl.title_id join public.users u on u.id = tl.user_id where tl."position" = 1 order by t.name;
--   -- E1. EFTER: unika nycklar och främmande nycklar (förväntat: user_titles_user_group_title_key u (user_id, group_id, title_id); title_leaderboard_group_title_position_key u (group_id, title_id, "position"); title_leaderboard_group_title_user_key u (group_id, title_id, user_id); user_titles_group_id_fkey och title_leaderboard_group_id_fkey f ... ON DELETE CASCADE; inga gamla nycklar utan group_id)
--   select conrelid::regclass::text as tabell, conname, contype, pg_get_constraintdef(oid) as def from pg_constraint where conrelid in ('public.user_titles'::regclass, 'public.title_leaderboard'::regclass) and contype in ('u', 'f') order by 1, 2;
--   -- E2. EFTER: index (förväntat: nytt idx_user_titles_group_title_value (group_id, title_id, value DESC); övriga som förut)
--   select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('user_titles', 'title_leaderboard') order by tablename, indexname;
--   -- E3. EFTER: triggers på user_titles (förväntat: title_leaderboard_update_trigger AFTER INSERT OR DELETE OR UPDATE, tgenabled O; user_titles_group_id_shim BEFORE INSERT, tgenabled O)
--   select tgname, tgenabled, pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.user_titles'::regclass and not tgisinternal order by tgname;
--   -- E4. EFTER: funktionerna (förväntat: prosecdef false, proconfig {search_path=""}, signaturer som i FUNKTIONERNA; de tre nya false/false/false/true i execute-kolumnerna, de tre gamla med de rättigheter de hade före apply)
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'execute') as public_exec, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec, has_function_privilege('service_role', p.oid, 'execute') as service_role_exec from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('update_group_title_leaderboard', 'update_group_title_leaderboards', 'update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id') order by p.proname;
--   -- E5. EFTER: vyn (förväntat: reloptions {security_invoker=true}; 14 kolumner med group_id sist; anon och authenticated false/false)
--   select reloptions from pg_class where oid = 'public.title_leaderboard_view'::regclass;
--   select ordinal_position, column_name from information_schema.columns where table_schema = 'public' and table_name = 'title_leaderboard_view' order by ordinal_position;
--   select has_table_privilege('anon', 'public.title_leaderboard_view', 'select') as anon_select, has_table_privilege('authenticated', 'public.title_leaderboard_view', 'select') as authenticated_select;
--   -- E6. EFTER: RLS-ytan oförändrad (förväntat: RLS på för båda, 0 policyer, och tabellgrants (relacl) exakt som före apply: migrationen rör inga grants på tabellerna, klientroller stängs av RLS utan policyer)
--   select relname, relrowsecurity, relacl::text as relacl from pg_class where oid in ('public.user_titles'::regclass, 'public.title_leaderboard'::regclass) order by relname;
--   select count(*) as policyer from pg_policies where tablename in ('user_titles', 'title_leaderboard');
-- QUERIES-END
-- Efter apply: get_advisors (security) i varje miljö. Förväntat: inga nya fynd (inga nya tabeller, inga nya policyer, inga SECURITY DEFINER-funktioner,
-- alla funktioner har fast search_path, vyn är security_invoker). Röken i staging: en runda i grupp A påverkar inte grupp B:s lista (S14).
-- (Kommentar för Lead: A4 och A5 returnerar bara en rad vardera; med ett par hundra rader är JSON-värdet kort nog att klistra in i B1 och B2.)
--
-- ROLLBACK (körs manuellt och bara efter ägar-ja, i den här ordningen. GILTIG BARA MED EN GRUPP: de återskapade globala nycklarna kräver att
-- ingen titel har rader från två grupper. Återställer 042:s och baslinjens funktioner och vyn utan group_id. Raderar group_id-kolumnerna
-- (förlustfritt med en grupp). Rulla tillbaka 055 före 053 om båda ska bort. Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken
-- finns bara här och har körts mot en riktig Postgres (PGlite) av buildern.)
-- ROLLBACK-START
--   drop view if exists public.title_leaderboard_view;
--   drop trigger if exists user_titles_group_id_shim on public.user_titles;
--   create or replace function public.update_title_leaderboard(p_title_id uuid)
--    returns void
--    language plpgsql
--    set search_path to ''
--   as $function$
--   begin
--       perform pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || p_title_id::text, 0));
--
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
--   create or replace function public.update_all_title_leaderboards()
--    returns void
--    language plpgsql
--    set search_path to ''
--   as $function$
--   declare
--       title_record record;
--   begin
--       for title_record in select id from public.titles loop
--           perform public.update_title_leaderboard(title_record.id);
--       end loop;
--   end;
--   $function$;
--   create or replace function public.trigger_update_title_leaderboard()
--    returns trigger
--    language plpgsql
--    set search_path to ''
--   as $function$
--   begin
--       if tg_op = 'INSERT' or tg_op = 'UPDATE' then
--           perform public.update_title_leaderboard(new.title_id);
--           return new;
--       end if;
--       if tg_op = 'DELETE' then
--           perform public.update_title_leaderboard(old.title_id);
--           return old;
--       end if;
--       return null;
--   end;
--   $function$;
--   drop function if exists public.update_group_title_leaderboards(uuid);
--   drop function if exists public.update_group_title_leaderboard(uuid, uuid);
--   drop function if exists public.user_titles_fill_group_id();
--   drop index if exists public.idx_user_titles_group_title_value;
--   alter table public.user_titles drop column group_id;
--   alter table public.title_leaderboard drop column group_id;
--   alter table public.user_titles add constraint user_titles_user_id_title_id_key unique (user_id, title_id);
--   alter table public.title_leaderboard add constraint title_leaderboard_title_id_position_key unique (title_id, "position");
--   alter table public.title_leaderboard add constraint title_leaderboard_title_id_user_id_key unique (title_id, user_id);
--   create view public.title_leaderboard_view with (security_invoker = true) as
--    select t.id as title_id, t.name as title_name, t.description as title_description, t.unlock_requirement, t.metric_key,
--           tl."position", tl.user_id, u.name as user_name, u.gender as user_gender, u.profile_picture, tl.value, tl.earned_at,
--           case when tl."position" = 1 then 'holder'::text when tl."position" <= 3 then 'runner_up'::text else 'top_10'::text end as status
--      from public.titles t
--      left join public.title_leaderboard tl on t.id = tl.title_id
--      left join public.users u on tl.user_id = u.id
--     order by t.name, tl."position";
--   revoke select on public.title_leaderboard_view from anon, authenticated;
--   select public.update_all_title_leaderboards();
-- ROLLBACK-END
-- (Efter rollbacken: vyn har samma behörigheter som efter 039 och 052 (ingen select för anon eller authenticated, security_invoker). Kontrollera med E5.)
-- Statiskt test: titleScopeMigration055.test.ts.

set local lock_timeout = '5s';

-- Förkontroll: ändrar och raderar ingenting. Ett stopp rullar tillbaka hela migrationen.
do $preflight$
declare
  v_first_run        boolean;
  v_groups           integer;
  v_ungrouped        integer;
  v_ungrouped_ids    text;
  v_no_membership    integer;
  v_readers          text;
begin
  if to_regclass('public.group_members') is null then
    raise exception 'migration 055 stopped: public.group_members is missing. Apply 053 first (ADR 012 decision 3). Nothing was changed.';
  end if;

  v_first_run := not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_titles' and column_name = 'group_id');

  if v_first_run then
    select count(distinct group_id) into v_groups from public.users where group_id is not null;
    if v_groups > 1 then
      raise exception 'migration 055 stopped: % groups have members, expected exactly 1 (ADR 012 decision 3). Nothing was changed; ask the owner before continuing.', v_groups;
    end if;

    select count(*) into v_ungrouped from public.user_titles ut join public.users u on u.id = ut.user_id where u.group_id is null;
    if v_ungrouped > 0 then
      select string_agg(x.user_id::text, ', ' order by x.user_id) into v_ungrouped_ids
        from (select ut.user_id from public.user_titles ut join public.users u on u.id = ut.user_id where u.group_id is null order by ut.user_id limit 10) x;
      raise exception 'migration 055 stopped: % rows in user_titles belong to users without a group (first user ids: %). Titles exist only inside a group (ADR 012, F2). Nothing was changed; ask the owner before continuing.', v_ungrouped, v_ungrouped_ids;
    end if;

    select count(*) into v_ungrouped from public.title_leaderboard tl join public.users u on u.id = tl.user_id where u.group_id is null;
    if v_ungrouped > 0 then
      select string_agg(x.user_id::text, ', ' order by x.user_id) into v_ungrouped_ids
        from (select tl.user_id from public.title_leaderboard tl join public.users u on u.id = tl.user_id where u.group_id is null order by tl.user_id limit 10) x;
      raise exception 'migration 055 stopped: % rows in title_leaderboard belong to users without a group (first user ids: %). Titles exist only inside a group (ADR 012, F2). Nothing was changed; ask the owner before continuing.', v_ungrouped, v_ungrouped_ids;
    end if;

    select count(*) into v_no_membership from public.user_titles ut join public.users u on u.id = ut.user_id where not exists (select 1 from public.group_members m where m.user_id = u.id and m.group_id = u.group_id and m.left_at is null); if v_no_membership > 0 then raise exception 'migration 055 stopped: % rows in user_titles belong to users without an active membership in their group. Migration 053 is missing or incomplete. Nothing was changed; ask the owner before continuing.', v_no_membership; end if;

    select count(*) into v_no_membership from public.title_leaderboard tl join public.users u on u.id = tl.user_id where not exists (select 1 from public.group_members m where m.user_id = u.id and m.group_id = u.group_id and m.left_at is null); if v_no_membership > 0 then raise exception 'migration 055 stopped: % rows in title_leaderboard belong to users without an active membership in their group. Migration 053 is missing or incomplete. Nothing was changed; ask the owner before continuing.', v_no_membership; end if;
  end if;

  -- Rebuilden slutar skriva titles.current_holder_id/current_value. Något annat som läser dem skulle tyst få föråldrade värden.
  select string_agg(r.reader, ', ' order by r.reader) into v_readers from (
    select 'function ' || p.proname as reader from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'update_title_leaderboard' and p.prosrc ~ 'current_holder_id'
    union all
    select 'view ' || v.viewname from pg_views v where v.schemaname = 'public' and v.definition ~ 'current_holder_id'
    union all
    select 'materialized view ' || m.matviewname from pg_matviews m where m.schemaname = 'public' and m.definition ~ 'current_holder_id'
    union all
    select 'policy ' || pol.policyname from pg_policies pol where pol.schemaname = 'public' and coalesce(pol.qual, '') || coalesce(pol.with_check, '') ~ 'current_holder_id'
    union all
    select 'trigger ' || t.tgname from pg_trigger t where not t.tgisinternal and pg_get_triggerdef(t.oid) ~ 'current_holder_id'
  ) r;
  if v_readers is not null then
    raise exception 'migration 055 stopped: titles.current_holder_id is read by % and would no longer be written (ADR 012 decision 1.5). Nothing was changed; ask the owner before continuing.', v_readers;
  end if;
end;
$preflight$;

-- Före-snapshot för beviset i $postcheck$. Temporära tabeller, inte "on commit drop" (apply utan omslutande transaktion skulle släppa dem direkt).
do $snapshot$
begin
  drop table if exists pg_temp.mig055_before_tl;
  drop table if exists pg_temp.mig055_before_ut;
  drop table if exists pg_temp.mig055_run;
  create temp table mig055_before_tl as select title_id, user_id, "position", value, earned_at from public.title_leaderboard;
  create temp table mig055_before_ut as select user_id, title_id, value, earned_at from public.user_titles;
  create temp table mig055_run as select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_titles' and column_name = 'group_id') as first_run;
end;
$snapshot$;

alter table public.user_titles add column if not exists group_id uuid references public.groups(id) on delete cascade;
alter table public.title_leaderboard add column if not exists group_id uuid references public.groups(id) on delete cascade;

-- Triggern av medan group_id fylls: annars en ombyggnad per uppdaterad rad med den gamla funktionen. På igen längre ner.
alter table public.user_titles disable trigger title_leaderboard_update_trigger;

update public.user_titles ut set group_id = u.group_id from public.users u where u.id = ut.user_id and ut.group_id is null;
update public.title_leaderboard tl set group_id = u.group_id from public.users u where u.id = tl.user_id and tl.group_id is null;

alter table public.user_titles alter column group_id set not null;
alter table public.title_leaderboard alter column group_id set not null;

-- De nya nycklarna först, de gamla globala efteråt. De nya är svagare (de innehåller de gamlas kolumner) och kan inte bryta mot befintliga rader.
do $constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_titles'::regclass and conname = 'user_titles_user_group_title_key') then
    alter table public.user_titles add constraint user_titles_user_group_title_key unique (user_id, group_id, title_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.title_leaderboard'::regclass and conname = 'title_leaderboard_group_title_position_key') then
    alter table public.title_leaderboard add constraint title_leaderboard_group_title_position_key unique (group_id, title_id, "position");
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.title_leaderboard'::regclass and conname = 'title_leaderboard_group_title_user_key') then
    alter table public.title_leaderboard add constraint title_leaderboard_group_title_user_key unique (group_id, title_id, user_id);
  end if;
end;
$constraints$;

alter table public.user_titles drop constraint if exists user_titles_user_id_title_id_key;
alter table public.title_leaderboard drop constraint if exists title_leaderboard_title_id_position_key;
alter table public.title_leaderboard drop constraint if exists title_leaderboard_title_id_user_id_key;

create index if not exists idx_user_titles_group_title_value on public.user_titles (group_id, title_id, value desc);

create or replace function public.update_group_title_leaderboard(p_group_id uuid, p_title_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
begin
    if p_group_id is null or p_title_id is null then
        raise exception 'update_group_title_leaderboard: group_and_title_required' using errcode = '22004';
    end if;

    -- Låset före all läsning och skrivning: allt nedan körs först när ingen annan ombyggnad av samma (grupp, titel) pågår.
    perform pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || p_group_id::text || ':' || p_title_id::text, 0));

    -- En grupp som raderas kaskadar sina user_titles och triggern hamnar här: inget att bygga åt en grupp som inte finns.
    if not exists (select 1 from public.groups where id = p_group_id) then
        return;
    end if;

    delete from public.title_leaderboard where group_id = p_group_id and title_id = p_title_id;

    insert into public.title_leaderboard (group_id, title_id, user_id, "position", value, earned_at)
    select
        p_group_id,
        p_title_id,
        ut.user_id,
        row_number() over (order by ut.value desc, ut.earned_at asc, ut.user_id asc) as "position",
        ut.value,
        ut.earned_at
    from public.user_titles ut
    where ut.group_id = p_group_id
      and ut.title_id = p_title_id
      and ut.value is not null
      and exists (select 1 from public.group_members m where m.group_id = ut.group_id and m.user_id = ut.user_id and m.left_at is null)
    order by ut.value desc, ut.earned_at asc, ut.user_id asc
    limit 10;

    update public.titles set updated_at = now() where id = p_title_id;
end;
$function$;

create or replace function public.update_group_title_leaderboards(p_group_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
    v_title_id uuid;
begin
    for v_title_id in select t.id from public.titles t order by t.id loop
        perform public.update_group_title_leaderboard(p_group_id, v_title_id);
    end loop;
end;
$function$;

create or replace function public.update_title_leaderboard(p_title_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
    v_group_id uuid;
begin
    for v_group_id in select g.id from public.groups g order by g.id loop
        perform public.update_group_title_leaderboard(v_group_id, p_title_id);
    end loop;
end;
$function$;

create or replace function public.update_all_title_leaderboards()
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
    v_group_id uuid;
begin
    for v_group_id in select g.id from public.groups g order by g.id loop
        perform public.update_group_title_leaderboards(v_group_id);
    end loop;
end;
$function$;

create or replace function public.trigger_update_title_leaderboard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
    if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
        perform public.update_group_title_leaderboard(NEW.group_id, NEW.title_id);
        if TG_OP = 'UPDATE' and (OLD.group_id is distinct from NEW.group_id or OLD.title_id is distinct from NEW.title_id) then
            perform public.update_group_title_leaderboard(OLD.group_id, OLD.title_id);
        end if;
        return NEW;
    end if;
    if TG_OP = 'DELETE' then
        perform public.update_group_title_leaderboard(OLD.group_id, OLD.title_id);
        return OLD;
    end if;
    return null;
end;
$function$;

create or replace function public.user_titles_fill_group_id()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
    if NEW.group_id is null then
        select u.group_id into NEW.group_id from public.users u where u.id = NEW.user_id;
    end if;
    return NEW;
end;
$function$;

revoke execute on function public.update_group_title_leaderboard(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.update_group_title_leaderboards(uuid) from public, anon, authenticated;
revoke execute on function public.user_titles_fill_group_id() from public, anon, authenticated;
grant execute on function public.update_group_title_leaderboard(uuid, uuid) to service_role;
grant execute on function public.update_group_title_leaderboards(uuid) to service_role;
grant execute on function public.user_titles_fill_group_id() to service_role;

drop trigger if exists user_titles_group_id_shim on public.user_titles;
create trigger user_titles_group_id_shim before insert on public.user_titles for each row execute function public.user_titles_fill_group_id();

alter table public.user_titles enable trigger title_leaderboard_update_trigger;

-- Vyn: samma kolumner i samma ordning som förut och group_id sist. security_invoker = true MÅSTE stå med: create or replace view ersätter vyns
-- alternativ med de som anges i satsen, så utan det förlorar vyn alternativet som 052 satte. Behörigheterna från 039 behålls av create or replace.
create or replace view public.title_leaderboard_view with (security_invoker = true) as
 select t.id as title_id,
        t.name as title_name,
        t.description as title_description,
        t.unlock_requirement,
        t.metric_key,
        tl."position",
        tl.user_id,
        u.name as user_name,
        u.gender as user_gender,
        u.profile_picture,
        tl.value,
        tl.earned_at,
        case
            when tl."position" = 1 then 'holder'::text
            when tl."position" <= 3 then 'runner_up'::text
            else 'top_10'::text
        end as status,
        tl.group_id
   from public.titles t
   left join public.title_leaderboard tl on t.id = tl.title_id
   left join public.users u on tl.user_id = u.id
  order by t.name, tl.group_id, tl."position";

select public.update_all_title_leaderboards();

-- Slutkontroll i samma transaktion: ett fel rullar tillbaka hela migrationen.
do $postcheck$
declare
  v_null_ut      integer;
  v_null_tl      integer;
  v_global_keys  integer;
  v_diff_tl      integer := 0;
  v_diff_ut      integer := 0;
begin
  select count(*) into v_null_ut from public.user_titles where group_id is null;
  select count(*) into v_null_tl from public.title_leaderboard where group_id is null;
  if v_null_ut > 0 or v_null_tl > 0 then
    raise exception 'migration 055 failed: group_id is still null (% rows in user_titles, % in title_leaderboard). Nothing was changed.', v_null_ut, v_null_tl;
  end if;

  select count(*) into v_global_keys from pg_constraint c
   where c.conrelid in ('public.user_titles'::regclass, 'public.title_leaderboard'::regclass)
     and c.contype = 'u' and not (select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'group_id') = any (c.conkey);
  if v_global_keys > 0 then
    raise exception 'migration 055 failed: % unique constraints on user_titles or title_leaderboard lack group_id. Nothing was changed.', v_global_keys;
  end if;

  -- Beteendeneutralt med en grupp: innehavare, positioner, värden och earned_at identiska före och efter (första körningen).
  if (select first_run from pg_temp.mig055_run) then
    select count(*) into v_diff_tl from (
      (select title_id, user_id, "position", value, earned_at from public.title_leaderboard except select title_id, user_id, "position", value, earned_at from pg_temp.mig055_before_tl)
      union all
      (select title_id, user_id, "position", value, earned_at from pg_temp.mig055_before_tl except select title_id, user_id, "position", value, earned_at from public.title_leaderboard)
    ) d;
    select count(*) into v_diff_ut from (
      (select user_id, title_id, value, earned_at from public.user_titles except select user_id, title_id, value, earned_at from pg_temp.mig055_before_ut)
      union all
      (select user_id, title_id, value, earned_at from pg_temp.mig055_before_ut except select user_id, title_id, value, earned_at from public.user_titles)
    ) d;
    if v_diff_tl > 0 or v_diff_ut > 0 then
      raise exception 'migration 055 failed: the title holders or values changed (% rows differ in title_leaderboard, % in user_titles). Nothing was changed; ask the owner before continuing.', v_diff_tl, v_diff_ut;
    end if;
  end if;

  drop table pg_temp.mig055_before_tl, pg_temp.mig055_before_ut, pg_temp.mig055_run;
end;
$postcheck$;
