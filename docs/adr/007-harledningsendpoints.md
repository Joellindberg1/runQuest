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
  Saknas `group_id` ger läsningar tom data (fail-closed, A6). Arvet där
  `users-with-runs`, `/auth/users` och `/challenges/group-stats` returnerade
  alla grupper är borttaget i v0.6.2.3 (RUN-258, `utils/groupScope.ts`); en
  CI-vakt (`ci-guards.mjs`, `group-filter`) fäller villkorliga gruppfilter i routes.

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
   handlers och `backendApi` redan följer) (ändrad av Addendum 2026-10-20, RUN-354: felet bär även success:false och code).
2. **Befintliga endpoints som utökas behåller sin nyckel och sin fältstil**
   (`{runs}`, `{events}`, camelCase i events) och får ENDAST additiva fält
   och ett additivt `meta`-block — ingen omdöpning, ingen borttagning
   (expand/contract; frontend kan deployas före/efter) (undantag: Addendum 2026-10-20, RUN-354, steg 2 flyttar de nakna nycklarna in i data efter ett dubbelsvarsfönster).
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
RUN-139: `PUT` och `DELETE` på rundor med `source='strava'` ger `409 { error:
'Strava runs are read-only' }` (Strava är sanningskällan; kontrollen sker efter
ägarskapet 404/403 och före all skrivning).

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
6. **`created_at`-fallbacken i "X h ago" (frontend, `preciseRunTime`).** `users-with-runs` ger `start_time` (Strava) och `created_at` (radens skapandetid). `start_time` används som exakt tidpunkt. `created_at` används BARA om raden skapades samma Stockholm-kalenderdag som `runs.date` (manuell loggning i stunden); en efterloggad runda (`created_at` en annan dag än `date`) ger annars ett felaktigt "5 h ago", så då faller visningen tillbaka på kalenderdagen ("today", "N d ago").

### Addendum inkrement 3–7 (data-spåret: B5–B10, implementationsutfall)
7. **`data.items` för group-history.** `GET /api/challenges/group-history` svarar `{ success, data: { items: ChallengeHistoryItem[] }, meta }` (tolkning av A6:s `items: []`). Kontraktstyp: `ChallengeGroupHistoryResponse` i shared.
8. **`is_treadmill`-semantik (B10).** Utelämnat `is_treadmill` ger NULL (nyckeln skickas inte i insert). NULL matchar aldrig `eq('is_treadmill', false)`, så event-/väderlogikens utfall för manuella rundor är oförändrat; ett default `false` hade ändrat det och är därför avvisat. Fel typ (inkl. `null`) ger 400. `PUT` är oförändrad (testat).
9. **A6 gäller även `GET /api/runs/group-history`.** Token utan `group_id` ger `{ runs: [], meta }` utan DB-anrop — inte alla gruppers rundor (arvet "alla om group_id saknas" är avvecklat för denna endpoint). Pagineringsvalidering körs före gruppkontrollen (ogiltig limit ger 400 även utan grupp). Gruppfiltret `users.group_id` sätts alltid.
10. **Offset bortom slutet.** Verifierat empiriskt mot prod-PostgREST 2026-10-05 (Lead): utan count-header ger offset bortom slutet 200 + tom lista; med `Prefer: count=exact` ger det 416 + `Content-Range: */N`. `fetchOffsetPage` (backend `utils/pagination.ts`) hanterar båda: 416/PGRST103 eller 200 + tom lista utan count ger en tom sida och totalen via en separat head-count, aldrig 500. fakeDb:s 416-emulering är strängare än verkligheten (risk för falsk röd, inte falsk grön).
11. **Känd lucka (pre-existing):** `POST /runs` vidarebefordrar inte `is_treadmill` till `checkEventQualification`. Poängräkningen exkluderar löpbandsrundor ändå (`eq('is_treadmill', false)`), så ingen felräkning; åtgärdas inte här.
12. **Manuella outdoor-rundor skickar `false` (inkrement 7, frontend).** Nya Log-formuläret skickar alltid en explicit bool (Outdoor/Treadmill-valet) — det är "skickat → sparas som true/false" enligt punkt 8, INTE det avvisade default-`false` (användaren gör ett val). Numeriskt inert i dag: manuella rundor saknar höjddata (`total_elevation_gain` NULL → bidrar 0 i elevation-tävlingar) och GPS (väder hämtas ej). Den dag manuella rundor får höjdmeter-fält påverkar `false`-raderna elevation-tävlingar — omvärdera då. Äldre manuella rundor förblir NULL (ingen chip i UI).

