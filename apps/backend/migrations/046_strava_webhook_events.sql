-- 046: strava_webhook_events och claim_strava_webhook_events — "Migration B" i ADR 010 (RUN-166, v0.7.0).
-- Datum: 2026-10-14. APPLICERAD i prod 2026-10-15 (ägar-ja i chatten; Lead via Supabase MCP apply_migration,
-- name: 046_strava_webhook_events, och uppdaterar den här raden till APPLICERAD med datum).
--
-- Bakgrund: webhook-rutten ska svara inom 2 s och får inte tappa händelser. Händelsen lagras först och bearbetas efteråt,
-- idempotent och med omförsök. Tabellen är kön, journalen och beviset för 48 h-larmet (ADR 010 beslut 5 och 6).
-- Dataminimering: titel, koordinater och tokens lagras aldrig. updates får bara bära nycklarna private, type och authorized
-- (CHECK-satsen nedan håller det i databasen, inte bara i koden).
--
-- Tabellen:
--   dedupe_key       unik idempotensnyckel, byggs av buildWebhookDedupeKey (event_time = Stravas epoch-sekunder). Insättning med
--                    on conflict (dedupe_key) do nothing: en omleverans ger ingen andra rad.
--   status           pending -> processing (claimad) -> done | dead. Listan är WEBHOOK_STATUSES i
--                    apps/backend/src/services/stravaWebhook/constants.ts (statiskt test håller dem lika).
--   outcome          hur en bearbetad händelse slutade. Ingen CHECK: enumen är WEBHOOK_OUTCOMES i kod, så ett nytt utfall kräver
--                    ingen migration.
--   attempts         misslyckade försök (en utgången lease räknas som ett, väntan på rate limit gör det inte).
--   user_id          ur mappningen vid mottagandet; null om användaren senare raderats (on delete set null).
--   last_error       kort felkod, aldrig token eller brödtext.
-- Index: (status, next_attempt_at) partiellt på pending/processing för claim och svep, och (owner_id, status) för
-- ägarurvalet och "har ägaren en processing-rad".
--
-- Åtkomst: RLS på, inga policyer, revoke all från anon och authenticated. Tabellen läses och skrivs uteslutande av backend med
-- service role. Funktionen är en funktion i public och därmed anropbar via PostgREST om inget annat sägs, så execute dras in
-- från public, anon och authenticated och ges bara till service_role.
--
-- claim_strava_webhook_events(p_lease_seconds, p_max): kontraktet är ADR 010 beslut 6, steg 1-3, atomärt i en transaktion:
--   1. tar pg_advisory_xact_lock(hashtextextended('strava_webhook_events:claim', 0)) som första sats. Två samtidiga claim-anrop
--      köar då i stället för att välja samma rader (mönstret från migration 042, här för en kort kritisk sektion). Låset släpps
--      vid transaktionens slut. READ COMMITTED ger varje sats i funktionen en ny ögonblicksbild, så den som väntat på låset ser
--      den förres committade rader.
--   2. släpper rader med status = 'processing' vars lease gått ut (eller saknar lease) tillbaka till 'pending' med attempts + 1.
--      next_attempt_at rörs inte: raden var förfallen när den claimades och är det fortfarande.
--   3. väljer ägaren (owner_id) vars äldsta förfallna pending-rad (next_attempt_at <= now(), ordning event_time, id) är äldst av
--      alla, bland ägare som inte har någon processing-rad. Efter steg 2 har varje kvarvarande processing-rad en levande lease,
--      så "ingen processing-rad" är samma sak som "ingen levande lease". Claimar sedan upp till p_max förfallna rader för just den
--      ägaren: status = 'processing', claimed_at = now(), lease_expires_at = now() + p_lease_seconds. Svaret kommer i
--      ordningen event_time, id.
-- Inga förfallna händelser eller bara upptagna ägare ger noll rader. p_lease_seconds och p_max måste vara positiva; null eller 0
-- avvisas, eftersom LIMIT NULL är "ingen gräns" och skulle claima allt.
-- now() är transaktionens starttid. Väntar anropet på låset blir lease_expires_at därför några millisekunder kortare än
-- p_lease_seconds; det är ofarligt (LEASE_SECONDS är 300).
-- FOR UPDATE SKIP LOCKED på urvalet är ett skydd för det oväntade (en annan skrivare som håller en pending-rad); under låset
-- är den vanligtvis overksam. En överhoppad rad tas av nästa svep.
--
-- Vad SQL:en inte kan visas köra utan databas (statiskt test: stravaWebhookMigration046.test.ts läser texten) och som ett
-- integrationstest mot testmiljön (RUN-13, v0.8.0) ska bevisa:
--   a. två samtidiga claim-anrop ger disjunkta rader, och aldrig rader för två ägare i samma anrop;
--   b. en ägare med en levande processing-rad får inga nya claims, men en annan ägares förfallna rader claimas;
--   c. en utgången lease ger pending med attempts + 1 och claimas om i samma anrop;
--   d. rader med next_attempt_at i framtiden claimas inte; äldsta event_time vinner mellan ägare, id bryter lika;
--   e. p_max begränsar antalet; noll eller null i p_max/p_lease_seconds ger fel 22023 och inga ändringar;
--   f. anon och authenticated får permission denied vid anrop och vid select/insert på tabellen; service_role lyckas;
--   g. insert med en updates-nyckel utanför de tre ger check_violation; samma dedupe_key två gånger ger 23505.
--
-- KÖRORDNING: applicera FÖRE deploy av backend-koden i v0.7.0 (ADR 010 beslut 15: A, B och C körs alla före deployen; B krävs
-- innan någon händelse tas emot). Additiv och bakåtkompatibel: gammal kod ignorerar tabellen och funktionen. Rollback av
-- backend-koden kräver ingen rollback av migrationen. De tre migrationerna A (045), B (denna) och C är inbördes oberoende.
--
-- Idempotent: create table/index if not exists, create or replace function, revoke/grant kan köras om. Ingen egen begin/commit:
-- apply_migration kör filen som en transaktion (som övriga migrationer). Ingen data ändras. Efter applicering:
-- get_advisors security.
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; tar bort kön och journalen med alla händelser, inga rundor).
-- Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   drop function if exists public.claim_strava_webhook_events(integer, integer);
--   drop table if exists public.strava_webhook_events;
-- Statiska tester: stravaWebhookMigration046.test.ts.

