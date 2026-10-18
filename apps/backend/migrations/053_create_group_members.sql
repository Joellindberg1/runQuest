-- 053: group_members — medlemskap med roll och fönster, join_group, create_group_with_admin och backfill. ADR 012 beslut 2 och 3 (RUN-294, S1, v0.8.0).
-- Datum: 2026-10-18. EJ APPLICERAD. Kräver ägar-ja per miljö: först staging (supabase-staging, projekt aormctqrmguvncxrigwy), sedan prod
-- (yrrqaxdngayakcivfrck). Körs av Lead via Supabase MCP apply_migration, name: 053_create_group_members, aldrig av en builder.
-- Lead uppdaterar den här raden till APPLICERAD med datum och miljö.
--
-- BAKGRUND
-- Idag är medlemskap bara users.group_id (en grupp per användare) och admin är den globala flaggan users.is_admin. Ägarbeslut F3 och F6
-- (2026-10-16) gör tid och roll till egenskaper hos medlemskapet: man går på sikt med i en annan grupp och startar från noll där, och
-- gruppadmin är den som SKAPAT gruppen, som en roll per medlemskap. group_members är därefter sanningen om medlemskap, roll och fönster.
-- users.group_id behålls som en läsoptimerad PEKARE till det aktiva medlemskapets grupp (ett tiotal läsvägar, JWT och det fail-closed
-- gruppfiltret ADR 007 A6 bygger på den) och skrivs bara av de två funktionerna nedan (ADR 012 beslut 2.2, alternativ D och K).
-- Den här filen är bara datamodellen och backfillen. Applikationskoden (medlemskapslagret, POST /groups/join, GET /groups/my, S5) kommer i
-- senare leveranser; ingen kod behöver ändras för att den här migrationen ska vara beteendeneutral (se KÖRORDNING).
--
-- TABELLEN group_members
--   id         uuid, primärnyckel (gen_random_uuid()).
--   group_id   gruppen; on delete cascade (en raderad grupp tar sina medlemskap med sig).
--   user_id    användaren; on delete cascade (en raderad användare tar sina medlemskap med sig).
--   role       'admin' | 'member' (CHECK, default 'member'). 'vice_admin' m.fl. läggs till senare genom att CHECK-listan utökas.
--   starts_on  Stockholm-dag från vilken rundor räknas; null = hela historiken. Första medlemskapet får null, varje senare medlemskap
--              börjar vid joindagen (p_today) (ADR 012 beslut 2.3, N1). Backfillen sätter alltid null.
--   joined_at  när raden skapades (default now()).
--   left_at    null = aktivt medlemskap. "Lämna grupp" byggs inte här (RUN-95), men kolumnen och indexen förutsätter den.
--
-- INDEX
--   group_members_one_active_per_user  unikt (user_id) där left_at is null: v0.8.0 tillåter ETT aktivt medlemskap per användare.
--                                      RUN-95 (flera grupper) släpper just det här indexet.
--   group_members_one_admin_per_group  unikt (group_id) där left_at is null och role = 'admin': EN admin per grupp. Överlåtelse
--                                      senare = byt roll i en transaktion.
--   group_members_group_active         (group_id) där left_at is null: gruppens aktiva medlemmar.
--   Ingen separat user_id-index utöver det partiella: tabellen har en rad per användare (6 i prod), så cascade-uppslaget är försumbart.
--
-- FUNKTIONERNA (båda: plpgsql, set search_path to '', säkerhetsläge INVOKER, bara service_role får köra dem)
--   join_group(p_user_id uuid, p_group_id uuid, p_role text, p_today date) returns public.group_members
--     Låser användarraden (for update; serialiserar samtidiga join-anrop för samma användare), kräver att användaren inte har ett
--     aktivt medlemskap, infogar raden och sätter users.group_id i samma transaktion. starts_on = null om användaren aldrig haft ett
--     medlemskap, annars p_today. p_today är Stockholm-dagen, beräknad i appen med calendar.ts, aldrig i databasen. Returnerar raden.
--   create_group_with_admin(p_name text, p_invite_code text, p_owner_id uuid, p_today date) returns public.groups
--     Skapar gruppen med owner_id = p_owner_id och ger skaparen rollen admin via join_group (som sätter pekaren). Allt eller inget:
--     ett fel i join_group (t.ex. skaparen är redan medlem) rullar tillbaka gruppen.
--   Fel (stabila SQLSTATE och meddelanden som medlemskapslagret mappar till HTTP; meddelandena innehåller inga personuppgifter):
--     23505  join_group: already_member            användaren har redan ett aktivt medlemskap (API: 409)
--     23505  join_group: group_has_admin           p_role = 'admin' men gruppen har redan en aktiv admin (API: 409)
--     23505  (groups_invite_code_key)              inbjudningskoden används redan (create_group_with_admin)
--     P0002  join_group: user_not_found | group_not_found | create_group_with_admin: owner_not_found   (API: 404)
--     22023  join_group: invalid_role | create_group_with_admin: name_required | invite_code_required   (ogiltig indata)
--     22004  join_group: today_required (senare medlemskap utan p_today) | create_group_with_admin: owner_required
--   Säkerhetsläge INVOKER är medvetet (som claim_strava_webhook_events, 046): service_role kringgår RLS ändå, så en definer-funktion
--   skulle bara kunna HÖJA rättigheterna om en grant någonsin gled. Execute dras in från public, anon och authenticated och ges bara
--   till service_role (ADR 012; docs/permissions.md).
--
-- FÖRKONTROLL (do-blocket $preflight$, körs efter att tabellen skapats men före backfillen; ett fel rullar tillbaka HELA migrationen,
-- inklusive tabellen, eftersom apply_migration kör filen som en transaktion). Den ändrar och raderar ingenting. Den stoppar vid:
--   1. fler än en grupp med medlemmar (ADR 012 beslut 3: prod och staging har exakt en),
--   2. användare utan grupp (F2: man kan inte spela utan grupp; felet listar de 10 första id:na),
--   3. en grupp utan entydig admin: ägaren (groups.owner_id) räknas om den är medlem i gruppen, annars måste gruppen ha exakt EN
--      users.is_admin-användare (ADR 012 beslut 2.5, N5). Ägaren går före en annan is_admin-användare.
-- Stoppen 1 och 2 gäller bara första körningen (group_members är tom). En omkörning (se nedan) prövar bara admin för grupper som saknar en
-- aktiv admin, så ett senare tillkommet supportkonto utan grupp (RUN-267) eller en andra grupp inte fäller en omkörning.
-- Ett stopp betyder: fråga ägaren. Ändra inte data bara för att få migrationen att gå igenom.
--
-- BACKFILL
-- En aktiv rad per användare med users.group_id som saknar aktivt medlemskap, starts_on null (hela historiken, som idag). Rollen admin får
-- gruppens ägare (groups.owner_id, om den är medlem), annars gruppens enda is_admin-användare; övriga får member. Grupper som redan har en
-- aktiv admin får bara medlemmar. Wolfpacks skapare blir admin (N5, verifierat i prod 2026-10-17: owner_id är satt och är samma användare
-- som gruppens enda is_admin; 6 medlemmar, 0 grupplösa). Slutkontrollen ($postcheck$) bevisar i samma transaktion att varje användare med
-- grupp har ett aktivt medlemskap i SAMMA grupp och att varje grupp med medlemmar har en aktiv admin.
--
-- Lås: create table tar SHARE ROW EXCLUSIVE på groups och users i resten av transaktionen (främmande nycklarna), vilket blockerar
-- skrivningar (inte läsningar) mot de två tabellerna i millisekunder. Första satsen, set local lock_timeout = '5s', gör att migrationen
-- misslyckas i stället för att köa skrivtrafiken bakom en lång transaktion. Misslyckas den med lock_timeout: kör om. Backfillen läser
-- users och skriver bara i den nya tabellen; users och groups ändras inte av migrationen (pekaren skrivs först av join_group).
--
-- KÖRORDNING: additiv, applicera FÖRE backend-deployen i v0.8.0 (ADR 012 beslut 3: 053 -> titelscope-migrationen -> group_settings).
-- Gammal kod (v0.7.x) känner inte till tabellen och märker ingenting. Under fönstret mellan migration och deploy skriver äldre
-- POST /groups/join och POST /auth/users bara users.group_id utan medlemskap; backfillen är idempotent och körs om (hela filen) vid
-- avvikelse, eller så kör release-röken konsistenskontrollen nedan och Lead backfyller manuellt.
--
-- Idempotent: create table/index if not exists, create or replace function, alter table ... enable row level security och revoke ger
-- samma slutläge; backfillen hoppar över användare som redan har ett aktivt medlemskap. Ingen egen begin/commit.
--
-- Bevis efter apply (läsning, ändrar inget; Lead kör i staging och i prod):
--   -- 1. Antal aktiva medlemskap = antal användare med grupp, 0 avvikelser mot pekaren (förväntat prod: 6, 0; staging: 4, 0 med 'Staging Pack')
--   select (select count(*) from public.group_members where left_at is null) as aktiva_medlemskap,
--          (select count(*) from public.users where group_id is not null)   as anvandare_med_grupp,
--          (select count(*) from public.users u where u.group_id is distinct from
--             (select m.group_id from public.group_members m where m.user_id = u.id and m.left_at is null)) as avvikelser_mot_pekaren;
--   -- 2. Exakt en admin per grupp, och det är gruppens skapare (förväntat: en rad per grupp, admin_ar_agaren = true)
--   select m.group_id, count(*) filter (where m.role = 'admin') as admins,
--          bool_and(m.user_id = g.owner_id) filter (where m.role = 'admin') as admin_ar_agaren
--     from public.group_members m join public.groups g on g.id = m.group_id where m.left_at is null group by m.group_id;
--   -- 3. Alla starts_on är null (förväntat: 0)
--   select count(*) from public.group_members where starts_on is not null;
--   -- 4. Index (förväntat: tre namn plus group_members_pkey)
--   select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'group_members' order by indexname;
--   -- 5. RLS på, 0 policyer, ingen klientåtkomst (förväntat: true / 0 / false, false)
--   select relrowsecurity from pg_class where oid = 'public.group_members'::regclass;
--   select count(*) from pg_policies where tablename = 'group_members';
--   select has_table_privilege('anon', 'public.group_members', 'select'),
--          has_table_privilege('authenticated', 'public.group_members', 'select');
--   -- 6. Funktionerna: invoker, tom search_path, execute bara för service_role (förväntat: prosecdef false, proconfig {search_path=""}, false/false/false/true)
--   select p.proname, p.prosecdef, p.proconfig,
--          has_function_privilege('public',        p.oid, 'execute') as public_exec,
--          has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
--          has_function_privilege('service_role',  p.oid, 'execute') as service_role_exec
--     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('join_group', 'create_group_with_admin') order by p.proname;
--   -- 7. Främmande nycklar (förväntat: två rader, båda confdeltype 'c' = cascade)
--   select conname, confdeltype from pg_constraint where conrelid = 'public.group_members'::regclass and contype = 'f' order by conname;
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; raderar ALLA medlemskap och roller, och backfillen måste då göras om vid
-- nästa applicering. users.group_id rörs inte och fortsätter peka rätt. Migrationer som bygger på group_members (titelscope,
-- group_settings) måste rullas tillbaka först). Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   drop function if exists public.create_group_with_admin(text, text, uuid, date);
--   drop function if exists public.join_group(uuid, uuid, text, date);
--   drop table if exists public.group_members;
-- Statiskt test: groupMembersMigration053.test.ts.