### Notering 2026-10-11 (ägarbeslut)
Undantaget (anon läser `level_requirements` direkt; B4 pt 5 och "Level-gränser läses som i ADR 004") upphävs — `GET /api/config/levels` (RUN-110), frontend byter (RUN-111), anon-policyn stängs (RUN-112). Endpointen ger `{ success, data: [{ level, xp_required }] }` (stigande på `level`, kontrakt `LevelsApiResponse`), kräver token men inte `group_id`, och går via backendens `levelService` (cache + fallback-tabell enligt ADR 004).

### Notering 2026-10-12 (RUN-215, Lead)

`POST/PUT/DELETE /api/runs` kan svara **500 `{ error, written: true }`** när raden skrevs men XP-omräkningen fallerade (additivt fält enligt A2; felformen `{ error }` enligt A1 oförändrad) (från Addendum 2026-10-20: fältet written följs av code recalc_failed_after_write, se punkt 6). Klienten ska då behandla skrivningen som genomförd: invalidera run-/totals-cachen, återställa formuläret och inte uppmana till nytt försök. Ett 500 utan `written` betyder att inget skrevs. Övriga endpoints använder inte fältet.

### Notering 2026-10-13 (RUN-225, Lead)

`POST /api/runs` tar headern **`Idempotency-Key`** (uuid v4, en per inskick; annat format → 400 `{ error: 'Idempotency-Key must be a UUID v4' }`; saknas headern är beteendet oförändrat). Samma nyckel igen från samma användare skapar ingen ny runda och ger samma status och form som det första lyckade svaret (200 `{ success, message, run }` (formen följer Addendum 2026-10-20 steg 2)), utan ny omräkning; nyckeln lagras i `runs.client_request_id` med unikt index per `user_id` (migration 043). Har den första förfrågan skrivit rundan men omräkningen fallerat (`written: true`) returnerar upprepningen rundan; omräkningen självläker som tidigare (nästa omräkning från rundans datum), ingen ny mekanism. En samtidig upprepning kan svara med rundan innan vinnarens omräkning är klar, alltså med 0 XP; det självläker när omräkningen är klar. Samma nyckel med en annan body ger återspelning av den första rundan (medvetet: nyckeln gäller ett inskick, och klienten byter nyckel när ett formulärvärde ändras). Gäller inte PUT/DELETE eller Strava-importen (idempotent via `external_id`).

## Addendum 2026-10-20 (v0.8.1, RUN-354, ägarbeslut): ett svarskuvert och ett felformat

Status: godkänt av ägaren 2026-10-20 (se "Ägarens beslut" nedan). Steg 1 är RUN-354 i v0.8.1; steg 2 är ett eget ärende i en senare version. Beslut A1 och A2 ändras här uttryckligen (pekare finns i A1/A2); beslut A3–A8 och B1–B10 är oförändrade. Ingen regeländring i spelet, ingen ny tabell, ingen migration.

### Kontext
Kartläggningen före v0.8.1 (F, E, H3) visar att A1:s "nya endpoints följer `{success,data,meta?}`" aldrig blev sann för resten av API:t. Sju former för lyckade svar och sex för fel finns kvar. Lyckade svar: `{success,data,meta?}`, `{success,message}`, `{success,message,run}`, `{success,token,user}`, fält på toppnivå (`newRuns`, `totalUpdated`), nakna `{events}`, `{events,meta}`, `{runs,meta}`, `{seen}`, `{ok:true}`, `{client_id}`, samt stubben `{message}`. Fel: `{error}` (235 ställen), `{success:false,error}` (10), `{success:false,error,message,...counts}` (`titles.ts:205`), 207 med `{success:false,message}` (`titles.ts:208`), `{error,written:true}` (`runs.ts:414,541,646`) och 404 med `{error,path,method}` (`app.ts:127`). Felen har inga maskinläsbara koder; frontend jämför i dag en enda fritext (`'Consent required'`, `useStravaActions.ts:23`). JSON-parsefel i `express.json()` och fel som ingen route fångat ger Express standard-HTML, eftersom Sentry-hanteraren (`observability/sentry.ts:301`) bara anropar `next(error)` och ingen JSON-felhanterare följer efter. Bara `waitlist.ts`, `users.ts` och `stravaWebhook.ts` har egna.

Skälet att göra det nu är PWA:n: en installerad PWA kan hålla en gammal bundle länge, och varje kuvertbyte efter den kräver versionering av API:t i stället för ett kontrollerat byte. Webbklienten har i dag en begränsad ålder: `index.html` är `no-cache` (Caddyfile), assets är `immutable` men tas bort vid deploy, och `staleChunkReload.ts` laddar om fliken när en gammal bundle försöker hämta en borttagen chunk. En gammal flik läker alltså sig själv vid nästa navigering; det gäller inte en PWA.

