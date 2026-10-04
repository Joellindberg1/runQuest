# 007. Härledningsendpoints för redesignen (inga nya tabeller, ingen regeländring)

## Status
Godkänd av ägaren 2026-10-04 (redesign-beslut 1–5)

## Kontext
Redesignens skärmar (docs/design/redesign-plan.md, inkrement 2, 3, 5, 6, 7)
visar siffror som går att härleda ur befintliga tabeller (`runs`,
`challenges`, `events`, `event_entries`, `admin_settings`,
`streak_multipliers`) men som ingen endpoint exponerar i dag. Ägarbeslut 1
(spelregler oförändrade) gör att inget i detta paket får ändra XP-, streak-,
titel- eller utmaningsregler — endast LÄSA/härleda. Ägarbeslut 2 (Season →
All-time/This year) och 4 (landing = dummydata, ingen publik endpoint) gäller.

Verifierat i koden 2026-10-04:

- **Veckovy saknas.** `GET /auth/users-with-runs` ger alla användare med ALLA
  sina runs (full historik, ingen paginering); inget "förra veckans ranking".
  Runs-selecten saknar `start_time` och `created_at` (därför kan "5 h ago"
  inte visas); `is_treadmill` finns redan.
- **XP-konfig är admin-only.** `GET /auth/admin-settings` och
  `GET /auth/streak-multipliers` kräver `requireAdmin`. Playbook och
  "Estimated XP" i Log runs behöver värdena. ADR 004 beslut 4 förutsåg ett
  autentiserat läs-endpoint men det är inte byggt; `routes/runs.ts` har en
  lokal `fetchAdminSettings()` som läser `admin_settings` (explicita kolumner,
  aldrig `*`) + tabellen `streak_multipliers` med defaults som fallback.
  OBS: `admin_settings` innehåller även `admin_password_hash` — ett läs-
  endpoint för alla inloggade får aldrig `select('*')`.
- **Utmaningar.** `GET /challenges/my` ger bara anroparens egna 20 senaste
  avslutade; `GET /challenges/group-stats` ger W/D/L per användare. Det finns
  ingen gruppbred historik och ingen head-to-head. Avslutade utmaningar ligger
  kvar i `challenges` (`status='completed'`, `outcome`, `winner_id`,
  `challenger_final_value`, `opponent_final_value`, `determine_at`,
  `*_level`, winner/loser-boostfält); avböjda/återkallade raderas.
  Pending/active/completed är de enda statusarna som förekommer.
- **Events.** `GET /events` räknar `participantCount` bara för
  competition-events (längd på live-leaderboarden); participation-events har
  0. `GET /events/history` har hårt `.limit(30)` utan offset;
  `GET /runs/group-history` har hårt `.limit(100)` och sorterar bara på
  `date` (ingen tie-breaker → instabil ordning vid sidning).
- **`POST /runs`** tar `{date, distance, source}`; `is_treadmill` sätts i dag
  bara av Strava-importen (`activity.trainer`). Manuella runs har `NULL`.
  Event-/väderlogik använder `eq('is_treadmill', false)`.
- **Svarsformerna är inkonsekventa** (STATE.md, konventioner): `{success,data}`
  (auth, challenges, titles, groups), `{runs}`, `{events}`, `{seen}`,
  `{ok:true}`; fel som `{error}` eller `{success:false,error,message}`.
  Fältstil: camelCase i events, snake_case i övrigt. Det finns inga delade
  API-svarstyper (STATE zon 10).
- Gruppavgränsning sker i handlers via `group_id` ur JWT.
  `users-with-runs` returnerar ALLA användare om `group_id` saknas (arv,
  STATE zon 8).

Relaterade ADR:er: **003** (nya routrar monteras i `app.ts`:s routerlista;
wiring-testet för varje prefix utökas), **004** (beslut 4: läs-endpoint för
XP-konfig — denna ADR levererar det; tabellen `streak_multipliers` är
runtime-källan; `packages/shared` är hem för ren logik), **001** (ny kod
kräver tester; route-tester med mockad DB som `runs-idor.test.ts`), **005**
(rör inte `calculateUserTotals`). Ingen ADR ersätts. Händelseloggen och
`GET /news` ligger i ADR 008 och ingår inte här.

