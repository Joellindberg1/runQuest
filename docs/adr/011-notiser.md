# 011. Personliga notiser — användarinställningar, läst per rad och rank_passed (Jira RUN-183, epic RUN-9, v0.7.0)

## Status
Godkänd av ägaren 2026-10-13, med alla rekommendationer (B1, B3, B7, B8, B9, B10 och Ö1–Ö10, se "Avgjorda frågor"). Ägarbeslut 2026-10-12 (B2, B4, B5 utökat, B6) är bindande och inbakade. Våg 2 (beslut 12) ingår i v0.7.0; försenas den kan den brytas ut till v0.7.1. Migrationerna i beslut 10 kräver ägarens uttryckliga godkännande per migration (docs/permissions.md, ADR 002). Ingen ADR ersätts; ADR 008 beslut 8 och dess oläst-predikat UTÖKAS (se Kontext, sista stycket) och ADR 008:s statusrad har fått "Utökad av ADR 011 (2026-10-13)".

Addendum 2026-10-14 (ägarbeslut efter Design Council): läs-gesten i beslut 4 (B4) ändras, se längst ner.

Addendum 2026-10-15 (utfall vid bygget, v0.7.0): tre korta noteringar, se längst ner.

## Kontext
Epic RUN-9 (fixVersion v0.7.0), story RUN-183 (ADR-steget). Klockan i headern är sedan v0.5.0 en oläst-räknare plus en popover över Pack News (ADR 008), men den har inga inställningar: alla icke-egna rader i gruppen räknas, och det enda sättet att bli "läst" är "Mark all read". ADR 008 och ADR 006 sköt uttryckligen notisinställningar och per-händelse-kvitto till en senare notis-ADR. Det här är den ADR:n. "Notis" betyder i hela dokumentet en rad i appens egen klocka och popover — ingen push, ingen e-post, ingen realtidskanal (se beslut 11 och Revisit-triggers).

Verifierat i koden 2026-10-13 (branch docs/adr-010-011, main 83c561b):

- **Händelseloggen** (ADR 008, migration 034 + 036 + 041): `activity_log` med monoton `id`, `type` + CHECK, `dedupe_key`, `is_backfill`, `payload jsonb`. `ACTIVITY_TYPES` i `packages/shared/src/activity.ts` har idag **13 typer**: `title_unlocked`, `title_taken`, `title_revoked`, `challenge_received`, `challenge_won`, `challenge_draw`, `level_up`, `run_milestone`, `streak_broken`, `event_open`, `event_closed`, `badge_earned`, `release_published`. Ett statiskt test (`activityLogMigration.test.ts`) kräver att CHECK-listan i den SENASTE migrationen som definierar `activity_log_type_check` är identisk med `ACTIVITY_TYPES`. Skrivning sker via `services/activityLog.ts` (`recordActivities`, `retractActivity`; icke-kastande, `upsert … ignoreDuplicates` på `dedupe_key`).
- **Aktör/mål per typ** (av `build*Draft` i shared): titlar `actor` = ny innehavare, `target` = förra (`title_taken`); `challenge_received` utmanare → motståndare; `challenge_won` vinnare → förlorare; `challenge_draw` utmanare → motståndare; `level_up`/`run_milestone`/`streak_broken`/`badge_earned` användaren → –; `event_open`/`event_closed`/`release_published` ingen aktör, inget mål. **`event_closed` bär bara antal deltagare och topp 3 (competition), inte vilka som deltog; `title_taken` bär inte vem som låg tvåa.**
- **Oläst idag** (`routes/news.ts`): `unread_count` och `is_unread` = rader i gruppen med `id > users.news_last_seen_id`, `is_backfill = false`, `created_at > users.created_at` och `actor_user_id ≠ jag` (egna handlingar räknas aldrig). Kvittering finns bara som `POST /api/news/seen` ("Mark all read"), monotont, villkoret i UPDATE:ns WHERE. Räknaren görs med två `head`-count-queries.
- **Frontend:** klockan (`app-shell/NotificationsPopover`) och popovern (`NewsPopoverPanel`: fem senaste ur samma flöde, "Mark all read", länk till `/news`) delar EN query-definition (`useNewsFeed`, nyckel `['news','feed', …]`, poll 2 min + fönsterfokus) med `/news` (`NewsScreen`: filter i `?type=`, sex chips Titles/Challenges/Events/Levels/Badges/Streaks, "Mark all read", tour `tour_news_v1`). Raderna (`NewsRow`, popoverns `li`) är inte interaktiva. `newsModel.ts` har en uttömmande `switch` över `ACTIVITY_TYPES` och `CATEGORY_OF: Record<ActivityType, NewsCategory>`; ett test kräver att varje typ hör till exakt ett filter och en kategori. Okända typer filtreras bort i klienten (RUN-138). `AuthProvider` rensar HELA query-cachen vid login, logout och 401.
- **Settings-sidan** (`features/settings/SettingsScreen`) har Strava, lösenord och senaste synk; rubrikens undertext är "Strava and password". Web Prototypens "Notifications"-kort (åtta reglage, undertext "Everything still lands in Pack News — this decides what reaches you.") är medvetet ej byggt (docs/open-assumptions.md, ADR 006 beslut 4).
- **`user_seen_items`** (migration 027): `(user_id, item_slug)` PK, text-slugs för onboarding/patch notes/tours (`tour_news_v1` …). `GET /api/onboarding/status` returnerar ALLA användarens slugs och hämtas vid varje appstart av onboarding-kön. Policyn för `authenticated` är borttagen (038); all åtkomst går via backend.
- **`users`-tabellen** har inga inställningskolumner; senast tillagda är `news_last_seen_id` (034) och `displayed_badge_series` (035). Alla `users`-selects i backend är explicita kolumnlistor (ingen `select('*')` hittad), så en ny kolumn skulle inte läcka — men tabellen innehåller `password_hash`/`email` och är den hetaste i systemet.
- **XP/ranking:** `users.total_xp` skrivs av `calculateUserTotals` (ADR 005) och, för event-XP, av `eventService` (`increment_event_xp` i `checkEventQualification` och `settleCompetitionEvents`) — samma tre ställen som skriver `current_level` och som `recordLevelUps` (ADR 008 beslut 5) redan hänger på. `calculateUserTotals` läser `current_level`, `total_km`, `group_id` före uppdateringen och loggar efteråt. `rank-delta` (`routes/leaderboard.ts`, `buildXpLedger` + `buildRankDelta` i shared) räknar redan ut "rank vid en given datumgräns" ur `runs.xp_gained` + `event_entries.xp_awarded` med komparatorn (xp desc, namn asc, id). Backend `users-with-runs` sorterar på `total_xp desc` utan tie-breaker; om Boarden sorterar om i frontend är inte verifierat.
- **Utmaningsleaderboarden** (`GET /challenges/group-stats`) rankar `points = (wins + draws × 0,5) / matcher`, därefter `wins`; `wins/draws/losses` skrivs bara av `settleChallenge` (efter claim, boostar, `challenge_active`-återställning), som sedan loggar `challenge_won`/`challenge_draw`. Lika poäng och vinster har ingen deterministisk ordning i svaret. `PUT /challenges/:id/respond` (accept) loggar ingenting; decline/withdraw raderar utmaningen och retractar `challenge_received`.
- **Titlar:** `emitTitleNews` snapshottar bara `position = 1` ur `title_leaderboard` före/efter `processAllUsersTitles`; `title_leaderboard` är GLOBAL (topp 10 per titel över alla grupper, STATE zon 8/11). `processAllUsersTitles(…, { emitNews: false })` är redan undertryckningsmekanismen för admin-`POST /titles/reprocess-all`.
- **Migrationer:** 042 är senaste i repot; 043 tas av RUN-225 och ADR 010 (Strava) tar också nummer. Migrationerna här numreras vid bygget (beslut 10).
- Det finns EN aktiv grupp med 6 användare.

Ägarens Strava-hållning (2026-10-07, bindande) berörs bara indirekt: notiserna bär ingen Strava-rådata; hur ADR:n följer den står i beslut 13.

**Relation till ADR 008 (utökning, inte ersättning).** (a) Beslut 8 förkastade `user_seen_items` och per-rad-kvitto "nu" och angav som revisit-trigger att oläst-semantiken ska bli per-händelse; den utlösaren är nu uppfylld (ägarbeslut B4). Vattenmärket `news_last_seen_id` behålls som golv. (b) Beslut 8:s regel "egna handlingar räknas aldrig som olästa" får ett undantag: utfall som avgörs asynkront medan användaren inte är där (utmaning vunnen) är en notis även om användaren är `actor` (ägarbeslut B5: "du vann över någon"). (c) Beslut 11.3 ("fakta, inte mottagare") består: ingen rad skrivs per mottagare; inställningarna tillämpas vid LÄSNING. (d) ADR 006 beslut 4 ("byggs INTE nu") var uttryckligen tidsbegränsat till den framtida notis-ADR:n.

Relaterade ADR:er: **002** (migrationsflödet), **004** (rena funktioner och delad SSOT i shared), **005** (`calculateUserTotals` enda skribent till totalerna; rank-detektionen är en observatör efter skrivningen), **007** (svarsform, `meta`), **008** (activity_log, oläst, best-effort), **009** (observatörsmönstret, retract), **001** (teststrategi), **010** (Strava-webhooks, parallell: raderingar/ändringar går via `calculateUserTotals`).

## Beslut

### 1. Omfång och princip
1. Notiser är **pull och in-app**: klockan + popovern, pollade som idag. Ingen push, e-post, SSE eller WebSocket i denna ADR.
2. **Fakta lagras en gång per händelse i gruppen; inställningarna tillämpas vid läsning** (ADR 008 beslut 11.3). Ändrar en användare sina reglage ändras räknaren direkt och retroaktivt över raderna ovanför golvet — inget skrivs om.
3. **Inga reglage utan fakta bakom.** Registret (beslut 2–3) får bara innehålla notisslag vars händelse faktiskt skrivs. Ett nytt slag läggs till tillsammans med sin skrivpunkt (en story).
4. **Ägarbeslut B2:** inställningarna styr KLOCKAN (räknare + popover). `/news` visar ALLT (rader, filter, historik); inställningarna döljer aldrig en rad där.