set local lock_timeout = '5s';

create table if not exists public.group_members (
  id        uuid        primary key default gen_random_uuid(),
  group_id  uuid        not null references public.groups(id) on delete cascade,
  user_id   uuid        not null references public.users(id) on delete cascade,
  role      text        not null default 'member' check (role in ('admin','member')),
  starts_on date,
  joined_at timestamptz not null default now(),
  left_at   timestamptz
);

create unique index if not exists group_members_one_active_per_user on public.group_members (user_id) where left_at is null;
create unique index if not exists group_members_one_admin_per_group on public.group_members (group_id) where left_at is null and role = 'admin';
create index if not exists group_members_group_active on public.group_members (group_id) where left_at is null;

alter table public.group_members enable row level security;

revoke all on public.group_members from anon, authenticated;

-- Förkontroll: stoppar migrationen (och rullar tillbaka tabellen ovan) vid flera grupper, grupplösa användare eller oklar admin.
do $preflight$
declare
  v_first_run     boolean;
  v_groups        integer;
  v_ungrouped     integer;
  v_ungrouped_ids text;
  r               record;
begin
  v_first_run := not exists (select 1 from public.group_members);

  if v_first_run then
    select count(distinct group_id) into v_groups from public.users where group_id is not null;
    if v_groups > 1 then
      raise exception 'migration 053 stopped: % groups have members, expected exactly 1 (ADR 012 decision 3). Nothing was changed; ask the owner before continuing.', v_groups;
    end if;

    select count(*) into v_ungrouped from public.users where group_id is null;
    if v_ungrouped > 0 then
      select string_agg(x.id::text, ', ' order by x.id) into v_ungrouped_ids
        from (select id from public.users where group_id is null order by id limit 10) x;
      raise exception 'migration 053 stopped: % users have no group (first ids: %). Everyone must belong to a group (ADR 012, F2). Nothing was changed; ask the owner before continuing.', v_ungrouped, v_ungrouped_ids;
    end if;
  end if;

  for r in
    select g.id as group_id,
           g.owner_id,
           exists (select 1 from public.users o where o.id = g.owner_id and o.group_id = g.id) as owner_is_member,
           (select count(*) from public.users a where a.group_id = g.id and coalesce(a.is_admin, false)) as admin_flags
      from public.groups g
     where exists (select 1 from public.users u where u.group_id = g.id)
       and not exists (select 1 from public.group_members m where m.group_id = g.id and m.role = 'admin' and m.left_at is null)
  loop
    if not r.owner_is_member and r.admin_flags <> 1 then
      raise exception 'migration 053 stopped: group % has no unambiguous admin (owner_id is %, the group has % is_admin users). The owner must be a member, or exactly one member must have is_admin (ADR 012 decision 2.5). Nothing was changed; ask the owner before continuing.',
        r.group_id, coalesce(r.owner_id::text, 'null'), r.admin_flags;
    end if;
  end loop;