## Beslut

### A. Konventioner för alla endpoints i paketet (kontraktszonen)
1. **Nya endpoints:** framgång = `{ success: true, data: <nyttolast>, meta?:
   {…} }`; fel = HTTP-status + `{ error: string }` (det mönster majoriteten av
   handlers och `backendApi` redan följer).
2. **Befintliga endpoints som utökas behåller sin nyckel och sin fältstil**
   (`{runs}`, `{events}`, camelCase i events) och får ENDAST additiva fält
   och ett additivt `meta`-block — ingen omdöpning, ingen borttagning
   (expand/contract; frontend kan deployas före/efter).
3. **Fältstil i nya endpoints: snake_case** (DB-stilen, majoriteten).
4. **Tid:** kalenderdagar är `YYYY-MM-DD` i Stockholm-tid (via
   `utils/dateUtils`, aldrig `new Date()`-lokal tid); tidpunkter är ISO-8601
   UTC. Veckan är måndag–söndag Stockholm. Nya helpers i `dateUtils`:
   `mondayOf(dateStr)`, `weekRange(dateStr)` (enhetstestade runt DST-skiften
   och årsskiften).
5. **Paginering.** Offset-sidor (för numrerad pager i designen):
   `?limit=&offset=` (heltal, `limit` 1–max per endpoint, `offset` ≥ 0, annars
   400) och `meta: { total, limit, offset, has_more }`; total via
   `count: 'exact'`. Sorteringen MÅSTE ha unik tie-breaker (`…, id desc`) så att
   sidor inte dubblerar/tappar rader. Utan parametrar beter sig befintliga
   endpoints exakt som i dag (samma default-limit). (Flödesliknande data —
   news — använder keyset i ADR 008, inte offset.)
6. **Gruppavgränsning:** alla nya endpoints filtrerar på `group_id` ur JWT.
   Saknas `group_id` returneras tom data (`items: []`/`users: []`) — inte
   "alla" (bryter medvetet mot `users-with-runs`-arvet).
7. **Delade typer:** svarstyperna för de nya/utökade endpoints definieras i
   `packages/shared/src/contracts/` (typer, ingen runtime-kod utom
   konstanter) och importeras av både backend-routes och frontendens
   API-klient. Det avvecklar "kontraktet speglas för hand" (zon 10) för det
   här paketet och ger frontend typade metoder. Förutsättning: shared är
   redan beroende i båda apparna (ADR 004).
8. **Wiring (ADR 003):** nya routrar `routes/leaderboard.ts`
   (`/api/leaderboard`) och `routes/config.ts` (`/api/config`) läggs i
   `app.ts`:s routerlista; wiring-testet (varje prefix svarar 401/400, inte
   404) utökas i samma PR.

### B. Endpoints

| # | Endpoint | Typ | Inkrement |
|---|---|---|---|
| 1 | `GET /api/leaderboard/week` | ny | 2 |
| 2 | `GET /api/leaderboard/rank-delta` | ny | 2 |
| 3 | `GET /api/auth/users-with-runs` + `start_time`, `created_at` | additivt | 2 |
| 4 | `GET /api/config/xp` | ny | 2, 7, Playbook |
| 5 | `GET /api/challenges/group-history` | ny | 5 |
| 6 | `GET /api/challenges/head-to-head/:userId` | ny | 3 |
| 7 | `GET /api/events` + `participantCount`/`memberCount` för alla typer | additivt | 6 |
| 8 | `GET /api/events/history` + offset-paginering, `participantCount`/`memberCount` | additivt | 6 |
| 9 | `GET /api/runs/group-history` + offset-paginering, `start_time`, `created_at` | additivt | 7 |
| 10 | `POST /api/runs` tar `is_treadmill` | additivt | 7 |

