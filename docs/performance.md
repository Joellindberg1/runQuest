# Prestandaövervakning (RUN-287)

Intern förvaltningsdokumentation (svenska, för Lead). Felrapporteringen i Sentry (RUN-282/284) kompletteras med tider: backend mäter
hur lång tid varje route tar, frontend mäter Web Vitals på de inloggade sidorna. Det här dokumentet säger vad som mäts, vad som inte
lämnar processen, vilka trösklar som gäller, vilka Sentry-alerts som föreslås och vad Lead gör.

## Vad som mäts

**Backend** (`apps/backend/src/observability/tracing.ts`, projekt `runquest-backend`): en transaktion per förfrågan, namngiven efter
routen (`GET /api/runs/:id`, `POST /api/runs`, `GET /api/leaderboard/week`), med de utgående anropen (Supabase, Strava, väder) som
delspans med tid och status. Startkommandot är oförändrat (`node dist/server.js`, ingen `--import`): server- och fetch-spans går via
Nodes `diagnostics_channel`, och routenamnet sätts av en middleware (`sentryRouteNaming`, monterad först i `createApp`).
Schedulers och webhook-arbetare ger ingen spårning, bara förfrågningar. `/health` spåras aldrig. Förfrågningar som svarar 401–404
och 3xx skickas inte (SDK:ts standard), inte heller 429 (vår rensning).

**Frontend** (`apps/frontend/src/shared/observability/sentryClient.ts`, projekt `runquest-frontend`):
- LCP, CLS, FCP och TTFB på en transaktion per sidladdning, namngiven efter sidan (`/board`, `/runner/:id`), och INP som en egen span.
  Mäts bara efter inloggning: Sentry-chunken laddas först när det inloggade skalet monterar. Landningen mäts av Lighthouse i CI (RUN-259, budget och rutin i `docs/release.md`).
- Sidladdningen mäts bara om dokumentet laddades på en skalsida och appen fortfarande står kvar där. Loggar användaren in från
  landningen mäts alltså inte den sidladdningen (det vore landningens LCP på `/board`); INP mäts ändå över hela besöket och
  får routenamnet för sidan som är öppen när den skickas (besökets sista sida), eftersom navigationer inte spåras.
- Inga navigationer, anrop eller resurser spåras.

**Provtagning:** högst 0,1 i båda (storyns tak, inom gratisnivåns kvot), en konstant i `packages/shared/src/tracingRate.ts`.
`SENTRY_TRACES_SAMPLE_RATE` (backend, runtime) och `VITE_SENTRY_TRACES_SAMPLE_RATE` (frontend, byggtid) kan bara sänka talet;
`0` stänger av spårningen utan kodändring. Backend tar bort `sentry-trace`, `baggage`, `traceparent` och `tracestate` ur varje
inkommande förfrågan innan SDK:t läser dem (`stripIncomingTraceContext`), så ingen utifrån kan tvinga fram spårning, äta kvoten
eller lägga egna trace-id och fria textfält i våra transaktioner och kuvertets trace-header. (I SDK 11.8 läser SDK:t huvudena först
när spanen startar, så anropet behöver inte ligga före `Sentry.init`; det görs först av försiktighet inför en senare SDK-version.)

**SDK v12:** `traceLifecycle: 'static'`, `beforeSendTransaction` och SDK:ts standardfilter för statuskoder (`ignoreStatusCodes`, som
släpper 401–404 och 3xx) försvinner i v12, där strömmande spans är enda läget. Uppgradera inte Sentry-SDK:t till v12 utan att gå
igenom `tracing.ts` och `sentryClient.ts` och flytta rensningen till `beforeSendSpan` (tillåtelselistorna flyttar med).

## Vad som aldrig lämnar processen eller webbläsaren

- **Inga spårningsheaders:** `tracePropagationTargets: []` i båda (`sentry-trace` och `baggage` läggs aldrig på anrop till
  Strava, Supabase, väder-API:t eller vårt eget API). I frontend är dessutom `traceFetch`/`traceXHR` av. Båda har test som
  fångar de utgående anropen med spårning på (`tracing.test.ts`, `sentryClient.tracing.test.tsx`).