### 2. Lagring av användarinställningar: typat register, sparse tabell
**Registret bor i kod** (`packages/shared/src/settings.ts`, SSOT enligt ADR 004). Varje definition har `key`, `scope: 'user' | 'group'`, `type` (`boolean` | `enum`), `default` och (för enum) tillåtna värden. Nycklar är namnrymda: `notify.<slag>` (beslut 3). Rena funktioner i shared, enhetstestade:
- `resolveSettings(stored, scope)` → fullt värdeobjekt: **saknad nyckel = default**; en lagrad nyckel med fel typ/okänt enumvärde → default (loggas som varning, kraschar aldrig); okända/pensionerade lagrade nycklar ignoreras.
- `sanitizePatch(body, scope)` → `{ ok: true, set, reset } | { ok: false, error }`. Strikt vid skrivning: okänd nyckel, fel typ eller fel scope → 400; högst 40 nycklar per anrop; `null` = återställ till default (raden raderas).

**Lagring (B1, beslutat: tabell, inte kolumn).** Migration `<nr>_create_user_settings` (additiv, före deploy):
```sql
create table if not exists public.user_settings (
  user_id    uuid        not null references public.users(id) on delete cascade,
  key        text        not null check (char_length(key) between 1 and 80),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_settings enable row level security;      -- inga policyer = ingen åtkomst utom service role
revoke all on public.user_settings from anon, authenticated;
```
Sparse: bara uttryckligen satta värden lagras; ett uttryckligt värde som råkar vara lika med dagens default behålls (användarens val överlever att en default ändras senare). Skäl för tabellen mot `users.settings jsonb`: (1) reglage trycks i följd (tre switchar på någon sekund) → tre samtidiga `PUT`; med en JSON-kolumn blir det read-modify-write av hela objektet och uppdateringar går förlorade, medan `upsert` på `(user_id, key)` är atomisk per nyckel utan PL/pgSQL; (2) "återställ" = radera raden; (3) inget nytt i den känsliga `users`-tabellen; (4) samma form fungerar för gruppomfång (se Konsekvenser, "Gruppomfång").

**API** (ny router `routes/settings.ts` på `/api/settings` i `createApp()`-listan, wiring-testet utökas; ADR 007 A: `{success,data,meta?}`/`{error}`, snake_case, typer i `packages/shared/contracts/settings.ts`):
- `GET /api/settings` → `data: { values: { <key>: boolean | string } }` (ALLA användar-scope-nycklar, upplösta), `meta: { customised: string[] }`.
- `PUT /api/settings` body `{ values: { <key>: boolean | string | null } }` → samma svar som GET efter skrivning. Skriver bara anroparens egna rader; gruppscope-nycklar ger 400 här.

### 3. Notisslag (kinds) och klassificering
Ett **notisslag** är det en användare slår av/på: en precis mening med en rad-typ och en roll. Ägarens lista (B5) blir följande register (`NOTIFICATION_KINDS` i `packages/shared/src/notifications.ts`; nyckel `notify.<slag>`, boolean). Kolumn "v" = när slaget levereras (beslut 5/12): **0.7.0** eller **senare**.

| Slag | Meningen i UI (engelska, slutlig copy av Designern) | Rad | Roll | Default | v |
|---|---|---|---|---|---|
| `title_taken_from_me` | Someone takes a title from you | `title_taken` | target = jag | på | 0.7.0 |
| `title_taken_runner_up` | Someone sneaks past you and takes a title you were chasing as runner-up | `title_taken` | `payload.runner_up_user_id` = jag (definition i beslut 7) | på | senare (våg 3) |
| `title_others` | Other title changes in the pack | `title_unlocked`/`title_taken`/`title_revoked` | ej mig | på | 0.7.0 |
| `challenge_received_me` | Someone challenges you | `challenge_received` | target = jag | på | 0.7.0 |
| `challenge_accepted_me` | Someone accepts your challenge | `challenge_accepted` (ny) | target = jag | på | 0.7.0 |
| `challenge_lost_me` | Someone beats you in a challenge | `challenge_won` | target = jag | på | 0.7.0 |
| `challenge_won_me` | You beat someone in a challenge | `challenge_won` | **actor = jag** (undantag, se nedan) | på | 0.7.0 |
| `challenge_draw_me` | Your challenge ends in a draw | `challenge_draw` | actor eller target = jag (undantag) | på | 0.7.0 |
| `challenges_others` | Other challenges in the pack | `challenge_*` | ej mig | på | 0.7.0 |
| `rank_passed_xp_me` | Someone passes you on the leaderboard | `rank_passed`, `measure = xp` | target = jag | på | 0.7.0 |
| `rank_passed_challenge_me` | Someone passes you on the challenge standings | `rank_passed`, `measure = challenge_points` | target = jag | på | 0.7.0 |
| `rank_passed_others` | Rank changes between others | `rank_passed` | ej mig | **av** | 0.7.0 |
| `event_open` | A new event opens | `event_open` | – | på | 0.7.0 |
| `event_closed_me` | An event you took part in closes | `event_closed` | `payload.entrant_ids` ∋ jag | på | 0.7.0 |
| `event_closed_others` | Other events close | `event_closed` | ej mig | på | 0.7.0 |
| `level_up_others` | Someone levels up | `level_up` | ej mig | på | 0.7.0 |
| `run_milestone_others` | Someone passes a distance milestone | `run_milestone` | ej mig | på | 0.7.0 |
| `badge_earned_others` | Someone earns a badge | `badge_earned` | ej mig | på | 0.7.0 |
| `streak_broken_others` | Someone loses a streak | `streak_broken` | ej mig | på | 0.7.0 |
| `release_published` | A new RunQuest version is out | `release_published` | system | på | 0.7.0 |

**Defaults (ägarbeslut Ö1):** klockan beter sig som idag för användare som aldrig rör inställningarna (allt räknas utom egna handlingar). Enda slaget som startar avstängt är `rank_passed_others`. Web Prototypens förslag (t.ex. "Someone else levels up" av) valdes bort.

**Klassificering (`classifyNotification`, ren funktion i shared).** Indata `{ type, actorId, targetId, payload }` + `viewerId`; utdata `NotificationKind | 'own' | null`. Varje rad får **exakt ett** slag ur betraktarens perspektiv — personliga slag före "others" — så att reglagen aldrig överlappar (en rad kan inte vara både "from you" och "others"):
- `title_taken`: target = jag → `title_taken_from_me`; annars `runner_up_user_id` = jag och actor ≠ jag → `title_taken_runner_up`; annars actor = jag → `own`; annars `title_others`. `title_unlocked`/`title_revoked`: actor = jag → `own`, annars `title_others`.
- `challenge_received`: target = jag → `challenge_received_me`; actor = jag → `own`; annars `challenges_others`. `challenge_accepted`: analogt (`challenge_accepted_me`). `challenge_won`: target = jag → `challenge_lost_me`; actor = jag → `challenge_won_me`; annars `challenges_others`. `challenge_draw`: actor eller target = jag → `challenge_draw_me`; annars `challenges_others`.
- `rank_passed`: target = jag → `rank_passed_xp_me`/`rank_passed_challenge_me` efter `payload.measure`; actor = jag → `own`; annars `rank_passed_others`.
- `event_open` → `event_open`. `event_closed`: `payload.entrant_ids` innehåller mig → `event_closed_me`, annars `event_closed_others` (rader utan fältet, t.ex. före denna ADR, klassas `event_closed_others`).
- `level_up`/`run_milestone`/`badge_earned`/`streak_broken`: actor = jag → `own`, annars `*_others`. `release_published` → `release_published`.
- Okänd framtida typ → `null` (räknas aldrig; en ny typ utan klassificering fäller ett test, se beslut 15).

**Egen-handling-regeln med undantag.** ADR 008 beslut 8: egna handlingar är aldrig olästa. Det gäller kvar för `own`. Undantagen är de två slag där jag är `actor` men händelsen är ett asynkront utfall jag inte utförde i stunden: `challenge_won_me` och `challenge_draw_me` (avgörs av cron kl 03:00 eller lazy). **Inga andra egna rader blir notiser** — ägarbeslut Ö7: ingen notis om egen streak som dör eller egen ny badge (badge har popup, streaken syns i appen).

**Vad inställningarna styr (B2).**
- `meta.unread_count` och `items[].is_unread` i `GET /api/news` = oläst enligt beslut 4 **OCH** slaget är påslaget i betraktarens inställningar (ägarbeslut Ö2: på `/news` lyser bara valda slag som olästa; sidan och klockan visar samma tal). Det är en ren funktion i `isNotifiable` om det någon gång ska ändras.
- **Popovern** visar de fem senaste raderna vars slag är påslaget (lästa som olästa), filtrerat i klienten ur de redan laddade 30 raderna med SAMMA `classifyNotification` (inga extra endpoints). **Egna handlingar (`own`) visas inte i popovern** (ägarbeslut Ö3) — de finns kvar på `/news`. Är fönstret tomt efter filtrering visas "Nothing new for you" + länken till `/news`.
- **`/news`** visar alla rader, oförändrade filter, räknare per chip över det laddade fönstret.