**1. `GET /api/leaderboard/week[?week_start=YYYY-MM-DD]`**
Veckans (default innevarande, Stockholm) per-användar-sammanställning för
gruppens medlemmar (samma medlemsmängd som `users-with-runs`, inklusive de
utan rundor), plus förra veckans ranking.
- `week_start` måste vara en måndag och inte i framtiden, annars 400.
- Definitioner: `km` = Σ `runs.distance`, `runs` = antal rader, `xp` = Σ
  `runs.xp_gained` för `runs.date` i veckan. **Event-XP ingår inte** (den är
  inte daterad per runda i `users.event_xp`); total-XP-rank med event-XP
  hanteras av `rank-delta` nedan. Rank = sortering på (`xp` desc, `km` desc,
  `name` asc) över ALLA medlemmar (0-XP-användare får också en rank) — samma
  regel för förra veckan, så `rank_delta = previous_rank − rank` (positivt =
  klättrat). `previous_rank`/`rank_delta` är `null` om användaren skapades
  efter förra veckans start.
- `mover` = användaren med störst positivt `rank_delta` (tie → högst `xp`);
  `null` om ingen klättrat eller förra veckan saknar rundor.
```ts
interface WeekLeaderboardResponse {
  week: { start: string; end: string; previous_start: string; is_current: boolean; today: string };
  users: Array<{
    user_id: string; name: string; profile_picture: string | null; level: number;
    km: number; runs: number; xp: number;
    days: Array<{ date: string; km: number; xp: number; runs: number }>; // 7 st, mån–sön
    rank: number; previous_rank: number | null; rank_delta: number | null;
  }>;
  totals: { km: number; runs: number; xp: number; active_runners: number; members: number };
  mover: { user_id: string; rank_delta: number } | null;
}
```
Beräkningen är en ren funktion `buildWeekLeaderboard(members, runs,
weekStart)` i `packages/shared` (enhetstestad); handlern gör en enda
runs-query (`date` mellan förra veckans måndag och aktuell söndag, join
`users!inner(group_id)`), ingen N+1.

**2. `GET /api/leaderboard/rank-delta`**
Rank-delta för Season-fliken (ägarbeslut 2: fliken heter All-time tills
seasons-featuren byggs — därför heter endpointen inte `season`, så namnet
är ledigt för den riktiga featuren). Svarar på "var låg du i total-XP-
rankingen vid innevarande veckas start?".
- `xp` = `users.total_xp` (samma värde som Board sorterar på → aktuell rank
  stämmer alltid med listan). `previous_xp = total_xp − Σ(XP krediterad sedan
  veckostart)` där krediterad XP = `runs.xp_gained` med `date ≥ veckostart` +
  event-XP (`event_entries.xp_awarded > 0` med tidpunkt `qualified_at` för
  participation, `events.settled_at ?? events.ends_at` för competition) ≥
  veckostart. Rank = (xp desc, name asc). Härledning, ingen ny lagring.
  Liggarfunktionen `buildXpLedger` (shared) skapas här och återanvänds av
  ADR 008:s backfill.
- Ingen `scope=year`: ägarbeslut 2 säger bara att copy byts; om ägaren vill
  ha en "This year"-rankning är det en parameter på samma endpoint (kräver
  hela XP-liggaren). Öppen fråga till ägaren, inget hinder.
```ts
interface RankDeltaResponse {
  as_of: string; // veckans måndag (Stockholm) = jämförelsepunkt
  users: Array<{ user_id: string; xp: number; rank: number; previous_xp: number;
                 previous_rank: number | null; rank_delta: number | null }>;
}
```

**3. `users-with-runs`** får `start_time` och `created_at` i `runs(...)`-
selecten (additivt; "senaste runda för X sedan" = `start_time ?? created_at`).
Payloaden växer marginellt. Att hela historiken skickas är ett känt arv som
INTE åtgärdas här (revisit-trigger).