A2 ("äldre endpoints får ENDAST additiva fält") hindrar bytet som det står. Det här addendumet löser det med expand/contract: steg 1 är rent additivt, och borttagningen i steg 2 sker först efter ett fönster där båda formerna finns. Railway deployar frontend och backend parallellt vid merge (`docs/release.md` steg 3.2) och ordningen mellan dem går inte att styra, så en omskrivning av svaren i ett enda steg skulle ge en period då den ena sidan är fel. Därför är bytet byggt så att ordningen mellan tjänsterna aldrig spelar roll (punkt 8).

Relaterade ADR:er: **007** (A1, A2, A6, A7 och noteringarna 2026-10-12 och 2026-10-13), **010** (beslut 3 punkt 8 och Addendum 2026-10-17 och 2026-10-19: loggar och Sentry får inga Strava-id; webhookens svar), **012** (beslut 5: 404 utan existensläckage, fail-closed A6), **003** (felhanteraren monteras i `createApp()`, wiring-testet utökas), **001** (tester). Ingen ADR ersätts.

### Beslut

**1. Kuvertet.**
- Lyckat svar: `{ success: true, data, meta? }`. `data` finns alltid (`null` när åtgärden inte har någon nyttolast). `meta` ligger kvar på toppnivå och betyder som i A5 (paginering) eller diagnostik (`settings_source`). Mänsklig text (`message`) ingår inte i kuvertet och hör till klienten; under dubbelsvarsfönstret finns den kvar där den finns i dag.
- Fel: `{ success: false, error: <text>, code: <maskinkod> }`. `error` är en fast engelsk text för visning och loggar, aldrig för logik. `code` är det klienten och supporten grenar på.
- Fältnamn och fältstil INOM `data` ändras inte av detta addendum (events förblir camelCase, övrigt snake_case enligt A3). `{runs, meta}` blir `{ success:true, data:{ runs }, meta }`; nyckeln `runs`/`events` behåller sitt namn, den flyttar bara in under `data`.
- Gruppavgränsningen (A6) är oförändrad: en läsning utan `group_id` svarar fortfarande 200 med tom data, i det nya kuvertet (`{success:true,data:{runs:[]},meta}`), inte med ett fel. En skrivning utan grupp svarar 403 `group_required`.
- HTTP-statusen styr fortfarande klientens grundbeteende (401 loggar ut sessionen). `success` är sant om och bara om statusen är 2xx, med ett enda undantag (punkt 4, 207).

**2. Hjälpare och felhanterare (backend).**
- `utils/respond.ts` ger `ok(res, data, meta?)` och `fail(res, status, error, code?)`. Utan uttryckligt `code` ges standardkoden för statusen (tabellen i punkt 3). `fail` tar en fast text, aldrig ett `Error`-objekt, och loggar och rapporterar ingenting själv: loggningen ligger kvar hos anroparen (`logger.error`, som är Sentry-kopplingen), så en händelse aldrig skickas två gånger. `code` är typad `ApiErrorCode` (punkt 3), så en kod utanför katalogen är ett kompileringsfel.
- Alla `res.status(4xx|5xx).json(...)` i `routes/` och `middleware/` går via `fail`. En CI-vakt i `scripts/ci-guards.mjs` (ny regel) fäller bygget om en sådan rad återkommer utanför `utils/respond.ts` och undantagslistan (punkt 4). Det är samma mekanism som regel 6 (gruppfiltret) och kompletterar acceptanskriteriets `grep`.
- I `createApp()` sist, i den här ordningen: (1) 404-hanteraren: `fail(res, 404, 'Route not found', 'route_not_found')`, utan `path` och `method` i svaret; (2) `installSentryErrorHandler(app)` oförändrad (rapporterar bara 500 eller högre, anropar `next(error)`); (3) en ny `jsonErrorHandler` EFTER Sentry. Den gör:
  - `res.headersSent` är sant: `next(error)` (Express stänger anslutningen);
  - status ur `statusOfExpressError` (samma funktion som Sentry-hanteraren använder), begränsad till 400–599, annars 500;
  - `error.type === 'entity.parse.failed'` ger 400 `invalid_json` med texten `Invalid JSON body`; `entity.too.large` ger 413 `payload_too_large` (`Request body too large`); `encoding.unsupported` och `charset.unsupported` ger 415 `unsupported_media_type`;
  - övriga 4xx ger `invalid_request`, 500 och uppåt ger `internal_error` (`Internal server error`), 503 ger `service_unavailable`. Texten väljs ur en fast tabell efter status eller typ, aldrig ur `error.message`, `error.stack`, `error.cause` eller `error.expose`.
- De lokala felhanterarna i `waitlist.ts` och `users.ts` tas bort när den centrala finns (texterna är desamma, så svaren är oförändrade utöver `success` och `code`). Webhookens hanterare står kvar (punkt 4).
- Express 5 skickar ett avvisat löfte från en async-handler till felhanteraren; ett okastat fel i en route ger därför 500 i samma form, inte en krasch.