### 4. Läst per rad: golv + `news_read` (B3, beslutat: ny tabell)
- **Golvet** `users.news_last_seen_id` (ADR 008) behålls oförändrat: allt med `id ≤ golvet` är läst. Det är det som gör att varje användare börjar utan `news_read`-rader vid utrullning (ingen backfill, ingen datamigrering).
- **Ovanför golvet** kvitteras enstaka rader i en ny tabell. Migration `<nr>_create_news_read` (additiv, före deploy):
```sql
create table if not exists public.news_read (
  user_id     uuid        not null references public.users(id) on delete cascade,
  activity_id bigint      not null references public.activity_log(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (user_id, activity_id)
);
create index if not exists news_read_activity_idx on public.news_read (activity_id);  -- cascade vid retract/retention
alter table public.news_read enable row level security;
revoke all on public.news_read from anon, authenticated;
```
`on delete cascade` från `activity_log` gör att en retractad rad (utmaning återkallad, badge förlorad, dagens `rank_passed` ångrad) städar sina kvitton av sig själv.
- **Oläst(U, rad)** = `rad.id > golvet` ∧ rad ∉ `news_read(U)` ∧ ¬`is_backfill` ∧ `created_at > users.created_at` ∧ `classifyNotification(rad, U)` är ett slag (inte `own`/`null`) ∧ slaget är påslaget. Beräknas i appen med EN ren funktion `isNotifiable` i shared (SSOT för server och klient), inte i SQL: servern läser de senaste 501 kandidatraderna (`id > golvet`, gruppen, ej backfill, `created_at > users.created_at`; kolumnerna `id,type,actor_user_id,target_user_id,payload`), användarens `news_read`-id:n ovanför golvet och inställningarna (tre queries parallellt, ersätter dagens två count-queries), och räknar. `unread_count` **mättas vid 500** (klockan visar "99+" över 99). Skäl mot SQL-predikat: slagen beror på `payload` (entrants, mått, andraplats) och skulle dubblera sanningen mellan SQL och klientens popover.
- **`POST /api/news/read`** body `{ ids: number[] }` (1–50 unika positiva heltal, annars 400). Servern slår upp vilka id:n som finns i anroparens grupp och ligger över golvet; övriga ignoreras tyst (ingen existensläcka, ingen FK-krasch för hela batchen); `upsert` med `ignoreDuplicates`; rader som redan är lästa ger inget. Svar: `{ unread_count }`. Idempotent.
- **`POST /api/news/seen` ("Mark all read")** oförändrat kontrakt: höjer golvet monotont (`up_to_id` eller senaste raden) och **raderar sedan `news_read`-rader med `activity_id ≤ nya golvet`** (pruning; best-effort — en misslyckad radering är ofarlig eftersom rader under golvet är inerta). `POST /news/read` rensar också rader ≤ golvet i samma anrop. Ingen schemalagd städning; revisit-trigger vid > 1 000 `news_read`-rader per användare (kompaktera golvet över det sammanhängande lästa prefixet).
- **Privat:** vad en användare läst exponeras aldrig för andra; inget endpoint returnerar `news_read` för någon annan.

**Läs-gester i UI (ägarbeslut B4).** En rad blir läst **direkt** (ingen väntetid; `READ_DWELL_MS = 0` som namngiven konstant så att en dröjsmålsregel kan införas utan omdesign) vid: musen/pennan över raden (`pointerenter`, `pointerType ≠ touch`), tangentbordsfokus på raden (`focusin` — raderna blir fokuserbara, `tabIndex=0`; Designer/a11y-granskning avgör tab-stoppens form), och touch (`pointerdown` på raden). Att raden rullar in i bild räknas INTE. "Mark all read" finns kvar i popover och på `/news`. Gäller både `/news` och popovern. **Optimistiskt:** raden och räknaren uppdateras lokalt i alla flödescacher i samma ögonblick (ren `markReadInFeed`, som `markSeenInFeed`); nätverksanropen buntas (högst var 300 ms eller vid avmontering, `READ_FLUSH_MS`) men UI:t väntar aldrig; fel återställer lokalt tillstånd tyst och nästa gest försöker igen. Rader som inte är olästa (lästa, `own`, avstängda, backfill) ger inget anrop. **Medvetet pris:** en snabb musrörelse över listan markerar passerade rader som lästa — det är ägarens val (B4) och styrs av den namngivna konstanten.

### 5. Inventering för B5: vad finns, vad saknas, var skrivs det
| Ägarens önskemål | Finns idag? | Åtgärd | Skrivpunkt |
|---|---|---|---|
| Någon tar en titel från dig | Ja: `title_taken`, target = förra innehavaren (även `reason: 'revoked'`) | Bara slaget | `emitTitleNews` (`titleNews.ts`) |
| Någon tar en titel där du låg tvåa (definition i beslut 7) | **Nej** — `title_taken` saknar andraplats och `emitTitleNews` snapshottar bara position 1 | Nytt additivt payloadfält `runner_up_user_id` (payload_version oförändrad) på `title_taken`, ur FÖRE-snapshotens andraplats i nya innehavarens grupp | `emitTitleNews` + `snapshotTitleHolders` (alla positioner ≤ 10, gruppfiltrerat via `users.group_id`) |
| Någon går förbi dig på leaderboarden | **Nej** | Ny typ `rank_passed`, mått `xp` (beslut 6) | `calculateUserTotals` + de två event-XP-skrivningarna i `eventService` (där `recordLevelUps` redan sitter) |
| Någon går förbi dig på utmaningsleaderboarden | **Nej** | `rank_passed`, mått `challenge_points` (beslut 6) | `settleChallenge`, efter W/D/L-uppdateringen |
| Någon utmanar dig | Ja: `challenge_received` | Bara slaget | `POST /challenges/send` |
| Någon vann över dig / du vann över någon | Ja: `challenge_won` (actor/target) | Slag + undantaget i beslut 3 | `settleChallenge` |
| Events du är delaktig i | Delvis: `event_open`/`event_closed` finns men deltagare saknas | Nytt additivt fält `entrant_ids: string[]` i `event_closed` (alla `event_entries.user_id` för eventet; högst gruppstorleken) | `settleCompetitionEvents`, `settleExpiredParticipationEvents` |
| (B8) Någon tackar ja till din utmaning | **Nej** — accept loggar ingenting | Ny typ `challenge_accepted` (beslut 7) | `PUT /challenges/:id/respond` (accept) |
| Övriga ("osv") | Ja: level/milestone/badge/streak/release | Bara slagen ("others") | befintliga |

Ordning och motivering finns i beslut 12.

### 6. `rank_passed`
**Händelse:** användare W går förbi användare M på ett rankingmått. Ny `ActivityType` `rank_passed`; `actor` = W (den som passerar), `target` = M (den som blir passerad), gruppen ur `users.group_id`.

**Payload v1:** `{ measure: 'xp' | 'challenge_points', passer_rank: number, passed_rank: number }` — rangerna EFTER passeringen (namn och bild hämtas live via actor/target). `RANK_MEASURES` är en konstant i shared; fler mått (veckotabellen, streak — ägarbeslut Ö9: senare) är additivt och kräver ingen ny typ. Inga Strava-uppgifter, ingen XP-siffra i payloaden.

**Mått och rangordning.** `xp` = All-time-tabellen: `users.total_xp` med komparatorn (xp fallande, namn stigande skiftlägesokänsligt, id) — samma som `rank-delta` och `compareByNameThenId` i shared. `challenge_points` (ägarbeslut Ö8: högre poäng, vinster som andra kriterium) = `(wins + draws × 0,5) / (wins + draws + losses)` fallande, därefter `wins`, därefter namn/id; en ny delad komparator i shared används även av `GET /challenges/group-stats` så att tabellen och detektionen aldrig kan skilja sig åt (tidigare saknade lika poäng en bestämd ordning). Vid bygget verifieras att Boardens All-time-sortering ger samma ordning som komparatorn (backend sorterar idag på `total_xp desc` utan tie-breaker); avviker den justeras Boarden, inte detektionen.

**Detektion (ren funktion `detectRankPasses` i shared, enhetstestad).** Anropas som observatör efter en lyckad skrivning, icke-kastande, i samma stil som `recordLevelUps` (ADR 008 beslut 5, ADR 005): W:s mått ökade; för varje annan gruppmedlem M gäller samtidigt:
1. **Korsning:** W låg bakom M före skrivningen och ligger före M efter den (rangen byter plats).
2. **Bara dygnsskiftets underlägsna:** W låg bakom M **vid dygnsskiftet** (Stockholm 00:00 idag). Det är den enda anti-spam-regel som behövs för pingis-passeringar (W förbi M kl 10, M förbi W kl 14, W förbi M kl 18 ger en rad kl 10; M:s återtagande kl 14 ger ingen rad eftersom M inte låg bakom vid dygnsskiftet).
3. **Max en rad per ordnat par, mått och Stockholm-dygn:** `dedupe_key = rank_passed:<measure>:<passerId>:<passedId>:<Stockholm-dag>` (ADR 008-mönstret, `activityKeys.rankPassed` i shared). Omkörning, överlappande instanser och upprepad passering samma dag ger aldrig en andra rad.
4. **Bara uppåt:** en minskning av W:s mått (raderad runda, omräkning, Strava-radering via ADR 010) skapar aldrig rader. Efter en minskning **retractas dagens egna rader** (`retractActivity` på dagens deterministiska nycklar för de M som W nu åter ligger bakom) så att flödet inte visar en passering som inte längre stämmer. Äldre dagars rader är historia och rörs inte. (Delbeslutet kan strykas utan att resten påverkas.)
5. **Medlemmar skapade efter dygnsskiftet** har ingen rang vid dygnsskiftet och passerar/passeras inte samma dag.

**Mått `xp` — dygnsskiftets rangordning och data.** Ur samma härledning som `rank-delta`: `buildXpLedger` + `buildRankDelta(users, ledger, asOf = idag i Stockholm)` ger `previous_xp`/`previous_rank` vid dygnsskiftet (total XP minus XP krediterad med datum ≥ idag). Ingen ny lagring och ingen ögonblickstabell. Detektionen körs bara när W:s `total_xp` faktiskt ökade, gruppen har fler än en medlem och `users.group_id` finns, så den vanliga skrivningen kostar några små queries bara vid XP-vinst (gruppmedlemmar; dagens `runs`; dagens `event_entries`); föregående `total_xp` läses i den befintliga `select` som redan hämtar `current_level, total_km, group_id`. **Känd begränsning:** liggaren är datumbaserad, så en runda daterad *igår* men synkad efter midnatt räknas som krediterad före dygnsskiftet och ger därför ingen rad (utebliven notis, aldrig falsk). Om det stör, ompröva (Revisit-triggers). Divergerar liggaren från `total_xp` för W eller M (`diverged` från `buildRankDelta`) hoppas paret över.

