# 008. Händelselogg (activity_log) för Pack News — grund för framtida realtid, nu endast display

## Status
Godkänd av ägaren 2026-10-04 (redesign-beslut 1–5; beslut 5 = händelseloggen byggs nu, display-only)

## Kontext
Pack News (design: klock-popover + skärm `/news`, ADR 006) visar vad som hänt
i gruppen: titelbyten, utmaningsutfall, level ups, events som öppnas/stängs,
brutna streaks. Ägarbeslut 5: en händelselogg byggs nu för display, men
designad som grund för framtida realtid/notifikationer (roadmap: "Notifikationer
+ realtid", stor). Ägarbeslut 1 (regler oförändrade) och 3 (titlar: dagens
namn/regler) gäller: loggen OBSERVERAR spelet, den ändrar inget.

Verifierat i koden/schemat 2026-10-04:

- **Ingen händelsehistorik finns.** Titelrankingen i `title_leaderboard`
  skrivs över (`update_title_leaderboard` gör `DELETE` + `INSERT` för
  titeln, triggad av varje `user_titles`-ändring) och `user_titles.earned_at`
  sätts om vid varje värdeändring i `EnhancedTitleService` — ett titelbyte
  går därför inte att återskapa i efterhand. Övriga händelser finns delvis
  kvar i tabeller: `challenges` (completed, `outcome`, `determine_at`,
  slutvärden), `events`/`event_entries` (`starts_at`, `settled_at`,
  `ends_at`, `qualified_at`, `xp_awarded`), `runs` (streaks, km). Level-
  historik saknas men kan rekonstrueras ur XP-flödet.
