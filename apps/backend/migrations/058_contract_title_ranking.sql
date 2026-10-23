-- 058: contract-migration för titelrankingen — släpp omslagsfunktionerna, shim-triggern, rebuild-triggern, titles.current_holder_id/current_value och slutstämplingen av titles.updated_at.
-- ADR 012 beslut 1.5 och 8 (RUN-309, v0.8.1). Slår ihop rankingens tre uppdateringsvägar till en (se EN VÄG nedan).
-- Datum: 2026-10-19. APPLICERAD i staging 2026-10-19 (ägar-ja i chatten); EJ APPLICERAD i prod. Kräver ägar-ja per miljö (kolumnerna släpps: destruktivt enligt docs/permissions.md): först staging (supabase-staging, projekt
-- aormctqrmguvncxrigwy), sedan prod (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 058_contract_title_ranking, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- ORDNING: kräver 055 och 056 (båda i prod sedan 2026-10-19). Ingen annan migration behövs före eller efter.
-- KÖRORDNING: det här är en CONTRACT-migration (expand/contract, ADR 012 beslut 3 och 8): v0.8.0 är live och inget v0.7.x körs längre, så resterna
-- som 055 lämnade för äldre kod kan tas bort. Båda ordningarna mot v0.8.1-deployen är säkra, eftersom ingen kod (v0.8.0 eller v0.8.1) anropar något som släpps:
--   * v0.8.0 (live): anropar bara update_group_title_leaderboard(s) och läser inte kolumnerna som släpps; bygger själv om rankingen explicit (per ändrad
--     titel och i slutet av calculateUserTotals), så den klarar sig utan triggern. Enda synliga följd: GET /api/titles (select *) tappar de två fälten
--     current_holder_id/current_value, som ingen klient använder (frontendens TitleData har dem inte).
--   * v0.8.1: processGroupTitles bygger om gruppens ranking EN gång i slutet (update_group_title_leaderboards) och är den enda skrivaren; getAllTitles
--     väljer kolumnerna uttryckligen och bryr sig inte om de finns.
-- REKOMMENDERAD ordning i varje miljö: v0.8.1-koden är deployad, sedan 058, sedan röken (nedan), så att röken körs mot koden som ska leva kvar.
-- Staging deployar integration/v0.8.1 automatiskt, så där är koden redan på plats när 058 körs.
--
-- BAKGRUND: DEN TREDUBBLA UPPDATERINGEN (ADR 012 beslut 4.4, städkandidat v0.8.1)
-- Före 058 byggdes gruppens ranking (title_leaderboard) om tre gånger för varje titelrad som processGroupTitles skrev:
--   1. triggern title_leaderboard_update_trigger (AFTER INSERT OR UPDATE OR DELETE på user_titles, FOR EACH ROW, trigger_update_title_leaderboard()):
--      en ombyggnad av (grupp, titel) per skriven rad, i skrivningens egen transaktion;
--   2. enhancedTitleService.processUserTitlesAfterRun: ett explicit rpc update_group_title_leaderboard(grupp, titel) per ändrad titel och användare,
--      direkt efter skrivningen (samma ombyggnad en gång till, plus en extra för titlar vars värde var oförändrat);
--   3. calculateUserTotals: ett avslutande rpc update_group_title_leaderboards(grupp) för alla titlar (stämplar title_leaderboard.updated_at för
--      hela gruppen, vilket är klockan som titleRecalcClock/group-eligibility läser, ADR 012 beslut 5.6).
-- Alla tre kallar samma funktion och ger samma rader (ombyggnaden är en ren funktion av user_titles och group_members: ordning value desc, earned_at asc,
-- user_id asc, topp 10, bara aktiva medlemmar). Bara title_leaderboard.updated_at skiljer, och bara väg 3 gav den egenskap som något läser (klockan).
-- Dessutom nådde väg 3 inte stravaSync/reprocess-all/skriptet (de kallar processAllGroupsTitles, inte calculateUserTotals), så klockan rörde sig där
-- bara för titlar som råkade ändras.
--
-- EN VÄG (v0.8.1-koden, i samma leverans som den här migrationen)
--   processGroupTitles(groupId) skriver user_titles för gruppens medlemmar och anropar sedan EN gång rebuildGroupTitleRanking(groupId) =
--   update_group_title_leaderboards(groupId), före efter-ögonblicksbilden för Pack News. Det är den enda stället i omräkningen som skriver title_leaderboard.
--   Övriga skrivare av rankingen är händelser som inte är en titelomräkning: en användare går med i gruppen (groups/join, auth/users) och admins
--   populate/refresh; de kallar samma rebuildGroupTitleRanking. Väg 1 och 2 är borta, väg 3 har flyttats in i processGroupTitles så att varje anropare
--   (calculateUserTotals, nattens stravaSync, reprocess-all, skriptet) får samma beteende och stämplar klockan för hela gruppen.
--   Resultatet är identiskt: rankingens rader är en funktion av user_titles och group_members, och den sista ombyggnaden efter den sista skrivningen ger
--   samma rader som den gav via triggern (beviset: docs i ADR 012 addendum och migrationens PGlite-körning, se slutrapporten för RUN-309).
--   Vad som ändras: (a) title_leaderboard stämplas för hela gruppen vid varje gruppomräkning (förr bara vid calculateUserTotals), (b) rankingen byggs om
--   efter alla skrivningar i stället för efter varje rad, (c) en skrivning till user_titles utanför appen (admin-SQL) bygger inte längre om rankingen:
--   kör då select public.update_group_title_leaderboards('<grupp-id>'), eller POST /api/titles/refresh som admin, eller vänta på nästa omräkning (varje
--   rundloggning och nattens synk bygger om). En raderad användare (cascade) lämnar ett hål i gruppens lista tills nästa omräkning; ingen
--   funktion för att radera användare finns i appen.
--
-- VAD MIGRATIONEN GÖR (i den här ordningen, allt i en transaktion; ett fel rullar tillbaka HELA migrationen)
--   1. lock_timeout 5 s (som 048 och 053-057): misslyckas hellre än att köa skrivtrafiken. Misslyckas den: kör om.
--   1b. $lock$: tar ALLA lås som resten av migrationen behöver, direkt och på en gång, i fast ordning: lock table public.titles, public.title_leaderboard, public.user_titles,
--      public.users in access exclusive mode nowait (se LÅS OCH TID). Allt som följer (förkontroll, snapshot, drop, postcheck) körs alltså med skrivningar utestängda, så förkontrollen och
--      före-snapshoten kan inte gå sönder mellan läsning och drop. Får den inte alla fyra släpper den dem igen och försöker på nytt (högst 20 försök med 0,25 s mellanrum), sedan stoppar den.
--   2. $preflight$: ändrar och raderar ingenting. Stoppar om (a) 055 inte är körd (update_group_title_leaderboard(s) eller user_titles.group_id saknas),
--      (b) något annat än de två kända triggrarna (title_leaderboard_update_trigger och user_titles_group_id_shim på user_titles) beror på de fyra
--      funktionerna som släpps, enligt pg_depend (vyer, triggrar på andra tabeller, policyer, standardvärden), (c) något annat än den kända främmande nyckeln
--      titles_current_holder_id_fkey, indexet idx_titles_current_holder_id och kolumnens egna standardvärde beror på titles.current_holder_id/current_value (pg_depend: vyer,
--      policyer, kontroller, genererade kolumner), (d) någon annan funktion, vy, materialiserad vy, policy eller trigger nämner funktionsnamnen eller kolumnnamnen i sin text,
--      i NÅGOT schema utom pg_catalog och information_schema, inte bara public (plpgsql-kroppar syns inte i pg_depend), eller (e) ett cron-jobb (om schemat cron finns) nämner dem. Ett stopp betyder: fråga ägaren, släpp inget med CASCADE.
--   3. $snapshot$: före-snapshot som temporära tabeller (mig058_before_tl = title_leaderboard med position, mig058_before_ut = user_titles, mig058_before_t =
--      titles utan de två kolumnerna). Inte "on commit drop", så att en körning utan omslutande transaktion inte släpper dem direkt (som 055).
--   4. Släpper de två triggrarna på user_titles (drop trigger if exists): user_titles_group_id_shim (shimmen för v0.7.x-koden) och
--      title_leaderboard_update_trigger (väg 1).
--   5. Släpper de fyra funktionerna UTAN cascade (drop function if exists, exakta signaturer): trigger_update_title_leaderboard(), user_titles_fill_group_id(),
--      update_title_leaderboard(uuid) och update_all_title_leaderboards(). Hade något beroende missats av förkontrollen avbryter Postgres själv.
--   6. create or replace update_group_title_leaderboard(uuid, uuid): samma funktion som 055 minus slutstämplingen av titles.updated_at (ingen läser den: 055 behöll den
--      bara för v0.7.x). Låsprotokollet är oförändrat (titles-radlåset FOR NO KEY UPDATE först, sedan advisory-låset), så deadlockresonemanget från 055 gäller. Grants behålls
--      av create or replace (bara service_role kan köra den).
--   7. alter table public.titles drop column current_holder_id, drop column current_value (utan cascade). Den främmande nyckeln titles_current_holder_id_fkey och indexet
--      idx_titles_current_holder_id följer med kolumnen. Kolumnerna är frusna sedan 055 (rebuilden skriver dem inte längre) och ingen kod läser dem. Värdena går förlorade:
--      spara fråga A6 före apply (rollbacken kan återställa dem ur den).
--   8. $postcheck$: de fyra funktionerna, de två triggrarna och de två kolumnerna är borta; update_group_title_leaderboard(s) finns kvar, är INVOKER, har fast
--      search_path och kan bara köras av service_role; update_group_title_leaderboard stämplar inte titles. Före/efter-snapshoten jämförs med EXCEPT i
--      båda riktningarna och måste vara IDENTISK: title_leaderboard inklusive position (inget byter plats, till skillnad från 055), user_titles och titles
--      (utom de två släppta kolumnerna). Avviker något stoppar det och rullar tillbaka allt. Därefter släpps snapshot-tabellerna.
--   Rörs INTE: user_titles/title_leaderboard (rader, nycklar, index), vyn title_leaderboard_view (14 kolumner, security_invoker, rör inga släppta objekt),
--   update_group_title_leaderboards(uuid), grants på andra objekt, RLS och policyer (ingen ny tabell, ingen ny policy, ingen ny funktion).
--
-- LÅS OCH TID (verifierat i PGlite med pg_locks, builderns körning): drop trigger tar ACCESS EXCLUSIVE på user_titles; drop column tar ACCESS EXCLUSIVE på titles OCH, för att ta
-- bort främmande nyckeln mot users (dess RI-triggrar sitter på users), ACCESS EXCLUSIVE på users (inte SHARE ROW EXCLUSIVE, som en tidigare version av den här texten sa). Under de
-- millisekunder DDL:n tar blockeras alltså också läsningar av users, alltså varje inloggning och varje autentiserad förfrågan.
-- DEADLOCK: låsen kommer inte stegvis. Steg 1b tar alla fyra (titles, title_leaderboard, user_titles, users) med NOWAIT i en sats och släpper dem om något är upptaget, så
-- migrationen VÄNTAR ALDRIG medan den håller ett lås och kan därför inte ingå i en väntecykel, vad andra transaktioner än gör. (Ett vanligt lock table utan nowait väntar på det
-- första upptagna låset medan det redan håller de tidigare, och två ordningar förekommer samtidigt i systemet: rebuild-funktionen rör titles, title_leaderboard, user_titles, users i
-- den ordningen (radlåset på titles först, 055), medan triggern i v0.8.0 skriver user_titles först och sedan kommer åt titles. Ingen ordning är därför säker med väntan.) Ordningen i
-- lock table är ändå funktionens, titles först, så att även ett oväntat tillfälle att vänta följer den. Förlorar en rebuild eller en titelskrivning mot migrationen får den 55P03/40P01
-- som vilken omräkning som helst: skrivningen eller ombyggnaden misslyckas med kod, och nästa omräkning (varje rundloggning, nattens synk) bygger om listan. Förlorar MIGRATIONEN
-- (20 försök utan att få alla lås) stoppar den utan att något ändrats.
-- KÖR NÄR INGET ANNAT SKRIVER TITLAR (som 055): ingen Strava-synk, cron eller titelomräkning ska pågå. Får migrationen 55P03 eller stopp av steg 1b rullas hela
-- transaktionen tillbaka utan att något ändrats: vänta en stund och KÖR OM filen, ingen annan åtgärd behövs.
--
-- IDEMPOTENS: drop ... if exists, create or replace, drop column if exists. En omkörning efter lyckad körning ändrar inget (förkontrollen hittar inget att stoppa på,
-- snapshoten jämförs mot sig själv). Ingen egen begin/commit (apply_migration kör filen som en transaktion).
--
-- STAGING-SEKVENS (Leads bevisfrågor står i QUERIES nedan; samma frågor körs i prod)
--   1. Före: A1 (8 rader), A2 (0 rader), A3 (0 och 0), A4 (spara alla sex värdena), A5 (spara), A6 (spara).
--   2. Ägar-ja för staging. apply_migration, name: 058_contract_title_ranking. Ett fel betyder att inget ändrats.
--   3. Efter: A1 (0 rader), A4 (IDENTISKA sex värden mot före; avviker de, kontrollera först att ingen omräkning körde mellan före och efter), A5 (identiskt), B1, B2, B3, B4.
--   4. Röken: en rundloggning i stagings låtsasgrupp (eller nattens synk) och därefter A3 (0 och 0) samt C1 (klockan har flyttats). get_advisors (security): inga nya fynd.
--   5. Först därefter prod, med ägarens ja i den aktuella tråden, samma sekvens. Prod 2026-10-19: en grupp, 6 användare, titeln The Hamster har lika rader (positionerna ändras inte av 058).
--
-- BEVIS (läsning, ändrar inget). Samma frågor har körts mot en riktig Postgres (PGlite) av buildern, med en datamängd som efterliknar prod.
-- QUERIES-START
--   -- A1. FÖRE och EFTER: vilka av objekten som finns (förväntat FÖRE: 8 rader = 4 funktioner, 2 triggrar, 2 kolumner; EFTER: 0 rader)
--   select 'function' as typ, p.oid::regprocedure::text as namn from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id')
--   union all select 'trigger', t.tgname || ' on ' || t.tgrelid::regclass::text from pg_trigger t where t.tgrelid = 'public.user_titles'::regclass and not t.tgisinternal
--   union all select 'column', a.attname::text from pg_attribute a where a.attrelid = 'public.titles'::regclass and a.attname in ('current_holder_id', 'current_value') and not a.attisdropped
--   order by 1, 2;
--   -- A2. FÖRE: det som beror på objekten som släpps, utom de kända (förväntat: 0 rader; samma kontroll som förkontrollen i migrationen men läsbar i förväg)
--   select 'beror pa funktion: ' || pg_describe_object(d.classid, d.objid, d.objsubid) as beroende from pg_depend d
--    where d.refclassid = 'pg_proc'::regclass and d.deptype in ('n', 'a')
--      and d.refobjid in (select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id'))
--      and not (d.classid = 'pg_trigger'::regclass and d.objid in (select t.oid from pg_trigger t where t.tgrelid = 'public.user_titles'::regclass and t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')))
--   union all
--   select 'beror pa kolumn: ' || pg_describe_object(d.classid, d.objid, d.objsubid) from pg_depend d join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
--    where d.refclassid = 'pg_class'::regclass and d.refobjid = 'public.titles'::regclass and a.attname in ('current_holder_id', 'current_value') and d.deptype in ('n', 'a')
--      and not (d.classid = 'pg_constraint'::regclass and d.objid in (select c.oid from pg_constraint c where c.conrelid = 'public.titles'::regclass and c.conname = 'titles_current_holder_id_fkey'))
--      and not (d.classid = 'pg_class'::regclass and d.objid = coalesce(to_regclass('public.idx_titles_current_holder_id')::oid, 0))
--      and not (d.classid = 'pg_attrdef'::regclass and d.objid in (select ad.oid from pg_attrdef ad where ad.adrelid = 'public.titles'::regclass and ad.adnum = d.refobjsubid))
--   union all
--   select 'namnger i text: function ' || p.pronamespace::regnamespace::text || '.' || p.proname from pg_proc p where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) and not (p.pronamespace = 'public'::regnamespace and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id')) and p.prosrc ~ '\y(current_holder_id|current_value|update_title_leaderboard|update_all_title_leaderboards|trigger_update_title_leaderboard|user_titles_fill_group_id)\y'
--   union all select 'namnger i text: view ' || v.schemaname || '.' || v.viewname from pg_views v where v.schemaname not in ('pg_catalog', 'information_schema') and v.definition ~ '\y(current_holder_id|current_value|update_title_leaderboard|update_all_title_leaderboards|trigger_update_title_leaderboard|user_titles_fill_group_id)\y'
--   union all select 'namnger i text: materialized view ' || m.schemaname || '.' || m.matviewname from pg_matviews m where m.schemaname not in ('pg_catalog', 'information_schema') and m.definition ~ '\y(current_holder_id|current_value|update_title_leaderboard|update_all_title_leaderboards|trigger_update_title_leaderboard|user_titles_fill_group_id)\y'
--   union all select 'namnger i text: policy ' || pol.schemaname || '.' || pol.tablename || '.' || pol.policyname from pg_policies pol where pol.schemaname not in ('pg_catalog', 'information_schema') and coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ '\y(current_holder_id|current_value|update_title_leaderboard|update_all_title_leaderboards|trigger_update_title_leaderboard|user_titles_fill_group_id)\y'
--   union all select 'namnger i text: trigger ' || t.tgrelid::regclass::text || '.' || t.tgname from pg_trigger t where not t.tgisinternal and not (t.tgrelid = 'public.user_titles'::regclass and t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')) and pg_get_triggerdef(t.oid) ~ '\y(current_holder_id|current_value|update_title_leaderboard|update_all_title_leaderboards|trigger_update_title_leaderboard|user_titles_fill_group_id)\y';
--   -- A3. FÖRE och EFTER (och efter röken): rankingen är exakt vad en ombyggnad ger ur user_titles och aktiva medlemskap (förväntat: 0 och 0). Visar att ingenting
--   -- behövde triggern för att hålla listan rätt, och är beviset att listan inte driver innan triggern släpps. Avviker den FÖRE: stanna och fråga, 058 orsakar det inte men tar bort det som höll listan rätt
--   with expected as (
--     select ut.group_id, ut.title_id, ut.user_id, row_number() over (partition by ut.group_id, ut.title_id order by ut.value desc, ut.earned_at asc, ut.user_id asc) as "position", ut.value, ut.earned_at
--       from public.user_titles ut
--      where ut.value is not null and exists (select 1 from public.group_members m where m.group_id = ut.group_id and m.user_id = ut.user_id and m.left_at is null)
--   ), shown as (select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard)
--   select 'forvantad minus lagrad' as riktning, count(*) as avvikande_rader from (select * from expected where "position" <= 10 except select * from shown) d
--   union all select 'lagrad minus forvantad', count(*) from (select * from shown except select * from expected where "position" <= 10) d;
--   -- A4. FÖRE och EFTER: radantal och fingeravtryck, INKLUSIVE position (förväntat: alla sex värdena IDENTISKA före och efter 058; position ingår, ingenting byter plats)
--   select (select count(*) from public.title_leaderboard) as leaderboard_rader, (select count(*) from public.user_titles) as user_titles_rader, (select count(*) from public.titles) as titles_rader,
--          (select md5(string_agg(concat_ws('|', group_id, title_id, user_id, "position", value, earned_at), ',' order by group_id, title_id, "position")) from public.title_leaderboard) as leaderboard_md5,
--          (select md5(string_agg(concat_ws('|', group_id, title_id, user_id, value, earned_at), ',' order by group_id, title_id, user_id)) from public.user_titles) as user_titles_md5,
--          (select md5(string_agg(concat_ws('|', id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at), ',' order by id)) from public.titles) as titles_md5;
--   -- A5. FÖRE och EFTER: innehavare (position 1) per grupp och titel i klartext (spara FÖRE-utfallet; förväntat EFTER: identiskt)
--   select g.name as grupp, t.name as titel, u.name as innehavare, tl.value from public.title_leaderboard tl join public.groups g on g.id = tl.group_id join public.titles t on t.id = tl.title_id join public.users u on u.id = tl.user_id where tl."position" = 1 order by g.name, t.name;
--   -- A6. FÖRE: de frusna värdena i kolumnerna som släpps (SPARA utfallet; rollbacken kan återställa dem ur det. Värdena skrivs inte längre sedan 055 och ingen läser dem)
--   select id, name, current_holder_id, current_value from public.titles order by name;
--   -- B1. EFTER: funktionerna som finns kvar (förväntat: update_group_title_leaderboard(p_group_id uuid, p_title_id uuid) och update_group_title_leaderboards(p_group_id uuid), prosecdef false, proconfig {search_path=""}, public/anon/authenticated false, service_role true)
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'execute') as public_exec, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec, has_function_privilege('service_role', p.oid, 'execute') as service_role_exec from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('update_group_title_leaderboard', 'update_group_title_leaderboards') order by p.proname;
--   -- B2. EFTER: rebuilden stämplar inte titles längre (förväntat: 0 för båda)
--   select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'update_group_title_leaderboard' and p.prosrc ~* 'update\s+public\.titles') as stamplar_titles, (select count(*) from pg_proc p where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) and p.prosrc ~ 'current_holder_id|current_value') as funktioner_som_nanner_kolumnerna;
--   -- B3. EFTER: user_titles har inga triggrar kvar, kolumnerna på titles är katalogen och vyn är orörd (förväntat: 0 triggrar; kolumnerna id, name, description, unlock_requirement, created_at, updated_at, metric_key, outdoor_only; reloptions {security_invoker=true}, 14 kolumner)
--   select count(*) as triggrar_pa_user_titles from pg_trigger where tgrelid = 'public.user_titles'::regclass and not tgisinternal;
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'titles' order by ordinal_position;
--   select reloptions, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'title_leaderboard_view') as vykolumner from pg_class where oid = 'public.title_leaderboard_view'::regclass;
--   -- B4. EFTER: RLS-ytan oförändrad (förväntat: RLS på för de tre tabellerna, 0 policyer)
--   select relname, relrowsecurity from pg_class where oid in ('public.titles'::regclass, 'public.user_titles'::regclass, 'public.title_leaderboard'::regclass) order by relname;
--   select count(*) as policyer from pg_policies where tablename in ('titles', 'user_titles', 'title_leaderboard');
--   -- C1. RÖKEN (efter en rundloggning eller nattens synk med v0.8.1-koden): klockan har flyttats för hela gruppen, inte bara för titlar som ändrats (förväntat: max(updated_at) per grupp är efter apply-tidpunkten, och A3 ger 0 och 0)
--   select group_id, count(*) as rader, max(updated_at) as klocka from public.title_leaderboard group by group_id order by group_id;
-- QUERIES-END
-- Efter apply: get_advisors (security) i varje miljö. Förväntat: inga nya fynd (inga nya objekt; tre funktioner och en trigger färre). Röken i staging: en runda i
-- grupp A flyttar klockan för A och bygger A:s lista, och ändrar inget i grupp B.
--
-- ROLLBACK (körs manuellt och bara efter ägar-ja, som EN transaktion: ett apply_migration-anrop, eller begin; ... commit; i ett svep; första raden sätter lock_timeout och ett
-- fel rullar tillbaka allt). Rollbacken återställer SCHEMA OCH CONSTRAINTS till 055/056-läget: kolumnerna (med typ, standardvärde, främmande nyckel och index), rebuild-triggern, shim-triggern,
-- de fyra funktionerna med 055:s kroppar och update_group_title_leaderboard med slutstämplingen, och funktionernas grants (bara service_role). Den återställer INTE kolumnordningen
-- (add column hamnar sist i titles; ingen kod väljer med select * eller position, men en psql-visning ser annorlunda ut) och INTE värdena: kolumnerna är NULL/0 tills de fylls ur den
-- sparade A6 (sista raden i blocket). Koden i v0.8.1 fungerar mot det återställda läget (triggern gör då bara dubbelarbete, som före 058). Rollbacken har körts mot en riktig
-- Postgres (PGlite) av buildern, inte i Supabases egen miljö.
-- ROLLBACK-START
--   set local lock_timeout = '5s';
--   alter table public.titles add column if not exists current_holder_id uuid;
--   alter table public.titles add column if not exists current_value numeric(15,4) default 0;
--   alter table public.titles drop constraint if exists titles_current_holder_id_fkey;
--   alter table public.titles add constraint titles_current_holder_id_fkey foreign key (current_holder_id) references public.users(id) on delete set null;
--   create index if not exists idx_titles_current_holder_id on public.titles (current_holder_id);
--   create or replace function public.update_group_title_leaderboard(p_group_id uuid, p_title_id uuid)
--    returns void
--    language plpgsql
--    set search_path to ''
--   as $function$
--   begin
--       if p_group_id is null or p_title_id is null then
--           raise exception 'update_group_title_leaderboard: group_and_title_required' using errcode = '22004';
--       end if;
--       perform 1 from public.titles where id = p_title_id for no key update;
--       if not found then
--           return;
--       end if;
--       perform pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || p_group_id::text || ':' || p_title_id::text, 0));
--       if not exists (select 1 from public.groups where id = p_group_id) then
--           return;
--       end if;
--       delete from public.title_leaderboard where group_id = p_group_id and title_id = p_title_id;
--       insert into public.title_leaderboard (group_id, title_id, user_id, "position", value, earned_at)
--       select
--           p_group_id,
--           p_title_id,
--           ut.user_id,
--           row_number() over (order by ut.value desc, ut.earned_at asc, ut.user_id asc) as "position",
--           ut.value,
--           ut.earned_at
--       from public.user_titles ut
--       where ut.group_id = p_group_id
--         and ut.title_id = p_title_id
--         and ut.value is not null
--         and exists (select 1 from public.group_members m where m.group_id = ut.group_id and m.user_id = ut.user_id and m.left_at is null)
--       order by ut.value desc, ut.earned_at asc, ut.user_id asc
--       limit 10;
--       update public.titles set updated_at = now() where id = p_title_id;
--   end;
--   $function$;
--   create or replace function public.update_title_leaderboard(p_title_id uuid)
--    returns void
--    language plpgsql
--    set search_path to ''
--   as $function$
--   declare
--       v_group_id uuid;
--   begin
--       for v_group_id in select g.id from public.groups g order by g.id loop
--           perform public.update_group_title_leaderboard(v_group_id, p_title_id);
--       end loop;
--   end;
--   $function$;
--   create or replace function public.update_all_title_leaderboards()
--    returns void
--    language plpgsql
--    set search_path to ''
--   as $function$
--   declare
--       v_group_id uuid;
--   begin
--       for v_group_id in select g.id from public.groups g order by g.id loop
--           perform public.update_group_title_leaderboards(v_group_id);
--       end loop;
--   end;
--   $function$;
--   create or replace function public.trigger_update_title_leaderboard()
--    returns trigger
--    language plpgsql
--    set search_path to ''
--   as $function$
--   begin
--       if TG_OP = 'INSERT' or TG_OP = 'UPDATE' then
--           perform public.update_group_title_leaderboard(NEW.group_id, NEW.title_id);
--           if TG_OP = 'UPDATE' and (OLD.group_id is distinct from NEW.group_id or OLD.title_id is distinct from NEW.title_id) then
--               perform public.update_group_title_leaderboard(OLD.group_id, OLD.title_id);
--           end if;
--           return NEW;
--       end if;
--       if TG_OP = 'DELETE' then
--           perform public.update_group_title_leaderboard(OLD.group_id, OLD.title_id);
--           return OLD;
--       end if;
--       return null;
--   end;
--   $function$;
--   create or replace function public.user_titles_fill_group_id()
--    returns trigger
--    language plpgsql
--    set search_path to ''
--   as $function$
--   begin
--       if NEW.group_id is null then
--           select u.group_id into NEW.group_id from public.users u where u.id = NEW.user_id;
--       end if;
--       return NEW;
--   end;
--   $function$;
--   revoke execute on function public.update_title_leaderboard(uuid) from public, anon, authenticated;
--   revoke execute on function public.update_all_title_leaderboards() from public, anon, authenticated;
--   revoke execute on function public.trigger_update_title_leaderboard() from public, anon, authenticated;
--   revoke execute on function public.user_titles_fill_group_id() from public, anon, authenticated;
--   grant execute on function public.update_title_leaderboard(uuid) to service_role;
--   grant execute on function public.update_all_title_leaderboards() to service_role;
--   grant execute on function public.trigger_update_title_leaderboard() to service_role;
--   grant execute on function public.user_titles_fill_group_id() to service_role;
--   drop trigger if exists user_titles_group_id_shim on public.user_titles;
--   create trigger user_titles_group_id_shim before insert on public.user_titles for each row execute function public.user_titles_fill_group_id();
--   drop trigger if exists title_leaderboard_update_trigger on public.user_titles;
--   create trigger title_leaderboard_update_trigger after insert or update or delete on public.user_titles for each row execute function public.trigger_update_title_leaderboard();
--   -- Valfritt, bara om värdena ska tillbaka (ur sparad A6; id är titelns id): update public.titles set current_holder_id = '<a6-current_holder_id>', current_value = <a6-current_value> where id = '<a6-id>';
-- ROLLBACK-END
-- (Efter rollbacken: kontrollera med A1, som ska ge 8 rader, och A3 som ska ge 0 och 0. Koden som bygger om rankingen explicit behöver inte rullas tillbaka.)
-- Statiskt test: titleRankingContractMigration058.test.ts. Retired-names-vakt: retiredTitleObjects.test.ts.