**Mått `challenge_points` — data.** Detektionen körs en gång per avgörande i `settleChallenge` efter W/D/L-uppdateringen. Bara de två deltagarnas mått ändras; en passering kräver att en deltagare *ökar* sitt mått och tar en plats av en tredje medlem eller av motståndaren (en förlorare som faller under någon räknas inte som att den andra "passerade" — bara en ökning som tar en plats ger rad). Poäng vid dygnsskiftet = nuvarande W/D/L minus utfall som avgjorts sedan dygnsskiftet; källa: `challenge_won`/`challenge_draw`-rader i `activity_log` med `occurred_at ≥ dygnsskiftet` (den enda faktiska avgörandetidsstämpeln — `challenges.determine_at` är den planerade tiden). Samma anti-spam-regler som `xp`.

**Undertryckning vid massomräkning.** (1) Regel 4 (bara uppåt) gör att omräkningar som sänker XP aldrig skapar rader. (2) `calculateUserTotals(userId, options)` får `options.emitRankNews` (default `true`); alla underhållsvägar som loopar över användare (admin-omräkning, framtida reprocess-skript, ADR 010:s eventuella mass-sync) anropar med `false` — samma mönster som `processAllUsersTitles({ emitNews: false })` för `/titles/reprocess-all`. (3) `reprocess-all` för titlar skriver redan inga nyheter (`emitNews:false`) och ska fortsätta göra det, inklusive den framtida `runner_up_user_id`-beräkningen. (4) Inget backfill-skript byggs: passeringar är inte härledbara i efterhand.

**Skrivpunkt.** `services/rankNews.ts` (ny, icke-kastande): `recordRankPassesForXp(userId, groupId, prevXp)` anropas från `calculateUserTotals` efter `recordRunMilestones` och från de två event-XP-skrivningarna i `eventService` efter `recordLevelUps`; `recordRankPassesForChallenge(challengeId)` från `settleChallenge` efter `recordChallengeSettled`. Skrivs via `recordActivities`.

### 7. Övriga nya fakta
- **`challenge_accepted`** (B8, beslutat: bara denna). `actor` = den som accepterar (motståndaren), `target` = utmanaren. Payload v1: `{ challenge_id, tier, metric, duration_days, start_date }`. `dedupe_key = challenge_accepted:<challengeId>`. Skrivs i `PUT /challenges/:id/respond` (accept) efter lyckad aktivering och `challenge_active`-flagga; en återställd aktivering (revert vid flaggfel) skriver ingen rad. Ingen retract behövs (en aktiv utmaning kan inte dras tillbaka). Kategori `challenge`, under Challenges-chipet.
- **`event_closed.entrant_ids`**: additivt fält i befintlig payload v1 (alla `event_entries.user_id` för eventet — användar-id:n som redan är synliga för gruppen; inga personuppgifter). Äldre rader saknar fältet och klassas `event_closed_others`. Backfillens `event_closed` lämnas utan fältet.
- **`title_taken.runner_up_user_id`** (våg 3). **Definition (ägarbeslut Ö4, 2026-10-13):** *"Om jag är två så jagar jag; om någon helt plötsligt dök upp bakom mig och tog titeln ändå, så vill jag veta det."* Alltså: användare R låg på **andra plats i titelns ranking inom gruppen** omedelbart FÖRE bytet, och titeln tas av en användare B som låg **bakom R** (tredje plats eller sämre, eller saknades på listan) och därmed gick om både förra innehavaren och R. R får en notis; slaget är `title_taken_runner_up`.
  - Fältet bär R:s id och sätts bara när alla villkor gäller: raden är en `title_taken` (inte `title_unlocked`), det fanns en andraplats i gruppen före bytet, och R ≠ B (om B själv var tvåa är det en vanlig omgång, inget fält). Annars `null`/utelämnat.
  - **Tvåan måste bevaras från ögonblicket före bytet.** Efter bytet har B tagit plats 1 och rankingen är omräknad, så R:s position går inte att läsa i efterhand. `snapshotTitleHolders` (som tar bilden FÖRE `processAllUsersTitles`) utökas därför från "position 1" till alla positioner (≤ 10 per titel, idag ~210 rader), och den rena `diffTitleHolders`/`buildTitleDrafts` får före-bilden som indata: R = den användare i före-bilden med näst bäst position bland användare i B:s grupp (`users.group_id`), eftersom `title_leaderboard` är global och position 2 globalt kan tillhöra en annan grupp. Finns bara en användare från B:s grupp i före-bilden finns ingen tvåa.
  - Fältet är ett additivt payloadfält (payload_version oförändrad). Dedupe-nyckeln ändras inte (R är inte med i nyckeln; samma byte upptäckt två gånger ger fortfarande en rad).
  - Bara titelbyten med `reason: 'overtaken'` ger normalt ett R; vid `reason: 'revoked'` (förre innehavaren uppfyller inte kravet) rykker R upp till plats 1 i rankingen, och då är det R som blir ny innehavare, inte B — ingen notis av detta slag.
  - Suppressas av `emitNews:false` som övriga titelrader.
  - Slaget levereras i våg 3 (beslut 12): definitionen är nu låst, men ändringen i `snapshotTitleHolders`/`diffTitleHolders` ligger i titelsystemet (zon 11) och är därför en egen story med eget risktest.
- **Typer som inte införs nu:** `challenge_declined`/`challenge_withdrawn` (utmaningen raderas vid avböjning; ett kvarlevande faktum skulle kräva en annan livscykel — ägarens val senare), `streak_at_risk` (tidsutlöst, meningslöst utan push), `sync_result` (Stravas synkresultat; ej gruppnyhet, Strava-hållningen).

### 8. API-yta (sammanfattning, ADR 007 A)
| Endpoint | Ny/ändrad | Not |
|---|---|---|
| `GET /api/settings`, `PUT /api/settings` | ny | beslut 2 |
| `POST /api/news/read` | ny | beslut 4 |
| `GET /api/news` | ändrad | `is_unread`/`meta.unread_count` följer `news_read`, inställningar och golv (kontraktstexten i `contracts/news.ts` uppdateras); nytt valfritt `involves=me` (beslut 9); `type=` validerar mot den utökade `ACTIVITY_TYPES` |
| `POST /api/news/seen` | ändrad (internt) | prunar `news_read` |
| `GET /api/challenges/group-stats` | ändrad (internt) | använder den delade komparatorn; samma svarsform |

### 9. Frontend: var inställningarna bor, "Involves me", filter, onboarding
- **En komponent, två platser (ägarbeslut B5):** `NotificationSettingsPanel` (grupperade switchar ur `NOTIFICATION_KINDS`, sektioner Titles / Challenges / Ranks / Events / The pack / System) monteras på **Settings** (nytt kort; undertexten blir "Strava, notifications and password"; copy från prototypen: "Everything still lands in Pack News — this decides what reaches you.") och på **notissidan `/news`** (desktop: i sidokolumnen under filtret; mobil: ett blad/sheet ur sidhuvudet — Designern avgör). Båda använder EN hook `useUserSettings` (query `['settings','user']`, optimistisk växling per switch, fel återställer och visar `role="alert"`; efter lyckad skrivning invalideras `['news','feed']` eftersom räknaren ändras serverside). Cachen är användarbunden och rensas redan av `AuthProvider` (hela cachen). Panelen ägs av `features/settings`; `features/news` importerar den (README:s regel om cross-feature-importer är riktning, inte sanning). Ny komponentyta = ny `designGroup` i lint (STATE: designspråket är lint sedan v0.6.1.3; `themeTokens.sync`/`lintScope`-testerna) — Designern registrerar den.
- **"Involves me" (ägarbeslut B6 + Ö5):** `involvesMe(item, viewer)` = viewer är `actor` eller `target`, **samt** `event_closed` där `entrant_ids` innehåller viewer (annars skulle "events du är delaktig i" aldrig hamna i filtret). Visas på `/news` som en separat toggle (inte ett typfilter) i adressen `?involves=me`, kombinerbar (AND) med typchips; servern tar `GET /news?involves=me` (actor/target via `or()`, `entrant_ids` via `payload @>`; uttrycket får väljas av implementatören — semantiken är låst, inte SQL-formen). Det är en vy-filtrering, helt skild från notisslagen.
- **Filter (B7, beslutat: ja):** nytt chip **Ranks** för `rank_passed` (kategori `rank`, egen färgtoken och ikon från Designern); `challenge_accepted` ligger under Challenges. `NEWS_FILTERS`/`CATEGORY_OF`/`describeNews` får nya cases (exhaustive `switch`, `never`-kontrollen och filter-testet tvingar fram det), `countByFilter` får en nyckel. Sju chips på mobil kräver att chip-raden fortsatt scrollar (Playwright-kandidaten i news/README).
- **Texter** (engelska, renderas i `newsModel` ur typ + payload + betraktare): "Karl passed you on the leaderboard" / "You passed Karl on the leaderboard" (mått och rang), "Karl accepted your challenge — it starts tomorrow"; för våg 3: "Karl took The Early Bird from Anna — you were runner-up". Slutlig copy av Designern/Refinern.
- **Onboarding (ägarbeslut B5):** (1) nuvarande tour `tour_news_v1` byts mot **`tour_news_v2`** (samma konvention som `tour_events_v2`: slug bumpas när stegen ändras så att alla ser den igen; `useOnboardingQueue` och `featureTourSteps` uppdateras) med nya steg: *Notification settings* (ankare `news-settings`, "choose what the bell counts — this page always shows everything"), *Hover, focus or tap to read* (förklarar den nya läs-gesten, den enda stora beteendeförändringen) och *Mark all read* (oförändrat); stegen följer befintliga regler (turen monteras bara när flödet har rader). (2) Release-notisen "What's new" (`changelog.json`, `announce: true`) pekar på Settings → Notifications för dem som inte besöker `/news`. (3) Settings-kortet har en kort förklaringsrad. Ingen ny onboarding-mekanism behövs: `user_seen_items` används oförändrat för tour-slugen.