create table if not exists public.strava_webhook_events (
  id               bigint generated always as identity primary key,
  dedupe_key       text        not null,
  object_type      text        not null check (object_type in ('activity','athlete')),
  object_id        bigint      not null,
  aspect_type      text        not null check (aspect_type in ('create','update','delete')),
  owner_id         bigint      not null,                                   -- Strava athlete id
  subscription_id  bigint      not null,
  event_time       timestamptz not null,                                   -- Stravas event_time (epoch s)
  updates          jsonb       not null default '{}'::jsonb,               -- ENDAST private/type/authorized (aldrig title)
  user_id          uuid        references public.users(id) on delete set null,
  status           text        not null default 'pending' check (status in ('pending','processing','done','dead')),
  outcome          text,
  attempts         smallint    not null default 0,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  lease_expires_at timestamptz,
  last_error       text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  constraint strava_webhook_events_dedupe_key_key unique (dedupe_key),
  constraint strava_webhook_events_updates_check check (
    jsonb_typeof(updates) = 'object' and (updates - array['private','type','authorized']) = '{}'::jsonb
  )
);

create index if not exists strava_webhook_events_due_idx
  on public.strava_webhook_events (status, next_attempt_at)
  where status in ('pending','processing');

create index if not exists strava_webhook_events_owner_idx
  on public.strava_webhook_events (owner_id, status);

alter table public.strava_webhook_events enable row level security;   -- inga policyer = ingen åtkomst utom service role
revoke all on public.strava_webhook_events from anon, authenticated;

create or replace function public.claim_strava_webhook_events(p_lease_seconds integer, p_max integer)
 returns setof public.strava_webhook_events
 language plpgsql
 set search_path to ''
as $function$
declare
  v_owner bigint;
begin
  -- Steg 1. Måste vara första satsen: allt nedan ska köras först när inget annat claim-anrop pågår.
  perform pg_advisory_xact_lock(hashtextextended('strava_webhook_events:claim', 0));

  if p_lease_seconds is null or p_lease_seconds <= 0 or p_max is null or p_max <= 0 then
    raise exception 'p_lease_seconds and p_max must be positive integers' using errcode = '22023';
  end if;

  -- Steg 2. En krasch (utgången lease) räknas som ett misslyckat försök.
  update public.strava_webhook_events
     set status = 'pending',
         attempts = attempts + 1,
         claimed_at = null,
         lease_expires_at = null,
         last_error = 'lease expired'
   where status = 'processing'
     and (lease_expires_at is null or lease_expires_at <= now());

  -- Steg 3. Ägaren med den äldsta förfallna händelsen, bland ägare utan någon processing-rad. Efter steg 2 har alla
  -- kvarvarande processing-rader en levande lease.
  select e.owner_id
    into v_owner
    from public.strava_webhook_events e
   where e.status = 'pending'
     and e.next_attempt_at <= now()
     and not exists (
       select 1
         from public.strava_webhook_events p
        where p.owner_id = e.owner_id
          and p.status = 'processing'
     )
   order by e.event_time, e.id
   limit 1;

  if v_owner is null then
    return;
  end if;

  return query
  with due as (
    select e.id
      from public.strava_webhook_events e
     where e.owner_id = v_owner
       and e.status = 'pending'
       and e.next_attempt_at <= now()
     order by e.event_time, e.id
     limit p_max
     for update skip locked
  ),
  claimed as (
    update public.strava_webhook_events t
       set status = 'processing',
           claimed_at = now(),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds)
      from due
     where t.id = due.id
    returning t.*
  )
  select c.* from claimed c order by c.event_time, c.id;
end;
$function$;

revoke execute on function public.claim_strava_webhook_events(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_strava_webhook_events(integer, integer) to service_role;