- **Inga id, query-strängar eller bodies i transaktionsnamn eller spans.** Allt går genom `scrubTransaction` (backend) och
  `scrubTransaction`/`scrubSpanJson` (frontend) före sändning, med en lista över tillåtna attribut i stället för en lista över
  förbjudna. Vad SDK:ts auto-instrumentering lägger och vad som blir kvar:
  - Servertransaktion (SDK:t): namn med råa sökvägen, `url.full/path/query`, `client.address`, `user_agent.original`, portar,
    `request.url`, brödsmulor, användare. **Kvar:** routenamn, metod, status, provtagningstal, tid.
  - Utgående anrop, supabase-js är fetch (SDK:t): namn och `url.full` med query (`?user_id=eq.<uuid>`), `network.peer.*`, user agent.
    **Kvar:** `METOD https://värd/sökvägens form` där ett sökvägssegment bara står kvar om det står på listan
    `FIRST_PARTY_PATH_SEGMENTS` i `tracing.ts` (Supabase-vägar, våra tabeller och rpc-namn, Strava- och Open-Meteo-vägar);
    allt annat blir `:id` (`/rest/v1/runs`, `/api/v3/activities/:id`, `/storage/v1/object/public/profile-pictures/:id`), samt
    status och tid. Ett test låser listan mot migrationerna och mot `.from()`/`.rpc()` i koden, så en ny tabell syns.
  - Felhändelser från backend (inte bara transaktioner): `transaction` är routenamnet (`sentryRouteNaming` sätter det på
    förfrågans isolation scope, även för förfrågningar som inte provtagits) och `request.url` är värden plus routenamnet, aldrig
    den råa sökvägen eller query-strängen (`scrub.ts`).
  - Sidladdning (frontend): råa sökvägen, resurs-spans med adresser, `lcp.element`/`lcp.url` (t.ex. en avatars adress),
    `cls.source.*`. **Kvar:** routenamn, webbvärdena, webbläsare, tidpunkter.
  - INP (frontend): en väljare för elementet (kan innehålla `aria-label`). **Kvar:** värdet, typen av interaktion, webbläsaren.
  - Kuvertets trace-header (frontend, `dynamicSamplingContext`): bara release i sin kända form (`RELEASE_PATTERN`), miljö, nyckel,
    trace-id, provtagning och sidans routenamn; `user_segment`, `replay_id` och allt annat kastas. En release som inte matchar
    mönstret tas bort i stället för att maskas.
  - Backend skickar inte `modules` och `server_name` (behövs inte för p95).
- **En transaktion per förfrågan, bara servertransaktioner:** ett utgående anrop som avslutas efter att svaret skickats (till
  exempel en `Promise.all` där ett anrop felar medan ett annat pågår) skulle annars skickas som en egen transaktion
  `GET (no route)` med anropet som rot. `scrubTransaction` släpper allt vars rot inte är `http.server`; de sena delspansen
  syns alltså inte i förfrågans transaktion heller.

## Trösklar

Startvärden, satta utan mätdata (det finns inga transaktioner än). **Räkna om dem efter två veckor** med p95 från Sentry
(Performance → Transactions, miljö `production`): målet läggs på ungefär det uppmätta p95 plus marginal, alerten på det dubbla målet.

### Backend (p95 av transaktionstiden)

| Transaktion | Varför | Mål | Alert (över) |
|---|---|---|---|
| `POST /api/runs` | logga en runda (infogning, omräkning av serien, totaler) | 1,5 s | 3 s |
| `GET /api/leaderboard/week` | veckotoplistan | 0,6 s | 1,5 s |
| `GET /api/leaderboard/rank-delta` | rankförändring på toplistan | 0,6 s | 1,5 s |
| `GET /api/auth/users-with-runs` | gruppens löpare och rundor (board) | 0,8 s | 2 s |
| `GET /api/titles/leaderboard` | titlarnas topplista | 0,8 s | 2 s |
| `POST /api/strava/webhook` | Strava kräver 200 inom 2 s (ADR 010) | 0,3 s | 1 s |

### Frontend (p75, Googles gränser för Web Vitals)

| Mått | Sida | Bra (mål) | Dåligt (alert över) |
|---|---|---|---|
| LCP | `/board` | 2,5 s | 4 s |
| CLS | `/board` | 0,1 | 0,25 |
| INP | hela besöket | 200 ms | 500 ms |

### Läs det här innan du litar på en alert

Med 6 användare och 10 % provtagning blir det några få prover per dag och route. Ett p95 på så få prover är i praktiken "den
långsammaste av dem": en enda långsam förfrågan (kall start efter deploy, Supabase som hostar om) kan ensam fälla alerten. Därför
fönstret 1 dygn, och alerten är en signal att titta i Sentry, inget som ska väcka någon. Behövs mer underlag: lägg till prover
genom fler användare, inte genom att höja taket.

## Föreslagna Sentry-alerts (Lead skapar dem)

Metric alerts, en per rad, miljö `production`, fönster 1 dygn, åtgärd "mejla ägaren". Tröskeln är alert-kolumnen ovan.

Backend, projekt `runquest-backend`, datakälla Transactions:

| Namn | Mått | Filter | Kritisk över |
|---|---|---|---|
| p95 logga runda | `p95(transaction.duration)` | `transaction:"POST /api/runs"` | 3000 ms |
| p95 veckotoplista | `p95(transaction.duration)` | `transaction:"GET /api/leaderboard/week"` | 1500 ms |
| p95 rank-delta | `p95(transaction.duration)` | `transaction:"GET /api/leaderboard/rank-delta"` | 1500 ms |
| p95 board-data | `p95(transaction.duration)` | `transaction:"GET /api/auth/users-with-runs"` | 2000 ms |
| p95 titeltoplista | `p95(transaction.duration)` | `transaction:"GET /api/titles/leaderboard"` | 2000 ms |
| p95 Strava-webhook | `p95(transaction.duration)` | `transaction:"POST /api/strava/webhook"` | 1000 ms |