### 10. Migrationssekvens (numreras vid bygget)
Senaste fil i repot är 042; 043 är RUN-225:s och ADR 010 tar också nummer, så **numren tilldelas vid bygget** (nästa lediga över repo OCH ledger, `list_migrations` före apply). Alla tre är additiva (expand), körs via MCP `apply_migration` efter ägarens uttryckliga ja per migration, filerna committas i release-PR:en.

| Ordning | Migration | Innehåll | Relativt deploy | Konsekvens om fel ordning |
|---|---|---|---|---|
| 1 | `<nr>_create_user_settings` | tabellen i beslut 2 | **FÖRE deploy** | Ny backend: `GET/PUT /api/settings` ger 500; `GET /news` läser inställningar — ett läsfel faller tillbaka på defaults (loggas), men PUT fungerar inte |
| 2 | `<nr>_create_news_read` | tabellen i beslut 4 | **FÖRE deploy** | Ny backend: `GET /news` och `POST /news/read` ger 500 (oläst-beräkningen läser tabellen) — klockan och `/news` bryts tills tabellen finns |
| 3 | `<nr>_activity_log_rank_passed_challenge_accepted` | släpp + lägg om `activity_log_type_check` med `rank_passed`, `challenge_accepted` (15 värden); idempotent `drop … if exists`, ingen egen transaktion (ADR 009 036/041-mönstret) | **EFTER deploy** (backend + frontend live) | Körs den före deploy ändras inget synligt förrän nya backend går live, men nya backend kan då skriva de nya typerna några sekunder innan nya frontend är live (Railway deployar tjänsterna oberoende); äldre flikar får okända typer — tåls sedan RUN-138, men v0.5.3-flikar kraschade (samma resonemang som ADR 009 addendum, migration 036). Efter deploy och före 3 misslyckas bara `rank_passed`/`challenge_accepted`-skrivningarna tyst (best-effort, loggas) |

Ordning vid release: 1 → 2 → merge/deploy → rök → 3. Mellan deploy och 3 saknas bara de nya raderna (högst några minuter). `activityLogMigration.test.ts` kräver att senaste CHECK-migrationen == `ACTIVITY_TYPES`; filen för 3 committas i samma PR som typerna (testet läser disken, inte ledgern). Ny frontend mot gammal backend (kort fönster): inställningspanelen visar felkort, hover-kvittering misslyckas tyst och återställs; gammal frontend mot ny backend fungerar (räknaren följer de nya reglerna, ingen hover-kvittering). **Rollback:** koden ångras med föregående release (tabellerna är additiva och ignoreras av gammal kod; släpps i en senare städning efter ja). Migration 3 ångras bara efter att de nya typernas rader raderats (`delete from activity_log where type in ('rank_passed','challenge_accepted')`, ask). Inga data migreras: tom `user_settings` = defaults, tom `news_read` + befintligt golv = dagens läge. Våg 3 (`runner_up_user_id`) kräver ingen migration (jsonb-payload).

### 11. Best-effort kontra outbox (utanför epicen)
Notisraderna skrivs som all annan logg: best-effort efter den underliggande skrivningen, icke-kastande, fel loggas och sväljs (ADR 008 beslut 4). Det består i denna ADR eftersom en missad rad bara är en saknad nyhet i en polled, in-app-vy som ändå är "display-grade" (ADR 008 konsekvenser, risk 2). **Utanför epicen RUN-9 men nämnt som villkor:** i samma stund en kanal som kan *missa en händelse för alltid* tillkommer (push, e-post, digest) räcker inte best-effort — då behövs en outbox/retry (skriv avsikt före eller atomiskt med händelsen, via RPC eftersom supabase-js saknar flerstegstransaktioner, och en leverantör som läser outboxen). ADR 008 beslut 11.6 pekade redan ut det som skälet att öppna frågan. Denna ADR ändrar inget där; `recordRankPasses…` och övriga nya skrivpunkter följer best-effort-modellen.

### 12. Ordning: vad ryms i v0.7.0, vad är senare
Motivering i omfång och risk. v0.7.0 är redan stor (51 stories, Strava-webhooks är den tunga posten) och notisskrivpunkterna ligger i skrivvägen (STATE zon 1). **Ägarbeslut 2026-10-13: våg 1 och våg 2 ingår i v0.7.0.**

**Vågordning:**
- **Våg 1 — grunden (v0.7.0, kärna):** registret + `GET/PUT /api/settings` + `user_settings`; `news_read` + `POST /news/read` + golv + pruning + `isNotifiable`; slagen som bygger på fakta som redan finns (`title_taken_from_me`, `title_others`, `challenge_received_me`, `challenge_lost_me`, `challenge_won_me`, `challenge_draw_me`, `challenges_others`, `event_open`, `event_closed_others`, `level_up_others`, `run_milestone_others`, `badge_earned_others`, `streak_broken_others`, `release_published`); popover/klockfiltrering; Settings-kortet och panelen på `/news`; läs-gesterna; "Involves me"; onboarding. *Risk låg:* mest läsväg; skrivvägarna rörs inte.
- **Våg 2 — nya fakta med inneslutna skrivpunkter (ingår i v0.7.0; försenas den kan den brytas ut till v0.7.1 utan att våg 1 påverkas):** `rank_passed` mått `xp` (en observatör i `calculateUserTotals` + två event-XP-skrivningar), `rank_passed` mått `challenge_points` (en observatör i `settleChallenge` + den delade komparatorn i `group-stats`), `challenge_accepted` (en rad i `/respond`), `event_closed.entrant_ids` (en rad i två befintliga skrivpunkter), `challenge_accepted_me`/`rank_passed_*`/`event_closed_me` som slag, samt chip Ranks. Migration 3 hör till denna våg. *Risk medel:* `calculateUserTotals` får en tredje sidoeffekt (efter badges och nivå-/milstolpe-loggen), men den är icke-kastande, gatad på XP-vinst, och `rank-delta`-liggaren är redan byggd och testad.
- **Våg 3 — senare utökning (egen story, förslagsvis först i v0.7.1; ej i v0.7.0):** `title_taken_runner_up` ("låg tvåa", definition i beslut 7 — nu otvetydig), `challenge_declined`, rank-mått för vecko- och streaktabellerna, allt som kräver push/outbox. Risken för "låg tvåa" bedöms fortfarande som hög trots att definitionen är låst: (1) snapshoten som tas före `processAllUsersTitles` ska gå från ~21 rader (position 1) till alla positioner (~210 rader) och tvåan ska bevaras fram till diffen — en ändring i titelsystemet, STATE zon 11 (leaderboard uppdateras tre gånger per skrivning, snapshot tas före första); (2) rankingen är GLOBAL (topp 10 över alla grupper), så andraplatsen måste filtreras på grupp och kan saknas om gruppens tvåa ligger utanför topp 10 (ofarligt med en grupp, kräver åtgärd vid multi-grupp); (3) den påverkar `diffTitleHolders`, vars regressionssvit (RUN-98) måste hållas intakt. Reglaget syns inte i UI förrän dess fakta skrivs (beslut 1.3). Utmaningstokens, XP och regler berörs inte.

### 13. Strava-hållningen, behörigheter, dataskydd
1. **Ingen AI/ML.** Alla regler (klassificering, passeringsdetektion, mått) är deterministiska, rena och enhetstestade.
2. **Gruppavgränsning från dag ett:** `POST /news/read` ignorerar id:n utanför anroparens grupp; `GET /news` är redan gruppavgränsat; settings och `news_read` är strikt per användare. Ingen endpoint exponerar någon annans läst-status eller inställningar.
3. **Ingen Strava-rådata** i notiser: `rank_passed`-payloaden har mått och rang, inte XP-siffror, tider, platser eller aktivitets-id:n. Härledd spelmekanik, som `badge_earned`.
4. **Raderingar slår igenom:** minskar W:s XP efter en raderad (Strava-)runda retractas dagens `rank_passed`-rader (beslut 6.4); ADR 010:s webhook-handler ska gå via `calculateUserTotals` (som ADR 009 beslut 9.4 redan kräver) och därmed inte kringgå detektionen.
5. **Ny datalagring — flaggad (hård gräns):** två nya tabeller (`user_settings`, `news_read`) i produktionsdatabasen och tre migrationer som kräver ägarens ja. `user_settings` innehåller preferenser (låg känslighet). `news_read` är beteendedata (vad en användare läst) och privat per användare; ingen annan användare eller endpoint kan läsa den. Ingen extern datalagring, inga betalningar.
6. **Skrivrättigheter:** endast backend (service role); `PUT /api/settings` och `POST /news/read|seen` skriver bara anroparens egna rader; `rank_passed`/`challenge_accepted` skrivs bara av `services/rankNews.ts` respektive `challenges.ts` via `activityLog.ts`.