**4. `GET /api/config/xp`** (kräver bara `authenticateJWT`)
- Källa: en ny tjänst `services/xpConfig.ts` (`getXpConfig()`, TTL-cache 60 s,
  invalideras av admin-PUT:arna) som `routes/runs.ts` OCKSÅ använder i stället
  för sin lokala `fetchAdminSettings()` — EN källa för XP-vägen och
  läs-endpointen, så Estimated XP i UI:t inte kan avvika från vad backend
  räknar. Explicit kolumnlista (`base_xp, xp_per_km, bonus_5km, bonus_10km,
  bonus_15km, bonus_20km, min_run_distance`); aldrig `*`, och
  `admin_password_hash`, `id` och tidsstämplar exponeras inte. Test kräver att
  svaret saknar `admin_password_hash` även när mocken returnerar den.
- Svaret är de EFFEKTIVA värdena som XP-beräkningen faktiskt använder
  (inkl. fallback till `DEFAULT_*` ur shared, ADR 004); `meta` anger om
  fallback användes.
```ts
interface XpConfigResponse {
  settings: { base_xp: number; xp_per_km: number; bonus_5km: number; bonus_10km: number;
              bonus_15km: number; bonus_20km: number; min_run_distance: number };
  streak_multipliers: Array<{ days: number; multiplier: number }>; // stigande days
}
// meta: { settings_source: 'db' | 'defaults'; multipliers_source: 'db' | 'defaults' }
```
- Frontend: `useXpConfig()` (TanStack Query, `staleTime` 10 min,
  `placeholderData` = shared-defaults så att Playbook/preview aldrig
  blockerar). Playbooks hårdkodade siffror och Estimated XP-förhandsvisningen
  (shared `calculateCompleteRunXP`) läser härifrån. Level-gränser läses
  fortsatt som i ADR 004 (anon `level_requirements`), inte härifrån.
- `GET /auth/admin-settings`/`streak-multipliers` (admin) är oförändrade.

**5. `GET /api/challenges/group-history[?limit=&offset=]`** (default limit 20,
max 50)
Gruppens avslutade utmaningar (`status='completed'`), senaste först
(`determine_at desc, id desc`). Namn/bild hämtas med samma andra-query-mönster
som `/my` (`users.in(ids)`). Ingen separat "settled_at"-kolumn finns:
`determine_at` är den schemalagda avgörandetiden (avräkningen sker inom ~1 h
via timcron) och används som avslutstid.
```ts
interface ChallengeHistoryItem {
  id: string; tier: 'minor' | 'major' | 'legendary'; metric: 'km' | 'runs' | 'total_xp';
  duration_days: number; start_date: string | null; end_date: string | null; ended_at: string | null; // determine_at
  outcome: 'challenger_wins' | 'opponent_wins' | 'draw'; winner_id: string | null;
  challenger: { id: string; name: string; profile_picture: string | null; level: number }; // level = vid start
  opponent:   { id: string; name: string; profile_picture: string | null; level: number };
  challenger_value: number | null; opponent_value: number | null;
  winner_boost: { type: string; delta: number; duration: number | null };
  loser_boost:  { type: string; delta: number; duration: number | null };
}
```
Mapping: `challenger_value = challenger_final_value`, nivåer = `challenger_level`/
`opponent_level`, boost-fält ur `winner_*`/`loser_*` (insatserna som gällde,
oförändrade regler). `meta` = offset-paginering.

**6. `GET /api/challenges/head-to-head/:userId[?limit=]`** (default 5, max 20)
Anroparens uppgörelser mot en annan medlem.
- Validering (IDOR-skydd, test krävs): `:userId` måste vara ett uuid och ≠
  anroparen (400) och tillhöra anroparens grupp (404 annars — läcker inte
  existens).
- `record` räknas från anroparens perspektiv över ALLA avslutade utmaningar
  mellan paret (båda orienteringarna); `history` = senaste `limit` som
  `ChallengeHistoryItem[]`; `active` = pågående/pending utmaning mellan
  paret eller `null` (för Runner card:ens Challenge-knapp/"live"-läge).
```ts
interface HeadToHeadResponse {
  opponent: { id: string; name: string; profile_picture: string | null };
  record: { wins: number; draws: number; losses: number; total: number };
  history: ChallengeHistoryItem[];
  active: { id: string; status: 'pending' | 'active'; challenger_id: string } | null;
}
```