Frontend, projekt `runquest-frontend`, datakälla Transactions:

| Namn | Mått | Filter | Kritisk över |
|---|---|---|---|
| p75 LCP /board | `p75(measurements.lcp)` | `transaction:"/board"` | 4000 ms |
| p75 CLS /board | `p75(measurements.cls)` | `transaction:"/board"` | 0,25 |

INP kommer som en egen span (`ui.interaction.*`, värdet i `browser.web_vital.inp.value`), inte som mått på transaktionen. Kontrollera
i alert-byggaren om Spans-datakällan går att använda för p75 på den; annars läses INP i Sentrys Web Vitals-vy (Insights) en gång i
månaden. Skriv i så fall in vad som valdes här.

## Att göra i drift (Lead)

1. **Inget måste sättas** för att spårningen ska starta: den följer `SENTRY_DSN` (backend) och `VITE_SENTRY_DSN` (frontend) och är
   på med 0,1 så fort koden är deployad. Railway-startkommandot (`npm run start --workspace=@runquest/backend`) ändras inte.
   Vill du ha den avstängd: `SENTRY_TRACES_SAMPLE_RATE=0` på backend-tjänsten (omstart) och `VITE_SENTRY_TRACES_SAMPLE_RATE=0` på
   frontend-tjänsten (ny build).
2. **Provtagningen i staging:** med 0,1 syns en av tio. Verifiera genom att köra ungefär 30 anrop mot samma route, och ladda
   `/board` inloggad ungefär 30 gånger. Då har minst en sidladdning sannolikt provtagits (95 %).
3. **Granska första transaktionen i Sentry** (öppna händelsens JSON) i staging före prod: namnet är routenamnet, inga id, inga
   query-strängar, inga headers eller användare, och delspansen är `METOD https://värd/sökvägens form`.
4. **Skapa alerts** enligt tabellerna. Efter två veckor: räkna om trösklarna (se Trösklar) och ändra tabellerna här.
5. **Om du någon gång vill ha Sentrys modul-instrumentering** (Express-lager, databasklienter): det kräver `--import` och ett
   ändrat startkommando, till exempel `node --import ./dist/instrument.mjs dist/server.js`, en egen `instrument`-fil som bygger
   `Sentry.init`, och att `enableRuntimeChannelInjection: false` tas bort. Det behövs inte för tider per route och görs inte här.

## Supabase Query Performance (Lead läser, en gång)

Mot prod, bara läsning. Syftet är att hitta index som saknas; varje fynd blir ett eget ärende (en migration med ägarens ja per
migration, `docs/release.md`).

1. **Dashboard → Database → Query Performance.** Sortera på "Total time" och därefter "Mean time". Anteckna de 10 främsta
   frågorna, deras antal anrop och medeltid. Se särskilt efter frågor mot `runs`, `activity_log`, `user_boosts`, `user_titles`,
   `title_leaderboard`, `strava_webhook_events` och `events`/`event_entries`, som routerna i tabellen ovan läser.
2. **`get_advisors` med typ `performance`** (Supabase MCP, `supabase`): listar främmande nycklar utan index, oanvända index,
   RLS-policyer som räknar om `auth.uid()` per rad och dubbla policyer.
3. **Samma data som SQL** om rapporten inte räcker (`execute_sql`, bara `select`):

   ```sql
   -- Frågor som tar mest tid totalt
   select left(query, 120) as query, calls, round(mean_exec_time::numeric, 1) as mean_ms,
          round(total_exec_time::numeric) as total_ms, rows
   from extensions.pg_stat_statements
   order by total_exec_time desc
   limit 20;

   -- Tabeller som läses sekventiellt mest (kandidater för index)
   select relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
   from pg_stat_user_tables
   where schemaname = 'public'
   order by seq_tup_read desc
   limit 20;

   -- Främmande nycklar vars första kolumn inte är först i något index
   select c.conrelid::regclass as tabell, a.attname as kolumn, c.conname
   from pg_constraint c
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = a.attnum)
   order by 1, 2;
   ```
4. **Jämför med indexen som redan finns** (`000_baseline.sql` plus migrationerna från 032; kontrollera `pg_indexes` för det
   faktiska läget): `runs` har index på `(user_id, date)`, `date`, `user_id` och `(external_id, user_id)`; `user_boosts` på
   `(user_id, expires_at)`; `title_leaderboard` på `(title_id, position)` och `user_id`; `users` på `group_id`. Ett fynd är en
   tung fråga (hög `total_ms` eller `seq_tup_read`) vars filterkolumner saknas här.
5. En tabell med några hundra rader får ofta en sekventiell läsning även när ett index finns, för att planeraren väljer det
   billigaste. Skapa inte index på tabeller under några tusen rader utan att frågan faktiskt är långsam.