### 14. Ej avgjorda punkter — ägarens beslut 2026-10-13 (alla rekommendationer godkända)
| Pkt | Fråga | Beslut | Skäl |
|---|---|---|---|
| **B1** | Inställningar: kolumn `users.settings jsonb` eller tabell | **Tabell `user_settings`** (beslut 2) | Atomär upsert per nyckel — reglage trycks i följd och en JSON-kolumn tappar uppdateringar utan en PL/pgSQL-merge; "återställ" = radera rad; rör inte den känsliga `users`-tabellen; samma form fungerar för gruppomfång. Pris: en extra liten query vid läsning. |
| **B3** | Per-rad-kvitto: ny `news_read` eller återanvänd `user_seen_items` | **Ny `news_read`** (beslut 4) | `user_seen_items` är text-slugs för onboarding och returneras i sin helhet av `GET /onboarding/status` vid varje appstart — hundratals `news_<id>`-slugs skulle blåsa upp den och blanda två betydelser; ingen FK mot `activity_log`; `news_read` får cascade-radering gratis. |
| **B7** | Eget filterchip för `rank_passed` | **Ja, chip "Ranks"** (beslut 9) | `/news` visar allt och användare filtrerar per slag; passeringar är varken nivåer eller titlar. Pris: sjunde chip på mobil (raden scrollar redan). |
| **B8** | Fler utmaningshändelser | **Bara `challenge_accepted`** (beslut 7) | Accept är det ögonblick utmanaren väntar på; decline/withdraw raderar utmaningen (ingen fakta kvar) och en "X tackade nej"-notis är socialt laddad. |
| **B9** | Prototypens uppskjutna inställningar | **De tre skjuts upp:** "Streak at risk", "Title you can claim", "Strava sync results" | "Streak at risk" är tidsutlöst och värdelös utan push; "Title you can claim" överlappar `title_unlocked`/`title_taken`; "Strava sync results" är inte en gruppnyhet och rör Strava-data. De återkommer med push/outbox (beslut 11). |
| **B10** | "Designlägen" | **Litet designspår före frontend** (tolkning: vilka designbeslut som krävs innan UI-storyerna startar) | Fyra leveranser: (1) inställningspanelen (switchrad, sektioner, två monteringar inkl. mobilbladet), (2) läs-lägena (hover, fokus, touch, läst/oläst) för rad och popover-rad, (3) `rank_passed`-raden, kategorifärg, ikon och chip, (4) onboardingstegens placering och copy. Utan (1) och (2) kan panel- och läs-storyerna inte byggas. |

### 15. Teststrategi (ADR 001, Produkt-läge)
| Vad | Nivå | Innehåll |
|---|---|---|
| Settings-registret | Enhetstest (shared) | unika nycklar; varje default giltig för sin typ; varje notisslag har nyckel, label, grupp, roll; `resolveSettings` (saknad = default, fel typ → default, okänd lagrad nyckel ignoreras); `sanitizePatch` (okänd nyckel/fel typ/fel scope → fel, `null` = reset, > 40 nycklar → fel) |
| `classifyNotification` + `isNotifiable` | Enhetstest (shared), tabelldrivet | alla typer × {jag aktör, jag mål, annan, aktör null, raderad användare}; `entrant_ids`, `runner_up_user_id`, `measure`; undantagen `challenge_won_me`/`challenge_draw_me`; **ett kontraktstest kräver att varje `ActivityType` är klassificerad** (en ny typ utan klassificering fäller testet, som `describeNews`s `never`); avstängt slag → inte notis; backfill, före `users.created_at`, ovanför/under golvet, i `news_read` |
| `detectRankPasses` | Enhetstest (shared) | korsning; pingis (W förbi M, M förbi W, W förbi M → en rad); passeraren låg inte bakom vid dygnsskiftet → ingen rad; lika XP/poäng; nytt dygn → ny nyckel; minskning → ingen rad + retract-nycklar; ny medlem; `diverged` → hoppas över; nyckeln `activityKeys.rankPassed` stabil |
| Andraplats vid titelbyte (våg 3) | Enhetstest (shared) | tvåa ur före-bilden i nya innehavarens grupp; tvåa i annan grupp ignoreras; B själv tvåa → inget fält; `title_unlocked` → inget fält; `reason: 'revoked'` → inget fält; bara en gruppmedlem på listan → inget fält; `diffTitleHolders` oförändrat beteende för befintliga fall (RUN-98-sviten grön) |
| Komparatorn för utmaningstabellen | Enhetstest (shared) + route-test | `group-stats` ger deterministisk ordning vid lika poäng/vinster |
| `GET /api/settings`, `PUT /api/settings` | Route-test (supertest mot `createApp()`) | 401; defaults för ny användare; `null` återställer; okänd nyckel 400; gruppscope-nyckel 400; en användare ser aldrig en annans värden; wiring-testet täcker routern |
| `POST /api/news/read` | Route-test | 401; > 50 ids/ogiltiga ids → 400; id i annan grupp ignoreras (inget fel, ingen rad); idempotent; id ≤ golvet ger ingen rad; räknaren sjunker; `seen` prunar `news_read` ≤ nya golvet; golvet kan inte sänkas |
| `GET /api/news` (oläst) | Route-test | räknaren följer inställningar och `news_read`; `is_unread` per rad; mättning vid 500; `involves=me` (actor/target/entrants); dagens oläst-tester behålls (egen handling, backfill, före `created_at`) |
| Skrivvägen (zon 1) | Beteendetest i samma PR | `calculateUserTotals` sparar totaler och loggar även när `recordRankPassesForXp` kastar; anropas efter totalskrivningen; `emitRankNews:false` skriver inget; ingen XP-vinst → inga extra queries; event-XP-vägarna anropar detektionen |
| `settleChallenge` / `respond` | Beteendetest | `rank_passed(challenge_points)` en gång vid avgörande, omkörning ger ingen dubblett; `challenge_accepted` skrivs vid accept och inte vid reverterad aktivering |
| Migrationerna | Statiskt test | `user_settings`/`news_read`: RLS på, inga policyer, `revoke` från anon/authenticated, PK, FK med cascade, additiva; migration 3: CHECK-listan == `ACTIVITY_TYPES` (det befintliga testet läser redan "senaste definierande" migration) samt en kontroll av 15 värden och additivitet som för 036/041 |
| Frontend (model) | Vitest (rena `.test.ts`) | `markReadInFeed` (flippar bara olästa, räknaren), buntning av id:n (300 ms/avmontering), `describeNews`/`CATEGORY_OF`/`NEWS_FILTERS` för de nya typerna (filter-testet "varje typ i exakt ett filter"), `parseFilterParam` med `ranks`, popover-filtrering och tomläge |
| Frontend (komponenter) | RTL | hover/focus/touch på rad i `/news` och popover markerar läst direkt och anropar inte nätverket för redan lästa; panelen: optimistisk switch, fel återställer och annonseras, samma panel på båda sidorna; `tour_news_v2`-stegen och kön |
| E2E (Playwright) | Ej nu | Villkorat av icke-prod-miljö (ADR 001); Playwright-kandidater: chip-radens scrollbredd med sju chips, hover-läst med riktig pekare |