- **Skrivpunkterna finns redan men är spridda:**
  - utmaning skickas: `routes/challenges.ts` `POST /send`; återkallas/avböjs:
    `PUT /:id/withdraw`, `PUT /:id/respond` (decline) och
    `autoDeclinePendingChallenges` — raden i `challenges` raderas;
  - utmaning avgörs: `settleChallenge()` (claim `status active → completed`
    först, sedan W/D/L + boosts) från timcron, lazy från `GET /:id/progress`;
  - titlar: `EnhancedTitleService.processAllUsersTitles(groupId)` (anropas av
    `calculateUserTotals` vid varje skrivväg, samt av admin
    `POST /titles/reprocess-all`) skriver `user_titles` (insert/update/
    delete = återkallelse, issue #10); holder = `position = 1` i
    `title_leaderboard`, som är GLOBAL (ej gruppavgränsad — STATE zon 8);
  - **level skrivs på tre ställen:** `calculateUserTotals` (efter `users`-
    uppdateringen, `reconcileTokensForLevel` för tokens),
    `eventService.checkEventQualification` (participation-XP) och
    `settleCompetitionEvents` (utbetalning) — de två senare sätter
    `current_level` direkt utan token-reconcile;
  - events: `maybeCreateEvent` (skapas `active` eller `scheduled`),
    `activateScheduledEvents` (var 5:e min), `settleCompetitionEvents`
    (claim → utbetalning), `settleExpiredParticipationEvents` (var 5:e min,
    utan claim och utan `settled_at`);
  - streaks: `calculateUserTotals` skriver `current_streak` vid skrivning;
    nattjobbet `recalculateAllStreaks` (03:00 Stockholm, issue #7) anropar
    `StreakService.updateUserStreak` för alla — det enda stället som
    upptäcker en streak som dött av att användaren slutat springa.
- **`user_seen_items(user_id, item_slug, seen_at)`** är onboardingens
  "sedda objekt"-tabell (unik `user_id,item_slug`, `GET /onboarding/status`,
  `POST /onboarding/mark-seen`).
- **Migrationer:** ADR 002 gäller (nästa nummer över repo och ledger; 032
  och 033 ligger som filer i repot, så 034 förväntas; körs via Supabase MCP
  `apply_migration` efter ägargodkännande; ny tabell = RLS på, inga
  anon-policyer, additivt först).
- Frontend har en inaktiv klockknapp ("Notifications — coming soon") i
  TopBar och Sidebar; inget notissystem finns.

Relaterade ADR:er: **002** (migrationsflödet), **005** (`calculateUserTotals`
är enda skribent till users-totalerna — loggen är en observatör som skriver
EFTER att totalerna sparats och rör aldrig deras beräkning), **004**
(level-matematiken i shared används för level-upp-detektion och backfill),
**006** (`/news`, klockpopover, tomläge tills inkrement 9), **007**
(svarsformskonventioner; `buildXpLedger`, se beslut 7). Ingen ADR ersätts.

## Beslut

### 1. Tabell `activity_log`
En append-only logg över *vad som hänt i en grupp*. Namnet undviker
kollisionen med den befintliga `events`-tabellen (löparevents).
Migration `034_activity_log.sql` (nästa lediga; additiv; ADR 002-flödet):

```sql
create table if not exists public.activity_log (
  id              bigint generated always as identity primary key,
  group_id        uuid        not null references public.groups(id) on delete cascade,
  type            text        not null,
  actor_user_id   uuid        references public.users(id) on delete set null,
  target_user_id  uuid        references public.users(id) on delete set null,
  payload         jsonb       not null default '{}'::jsonb,
  payload_version smallint    not null default 1,
  dedupe_key      text        not null,
  is_backfill     boolean     not null default false,
  occurred_at     timestamptz not null default now(),   -- när det hände (visning/dag-gruppering)
  created_at      timestamptz not null default now(),   -- när det loggades
  constraint activity_log_dedupe_key_key unique (dedupe_key),
  constraint activity_log_type_check check (type in (
    'title_unlocked','title_taken','title_revoked',
    'challenge_received','challenge_won','challenge_draw',
    'level_up','run_milestone','streak_broken',
    'event_open','event_closed'))
);
create index if not exists activity_log_group_id_idx  on public.activity_log (group_id, id desc);
create index if not exists activity_log_actor_idx     on public.activity_log (actor_user_id)  where actor_user_id  is not null;
create index if not exists activity_log_target_idx    on public.activity_log (target_user_id) where target_user_id is not null;
alter table public.activity_log enable row level security;       -- inga policyer = ingen åtkomst utom service role
revoke all on public.activity_log from anon, authenticated;
alter table public.users add column if not exists news_last_seen_id bigint;  -- beslut 8
```
- `id` är en monoton identitet: ordningen i flödet, nyckeln för paginering
  (`before`/`after`) och för oläst-vattenmärket. Luckor (rollbacks, ignorerade
  dubletter) är ofarliga.
- `type` är `text` + `CHECK`, inte en Postgres-`enum`: att lägga till en typ
  är då en vanlig migration (släpp/lägg `CHECK`) i stället för `ALTER TYPE`.
  Typlistan har EN källa i kod, `ACTIVITY_TYPES` i `packages/shared`, och ett
  statiskt test kräver att migrationens `CHECK`-lista är identisk med den.
- Raden är ett **faktum, inte text.** Ingen renderad copy lagras; klienten
  renderar ur `type` + `payload` + vem som tittar ("took … from **you**" när
  `target` är den som tittar). Namn/bild hämtas live via `actor`/`target`;
  det som kan ändras och ändå ska stå kvar (titelnamn) ligger som
  ögonblicksbild i `payload`.
- `on delete set null` på användarreferenserna: historiken överlever en
  raderad användare (renderas som "a former member").
- `payload_version` låter payloadformen utvecklas utan ny typ.

### 2. Typkatalog och payloads
Alla rader är EN händelse i gruppen (inte en per mottagare); relevans för en
viss läsare härleds ur `actor`/`target`. Typerna definieras som en
diskriminerad union i `packages/shared/src/activity.ts` (typer + konstanten
`ACTIVITY_TYPES`) och delas av backend och frontend.

| `type` | actor → target | payload (v1) | Betydelse |
|---|---|---|---|
| `title_unlocked` | ny innehavare → – | `title_id, title_name, metric_key, value` | en titel som INGEN höll får sin första innehavare |
| `title_taken` | ny innehavare → förra innehavaren | `title_id, title_name, metric_key, value, previous_value, reason: 'overtaken' \| 'revoked'` | innehavarskifte; `revoked` = förra innehavaren uppfyller inte längre kravet (issue #10) |
| `title_revoked` | förra innehavaren → – | `title_id, title_name, metric_key` | titeln blev utan innehavare (ingen efterträdare) |
| `challenge_received` | utmanaren → motståndaren | `challenge_id, tier, metric, duration_days` | utmaning skickad (pending) |
| `challenge_won` | vinnaren → förloraren | `challenge_id, tier, metric, duration_days, winner_value, loser_value, winner_boost{type,delta,duration}, loser_boost{…}` | avgjord utmaning; "challenge lost" är samma rad sedd av `target` |
| `challenge_draw` | utmanaren → motståndaren | som ovan men `challenger_value, opponent_value` | oavgjort |
| `level_up` | användaren → – | `level` | en rad per uppnådd nivå |
| `run_milestone` | användaren → – | `kind: 'total_km', threshold` | totala km passerar 100/250/500/1000/2500/5000 (konstanten `RUN_MILESTONES` i shared; `kind` lämnar plats för fler sorter utan ny typ) |
| `streak_broken` | användaren → – | `length, last_run_date` | streak som gav multiplikator dog (se beslut 5) |
| `event_open` | – | `event_id, event_type, template_name, icon, reward_xp, ends_at` | event blev aktivt |
| `event_closed` | – | `event_id, event_type, template_name, participants, members, top?: [{user_id, rank, xp}]` | event avslutat/avräknat (`participants` av `members` — "4 of 6 finished it") |

**Avvikelser från ägarens/planens typlista, medvetna:** (a) `challenge_lost`
lagras inte — det är `challenge_won` sedd av förloraren (annars två rader för
ett faktum och dubbel räkning i flödet); (b) `challenge_draw` läggs till —
`settleChallenge` har tre utfall; (c) `title_revoked` läggs till —
återkallelse utan efterträdare är en egen händelse som annars inte kan
uttryckas. Typlistan är i övrigt ägarens. Designens "title_unlocked: The
Commuter is now claimable" justeras enligt ägarbeslut 3 (dagens regler): "Karl
unlocked The Commuter".

### 3. Dedupe-nycklar (idempotens)
`dedupe_key` är obligatorisk och unik; alla skrivningar är `insert … on
conflict (dedupe_key) do nothing` (supabase-js `upsert` med `onConflict:
'dedupe_key', ignoreDuplicates: true`). Nycklarna byggs av rena funktioner i
shared (`activityKeys.*`) så att live-skrivning och backfill ger SAMMA nyckel:

| Typ | Nyckel |
|---|---|
| `challenge_received` | `challenge_received:<challengeId>` |
| `challenge_won` / `challenge_draw` | `challenge_settled:<challengeId>` |
| `level_up` | `level_up:<userId>:<level>` (första gången nivån nås — regression och återtagande ger ingen andra rad) |
| `run_milestone` | `run_milestone:<userId>:<kind>:<threshold>` |
| `streak_broken` | `streak_broken:<userId>:<last_run_date>` |
| `event_open` / `event_closed` | `event_open:<eventId>` / `event_closed:<eventId>` |
| `title_unlocked` | `title_unlocked:<titleId>:<userId>:<value>` |
| `title_taken` | `title_taken:<titleId>:<newHolderId>:<oldHolderId>:<value>` |
| `title_revoked` | `title_revoked:<titleId>:<userId>:<Stockholm-dag>` |

Nycklarna skyddar mot överlappande instanser, omräkning/omkörning och
samtidiga skrivningar från två användare (titel-diffen kan upptäcka samma
byte två gånger). `challenge_received` raderas (retract) via nyckeln när
utmaningen återkallas/avböjs, så flödet inte visar en utmaning som inte
längre finns.

### 4. En skrivmodul, best-effort
`apps/backend/src/services/activityLog.ts` exporterar
`recordActivity(entry)`, `recordActivities(entries)` och
`retractActivity(dedupeKey)`. Alla är **icke-kastande**: fel loggas på
`error`-nivå och sväljs — loggen är härledd visningsdata och får aldrig
fälla XP-/titel-/utmaningskedjan (zon 1). Modulen är också den ENDA punkt
dit en framtida realtidskanal kopplas (beslut 11). Ingen annan kod skriver
till tabellen utom backfill-skriptet (beslut 7).

### 5. Skrivpunkter
Loggen skrivs EFTER att den underliggande skrivningen lyckats, och
gruppen läses ur `users.group_id` (inte ur funktionsparametern — Strava-
importen anropar `calculateUserTotals` utan `groupId`, STATE zon 5).

| Händelse | Skrivpunkt | Villkor | `occurred_at` |
|---|---|---|---|
| `challenge_received` | `POST /challenges/send`, efter insert + token-markering | alltid | nu |
| (retract) | decline/withdraw i `routes/challenges.ts` + `autoDeclinePendingChallenges` | raden raderas med utmaningen | – |
| `challenge_won`/`_draw` | `settleChallenge`, efter claim + W/D/L | utfall; boostvärden ur challenge-raden | nu (≈ `determine_at`) |
| `level_up` | hjälpare `recordLevelUps(userId, prev, new)` från `calculateUserTotals` (prev = `users.current_level` som läses i den befintliga `select`en före uppdateringen; efter lyckad update) OCH från båda level-skrivningarna i `eventService` (prev läses i samma `select` som `total_xp`) | `new > prev`; en rad per nivå i `(prev, new]` | nu |
| `run_milestone` | `calculateUserTotals`, efter lyckad update | `prevTotalKm < tröskel ≤ nytt totalKm` (prev ur samma `select`) | nu |
| `event_open` | `maybeCreateEvent` (`select('id')` på insert, bara om `status='active'`) och `activateScheduledEvents` (`update … .eq('status','scheduled').select(…)` så att bara faktiskt aktiverade loggas) | status → active | `starts_at` |
| `event_closed` | `settleCompetitionEvents` (efter utbetalning; topp 3 i payload) och `settleExpiredParticipationEvents` (statusvakt + `select` av de avslutade; `participants` = antal `event_entries`, `members` = gruppstorlek) | event avslutat | `settled_at`/`ends_at` |
| `streak_broken` | `StreakService.updateUserStreak` (nattjobbet; läser `current_streak` före uppdateringen) — INTE `calculateUserTotals` (en streak som sjunker av en raderad runda är datakorrigering, inte ett avbrott) | `prev current_streak ≥ T` och ny = 0; `T` = lägsta `days` i `streak_multipliers` (i dag 5, fallback 5) | kl 00:00 Stockholm dag `last_run_date + 2` |
| `title_*` | `processAllUsersTitles` (beslut 6) | holderskifte | nu |

Inget skrivs vid första deploy för redan passerade nivåer/milstolpar — alla
villkor jämför mot FÖREGÅENDE värde, så ingen "historieflod" uppstår live.
Event-XP-level-ups loggas direkt vid `eventService`-skrivningen även om
tokens (`reconcileTokensForLevel`) först delas ut vid nästa
`calculateUserTotals` (befintlig lucka, ändras inte här).

### 6. Titeldetektion (snapshot-diff, appnivå)
`processAllUsersTitles(groupId, { emitNews = true })`:
1. före bearbetning: `select title_id, user_id, value from title_leaderboard
   where position = 1` (alla titlar, ~21 rader);
2. bearbeta som i dag (`user_titles` insert/update/delete; DB-triggern
   uppdaterar `title_leaderboard`);
3. efter: samma select + vilka `(title, user)`-par som fortfarande har en
   `user_titles`-rad;
4. ren funktion `diffTitleHolders(before, after, stillHolds)` (enhetstestad)
   ger: ingen→någon = `title_unlocked`; A→B = `title_taken` (`reason:
   'revoked'` om A inte längre har raden, annars `'overtaken'`);
   någon→ingen = `title_revoked`; samma innehavare (även med ändrat värde) =
   ingen händelse. `group_id` = nya innehavarens (vid `title_revoked` den
   förras) `users.group_id`; saknas grupp hoppas raden över.
5. `emitNews:false` för admin-`/titles/reprocess-all` (ett regel-/data-
   underhåll ska inte spamma flödet).

Titelhändelser loggas **endast framåt** (se beslut 7). Eftersom
`title_leaderboard` är global men loggen är gruppavgränsad förutsätter
detektionen en grupp (som i dag); multi-grupp kräver gruppavgränsad
titelranking först (revisit-trigger).

### 7. Retroaktiv backfill (härledbara typer)
Engångs-/repareringsskript `apps/backend/src/scripts/backfillActivityLog.ts`
(som `backfillTreadmill.ts`): default dry-run (skriver räknare per typ +
urval), `--apply` skriver, `--since=YYYY-MM-DD` (default idag − 90 dagar —
flödets värde är färskhet), valfri `--group=<id>`. Rader får `is_backfill =
true` och samma `dedupe_key`:er som live. Härledning (rena byggfunktioner i
shared, enhetstestade; skriptet är tunn I/O):

| Typ | Källa | `occurred_at` |
|---|---|---|
| `challenge_won`/`_draw` | `challenges` med `status='completed'` | `determine_at ?? end_date` |
| `challenge_received` | endast pending `challenges` | `created_at` |
| `event_open`/`event_closed` | `events` med status `active`/`settled`; `participants` ur `event_entries`, `members` = NUVARANDE gruppstorlek (approximation, därför `is_backfill`) | `starts_at` / `settled_at ?? ends_at` |
| `level_up` | **XP-liggaren**: `buildXpLedger(runs, event_entries)` = runda-XP (`runs.xp_gained` per `date`/`created_at`) + event-XP (`qualified_at` för participation, `settled_at ?? ends_at` för competition) sorterad i tid; `replayLevels(ledger, level_requirements)` ger tidpunkten då kumulativ XP först når varje nivåtröskel (ur shared-matematiken, ADR 004) | tidpunkten för krediteringen |
| `streak_broken` | `runs`: sammanhängande dagsföljder med längd ≥ T som följts av ett glapp (eller slutat före igår) | kl 00:00 Stockholm `sista dag + 2` |
| `run_milestone` | `runs` kumulerat per användare i datumordning | datum då tröskeln passerades |
| `title_*` | **backfillas inte** — `title_leaderboard` skrivs över och `user_titles.earned_at` är "senast förbättrad", inte "först uppnådd" | – |

`buildXpLedger` skapas i inkrement 2 (ADR 007 B2, `rank-delta`) och
återanvänds här. Historiska `runs.xp_gained` återspeglar nuvarande
omräkning (streak-/boostomräkningar), så level-tidpunkterna är bästa möjliga
rekonstruktion — märkta `is_backfill`. Skriptet är idempotent (omkörning
ger inga dubbletter) och rader kan rensas och regenereras
(`delete … where is_backfill`).

### 8. Oläst-modell: id-vattenmärke per användare
- **Kolumn `users.news_last_seen_id bigint null`** (migration 034). Valet
  mellan `last_seen_at`, `user_seen_items`-mönstret och en egen tabell:
  - `last_seen_at` (tidsstämpel) förkastas: flödets ordning är `id`, och
    `occurred_at` ≠ loggningstid (backfill, `streak_broken` kl 00:00,
    `event_open` vid `starts_at`) — tidsjämförelse ger fel oläst-mängd;
  - `user_seen_items` (en rad per användare × händelse) förkastas nu: designen
    har bara "Mark all read" (ingen per-rad-kvittens), och mönstret ger N×M
    rader för ingen vinst. Omprövas när notiser behöver per-händelse-
    leveranskvitton (revisit-trigger);
  - egen `news_read_state`-tabell förkastas (YAGNI) — notisinställningar
    (Web Prototype "Settings → Notifications") hör till realtids-ADR:n.
- **Oläst för användare U** = rader i U:s grupp med `id > coalesce(
  news_last_seen_id, 0)` OCH `is_backfill = false` OCH `created_at >
  users.created_at` (nya medlemmar ärver inte gamla nyheter) OCH
  `actor_user_id is distinct from U` (egna handlingar är inte nyheter för en
  själv; de visas i flödet men räknas inte). Backfill-rader är aldrig olästa,
  så ingen engångsinitiering av vattenmärken behövs vid utrullning.
- **Mark all read** sätter vattenmärket monotont (`greatest`; skrivs bara om
  det höjs) till senaste radens id i gruppen eller till `up_to_id` om angivet.

### 9. API
Ny router `routes/news.ts` monterad på `/api/news` i `app.ts`:s routerlista
(ADR 003; wiring-testet utökas). Konventioner enligt ADR 007 (A).

**`GET /api/news`** — `limit` (1–100, default 30), `before=<id>` XOR
`after=<id>` (keyset; båda → 400), `type=a,b` (kommaseparerad, valideras mot
`ACTIVITY_TYPES`, okänd → 400). Alltid gruppavgränsat (saknad grupp → tom).
Sortering `id desc`.
```ts
interface NewsResponse {
  items: Array<{
    id: number; type: ActivityType; occurred_at: string; payload_version: number;
    actor:  { id: string; name: string; profile_picture: string | null } | null;
    target: { id: string; name: string; profile_picture: string | null } | null;
    payload: unknown;          // diskriminerad per type i shared
    is_backfill: boolean; is_unread: boolean;
  }>;
}
// meta: { unread_count: number; last_seen_id: number | null; has_more: boolean; next_before: number | null }
```
`unread_count` räknas över ALLA typer (oberoende av `type`-filtret).
Klockbadge + popover = `GET /news?limit=5`, pollad (60 s + vid fönsterfokus)
av skalet; skärmen använder `next_before` (oändlig bläddring).
Dag-gruppering ("Today / Yesterday / Earlier this week") görs i klienten på
`occurred_at` i Stockholm-tid; filterchips (Titles / Challenges / Events /
Levels / Streaks) mappas i klienten (`level_up` + `run_milestone` under
Levels) till `type=`-listor. Chip-räknare är antal i det laddade fönstret.

**`POST /api/news/seen`** — body `{ up_to_id?: number }` (positivt heltal,
annars 400). Svar: `{ last_seen_id, unread_count }`. Vattenmärket kan aldrig
sänkas av en sen/omkastad request.

### 10. Åtkomst och RLS
Ingen anon- eller `authenticated`-åtkomst alls: RLS på, inga policyer,
`revoke all` från `anon`/`authenticated`. Läsning sker uteslutande via
backend (service role, JWT-autentiserat, gruppavgränsat) — samma modell som
övriga tabeller efter migration 030/031. Inga anon-policyer läggs till
(permissions.md: ny anon-åtkomst = avvikelse). Konsekvens för framtiden: eftersom
appen använder egen JWT, inte Supabase Auth, kan frontend inte prenumerera
direkt på tabellen via Supabase Realtime; realtid byggs via backend (beslut 11).

### 11. Realtidsberedskap (kontrakt som ska hålla — inget realtidsbygge nu)
1. **Stabil, additiv typlista** (`ACTIVITY_TYPES` + `CHECK` + test) och
   versionerade payloads; nya typer är en migration + en rad i shared, aldrig
   en omskrivning.
2. **Monoton `id` som kursor:** `GET /news?after=<id>` ger "allt nytt sedan
   X" — samma kontrakt bär polling nu och SSE/WebSocket-catch-up senare.
3. **Fakta, inte mottagare:** en framtida notifierare härleder mottagare ur
   `type`/`actor`/`target`/`group_id` (t.ex. `target_user_id` för "du blev
   utmanad") och användarens inställningar — raden förändras inte.
4. **`is_backfill` = aldrig notis.**
5. **En skrivmodul** (`activityLog.ts`) är kopplingspunkten för en intern
   händelsebuss (EventEmitter → SSE/WS) efter lyckad insert; i dag ingen
   mottagare.
6. När tabellen får realtidsroll blir den en del av kritiskt flöde:
   best-effort-skrivningen (beslut 4) omprövas (outbox/retry), och
   `STATE.md` får ett eget flöde med rök.

### 12. Utrullningsordning
1. Ägargodkänd migration 034 (`apply_migration`; `list_migrations`,
   `get_advisors security` efteråt).
2. Backfill-skriptet: dry-run → ägaren ser räknare → `--apply`
   (tabellen innehåller då bara backfill-rader, så `id`-ordningen =
   tidsordning).
3. Deploya backend med skrivpunkterna + `/api/news`.
4. Deploya frontend (inkrement 9). Fram till dess är klockan inaktiv.
Eftersom flödet sorteras på `id` hamnar rader som backfillas EFTER go-live
överst trots äldre `occurred_at`; omkörning efter go-live är därför
reparation, inte rutin. Migrationen måste ligga före kod som skriver
(annars loggas fel — icke-fatala — tills tabellen finns).

## Alternativ som övervägts
- **Härleda Pack News vid läsning, utan tabell** (challenges/events/streaks
  ur befintliga tabeller). Bortvalt av ägaren (beslut 5) och på sak: titelbyten
  går inte att härleda (rankingen skrivs över), level-historik saknas, och ett
  hybridflöde (vissa typer lagrade, andra härledda) ger två paginerings-/
  oläst-/ordningsmekanismer och ingen enhetlig ström att bygga realtid på.
- **DB-triggrar som skriver loggen** (på `challenges`, `user_titles`/
  `update_title_leaderboard`, `events`, `users`). Fördel: fångar även
  ändringar utanför appkoden. Bortvalt: ADR 005 tog bort triggrar som
  skrev härledd data av goda skäl (domänlogik i PL/pgSQL, osynlig, otestad,
  två skribenter); level-/milstolpe-/streak-detektion kräver appens
  matematik; appkodens snapshot-diff är enhetstestbar. Omprövas om
  instrumenteringsluckor upptäcks (t.ex. holderskiften via nya vägar).
- **Fan-out: en rad per mottagare (inkorg) med `read`-flagga.** Bortvalt:
  multiplicerar rader, dubblerar fakta, och mottagarlogiken ändras med
  framtida inställningar; en grupplogg + härledd relevans är billigare och
  lika bra för display.
- **Postgres `enum` för `type`.** Bortvalt: `ALTER TYPE … ADD VALUE` är
  stelare än att byta en `CHECK` i en additiv migration; kod-listan +
  teststyrd likhet ger samma säkerhet.
- **UUID som primärnyckel och tidsstämpelkursor.** Bortvalt: ordning,
  keyset-paginering och vattenmärke blir enklare och robustare med en
  monoton identitet; tidsstämplar kolliderar och skiljer sig från
  `occurred_at`.
- **Lagra renderad text.** Bortvalt: perspektivberoende ("from you"),
  språk och framtida copy-ändringar; fakta + klientrendering.
- **Offset-paginering för `/news`.** Bortvalt: flödet växer löpande;
  keyset ger stabila sidor när nya rader tillkommer.
- **Supabase Realtime direkt mot tabellen.** Bortvalt/ej möjligt nu: egen
  JWT-auth betyder ingen Supabase-session, och RLS utan policyer (beslut 10)
  skulle blockera prenumerationen.

## Konsekvenser
- **Ny datalagring (ägarbeslut 5, godkänd — flaggas ändå tydligt):** en ny
  tabell och en ny kolumn (`users.news_last_seen_id`) i produktionsdatabasen.
  Migration 034 kräver ägarens uttryckliga godkännande per
  `docs/permissions.md`/ADR 002 (ask), körs via MCP `apply_migration` och är
  additiv (expand; ingen contract). **Backfill-skriptet skriver data i prod och
  kräver likaså godkännande** (dry-run först; `--apply` är den skrivande
  åtgärden). Datan är härledd och kan raderas/regenereras (`where
  is_backfill`).
- **Inga externa tjänster och ingen kostnad** (ingen 15c-flagga). Volymen är
  ett par hundra rader initialt och några rader per dag; ryms obetydligt i
  nuvarande plan.
- **Känslig data:** loggen innehåller användar-id:n, titel-/utmaningsfakta och
  händelsetider — data som redan är synlig för alla gruppmedlemmar. Payloads
  får inte innehålla e-post, hashar, tokens eller Strava-id:n (regel + test på
  payloadbyggarna). Ingen anon-åtkomst (beslut 10).
- **Skrivrättigheter:** endast backend (service role) skriver; endast
  `activityLog.ts` (+ backfill-skriptet) rör tabellen. Läsning endast via
  `GET /news` (gruppavgränsad). `POST /news/seen` skriver bara anroparens
  egen `users.news_last_seen_id`.
- **Produktionsrisk (zon 1/6/11):** skrivpunkter sitter i den affärskritiska
  skrivvägen. Mildras av att alla anrop är icke-kastande och sker EFTER den
  underliggande skrivningen; kostnaden är några extra queries per skrivning
  (`calculateUserTotals` läser 3–4 kolumner i stället för 1 i en befintlig
  `select`; titel-diffen lägger 2 små selects per `processAllUsersTitles`).
  Små ändringar i `activateScheduledEvents`/`settleExpiredParticipationEvents`
  (statusvakt + `select` av berörda rader) gör dem också mer idempotenta.
- **Positivt:** en enhetlig, paginerbar, idempotent ström som både driver Pack
  News nu och är notis-/realtidsgrunden senare; titelhistoriken börjar sparas
  (kan inte rekonstrueras senare); oläst blir en enda monoton kolumn.
- **Negativt/risker:** (1) Loggen är en andrahandsbild — den kan avvika från
  sanningen (en `level_up`-rad ligger kvar efter regression; `title_*`
  missas om ett holderskifte sker via en framtida väg som inte passerar
  `processAllUsersTitles`). Accepterat för display; avvikelsen blir allvarlig
  först när notiser skickas. (2) Best-effort betyder att en rad kan saknas vid
  kraschande skrivning; syns i loggen. (3) Backfillens leveltidpunkter är en
  rekonstruktion. (4) `is_backfill`-rader ser ut som riktiga i flödet (avsiktligt)
  men räknas aldrig som olästa. (5) Detektionen av `streak_broken` beror på
  nattjobbet (zon 6: startas bara i `NODE_ENV=production`; UTC/Stockholm-
  kantfall i `StreakService` — jobbet körs 03:00 Stockholm just därför).
  (6) Titeldetektionen är gruppantagande (global titelranking, zon 8).
  (7) Event-XP-level-ups saknar token-reconcile (befintlig lucka).
- **Tester (ADR 001):** rena funktioner med enhetstester — `activityKeys`
  (stabila nycklar), `diffTitleHolders` (alla kombinationer inkl. samma
  innehavare + ändrat värde = ingen rad, `revoked` vs `overtaken`),
  nivåintervall `(prev,new]`, milstolpe-korsning, streak-brott-tröskel,
  backfillbyggarna (challenges→rader, events→rader, streak-segment,
  `replayLevels`, milstolpar) och payloadbyggarna (ingen PII). `recordActivity`
  sväljer fel och returnerar utan att kasta. Route-tester för `/news`: 401;
  gruppavgränsning; `limit`/`before`/`after`/`type`-validering (400);
  keyset (`next_before`, `has_more`); oläst-predikatet (egen handling,
  backfill, äldre än användarens `created_at`, ovanför/under vattenmärket);
  `POST /news/seen` monotont och validerat. Statiskt test: migrationens
  `CHECK`-lista == `ACTIVITY_TYPES`. När ADR 001:s in-memory-fake finns:
  scenario "avgör utmaning två gånger → exakt en rad", "radera runda → ingen
  streak_broken-rad". Wiring-testet (ADR 003) täcker `/api/news`.
- **Arkitekturdiagram:** uppdateras i SAMMA commit — Data-kortet i
  `docs/architecture/runquest-architecture.json` får raden om
  `activity_log`/`GET /api/news`. Tabellräknaren i `db`-komponenten (24)
  ändras av Lead när migration 034 körts. HTML genereras om (archify) av Lead.
- **STATE.md-ändringar att föreslå:** (1) ADR-index: rad 008. (2) Stack/DB:
  "25 tabeller" efter migration 034. (3) Kritiska flöden: nytt flöde 8
  "Pack News/händelselogg — skrivpunkter → `activity_log` → `GET /api/news` →
  `POST /api/news/seen`. Rök: avgör en utmaning (cron/lazy) → exakt en
  `challenge_won`-rad; omkörning ger ingen dubblett; `GET /news` visar den,
  `seen` nollar oläst". (4) Konventioner: "Domänhändelser loggas via
  `services/activityLog.ts` (icke-kastande), nycklar ur shared/`activityKeys`;
  loggen skrivs EFTER underliggande skrivning". (5) Zon 1: `calculateUserTotals`
  har nu loggande sidoeffekter (best-effort). Zon 11: holder-diff i
  `processAllUsersTitles`. (6) Ordlista: "händelselogg/Pack News → activity_log/
  news". (7) Behörigheter: det nya backfill-skriptet kräver ask
  (permissions).

## Revisit-triggers
- Notifikationer/realtid byggs (roadmap) → ny ADR: outbox/retry i stället för
  best-effort, `after`-kursor eller push-kanal, notisinställningar (egen
  tabell), per-händelse-kvittens (`user_seen_items`-mönstret eller
  read-tabell).
- Multi-grupp → gruppavgränsad titelranking först; `group_id` i loggen är redan
  på plats.
- Instrumenteringsluckor upptäcks (händelser som inte loggas) → ompröva
  DB-triggrar/outbox för just den typen.
- Fler än ~50 000 rader eller läsprestanda sjunker → retention/arkivering och
  partitionering; flödet behöver aldrig mer än ~90 dagar.
- Nya typer behövs (t.ex. `badge_earned` när badge-systemet frigörs,
  `season_*`) → additiv migration (ny `CHECK`) + rad i `ACTIVITY_TYPES`.
- Oläst-semantiken ska bli per-händelse ("mark as read" på enskild rad) →
  byt vattenmärket mot per-rad-kvittens.