**7–8. Events.** `/events` och `/events/history` får additiva fält per event:
`participantCount` (antal `event_entries` för eventet, nu för ALLA typer —
för competition oförändrat värde) och `memberCount` (antal användare i
gruppen) → "4 of 6 finished it". Beräknas med en enda extra
`event_entries`-query över sidans event-id:n och en gruppstorleksquery.
`/events/history` får `?limit=&offset=` (default limit 30 = dagens, max 50;
sortering `ends_at desc, id desc`) och `meta` (nyckeln `events` oförändrad).
Pagern i designen (6 per sida) anropar `limit=6&offset=…`; som bonus byggs
leaderboards bara för sidans event.

**9. `GET /api/runs/group-history`** får `?limit=&offset=` (default limit 100 =
dagens, max 200), sortering `date desc, created_at desc, id desc`, `meta`
(nyckeln `runs` oförändrad) samt additiva fält `start_time` och `created_at`
per rad.

**10. `POST /api/runs`** tar ett valfritt `is_treadmill` (boolean; annan typ =
400). Utelämnat → kolumnen förblir `NULL` (exakt dagens beteende för
manuella rundor; ingen regeländring). Skickat → sparas som `true`/`false`.
Svarets `run` får `is_treadmill`. `PUT /runs/:id` ändras inte (att redigera
löpbandsflaggan i efterhand ingår inte). Titel-/event-/väderlogik som
använder `is_treadmill` är oförändrad.

### C. Utanför paketet (medvetet)
- **Progress-batchning för Duels live-kort** (planens inkrement 5): max en
  aktiv utmaning per användare → högst tre samtidiga i en grupp om sex, så
  N anrop till `/:id/progress` är ≤ 3. Omprövas vid större grupper.
- **`GET /users/me/stats`** (planens inkrement 8): beslutas när Profile byggs
  och payloaden är mätt; härledningar sker tills vidare klient-side ur
  `users-with-runs`.
- Landing-aggregat (ägarbeslut 4: ingen publik endpoint), notiser/realtid,
  Strava-synklogg, `groups.race_name/race_date` (planens övriga lagringsbehov
  — egna ADR:er om/när de tas).

## Alternativ som övervägts
- **Härleda veckovyn och rank-delta helt i klienten ur `users-with-runs`.**
  Datan finns redan där (alla runs, alla användare) och det vore noll
  backendarbete. Bortvalt: veckogränserna (Stockholm, DST) och rank-reglerna
  skulle då ligga i klienten och kunna divergera från backend; full
  runs-historik är redan ett skalningsarv vi inte vill fördjupa beroendet av;
  och en serverdefinition av "veckan" behövs ändå för framtida notiser
  ("Mover of the week"). Klientvarianten förblir ok som fallback om backend
  släpar.
- **Lägga `rank_delta`/`previous_rank` direkt i `users-with-runs`.**
  Bortvalt: hetaste endpointen får tyngre beräkning i varje anrop (även från
  skärmar som inte visar delta) och kan inte få parametrar; separat endpoint
  cachas/åsidosätts oberoende.
- **Event-XP i veckans XP.** Bortvalt: `users.event_xp` är en ackumulerad
  summa utan datum; att datera den kräver event-liggaren och skulle göra
  veckotabellen och Board-rankens definition olika. Veckans XP = runda-XP,
  tydligt märkt.
- **Publik (oautad) XP-konfig-endpoint.** Bortvalt: kravet är "läsbar för alla
  INLOGGADE"; en oautad route skulle öppna för skrapning utan behov och bryter
  mot att anon inte får läsa något (permissions.md).
- **Återanvända `GET /auth/admin-settings` med lättad `requireAdmin`.**
  Bortvalt: samma route läser `streak_multipliers`-kolumnen som inte finns
  och har admin-semantik; blandar läs-för-alla med admin-läs och riskerar
  att exponera hashen vid framtida kolumnändring. Egen route + explicit
  kolumnlista.