## Konsekvenser
- **Ny datalagring — flaggad (hård gräns):** `user_settings` och `news_read` (två nya tabeller) samt en utökad CHECK på `activity_log` i produktion. Tre migrationer, ägarens uttryckliga ja per migration (ask). Ingen känslig personuppgift, men `news_read` är privat beteendedata. Volym: ≤ 20 `user_settings`-rader per användare och några tiotal `news_read`-rader (prunas vid "Mark all read"). Se beslut 13.5.
- **Inga externa tjänster, ingen kostnad** (ingen 15c-flagga).
- **Produktionsrisk (zon 1):** `calculateUserTotals` får en tredje observatörs-sidoeffekt (rank-detektion); mildras av icke-kastande, gating på XP-vinst och att rank-liggaren redan är byggd och testad (`rank-delta`). `settleChallenge` får en observatör efter W/D/L. `GET /news` byter två count-queries mot tre läsningar (+1 query) och ett skanningstak på 501 rader. Titelsystemet rörs inte i 0.7.0 (våg 3 gör det).
- **Beteendeförändringar användare märker:** (1) hovra/fokusera/trycka på en rad markerar den läst direkt (förklaras i touren och "What's new"); (2) popovern slutar visa egna handlingar och rader av avstängda slag; (3) `/news` tonar bara de rader klockan räknar. Defaults gör att räknaren i övrigt är densamma som idag.
- **Positivt:** inställningarna lagras och utvärderas på ett ställe; kontraktet "fakta, inte mottagare" består, så en framtida push läser samma register; nya notisslag är en rad i registret + en skrivpunkt; `news_read` städas av cascade; mönstret går att återanvända för gruppomfång (nedan).
- **Negativt/risker:** (1) hover-läst kan markera rader av misstag (ägarens val, styrs av `READ_DWELL_MS`). (2) `rank_passed` missar en passering vars XP är daterad före dygnsskiftet men synkad efter midnatt (utebliven notis, aldrig falsk). (3) `unread_count` mättas vid 500. (4) 20 reglage är många; "others"-slagen kan visas som en hopfällbar sektion (Designern). (5) Tabellerna måste finnas före deploy (beslut 10). (6) Den delade komparatorn ändrar `group-stats`-ordningen vid exakt lika poäng (bara till det bättre: förut odefinierad). (7) Fönstret före migration 3: de nya raderna saknas tyst. (8) Racen i `POST /news/seen` mot samtidiga `POST /news/read` är ofarlig (golv monotont, kvitton ovanför är idempotenta).
- **Fynd utanför scope:** `GET /titles/user/:userId` saknar gruppkontroll och `title_leaderboard` är global (kända, zon 8) — relevant för "låg tvåa" (våg 3). `/auth/recalculate-totals` låter vem som helst köra sin egen omräkning; ofarligt för detektionen (ingen XP-vinst, inga rader).
- **Gruppomfång (RUN-94, framtida; inget byggs):** registret bär `scope: 'group'` från start, så XP-regelpaketet kan landa som `xp.ruleset` (enum: standard + de tre varianterna) och en "on"-flagga per grupp utan omskrivning. Återanvänds: samma `resolveSettings`/`sanitizePatch(scope)`, samma sparse-form i en `group_settings(group_id, key, value, updated_at)`-tabell (FK `groups`, cascade, RLS utan policyer), en router `routes/groupSettings.ts` på `/api/groups/settings` som läses av medlemmar men skrivs av admin (`requireAdmin`), och samma frontendmönster (hook + optimistisk panel). Skiljer sig: skrivrättighet (admin, inte medlem), cache-nyckel per grupp och att regelvärden är *ägarbeslut* (ändring av XP-regler kräver separat ADR; ADR 004/005). Kopplingen till RUN-94:s förarbete "per-grupp-inställningar först" är att den här ADR:n etablerar registret, upplösningsregeln (saknad = default) och sparse-lagringen som förarbetet behöver.
- **Arkitekturdiagram (ej ändrat här; ADR 010:s arkitekt ändrar diagramkällan för båda ADR:erna):** när koden byggs ska `docs/architecture/runquest-architecture.json` omfatta: Data-kortet (rad ~47, `activity_log`/`GET /api/news`) får "Notiser (ADR 011): `user_settings` (sparse, per användare × nyckel) via `GET/PUT /api/settings`; `news_read` (per-rad-kvitto ovanför golvet `users.news_last_seen_id`) via `POST /api/news/read`; oläst = golv ∧ ej i `news_read` ∧ slaget påslaget (delad `isNotifiable`); `rank_passed` och `challenge_accepted` loggas best-effort i activity_log (rank-detektion som observatör i `calculateUserTotals`/`eventService`/`settleChallenge`); ingen anon-åtkomst"; tabellräknaren i `db`-komponenten 26 → 28 när de två migrationerna körts (Lead); `rq-2-rundans-vag.json` (runda → `calculateUserTotals`) får `rankNews` som tredje observatör. HTML genereras om (archify) av Lead. Under bygget rörs diagrammet inte.
- **STATE.md-ändringar att föreslå (Lead skriver):** (1) ADR-index: raden nedan. (2) Stack/DB: "28 tabeller efter migration <nr1>+<nr2>". (3) Kritiska flöden: flöde 8 (Pack News) får tillägget "klockan = notiser enligt `user_settings`; läst per rad via `news_read`; Rök: slå av ett slag → räknaren sjunker; hovra en oläst rad → läst direkt; logga en runda som tar någon förbi → en `rank_passed`-rad (max en per par och dygn)". (4) Konventioner: "Användarinställningar: typat register i `packages/shared/src/settings.ts` (saknad nyckel = default), sparse tabell `user_settings`; notisslag klassificeras av `classifyNotification`/`isNotifiable` (shared)"; "Observatörer efter totalskrivning: levels/milstolpar (ADR 008), badges (ADR 009), rank_passed (ADR 011) — alla icke-kastande". (5) Zon 1: `calculateUserTotals` har nu tre best-effort-sidoeffekter. (6) Ordlista: "notis/notisslag → `notify.<slag>`, `NOTIFICATION_KINDS`; läst → `news_read`". (7) Behörigheter: tre migrationer = ask. (8) `docs/open-assumptions.md`: raden om Settings → Notifications ("ej byggt") ersätts när detta byggs; ADR 006 beslut 4:s anmärkning om notisinställningar är därmed uppfylld.
- **Jira (inget skrivet):** epic RUN-9 finns (fixVersion v0.7.0). Våg 3 (förslagsvis v0.7.1) bör få egen story/epic; ägarens ordning vinner. Beroenden på andra epics: migrationsnummer mot RUN-225 och ADR 010; `calculateUserTotals`/`eventService` delas med RUN-93 (Strava-webhooks) — konfliktyta, sekvensera mergar.

## Avvisade alternativ
- **`users.settings jsonb` (B1).** Avvisat: förlorade uppdateringar vid snabba växlingar utan PL/pgSQL-merge, och ännu en kolumn i den känsliga tabellen.
- **`user_seen_items` med slugs `news_<id>` (B3).** Avvisat: blåser upp onboarding-svaret, ingen FK/cascade, två betydelser i samma tabell.
- **Skriva en rad per mottagare (inkorg).** Avvisat redan i ADR 008; inställningar som tillämpas vid läsning ger samma resultat utan att duplicera fakta.
- **Tillämpa inställningarna vid skrivning (skriv bara rader som någon vill ha).** Avvisat: raden är gruppens faktum och `/news` ska visa allt (B2); en ändrad inställning skulle inte kunna tillämpas bakåt.
- **Oläst-predikatet i SQL (`.or()` över slag).** Avvisat: slagen beror på `payload` (entrants, mått, andraplats), och klientens popover skulle ändå behöva samma logik — två sanningar. Appfunktionen i shared är en.
- **Dröjsmål innan hover räknas som läst.** Avvisat av ägaren (B4: direkt); konstanten `READ_DWELL_MS` finns om det ändras.
- **"Läst" vid scroll-in-i-bild (IntersectionObserver).** Avvisat: ägarens gester är hovra/fokus/touch; synlighet betyder inte att man läst, och skulle tömma klockan på en lång lista.
- **Ögonblickstabell för dygnsskiftets rangordning.** Avvisat (YAGNI): ordningen vid dygnsskiftet härleds ur `rank-delta`-liggaren utan lagring; omprövas om den datumbaserade begränsningen stör.
- **Detektera passeringar med en DB-trigger på `users.total_xp`.** Avvisat av samma skäl som ADR 005/008 avvisade triggrar för härledd data: osynlig domänlogik, två skribenter, svårtestad; och eventets `increment_event_xp` kringgår ändå `calculateUserTotals`.
- **`rank_passed` per rangändring (inte per par och dygn).** Avvisat: spam vid pingis-passeringar och vid varje runda nära en granne.
- **Notisslag med OR-semantik (en rad kan matcha flera reglage).** Avvisat: "Alla titeländringar" på + "Titel tagen från dig" av skulle ändå larma; exklusiv klassificering gör varje reglage meningsfullt.
- **Läsa tvåan efter titelbytet (i stället för att bevara den från före-bilden).** Avvisat: efter bytet är rankingen omräknad och R:s tidigare position går inte att återskapa; titelrankingen skrivs över (ADR 008 kontext).
- **Bygga hela B5-listan i en våg.** Avvisat som tvång: "låg tvåa" berör titelsystemets zon 11 och global ranking; våg 3.

## Avgjorda frågor (ägaren 2026-10-13, alla enligt rekommendation; ersätter "Öppna frågor")
- **Ö1 Defaults:** som idag (allt på, egna handlingar undantagna), utom `rank_passed_others` som är av.
- **Ö2 `/news` och oläst:** bara valda slag lyser och räknas som olästa; sidan och klockan visar samma tal.
- **Ö3 Egna rader i popovern:** popovern visar inga egna handlingar; de finns kvar på `/news`.
- **Ö4 "Titel där du låg tvåa":** *"Om jag är två så jagar jag, om någon helt plötsligt dök upp bakom mig och tog den ändå så vill jag veta det."* Definition: jag låg tvåa i titelns ranking inom gruppen, och titeln tas av någon som låg bakom mig. Låst i beslut 7; levereras i våg 3 (se beslut 12).
- **Ö5 "Involves me" för events:** events man deltagit i räknas med (utöver aktör eller mål).
- **Ö6 Omfång:** våg 1 + våg 2 ingår i v0.7.0 (våg 2 kan brytas ut till v0.7.1 om den försenas); våg 3 senare.
- **Ö7 Egna asynkrona utfall:** inga notiser om egen streak eller egen badge.
- **Ö8 "Förbi" på utmaningstabellen:** högre poäng, vinster som andra kriterium.
- **Ö9 Vecko- och streakmått:** senare (samma typ, nytt mått).
- **Ö10 B1, B3, B7, B8, B9, B10:** alla rekommendationer godkända (beslut 14).

## Revisit-triggers
- Push, e-post eller realtid byggs → outbox/retry i stället för best-effort (beslut 11), SSE/after-kursor, digest; `is_backfill` förblir aldrig notis.
- Fler grupper → gruppscope-register (`group_settings`), gruppavgränsade mått för `rank_passed`, ompröva gruppfiltret för titlars andraplats (topp 10 är global).
- RUN-94 (XP-regelpaket per grupp) tas → gruppomfånget i konsekvenserna blir en riktig ADR med ägarbeslut om reglerna.
- Misstag i hover-läst rapporteras → sätt `READ_DWELL_MS > 0` (konstant) eller kräv fokus/klick på touch.
- `news_read` överstiger ~1 000 rader per användare eller `unread_count` mättas ofta → kompaktera golvet över det sammanhängande lästa prefixet.
- Uteblivna `rank_passed` för synkade rundor daterade före midnatt stör → ersätt liggaren med en dygnsskiftes-snapshot (liten tabell) eller räkna på `runs.created_at`.
- Strava-webhooks (ADR 010) byggs → bekräfta att raderingar går via `calculateUserTotals` (retract av dagens `rank_passed`) och att mass-synk använder `emitRankNews:false`.
- Fler rankingmått (Week, Streaks) eller fler utmaningshändelser (declined/withdrawn) → additiva mått/typer enligt registret; `ACTIVITY_TYPES` + CHECK + klassificering i samma PR.
- Ägaren vill ha fler än on/off per slag (t.ex. "bara om det rör mig") → registret stödjer `enum`; slagen slås ihop till tre-läges-reglage utan datamigrering.

---

## Föreslagen STATE.md-indexrad
```
  011 · Godkänd · Personliga notiser: in-app (klocka + popover), pull; inställningar i typat register (packages/shared/settings.ts, saknad nyckel = default) lagrade sparse i tabell user_settings (GET/PUT /api/settings); notisslag = exklusiv klassificering per rad ur betraktarens perspektiv (classifyNotification/isNotifiable i shared), inställningarna tillämpas vid läsning och styr KLOCKAN (räknare + popover; inga egna rader i popovern) medan /news visar allt (bara valda slag lyser); läst per rad: golvet users.news_last_seen_id + tabell news_read (hover/fokus/touch = läst direkt, Mark all read kvar, pruning); ny typ rank_passed (mått xp + challenge_points; max en rad per par/mått/Stockholm-dygn, bara om passeraren låg bakom vid dygnsskiftet, bara uppåt, dagens rader retractas vid minskning, emitRankNews:false vid massomräkning) och challenge_accepted, event_closed.entrant_ids, chip Ranks, "Involves me" (inkl. events); v0.7.0 = våg 1+2, "låg tvåa" (title_taken.runner_up_user_id, tvåan bevarad ur före-bilden) = våg 3; migrationer user_settings + news_read FÖRE deploy, CHECK-migration EFTER deploy (nummer vid bygget, ask); best-effort består, outbox först med push; gruppscope (RUN-94) återanvänder registret
```