set local lock_timeout = '5s';

-- Alla lås som resten behöver, direkt, på en gång och utan att vänta medan något lås hålls (se LÅS OCH TID i huvudet). Ordningen följer rebuild-funktionens: titles först.
-- NOWAIT: är något av de fyra upptaget misslyckas satsen direkt (55P03) och undertransaktionen släpper de redan tagna, så ingen väntecykel kan uppstå. Högst 20 försök.
do $lock$
declare
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    begin
      lock table public.titles, public.title_leaderboard, public.user_titles, public.users in access exclusive mode nowait;
      exit;
    exception when lock_not_available then
      if v_attempt >= 20 then
        raise exception 'migration 058 stopped: could not lock titles, title_leaderboard, user_titles and users after % attempts (a title recalculation, a sync or a request is running). Nothing was changed; run it again when nothing writes titles.', v_attempt;
      end if;
      perform pg_sleep(0.25);
    end;
  end loop;
end;
$lock$;

-- Förkontroll: ändrar och raderar ingenting. Ett stopp rullar tillbaka hela migrationen.
do $preflight$
declare
  v_blockers text;
  v_names    constant text := '\y(current_holder_id|current_value|update_title_leaderboard|update_all_title_leaderboards|trigger_update_title_leaderboard|user_titles_fill_group_id)\y';