**3. Kodkatalogen.**
- **Format:** snake_case, `[a-z][a-z0-9_]*`, högst 40 tecken, engelska ord, stabila för alltid. En kod byter aldrig betydelse och återanvänds aldrig; en kod som blir fel markeras som föråldrad i filen men tas inte bort utan en egen ADR-notering.
- **Hemmet:** `packages/shared/src/contracts/errors.ts` (ADR 007 A7: typer och konstanter), exporterad ur `packages/shared`. Där finns `API_ERROR_CODES` (en `as const`-lista) och `type ApiErrorCode`, och i `common.ts` byter `ApiError` form till `{ success:false; error:string; code:ApiErrorCode; data?:TData }` (`written?: true` bara under dubbelsvarsfönstret). Backend och frontend importerar samma lista.
- **Versionering:** katalogen är bara additiv. Ett test fäster hela listan (som `ANALYTICS_EVENTS` och integritetstextens ögonblicksbild): en ny kod är en granskad diff i samma PR som den första användningen, och testet kontrollerar formatet och att ingen kod liknar en uppströmskod (se punkt 5). Klienten ska behandla en okänd kod som klassen för sin HTTP-status (generell hantering), aldrig som ett fel i sig; det gör att en gammal bundle klarar en ny kod.
- **När en specifik kod behövs:** när klienten grenar på den, när en fritextjämförelse finns i dag, eller när supporten vill kunna räkna den. Alla övriga fel använder standardkoden för sin status. RUN-354 får lägga till koder som uppfyller något av de tre villkoren och redovisar dem i PR:en; allt annat ändrar katalogen först efter ett nytt addendum.

Startkatalogen:

| Status | Kod | Betydelse (nuvarande text eller plats) |
|---|---|---|
| 400 | `invalid_request` | standard för 400: valideringsfel (`Date and distance are required`, `page.error`, `patch.error`) |
| 400 | `invalid_json` | brödtexten gick inte att tolka (`express.json()`, väntelistan) |
| 400 | `consent_required` | `Consent required` (Strava-callbacken), `Consent is required` (väntelistan) |
| 400 | `strava_not_connected` | `User not connected to Strava` |
| 400 | `strava_authorization_failed` | `Failed to exchange authorization code` |
| 400 | `strava_sync_failed` | `result.error` i `POST /strava/sync` (i dag 400 trots serverorsak; statusen ändras inte här) |
| 401 | `unauthorized` | standard för 401: saknad header eller token |
| 401 | `token_invalid` | ogiltig eller utgången JWT (`authenticateJWT`); sessionen rensas |
| 401 | `invalid_credentials` | login, oavsett om kontot saknas eller lösenordet är fel (punkt 5) |
| 401 | `current_password_incorrect` | `POST /auth/change-password`; ska inte logga ut sessionen |
| 403 | `forbidden` | standard för 403: ägarskap (`Not authorized to update this run`) |
| 403 | `admin_required` | `Admin access required` |
| 403 | `group_required` | `Admin must belong to a group` (skrivningar utan grupp) |
| 404 | `not_found` | standard för 404, även för ett id i en annan grupp (A6, ADR 012 beslut 5) |
| 404 | `route_not_found` | ingen route matchade |
| 404 | `invalid_invite_code` | `Invalid invite code` |
| 409 | `conflict` | standard för 409 |
| 409 | `sync_paused` | `Sync is paused` (ADR 010 beslut 7 punkt 5) |
| 409 | `strava_read_only` | `Strava runs are read-only` (RUN-139) |
| 409 | `run_qualified_event` | rundan kvalificerade ett event och kan inte raderas |
| 409 | `already_in_group` | `You are already a member of a group` |
| 409 | `strava_account_in_use` | Strava-kontot är redan kopplat till en annan användare |
| 409 | `user_exists` | `User with this name or email already exists` (en kod för namn och e-post) |
| 413 | `payload_too_large` | `Request body too large` |
| 415 | `unsupported_media_type` | teckenkodning eller innehållstyp stöds inte |
| 429 | `rate_limited` | `Too many attempts, try again later` |
| 500 | `internal_error` | standard för 500 |
| 500 | `recalc_failed_after_write` | raden skrevs men XP-omräkningen föll (punkt 6) |
| 503 | `service_unavailable` | standard för 503 |
| 503 | `strava_unavailable` | `Strava is temporarily unavailable` (tokenlagringen, ADR 013) |
| 207 | `partial_failure` | `POST /titles/reprocess-all` när några men inte alla användare föll (punkt 4) |