- **Keyset-paginering överallt.** Bortvalt för events/runs: designen har
  numrerad pager (kräver `total`/hopp till sida); datamängderna är små och
  tie-breakern gör offset stabil. Keyset används där flödet växer löpande
  (news, ADR 008).
- **Ett enda `/summary`-endpoint per skärm (backend-for-frontend).**
  Bortvalt: kopplar backend hårt till skärmlayouter som fortfarande
  ändras; små, återanvändbara härledningar (week, head-to-head) räcker.

## Konsekvenser
- **Inga nya externa tjänster, ingen kostnad, ingen databas, INGA nya
  tabeller och inga migrationer.** Allt är läsning/härledning ur befintliga
  tabeller; endast `POST /runs` skriver (en redan existerande kolumn).
  Ingen känslig data tillkommer; **flagga:** `GET /config/xp` ligger i samma
  tabell som `admin_password_hash` — kolumnlistan är därför explicit och
  testad (se B4). Nya endpoints exponerar bara data som redan är synlig för
  alla gruppmedlemmar (namn, nivå, XP, utmaningar).
- **Nya skrivrättigheter:** inga. Nya läsrättigheter: inloggade läser XP-
  konfig (tidigare admin-only) — avsiktligt (Playbook/Estimated XP), innehåller
  ingen hemlighet.
- **Positivt:** redesignens Board/Runner/Duels/Events/Log runs blockeras inte
  av saknade data; XP-vägen och UI-förhandsvisningen delar EN konfigkälla
  (`xpConfig`), vilket också levererar ADR 004:s uppskjutna läs-endpoint;
  för första gången delade API-typer (typade klientmetoder) för nya
  endpoints; offset-paginering med stabil sortering löser även dagens
  instabila `group-history`-ordning.
- **Negativt/risker:** (1) Veckoberäkning och rank-delta är nya
  beräkningar nära affärskärnan (XP-siffror syns för användarna) — därför
  rena funktioner med tester runt vecko-/årsgränser, DST och tie-breakers.
  (2) `rank-delta` bygger på tidpunkter för event-XP (`qualified_at`,
  `settled_at ?? ends_at`) — avvikelse mot `users.event_xp` kan ge fel delta
  (inte fel rank); avvikelsen loggas som varning. (3) `users-with-runs` (full
  historik) förblir tung; veckoendpointen lägger en andra runs-query. Ok för 6
  användare; mät innan större grupper. (4) `group_id` i JWT kan vara
  inaktuell efter `groups/join` (STATE zon 8) — nya endpoints ärver det.
  (5) Offset-sidor kan skifta om rader tillkommer mellan anrop; accepterat
  (pagern är en bläddringsyta, inte ett flöde). (6) `backendApi.ts` (1043
  rader, zon 10) får inte fortsätta växa: de nya klientmetoderna skrivs i en
  ny modul (t.ex. `shared/services/api/`) som delar den befintliga
  fetch-/401-hanteringen via `authenticatedRequest` — Builders val av
  exakt struktur, kravet är att zonen inte fördjupas.
- **Tester (ADR 001):** route-test per endpoint med mockad DB i stil med
  `runs-idor.test.ts`: 401 utan token; gruppavgränsning (annan grupps data
  syns aldrig; saknad grupp → tom); valideringsfel → 400 (ogiltig
  `week_start`, `limit`, uuid, `is_treadmill` av fel typ); paginering
  (`meta`, stabil ordning med lika `date`); head-to-head mot användare i annan
  grupp → 404 och mot sig själv → 400; `config/xp` läcker inte
  `admin_password_hash`; `POST /runs` med/utan `is_treadmill` (NULL
  bevaras). Enhetstester i shared för `buildWeekLeaderboard`/rank-reglerna/
  `buildXpLedger` och i backend för `dateUtils.mondayOf/weekRange`.
  Wiring-testet (ADR 003) utökas med `/api/leaderboard` och `/api/config`.
- **Arkitekturdiagram:** ingen ändring — inga nya komponenter eller
  kopplingar; två nya routrar inom befintlig backend-komponent.