end;
$preflight$;

create or replace function public.join_group(p_user_id uuid, p_group_id uuid, p_role text, p_today date)
 returns public.group_members
 language plpgsql
 set search_path to ''
as $function$
declare
  v_had_membership boolean;
  v_row            public.group_members;
begin
  if p_user_id is null or p_group_id is null then
    raise exception 'join_group: user_and_group_required' using errcode = '22004';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'join_group: invalid_role' using errcode = '22023';
  end if;

  -- Raden låses så att två samtidiga join-anrop för samma användare köas i stället för att båda passera kontrollen nedan.
  perform 1 from public.users where id = p_user_id for update;
  if not found then
    raise exception 'join_group: user_not_found' using errcode = 'P0002';
  end if;

  perform 1 from public.groups where id = p_group_id for key share;
  if not found then
    raise exception 'join_group: group_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.group_members where user_id = p_user_id and left_at is null) then
    raise exception 'join_group: already_member' using errcode = '23505';
  end if;

  if p_role = 'admin' and exists (select 1 from public.group_members where group_id = p_group_id and role = 'admin' and left_at is null) then
    raise exception 'join_group: group_has_admin' using errcode = '23505';
  end if;

  -- Första medlemskapet räknar hela historiken (starts_on null); varje senare börjar vid joindagen, som appen räknat ut (Stockholm-dag).
  v_had_membership := exists (select 1 from public.group_members where user_id = p_user_id);
  if v_had_membership and p_today is null then
    raise exception 'join_group: today_required' using errcode = '22004';
  end if;

  insert into public.group_members (group_id, user_id, role, starts_on)
  values (p_group_id, p_user_id, p_role, case when v_had_membership then p_today else null end)
  returning * into v_row;

  update public.users set group_id = p_group_id where id = p_user_id;

  return v_row;