- **Förhållande till de interna felkoderna.** `errorCode()` (`utils/errorCode.ts`) ger en kort etikett för loggar: databaskoder (`PGRST116`), nätverksorsaker (`ECONNRESET`), Stravas statusar (`strava_401`, `strava_503`) och egna (`seam_timeout`). De beskriver ORSAKEN och bor i loggar och Sentry. API-koderna beskriver UTFALLET för anroparen. De två språken blandas aldrig: en API-kod är aldrig en uppströmskod, och en uppströmskod skickas aldrig till klienten. Skälen: (1) en Strava-401 skulle likna en egen 401 och kunna utlösa utloggning; (2) uppströmsdetaljer är supportinformation och hör hemma i loggen (ADR 010 beslut 8.6); (3) kolumn- och tjänstenamn i koden får inte bli ett kontrakt mot klienten.
- **Förhållande till Sentry.** Sentrys taggar (`alert`, `source`, `user_id`, `sentry_test`) och `source`-värdena (`webhook_dead`, `subscription_missing`, `token_write`, `challenge_repair`, `token_key`) är en egen namnrymd för larm och återanvänds inte som API-koder. Ingen ny Sentry-tagg införs: 4xx rapporteras inte, och 5xx faller i praktiken i `internal_error`, `service_unavailable` och `recalc_failed_after_write`, vars orsak redan finns i den loggade felkoden. `loggedDetail` (`sentry.ts`) skickar bara `code` och `message` ur ett loggat objekt; skulle en handler någon gång logga ett svar kommer bara vår egen katalogkod med, vilket är ofarligt.

**4. Undantag och specialfall.** Undantagslistan är kort, uttömmande och fäst i ett test (en ny avvikelse kräver en ändring av testet och därmed en granskad diff).
- **Strava-webhookens `GET /api/strava/webhook` (`{"hub.challenge": …}`) och `POST /api/strava/webhook` (`{received:true}`).** Stravas krav styr svaret: verifieringen kräver exakt den formen, och för POST läser Strava bara statuskoden (200 inom 2 s, annars omleverans). Hela routern utom `/health` är undantagen, även felsvaren (`{error}` med 400, 403, 413, 500, 503): de ändras inte och ADR 010:s tester står kvar. `GET /api/strava/webhook/health` (JWT + admin) är inte undantagen och går över i kuvertet.
- **`GET /health`.** Liveness-svaret `{status:'OK',message,timestamp,uptime}` kan läsas av Railway eller en övervakare utanför repot; det ändras inte.
- **`GET /api`.** Vägvisaren (`{message,endpoints,version,environment}`) är ett dokument för människor som ingen klient tolkar; den ändras inte. Dessa två står kvar tills någon behöver dem som kontrakt.
- **Inte undantagna:** `GET /api/public/stats` (redan `{success,data}`; Lighthouse-attrappen i `scripts/lighthouse/mock-api.mjs` påverkas inte), `GET /api/strava/config` (`{client_id}`, bara frontend läser den) och väntelistan (frontend läser bara statuskoden). Preflight (OPTIONS) och 304 har ingen kropp och berörs inte.
- **207 i `POST /titles/reprocess-all`.** Utfallet "några lyckades, några föll" (RUN-158) behåller sin status men går genom det vanliga felkuvertet: `207 { success:false, error:'N of M users failed; the rest were recalculated', code:'partial_failure', data:{ total, processed, failed } }`. Skälet att inte göra det till ett 200 med `success:true`: kuvertets `success` skulle då ljuga om en halvfelad körning, vilket RUN-158 just rättade. Det är det enda 2xx-svaret med `success:false` och det enda felsvaret som bär `data` (bara räknare); ett eget test pekar ut det. Ingen frontendkod anropar rutten (den körs som admin-underhåll), så följden är liten. Alla användare föll: 500 `{ success:false, error, code:'internal_error', data:{ total, processed:0, failed } }`. Räknarna ligger i `data`; de nuvarande toppnivåfälten `total`, `processed`, `failed` och `message` finns kvar under dubbelsvarsfönstret.