- **STATE.md-ändringar att föreslå:** (1) ADR-index: rad 007. (2) Konventioner,
  svarsformen: "Nya endpoints: `{success,data,meta?}`/`{error}`, snake_case;
  utökade behåller sin form; delade typer i `packages/shared/src/contracts/`;
  paginering `limit/offset` + `meta`". (3) Zon 10: "API-kontrakt delvis
  delade (redesign-endpoints, ADR 007)". (4) Zon 4: ADR 004:s uppskjutna
  XP-konfig-läs-endpoint levererad (`GET /api/config/xp`; `services/xpConfig.ts`
  är EN källa för runs-vägen). (5) Ordlista: "vecka → week (Stockholm,
  mån–sön)". (6) docs/contracts.md (refereras av redesign-planen, finns
  inte) bör skapas med endpointtabellen ovan som grund.

## Revisit-triggers
- Gruppen växer förbi ~20 medlemmar eller `users-with-runs` passerar några
  hundra kB → server-side aggregat/paginering av Board-datan; `/leaderboard/*`
  får då tyngre cache eller materialiserad vy.
- Ägaren vill ha "This year"-ranking eller säsonger (roadmap) → `scope`/
  `season_id` på `/leaderboard/*` och en egen ADR (påverkar level-/XP-
  modellen).
- Rank-/veckadefinitionen ska skickas i notiser ("Mover of the week") →
  flytta beräkningen till ett schemalagt jobb som skriver händelser (ADR
  008).
- Multi-grupp (roadmap) → `group_id` ur JWT räcker inte; gruppväxling i
  anropet.
- Fler än en konsument av `packages/shared/src/contracts` med olika
  versionstakt (t.ex. mobilapp) → versionera API:t.

## Addendum 2026-10-05 (implementationsutfall, Lead-godkänt)
Avvikelser och tillägg som uppstod vid bygget av inkrement 2 (Board-delmängden: endpoint 1–4). Ingen regeländring.

1. **`totals.best_week_km` och `totals.pct_of_best_week` (additiva fält)** i `GET /api/leaderboard/week`. `best_week_km` = gruppens bästa vecka någonsin i km, där den aktuella/valda veckan räknas med (procenten överstiger därför aldrig 100). `pct_of_best_week` = veckans km i % av `best_week_km`, heltal, `null` om bästa veckan är 0. Fälten finns i `WeekLeaderboardTotals` (shared/contracts). Läsningen är dekorativ: om historikfrågan felar faller handlern tillbaka på veckans egna km (best = veckans km, pct 100) i stället för att ge 500.
2. **Cachad, sidvis historikläsning.** Bästa veckan kräver hela gruppens runs-historik. Den läses sidvis (1000 rader/sida via `range()`, unik tie-breaker `date, id`; PostgREST kapar annars vid 1000 rader) och cachas **5 min TTL, process-lokalt** per grupp (en Railway-instans i dag; fler instanser ger upp till 5 min skeva värden). Den aktuella veckan maxas alltid mot cachen så att ett nytt rekord syns direkt.
3. **14-dagarsfönstret i `rank-delta`.** Event-XP-queryn begränsas till `events.ends_at >= veckostart − 14 dagar` (och `xp_awarded > 0`) för att hålla svaret under 1000-radersgränsen när eventhistoriken växer. **Tail-risk:** om en competition-avräkning står stilla (ej settled) mer än 14 dagar efter `ends_at` och sedan avräknas efter veckostart, faller dess event-XP utanför fönstret → liggaren underskattar krediterad XP → `previous_xp` överskattas. `diverged`-varningen (liggare > `total_xp`) fångar INTE detta fall (liggaren blir för liten, inte för stor). Avräkningen körs normalt inom ~1 h, så risken är låg; åtgärd vid behov: bredda fönstret eller sida event_entries.
4. **XP-konfig-cachen är process-lokal** (60 s TTL, invalideras av admin-PUT:arna i den egna processen). Med fler instanser kan värdena vara upp till 60 s skeva efter en admin-ändring. Revisit vid skalning.
5. **`level_requirements` ingår inte** i `GET /api/config/xp` (följer B4: nivågränser läses som i ADR 004).