---

## Addendum 2026-10-14 (ägarbeslut efter Design Council): läs-gesten i beslut 4 (B4) ändras
Ändrar bara **läs-gesterna** i beslut 4 ("Läs-gester i UI (ägarbeslut B4)"). Allt annat i beslut 4 (golv + `news_read`, `POST /news/read`, optimistisk uppdatering, buntning med `READ_FLUSH_MS`, "Mark all read") och resten av ADR:n gäller oförändrat. Ingen ADR ersätts; detta är en ändring av ADR 011:s eget beslut, med ägaren som beslutsfattare. Arkitekturdiagrammet ändras inte (inga nya runtime-komponenter eller kopplingar). Ingen kostnad, ingen ny datalagring, ingen migration.

### Beslut B4, ny lydelse
En rad blir läst **direkt** (ingen väntetid) av följande, och av inget annat:
- **Mus (och penna som hovrar):** hover (`pointerenter`, `pointerType ≠ touch`) räknas som läst direkt, men **först efter verklig pekarrörelse**. `pointerenter` ignoreras under ca 150 ms efter montering av listan (namngiven konstant i samma modul som `READ_DWELL_MS`, förslagsvis `POINTER_SETTLE_MS = 150`), så att en pekare som råkar vila över raden när popovern eller listan öppnas inte markerar den läst.
- **Touch:** en **tap**, alltså `pointerup` utan rörelse på raden, markerar läst. `pointerdown` markerar inte längre (en scroll som börjar på en rad ska inte tömma den).
- **Tangentbord och hjälpmedel:** **fokus markerar inte läst** (`focusin` som läs-gest utgår). **Enter eller Space** på raden markerar läst (rad-elementets aktivering, `click`, så att samma väg tas av tangentbord och av skärmläsare som aktiverar utan att flytta fokus).
- **"Mark all read"** finns kvar i popovern och på `/news`, oförändrat.

Att raden rullar in i bild räknas fortfarande INTE. Gäller både `/news` och popovern. `READ_DWELL_MS = 0` gäller **oförändrat för hover efter rörelsevakten**: när 150 ms-fönstret passerat och pekaren rört sig markeras raden utan ytterligare dröjsmål. De två konstanterna är olika saker: `READ_DWELL_MS` är väntetiden *efter* en giltig hover, den nya konstanten är fönstret *efter montering* där hover ignoreras.

### Raden som element och tillgänglighet
- Raden är inte längre `li tabIndex=0` utan en **`button`/grupp med ett tydligt tillgängligt namn** (händelsetexten och läst-/oläst-läget). Tab-stoppet och aktiveringen kommer från elementet självt, inte från ett påtvingat `tabIndex`. Detta ersätter "raderna blir fokuserbara, `tabIndex=0`" i beslut 4 (Designer/a11y-granskningen som beslutet väntade på är gjord).
- **Polite live-uppdatering av oläst-räknaren** (`role="status"`/`aria-live="polite"`, inte `assertive`). Annonseringen bör debouncas så att en svepning över flera rader inte ger en tirad av tal; formen avgör implementatören.

### Skäl (Design Councils tillgänglighetsroll)
1. **Ett Tab-svep skulle nollställa alla olästa.** Med fokus = läst går en enda svepning genom listan förbi varje rad och markerar alla, utan att användaren läst något.
2. **Skärmläsare med virtuell markör flyttar aldrig fokus** och skulle därför aldrig markera något läst. Aktivering (Enter/Space/`click`) är gesten som fungerar för dem.
3. **En pekare som vilar över en rad när popovern öppnas** markerade raden läst utan att användaren rört sig. Rörelsevakten (ca 150 ms) åtgärdar det.
Touch ändras till tap av samma grundsats: gesten ska vara en avsiktlig handling, inte en bieffekt av att fingret landar.

### Följder för berörda stories (Jira, epic RUN-9)
Storynumren är stämda mot Jira 2026-10-14 (Lead).
- **S21 (RUN-197), läs-gesterna på rad och popover-rad:** implementerar de fyra reglerna ovan. Nytt i acceptansen: `pointerenter` inom ca 150 ms efter montering markerar inte; `pointerdown` ensam markerar inte, `pointerup` utan rörelse gör det; `focusin` markerar inte; Enter och Space markerar; rad-elementet är `button`/grupp med tillgängligt namn (inte `li tabIndex=0`); oläst-räknaren har polite live-region. Testerna i beslut 15 ("hover/focus/touch ... markerar läst direkt") byts mot: hover efter rörelse, tap, Enter/Space markerar; fokus ensam och ett Tab-svep markerar ingen rad; hover inom vakt-fönstret markerar inte; redan lästa rader ger fortfarande inget nätverksanrop. Fördröjd tidtagning testas med fejkade timers. Playwright-kandidaten "hover-läst med riktig pekare" (beslut 15, E2E) behålls och gäller nu även den vilande pekaren vid öppning.
- **S20 (RUN-250), klockan och popovern:** popover-raderna följer samma läs-gester som /news-raderna (hover efter rörelse, tap, Enter/Space; fokus ensam markerar inte), rörelsevakten gäller från att popovern monteras, och räknarens polite live-region gäller även klockans badge. Popoverns sidhuvud får inget kugghjul (ägarbeslut 6, 2026-10-14).
- **S23 (RUN-251), onboardingen/touren:** touren `tour_news_v2` (beslut 9) beskriver gesten, så texten "Hover, focus or tap to read" är inte längre sann. Stegets copy ska säga hover (efter rörelse) eller tap, och tangentbord via Enter/Space; fokus får inte nämnas som läs-gest. Ägarens beslut 7 (2026-10-14) slår dessutom ihop stegen "newest first" och "gold dot = unread, hover/tap marks it read" till ett och sätter turen till fem steg; slutlig copy skrivs av Lead/Designern vid bygget. Release-notisen "What's new" (beslut 9) och beteendeförändring (1) i Konsekvenser ska använda samma formulering.
- **Övriga ställen i ADR:n som nämner gamla gesten** (beslut 9 tour-steget, beslut 15 frontend-RTL-raden, Konsekvenser "Beteendeförändringar" punkt 1 och "Negativt/risker" punkt 1, Avvisade alternativ "Dröjsmål innan hover...", Avvisade alternativ "Läst vid scroll-in", Revisit-triggern om hover-läst, indexraden) står kvar i originaltext och ska läsas enligt detta addendum; texten ovan gäller där de skiljer sig.

### Konsekvenser
- **Mindre risk för misstag:** den vilande pekaren och Tab-svepet är borta som felkällor. Kvarstår medvetet (ägarens val B4): en snabb musrörelse över listan markerar passerade rader som lästa, styrt av `READ_DWELL_MS`.
- **Mer ansträngning för tangentbord:** läst-markering kräver ett aktivt tryck per rad (eller "Mark all read"). Det är avsikten.
- **Antaganden (flaggade):** (a) rörelsevaktens exakta form är implementatörens: semantiken som är låst är att ingen rad blir läst av en pekare som inte rört sig efter fönstret; om en `pointermove` på en rad som pekaren redan vilade över ska räknas (rekommenderas, annars måste pekaren lämna och återinträda) avgör S21 med test. (b) Penna som hovrar behandlas som mus, penna i kontakt som touch. (c) Raden har ingen annan primär åtgärd än att markera läst; får den en (länk, expandera) krävs ett nytt beslut för hur aktiveringen delas.
- **Revisit:** triggern "Misstag i hover-läst rapporteras" gäller som förut (`READ_DWELL_MS > 0`); "kräv fokus/klick på touch" är nu delvis uppfylld (tap).

## Addendum 2026-10-15 (v0.7.0, utfall vid bygget): tre noteringar
Korta noteringar; inga beslut i det här dokumentet ändras.
1. **`rank_passed` med okänt mått klassas som `null` (beslut 3).** När betraktaren är mål (`target` = jag) väljer `payload.measure` slaget: `xp` → `rank_passed_xp_me`, `challenge_points` → `rank_passed_challenge_me`. Saknas måttet eller är det ett som den här koden inte känner till (ett framtida mått, se beslut 6) ger `classifyNotification` `null`: raden räknas aldrig och inget reglage träffas, i stället för att falla på fel reglage. Aktör = jag ger `own` och alla andra `rank_passed_others`, som beslutet säger.
2. **Legendary-autostarten skriver ingen `challenge_accepted` (beslut 7), och det är avsiktligt.** Raden hör till `PUT /challenges/:id/respond` (accept); en legendary-utmaning som startas av schedulern efter fyra dagar utan svar (`autoStartLegendaryChallenges`) har ingen som accepterat, så ingen `challenge_accepted`-rad och ingen `challenge_accepted_me`-notis skrivs. En legendary-utmaning kan inte avböjas eller dras tillbaka.
3. **Touren heter `tour_news_v2`; `tour_news_v1`-hänvisningarna i Kontext (frontendraden och `user_seen_items`-raden) beskriver läget före bygget.** Beslut 9 hade redan bytet; touren (RUN-251) har fem steg enligt addendum 2026-10-14 (beslut 7), och `tour_news_v1` ligger kvar som en oanvänd rad i `user_seen_items` (ofarlig, slugen frågas aldrig efter). Texten i Kontext lämnas orörd som historik.