**5. Säkerhet: vad ett felsvar aldrig bär.**
- Skrubbern (ADR 010 Addendum 2026-10-19) körs på det som lämnar processen till Sentry, men inte på HTTP-svar. Ett felsvar har alltså ingen andra försvarslinje, och den första måste vara strukturell: samma princip som ADR 010 Addendum 2026-10-19 ("en text utan id") och `loggedDetail` (bara `code` och `message`, aldrig ett helt felobjekt eller en body), tillämpad på svaret.
- **Regel:** `error` är en fast text som anropsstället skrivit, eller en valideringstext byggd av anroparens EGEN indata (`patch.error`, `Unknown setting …`). Aldrig `error.message`, `error.stack`, `error.cause`, `error.details`, PostgREST-text eller text från Strava eller Supabase; inget radvärde, inget Strava-id, ingen koordinat och inget token. `fail` tar ingen `Error`-parameter, så det går inte att skicka vidare ett fel av misstag; `jsonErrorHandler` väljer sin text ur en fast tabell (punkt 2). I dag finns ingen handler som ekar `error.message` (kontrollerat med sökning i `routes/` och `middleware/`), och regeln gör att det förblir så.
- **Body-parserns fel är farligast.** `JSON.parse`-felet i `express.json()` kan citera början av brödtexten (`Unexpected token 'x', "{"password":"…`). Svaret får därför aldrig innehålla `error.message`; det testas med en trasig login-body som innehåller ett lösenord.
- **404-svaret ekar inte längre `path` och `method`.** `req.originalUrl` innehåller frågesträngen, som kan bära en OAuth-`code` eller `hub.verify_token`. Samma skäl gäller loggraden i 404-hanteraren: den ska logga `req.path`, som begäranloggen i `app.ts` redan gör.
- **Kontots existens.** Inloggningen svarar identiskt (status 401, text, kod `invalid_credentials`) för okänt konto, fel lösenord och ett databasfel i uppslaget. `current_password_incorrect` kan bara nås av en inloggad användare och gäller det egna kontot. `user_exists` (409) finns bara på den admin-skyddade `POST /auth/users`, en kod för både namn och e-post så att den inte säger vilket fält som träffade. Ett id i en annan grupp ger samma `not_found`, status och text som ett id som inte finns (A6, ADR 012 beslut 5): ett test jämför svaren byte för byte. `invalid_invite_code` svarar lika oavsett orsak. Katalogen lägger alltså inga nya existenssignaler till de som redan finns; nuvarande statusar bevaras (till exempel `Run not found` 404 mot `Not authorized` 403 i `runs.ts`, vars skillnad finns redan i dag).
- **Tester:** (a) en kanariefågel: en test-route kastar ett fel vars meddelande innehåller `activity 12345678901`, `lat 57.70887, lng 11.97456` och `token SECRET`; svaret (500) och svaret på en trasig JSON-body med ett lösenord ska vara exakta, fasta kroppar utan någon del av dem; (b) katalogtestet nekar koder som `^strava_\d{3}$`, `^PGRST`, `^E[A-Z]+$` och `^seam_`; (c) 404 saknar `path` och `method`; (d) not-found-paret (okänt id mot id i annan grupp) ger identiska kroppar.

**6. `written:true`.** Betydelsen "raden är skriven men omräkningen föll, försök inte igen" ska leva kvar, och den bärs av koden i stället för ett eget fält.
- `POST/PUT/DELETE /api/runs` svarar fortfarande 500, nu `{ success:false, error:'Run was created|updated|deleted but XP recalculation failed', code:'recalc_failed_after_write' }`. Statusen är kvar (ett 500 utan den koden betyder, som i Notering 2026-10-12, att inget skrevs).
- Klientens regel (kontraktet, inte bara en text): vid `recalc_failed_after_write` behandlas skrivningen som genomförd, run- och totals-cachen invalideras, formuläret återställs, en ny `Idempotency-Key` tas och användaren uppmanas inte att försöka igen. Det är den enda kod med ett beteende klienten MÅSTE ha.
- Under dubbelsvarsfönstret (punkt 8) skickar servern också `written: true`, och klienten läser antingen fältet eller koden. Fältet tas bort i steg 2. RUN-354 byter då `backendApi.ts` `writtenFailure`, `runEffects.ts` och de tre läsningarna (`:820`, `:848`, `:1126`) till koden. Idempotensen i Notering 2026-10-13 är oförändrad.

**7. Frontend.**
- RUN-353:s (S12, "En API-klient i frontend") `request` är den enda uppackaren. Den läser `success`, `data`, `meta`, `error` och `code`; vid en 2xx utan `success` (steg 1, gamla svar) läser den den gamla nyckeln. Utan en känd kod faller den tillbaka på statusens klass. `'Consent required'`-jämförelsen i `useStravaActions.ts` byts mot `code === 'consent_required'`.
- Sessionen rensas bara vid 401 med `unauthorized` eller `token_invalid` (inte `invalid_credentials` eller `current_password_incorrect`; i dag gör `authenticatedRequest` utloggning på varje 401).
- Klienten visar `error` för användaren och loggar `code` och status, aldrig kroppen.

**8. Utrullning: expand, dubbelsvar, contract.**

| Steg | Backend | Frontend | När |
|---|---|---|---|
| 1 (expand, v0.8.1) | `success` och `code` på varje svar och fel; JSON-felhanterare, 404, parsefel; `data` skickas BREDVID de gamla nycklarna för de nakna svaren och för `success:true`-svar med nyttolast utanför `data` (`{events}`, `{events,meta}`, `{runs,meta}`, `{seen}`, `{ok}`, `{client_id}`, login `{token,user}`, `{message,run}`, `{message,group}`, `newRuns`/`totalUpdated`/räknare); `written:true` kvar | `request` läser `data` först och den gamla nyckeln som reserv; läser `code`; `written` eller koden | en merge; tjänsternas ordning spelar ingen roll |
| 2 (contract) | de gamla nycklarna, `written` och toppnivåräknarna tas bort; ett test per borttagen kuvertvariant | reservläsningen tas bort; läser bara `data` och `code` | tidigast 14 dygn efter att steg 1:s frontend är i prod, och alltid före PWA:ns första release |