begin
  if to_regprocedure('public.update_group_title_leaderboard(uuid, uuid)') is null or to_regprocedure('public.update_group_title_leaderboards(uuid)') is null then
    raise exception 'migration 058 stopped: update_group_title_leaderboard(uuid, uuid) or update_group_title_leaderboards(uuid) is missing. Apply 055 first (ADR 012 decision 3). Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_titles' and column_name = 'group_id') then
    raise exception 'migration 058 stopped: user_titles.group_id is missing. Apply 055 first (ADR 012 decision 3). Nothing was changed.';
  end if;

  -- (b) Beroenden av funktionerna som släpps, utom de två kända triggrarna.
  select string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', ') into v_blockers
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass
     and d.deptype in ('n', 'a')
     and d.refobjid in (select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id'))
     and not (d.classid = 'pg_trigger'::regclass and d.objid in (select t.oid from pg_trigger t where t.tgrelid = 'public.user_titles'::regclass and t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')));
  if v_blockers is not null then
    raise exception 'migration 058 stopped: % depends on a function this migration drops. Nothing was changed; ask the owner before continuing.', v_blockers;
  end if;

  -- (c) Beroenden av kolumnerna som släpps, utom den kända främmande nyckeln, indexet och kolumnens eget standardvärde.
  select string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', ') into v_blockers
    from pg_depend d
    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where d.refclassid = 'pg_class'::regclass
     and d.refobjid = 'public.titles'::regclass
     and a.attname in ('current_holder_id', 'current_value')
     and d.deptype in ('n', 'a')
     and not (d.classid = 'pg_constraint'::regclass and d.objid in (select c.oid from pg_constraint c where c.conrelid = 'public.titles'::regclass and c.conname = 'titles_current_holder_id_fkey'))
     and not (d.classid = 'pg_class'::regclass and d.objid = coalesce(to_regclass('public.idx_titles_current_holder_id')::oid, 0))
     and not (d.classid = 'pg_attrdef'::regclass and d.objid in (select ad.oid from pg_attrdef ad where ad.adrelid = 'public.titles'::regclass and ad.adnum = d.refobjsubid));
  if v_blockers is not null then
    raise exception 'migration 058 stopped: % depends on titles.current_holder_id or titles.current_value. Nothing was changed; ask the owner before continuing.', v_blockers;
  end if;

  -- (d) Text som nämner funktionerna eller kolumnerna (plpgsql-kroppar syns inte i pg_depend), i alla scheman utom pg_catalog och information_schema (Supabase har egna scheman som
  -- extensions, auth och storage). Undantaget för de fyra funktionerna som släpps gäller bara schemat public; de två kända triggrarna räknas inte.
  select string_agg(r.reader, ', ' order by r.reader) into v_blockers from (
    select 'function ' || p.pronamespace::regnamespace::text || '.' || p.proname as reader from pg_proc p
     where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
       and not (p.pronamespace = 'public'::regnamespace and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id'))
       and p.prosrc ~ v_names
    union all
    select 'view ' || v.schemaname || '.' || v.viewname from pg_views v where v.schemaname not in ('pg_catalog', 'information_schema') and v.definition ~ v_names
    union all
    select 'materialized view ' || m.schemaname || '.' || m.matviewname from pg_matviews m where m.schemaname not in ('pg_catalog', 'information_schema') and m.definition ~ v_names
    union all
    select 'policy ' || pol.schemaname || '.' || pol.tablename || '.' || pol.policyname from pg_policies pol where pol.schemaname not in ('pg_catalog', 'information_schema') and coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ v_names
    union all
    select 'trigger ' || t.tgrelid::regclass::text || '.' || t.tgname from pg_trigger t
     where not t.tgisinternal and not (t.tgrelid = 'public.user_titles'::regclass and t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim')) and pg_get_triggerdef(t.oid) ~ v_names
  ) r;
  if v_blockers is not null then
    raise exception 'migration 058 stopped: % names a function or a column this migration drops. Nothing was changed; ask the owner before continuing.', v_blockers;
  end if;

  -- (e) Ett cron-jobb (schemat finns inte i staging och inte i prod sedan 052, men kontrollen kostar ingenting).
  if to_regclass('cron.job') is not null then
    execute 'select string_agg(jobid::text, '', '') from cron.job where command ~ $1' into v_blockers using v_names;
    if v_blockers is not null then
      raise exception 'migration 058 stopped: cron job(s) % name a function or a column this migration drops. Nothing was changed; ask the owner before continuing.', v_blockers;
    end if;
  end if;
end;
$preflight$;

-- Före-snapshot för beviset i $postcheck$. Temporära tabeller, inte "on commit drop" (apply utan omslutande transaktion skulle släppa dem direkt).
do $snapshot$
begin
  drop table if exists pg_temp.mig058_before_tl;
  drop table if exists pg_temp.mig058_before_ut;
  drop table if exists pg_temp.mig058_before_t;
  create temp table mig058_before_tl as select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard;
  create temp table mig058_before_ut as select user_id, group_id, title_id, value, earned_at from public.user_titles;
  create temp table mig058_before_t as select id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at from public.titles;
end;
$snapshot$;

-- Väg 1 och shimmen: triggrarna först, sedan funktionerna de kör. Utan cascade: ett missat beroende avbryter migrationen i stället för att tas bort tyst.
drop trigger if exists user_titles_group_id_shim on public.user_titles;
drop trigger if exists title_leaderboard_update_trigger on public.user_titles;

drop function if exists public.trigger_update_title_leaderboard();
drop function if exists public.user_titles_fill_group_id();
drop function if exists public.update_title_leaderboard(uuid);
drop function if exists public.update_all_title_leaderboards();

-- Ombyggnaden av EN (grupp, titel): oförändrad mot 055 utom att den inte längre stämplar titles.updated_at. Titles-radlåset (FOR NO KEY UPDATE) ligger kvar först i
-- låsordningen: det serialiserar ombyggnader av samma titel och hindrar att titeln raderas mitt i ombyggnaden. Grants behålls av create or replace.
create or replace function public.update_group_title_leaderboard(p_group_id uuid, p_title_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
begin
    if p_group_id is null or p_title_id is null then
        raise exception 'update_group_title_leaderboard: group_and_title_required' using errcode = '22004';
    end if;

    -- Låsordning: titles-radens lås (FOR NO KEY UPDATE) FÖRE advisory-låset. Inte FOR UPDATE: det krockar med key share som varje insert i user_titles och
    -- title_leaderboard tar på titles-raden. Finns ingen rad är titeln borta (kaskad): inget att bygga.
    perform 1 from public.titles where id = p_title_id for no key update;
    if not found then
        return;
    end if;

    -- Advisory-låset före all läsning och skrivning av listan: allt nedan körs först när ingen annan ombyggnad av samma (grupp, titel) pågår.
    perform pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || p_group_id::text || ':' || p_title_id::text, 0));

    -- En grupp som raderas kaskadar sina rader: inget att bygga åt en grupp som inte finns.
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
end;
$function$;

-- Kolumnerna som ingen läser. Nyckeln titles_current_holder_id_fkey och indexet idx_titles_current_holder_id följer med. Utan cascade.
alter table public.titles drop column if exists current_holder_id;
alter table public.titles drop column if exists current_value;

-- Slutkontroll i samma transaktion: ett fel rullar tillbaka hela migrationen.
do $postcheck$
declare
  v_found     text;
  v_fn        regprocedure;
  v_diff_tl   integer;
  v_diff_ut   integer;
  v_diff_t    integer;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_found from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard', 'user_titles_fill_group_id');
  if v_found is not null then
    raise exception 'migration 058 failed: % still exists. Nothing was changed.', v_found;
  end if;

  select string_agg(t.tgname, ', ') into v_found from pg_trigger t
   where t.tgrelid = 'public.user_titles'::regclass and t.tgname in ('title_leaderboard_update_trigger', 'user_titles_group_id_shim');
  if v_found is not null then
    raise exception 'migration 058 failed: trigger(s) % still exist on user_titles. Nothing was changed.', v_found;
  end if;

  select string_agg(a.attname, ', ') into v_found from pg_attribute a
   where a.attrelid = 'public.titles'::regclass and a.attname in ('current_holder_id', 'current_value') and not a.attisdropped;
  if v_found is not null then
    raise exception 'migration 058 failed: titles.% still exists. Nothing was changed.', v_found;
  end if;

  -- Funktionerna som finns kvar: INVOKER, fast search_path, bara service_role kan köra dem, och ombyggnaden stämplar inte titles.
  foreach v_fn in array array[
    'public.update_group_title_leaderboard(uuid, uuid)'::regprocedure,
    'public.update_group_title_leaderboards(uuid)'::regprocedure
  ] loop
    if exists (select 1 from pg_proc p where p.oid = v_fn and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
      raise exception 'migration 058 failed: % is not SECURITY INVOKER with a fixed search_path. Nothing was changed.', v_fn;
    end if;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'migration 058 failed: % must be executable by service_role only. Nothing was changed.', v_fn;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.oid = 'public.update_group_title_leaderboard(uuid, uuid)'::regprocedure and p.prosrc ~* 'update\s+public\.titles') then
    raise exception 'migration 058 failed: update_group_title_leaderboard still stamps public.titles. Nothing was changed.';
  end if;

  -- Ingenting får ha ändrats i data: samma rader, samma värden och SAMMA POSITIONER före och efter (EXCEPT i båda riktningarna).
  select count(*) into v_diff_tl from (
    (select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard except select group_id, title_id, user_id, "position", value, earned_at from pg_temp.mig058_before_tl)
    union all
    (select group_id, title_id, user_id, "position", value, earned_at from pg_temp.mig058_before_tl except select group_id, title_id, user_id, "position", value, earned_at from public.title_leaderboard)
  ) d;
  select count(*) into v_diff_ut from (
    (select user_id, group_id, title_id, value, earned_at from public.user_titles except select user_id, group_id, title_id, value, earned_at from pg_temp.mig058_before_ut)
    union all
    (select user_id, group_id, title_id, value, earned_at from pg_temp.mig058_before_ut except select user_id, group_id, title_id, value, earned_at from public.user_titles)
  ) d;
  select count(*) into v_diff_t from (
    (select id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at from public.titles except select id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at from pg_temp.mig058_before_t)
    union all
    (select id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at from pg_temp.mig058_before_t except select id, name, description, unlock_requirement, metric_key, outdoor_only, created_at, updated_at from public.titles)
  ) d;
  if v_diff_tl > 0 or v_diff_ut > 0 or v_diff_t > 0 then
    raise exception 'migration 058 failed: title holders, values or positions changed (% rows differ in title_leaderboard, % in user_titles, % in titles). The migration only drops objects and must change no data. Nothing was changed; ask the owner before continuing.', v_diff_tl, v_diff_ut, v_diff_t;
  end if;

  drop table pg_temp.mig058_before_tl, pg_temp.mig058_before_ut, pg_temp.mig058_before_t;
end;
$postcheck$;