end;
$function$;

create or replace function public.create_group_with_admin(p_name text, p_invite_code text, p_owner_id uuid, p_today date)
 returns public.groups
 language plpgsql
 set search_path to ''
as $function$
declare
  v_group public.groups;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'create_group_with_admin: name_required' using errcode = '22023';
  end if;
  if p_invite_code is null or btrim(p_invite_code) = '' then
    raise exception 'create_group_with_admin: invite_code_required' using errcode = '22023';
  end if;
  if p_owner_id is null then
    raise exception 'create_group_with_admin: owner_required' using errcode = '22004';
  end if;

  perform 1 from public.users where id = p_owner_id for update;
  if not found then
    raise exception 'create_group_with_admin: owner_not_found' using errcode = 'P0002';
  end if;

  insert into public.groups (name, invite_code, owner_id) values (p_name, p_invite_code, p_owner_id) returning * into v_group;

  -- Ger skaparen rollen admin och sätter pekaren users.group_id. Ett fel här (t.ex. already_member) rullar tillbaka gruppen ovan.
  perform public.join_group(p_owner_id, v_group.id, 'admin', p_today);

  return v_group;
end;
$function$;

revoke execute on function public.join_group(uuid, uuid, text, date) from public, anon, authenticated;
revoke execute on function public.create_group_with_admin(text, text, uuid, date) from public, anon, authenticated;
grant execute on function public.join_group(uuid, uuid, text, date) to service_role;
grant execute on function public.create_group_with_admin(text, text, uuid, date) to service_role;