- **Varför ordningen inte spelar roll.** Efter steg 1 fungerar alla fyra kombinationer: gammal bundle mot ny backend (de gamla nycklarna finns kvar), ny bundle mot gammal backend (reservläsningen), ny mot ny, gammal mot gammal. Därför behövs ingen "koordinerad release" och Railways parallella deploy är ofarlig. Steg 2 har samma egenskap: efter fönstret finns ingen aktiv klient som läser de gamla nycklarna, och en frontend utan reservläsning mot en backend som fortfarande skickar dubbelt fungerar likaså. Den enda hårda regeln är att steg 2 inte görs före fönstret är slut.
- **Hur länge backend tål gamla klienter.** Fönstret är MINST 14 dygn från att steg 1:s frontend är live i prod (två gånger JWT-livslängden på 7 dygn, `JWT_EXPIRES_IN`; täcker en flik som stått öppen och en session som loggar in på nytt) och SENAST PWA:ns första release. Före PWA:n är en klients ålder begränsad av att `index.html` är `no-cache` och av `staleChunkReload.ts`; med sex användare kan ägaren dessutom be alla ladda om. Efter PWA:ns första release finns ingen sådan övre gräns: därefter får inget kuvert ändras på plats, och ett kontrakt som ska brytas kräver API-versionering (revisit-trigger nedan).
- **Rollback.** Inga migrationer och ingen data berörs, så all rollback är en Railway-redeploy av tjänsten (`docs/release.md` steg 9): backend först om API:t felar, frontend först om felet syns i UI:t. Från steg 1 tål varje enskild tjänst att rullas tillbaka ett steg: backend tillbaka till föregående bygge ger gamla nycklar som den nya bundlen läser via reservläsningen; frontend tillbaka läser dubbelsvaret. Efter steg 2 är backend tillbaka till steg 1-bygget (dubbelsvar) säkert mot varje klient, och frontend tillbaka till steg 1-bygget är säkert mot en backend i steg 2, eftersom steg 1:s bundle läser `data`. Rulla aldrig tillbaka förbi steg 1 medan fönstret är öppet eller efter det (en bundle som bara läser de gamla nycklarna).
- **Verifiering.** Staging följer integrationsgrenen och har samma parallella deploy, så Lead kör steg 1 där, med kombinationerna gammal och ny bundle mot ny och gammal backend (en gammal bundle går att bygga från `main`). Röken i prod är flöde 1 (login, skyddade anrop), logga en runda, Board och events.

**9. Tester (ADR 001).** Alla befintliga tester är gröna; en förväntan ändras bara där en kuvertvariant medvetet byts, med motivering i PR:en (`useRunChanges.test.tsx`, `EditRunSheet.test.tsx`, `useCreateRun.test.tsx`, `useLogForm.test.tsx` och `backendApi.runWritten.test.ts` har `written` i sina förväntningar och byter i steg 2). Nytt: `respond.test.ts` (kuvertets form, `fail` med och utan kod); supertest mot hela appen för trasig JSON mot en autentiserad och en oautentiserad `/api`-rutt (400, `Content-Type: application/json`, `{success:false,error,code:'invalid_json'}`), ett okastat fel (500), 404, 413, 415 och `headersSent`; kanariefåglarna i punkt 5; katalogens fästa lista; undantagslistan; ett test per kuvertvariant i steg 1 (båda formerna) och i steg 2 (den gamla formen finns inte kvar); wiring-testet (ADR 003) utökas så att varje routers 401 har felformen; CI-vakten (punkt 2). Frontend: `request` mot båda formerna, okänd kod, `consent_required`, `recalc_failed_after_write` (med och utan `written`).

### Alternativ som övervägts
- **En omskrivning i ett enda steg ("koordinerad release").** Enklast att skriva, men Railway deployar parallellt utan ordning, så det blir ett fönster på minuter då en sida är fel, och en rollback av bara den ena tjänsten ger fel hos gamla flikar. Med sex användare är skadan liten men inte noll, och dubbelsvaret kostar bara en hjälpare och ett test per variant. Ägaren valde dubbelsvaret 2026-10-20.
- **`application/problem+json` (RFC 9457).** Standard, men en ny mediatyp och nya fältnamn (`type`, `title`, `detail`) för en enda konsument som redan läser `success` och `error`. Avvisat; `code` motsvarar `type` utan URI-ceremonin. Kan läggas till senare utan att bryta något.
- **Kasta typade fel (`throw new ApiException(404,'not_found')`) och mappa centralt.** Renare på sikt (Express 5 hanterar avvisade löften), men 235 ställen ändrar kontrollflödet från `res.status().json(); return;` till `throw`, vilket är en riskfylld omskrivning av varje handler. Ett anrop av `fail` är mekaniskt och går att granska. Kan göras senare ovanpå samma katalog.
- **Skicka felorsaken (`strava_503`, `PGRST116`) som `code`.** Avvisat (punkt 3 och 5): läcker implementationsdetaljer och blandar orsak med utfall.
- **Bara HTTP-status, ingen kod.** Avvisat: samma status betyder olika saker (409 har sex, 401 har fyra), och den enda fritextjämförelsen i klienten är redan skör.
- **Numeriska koder eller koder per rutt.** Avvisat: oläsliga i loggar, och katalogen blir en lista per endpoint som växer med varje rutt.
- **207 som ett lyckat svar.** Avvisat (punkt 4).

### Konsekvenser
- **Kostnad, tjänster, data:** ingen kostnad, inga nya externa tjänster, ingen databas, inga migrationer. Ingen känslig data tillkommer. **Flagga:** felsvaret är den enda kanal där skrubbern inte körs; skyddet är strukturellt (punkt 5) och testat.
- **Positivt:** PWA:n och RUN-353:s `request` får en uppackning och en felmodell; klienten grenar på koder i stället för fritext; JSON även för parsefel och okända rutter (i dag HTML); en `path` med frågesträng ekas inte längre; den oanvända `ApiError` i shared används på riktigt.
- **Negativt/risker:** (1) Hela API:ts svarsform ändras: mekaniskt men brett (316 `res.*`-anrop i `routes/`), så RUN-354 bör delas av Lead (naken form först, därefter `success:true`-svar med nyttolast utanför `data`) och granskas av integration-critic; login och Strava-flödet (kritiska flöden) rökas. (2) Dubbelsvaret gör `runs` (högst 200 rader) och `events` upp till dubbelt så stora under fönstret; backend har ingen komprimering. Ok för sex användare, men fönstret ska inte glömmas. (3) Katalogen kan växa okontrollerat om RUN-354 mappar varje text till en egen kod; villkoren i punkt 3 och det fästa testet är spärren. (4) Fönstret på 14 dygn är en uppskattning av klientåldern: backend ser ingen bundle-version, så "ingen gammal klient kvar" kan inte mätas, bara antas. (5) `ok(res, null)` gör att `data` kan vara `null`; klienten måste tåla det (S12). (6) Loginsvaret för okänt konto hoppar över `bcrypt.compare`, så svarstiden skiljer sig något från fel lösenord (befintligt, begränsat av `loginRateLimiter`, 20 försök per 15 min och IP); den ändras inte här men är en liten separat åtgärd (jämför mot en dummy-hash).
- **Förhållande till befintliga beslut:** A1 och A2 ändras uttryckligen (pekare i texten); A3–A8, B och noteringarna 2026-10-11 till 2026-10-13 gäller i övrigt. ADR 010:s webhook är undantagen, inte ändrad.
- **Arkitekturdiagram:** ingen ändring. Felhanteraren och hjälparen ligger i den befintliga backend-komponenten; inga nya komponenter eller kopplingar.

### Ägarens beslut 2026-10-20 (i chatten, "Kör på rekommendationerna")
1. **Dubbelsvar i två steg** (punkt 8), inte en omskrivning i ett steg.
2. **Steg 2 gäller alla svar med nyttolast utanför `data`**, även login, `run`, `group` och `newRuns`. Login rökas särskilt.
3. **Fönstret:** minst 14 dygn efter att steg 1:s frontend är live i prod, och alltid före PWA:ns första release. Steg 2 ligger därför i en senare version än v0.8.1.
4. **Tidsläckan i login** (konsekvens 6) blir ett eget ärende i v0.8.1.

### Revisit-triggers
- PWA:ns första release: därefter ändras inget kuvert på plats; kontraktsbrytande ändringar kräver API-versionering (huvud eller sökväg) och en minsta klientversion. Samma sak om en andra konsument (mobilapp) tillkommer (ADR 007:s trigger "fler än en konsument" är då uppfylld).
- Katalogen passerar ca 50 koder, eller en kod får två betydelser i praktiken: gruppera per domän eller släpp "en kod per utfall".
- Supporten behöver koppla en användares felrapport till en loggrad: lägg ett `request_id` i kuvertet (och i loggraden), inte i detta steg.
- Någon vill ha ett fel som kastas (`throw`) i stället för `fail`: gör det ovanpå samma katalog, rutt för rutt.