-- Backfill: en aktiv rad per användare med grupp som saknar aktivt medlemskap, starts_on null (hela historiken).
-- admin_pick har en rad per grupp som saknar aktiv admin: ägaren om den är medlem i gruppen, annars den enda is_admin-användaren
-- (förkontrollen har bevisat att exakt en finns). Grupper som redan har en admin får ingen rad här, så en omkörning lägger bara till medlemmar.
insert into public.group_members (group_id, user_id, role, starts_on)
with admin_pick as (
  select g.id as group_id,
         coalesce(
           (select o.id from public.users o where o.id = g.owner_id and o.group_id = g.id),
           (select (array_agg(a.id order by a.id))[1] from public.users a where a.group_id = g.id and coalesce(a.is_admin, false))
         ) as admin_id
    from public.groups g
   where not exists (select 1 from public.group_members m where m.group_id = g.id and m.role = 'admin' and m.left_at is null)
)
select u.group_id,
       u.id,
       case when ap.admin_id = u.id then 'admin' else 'member' end,
       null::date
  from public.users u
  left join admin_pick ap on ap.group_id = u.group_id
 where u.group_id is not null
   and not exists (select 1 from public.group_members m where m.user_id = u.id and m.left_at is null);

-- Slutkontroll i samma transaktion: ett fel rullar tillbaka hela migrationen.
do $postcheck$
declare
  v_missing  integer;
  v_no_admin integer;
begin
  select count(*) into v_missing
    from public.users u
   where u.group_id is not null
     and not exists (
       select 1 from public.group_members m
        where m.user_id = u.id and m.group_id = u.group_id and m.left_at is null
     );
  if v_missing > 0 then
    raise exception 'migration 053 failed: % users have no active membership in their group after the backfill. Nothing was changed.', v_missing;
  end if;

  select count(*) into v_no_admin
    from public.groups g
   where exists (select 1 from public.group_members m where m.group_id = g.id and m.left_at is null)
     and not exists (select 1 from public.group_members m where m.group_id = g.id and m.role = 'admin' and m.left_at is null);
  if v_no_admin > 0 then
    raise exception 'migration 053 failed: % groups with members have no active admin after the backfill. Nothing was changed.', v_no_admin;
  end if;
end;
$postcheck$;
