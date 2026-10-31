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

## Landningens baslinje (RUN-260)

Mätt 2026-10-19 (RUN-328, S1 i ADR 006, addendum 2026-10-19) på `/` **innan** förrenderingen finns: `dist/landing.html` och Caddy-regeln saknas, så `/` serveras av `index.html` och landningen ritas av JS (lazy `Index`-chunk). Det här är siffrorna S4–S6 ska slå, och underlaget för ägarbeslut C.

**Hur det mättes.** Bygge av `integration/v0.8.0` (76e2834e), `npm run build` i `apps/frontend`. `scripts/lighthouse/run.sh` oförändrat (mobilprofil, 3 körningar, Caddy på 127.0.0.1) i båda `STATS_MODE`. Desktop och "applicerad strypning" (nedan) kördes med samma servering och egna lhci-inställningar (`preset: desktop` respektive `throttlingMethod: devtools`), 3 körningar vardera. Lighthouse 12.6.1, Microsoft Edge 155 headless (`--headless=new`) på Windows, **inte** Linux/Chrome som CI. Absoluta tal är alltså lokala och ska inte jämföras mot CI-medianerna i `docs/release.md`; jämför före/efter på samma maskin. Råa rapporter ligger inte i repot. Medianer av 3 körningar, siffror för `/`.

### Mått (median av 3)

| Profil | Läge | Perf | LCP (ms) | FCP (ms) | CLS | TBT (ms) |
|---|---|---|---|---|---|---|
| Mobil (simulerad strypning, som CI) | API ger fel | 0,81 | 4 347 | 2 722 | 0,018 | 7 |
| Mobil (simulerad strypning, som CI) | falskt API | 0,81 | 4 326 | 2 727 | 0,000 | 27 |
| Desktop | API ger fel | 0,99 | 936 | 609 | 0,009 | 0 |
| Desktop | falskt API | 0,99 | 934 | 614 | 0,000 | 0 |
| Mobil, applicerad strypning (tillägg, brusig) | API ger fel | 0,69 | 5 386 | 2 985 | 0,018 | 211 |
| Mobil, applicerad strypning (tillägg, brusig) | falskt API | 0,67 | 5 521 | 3 033 | 0,000 | 247 |

Enskilda körningar (LCP, mobil simulerad): fel 4 364 / 4 347 / 4 264, falskt API 4 326 / 4 279 / 4 467. Applicerad strypning varierar mer (LCP 5 243–7 195 ms, TBT 142–1 035 ms; första körningen är kall). Den raden är ett tillägg: den visar riktiga, ordnade nätverkstider under 150 ms RTT, 1,6 Mbit/s och 4× CPU, men är inte CI:s mått. Budgetens `/legal` låg på LCP 2 909 / 2 961 ms (mobil, fel/falskt API).

### LCP-elementet

| Profil | Element (selektor ur `largest-contentful-paint-element`) | Typ |
|---|---|---|
| Mobil (390 px) | `div#film > div.rq-film__stage > picture.rq-film__poster > img` | filmens poster, `landing-film-poster-480.v1.webp`, `loading="lazy"`, ruta 370×207 vid y = 464 |
| Desktop | `div.rq-landing__inner > main.rq-landing-main > section.rq-landing-hero > h1#landing-title` | rubriktext, ruta 679×265 |

Samma element i alla 12 mobilkörningar och alla 6 desktopkörningar. På desktop ritas h1 när CSS och JS är klara; filmens poster (720-varianten, 50 954 B) laddas men är inte LCP. Efter S2 byter mobilpostern id (`#film-mobile`), selektorn ovan ändras då.

### LCP-faser, mobil

| Fas (median) | Simulerad, fel | Simulerad, falskt API | Applicerad, fel |
|---|---|---|---|
| TTFB | 453 ms (10 %) | 452 ms | 5 ms |
| **Load delay** (tid till att postern begärs) | **3 191 ms (≈ 74 %)** | **3 064 ms (≈ 71 %)** | **4 171 ms (≈ 77 %)** |
| Load time (själva hämtningen) | 99 ms (≈ 2 %) | 64 ms (≈ 1 %) | 1 188 ms (≈ 22 %) |
| Render delay | 548 ms | 715 ms | 35 ms |

Lighthouse underkänner `lcp-discovery-insight` och `lcp-lazy-loaded` i alla mobilkörningar: begäran finns inte i det första dokumentet, `fetchpriority="high"` saknas och bilden är `loading="lazy"`. (`prioritize-lcp-image` godkänner, eftersom bilden redan hämtas med hög prioritet först när den väl finns.) Desktop-LCP (h1) har load delay 0 och render delay ≈ 0,8 s.

### Nätverksordning (Lighthouse `network-requests`, ms från första begäran: start till slut)

Observerade tider, localhost utan strypning (mobil, median av 3; falskt API inom parentes där det skiljer sig):

| Resurs | Start – slut | Anmärkning |
|---|---|---|
| `/` (dokumentet) | 1 – 5 | 3 542 B, ingen `landing`-markup, tom `#root` |
| `fonts/bebas-neue-400.v1.woff2` | 22 – 36 | förladdad i `<head>` |
| **`assets/index-BDyySsWJ.js` (ingångs-JS)** | **30 – 46** | `modulepreload` av `router-` och `react-query-` samtidigt |
| `assets/index-CinfvKFm.css` | 32 – 40 | renderingsblockerande |
| **`assets/Index-B4w1MJSK.js` (landningens lazy-chunk)** | **169 – 177** (160 – 164) | begärs först när ingångs-JS körts och routern valt `Index` |
| `assets/Index-OCyMgc2W.css` | 170 – 176 | landningens CSS, hör till samma lazy-chunk |
| **`media/landing-film-poster-480.v1.webp` (poster)** | **286 – 288** (305 – 312) | prioritet Low i Chrome (lazy), begärs efter lazy-chunken |
| `/api/public/stats` | 221 – 225 (211 – 216) | efter hydrering |

Lokalt är allt snabbt; det som visar ordningen är att postern är **tredje nivån**: dokument, sedan ingångs-JS, sedan lazy-chunken, sedan postern. Samma kedja med applicerad strypning (mobil, median av 3, fel-läge; falskt API inom parentes), där tiderna är verkliga:

| Resurs | Start – slut (ms) |
|---|---|
| dokumentet | 1 – 590 |
| ingångs-JS | 637 – 2 720 (624 – 2 719) |
| entry-CSS | 637 – 1 955 |
| lazy-chunk `Index-*.js` | 3 040 – 3 770 (3 086 – 3 826) |
| `Index-*.css` | 3 043 – 3 724 |
| **poster** | **4 173 – 5 349 (4 268 – 5 449)** |
| LCP | 5 386 (5 521) |

Desktop (observerat, median): ingångs-JS 21 – 37, lazy-chunk 150 – 156, poster (720) 255 – 262 (falskt API 332 – 345).

### Bytes

Ingångskedjan på `/` är sex JS-filer. Rått, gzip (nivå 9, `zlib`) och överfört enligt Lighthouse (Caddy `encode`, med svarshuvud):

| Fil | Rått | gzip | Överfört |
|---|---|---|---|
| **`index-BDyySsWJ.js` (ingångs-chunk)** | **495 849 B** | **152 994 B** | 159 880 B |
| `router-Dbt-CLBq.js` (modulepreload) | 162 532 B | 53 252 B | 56 052 B |
| `react-query-CHP6laak.js` (modulepreload) | 39 697 B | 11 794 B | 12 666 B |
| **`Index-B4w1MJSK.js` (landningens lazy-chunk)** | **27 570 B** | **9 164 B** | 9 800 B |
| `TextField-DwlUB5us.js`, `previewUsers-DeZ1pD3M.js` (lazy, små) | 1 106 + 1 929 B | 541 + 770 B | 879 + 1 133 B |
| **Summa JS på `/`** | **728 683 B** | **228 515 B** | **240 410 B** (= `resource-summary:script:size` 240,4 kB) |
| `index-CinfvKFm.css` (renderingsblockerande) | 216 871 B | 32 913 B | 36 979 B |
| `Index-OCyMgc2W.css` (landning) | 27 637 B | 4 554 B | 5 310 B |
| `landing-film-poster-480.v1.webp` (mobil) | 27 246 B | – | 27 552 B |
| `landing-film-poster-720.v1.webp` (desktop) | 50 954 B | – | 51 261 B |

Totalt överfört på `/`: ca 431 kB (mobil, 20 begäranden). Budgettaket för skriptvikt är 275 kB. Teckensnitten väger 116 kB (sex filer, bara Bebas Neue är förladdad).

### Slutsats för ägarbeslut C: är mobilpostern LCP-flaskhalsen?

**Ja, postern är LCP-elementet på mobil (12 av 12 körningar), men det är inte bildens storlek som kostar, det är att den upptäcks sent.** Tre fynd:

1. **Väntan, inte hämtning.** 71–77 % av mobil-LCP är load delay (3,1–4,2 s) innan postern ens begärs; själva hämtningen är 1–2 % (64–99 ms simulerat). Under riktig strypning är hämtningen 1,2 s, men med 150 ms RTT (562 ms i Lighthouses strypning) är det troligen mest latens, inte de 27 kB (inte separat mätt).
2. **Orsaken är JS-kedjan.** Postern finns inte i dokumentet; den skapas av landningens lazy-chunk, som i sin tur begärs först efter att ingångs-JS (496 kB rått, 160 kB överfört) hämtats och körts. Ingen yta ritas heller före JS: mobil-FCP är 2,7 s, redan över målet 2,5 s, så även en omedelbart hämtad poster hade inte räckt utan förrendering.
3. **Desktop är inte ett problem att lösa med postern.** LCP är rubriken (0,93 s), långt under målet.

Det betyder att S4–S6 (förrendering, `<link rel="preload" … fetchpriority="high">` för mobilpostern, `loading="eager"`) träffar den faktiska orsaken. Att **minska postern** vore en dålig hävstång på dessa siffror: 27 kB är ca 6 % av sidans 431 kB och hämtningen 1–2 % av LCP. Att **flytta postern under första skärmen** ändrar bara vilket element som blir LCP (troligen h1 eller ingressen), men löser inte att inget ritas före JS. Ingen av de tre vägarna i beslut C ska väljas på dagens underlag.

Det som **inte** går att avgöra ur baslinjen: om 2,5 s nås efter förrendering. Hypotesen är att kedjan blir dokument, CSS (37 kB), poster (27 kB) i stället för dokument, JS, lazy-chunk, poster, men S6 måste mäta det. Beslut C blir aktuellt först om S6:s mobil-LCP fortfarande ligger över 2,5 s **och** postern fortfarande är LCP-elementet; då avgör LCP-fasen "load time" i den rapporten om det är bildens storlek (minska eller flytta) eller något annat som kostar. Ligger postern kvar som LCP men load delay är nära noll vore storleken nästa hävstång. TBT är lågt idag (7–27 ms simulerat, 211–247 ms applicerat); hydrering av hela landningen kan höja det (ADR 006, risk 2), så den raden ska följas i S6.

## Lean ingång för landningen (RUN-331, S4)

Mätt 2026-10-19 på bygget av S4 efter kaskadfixen i RUN-331 (`npm run build` i `apps/frontend`, prodläge, grenen med S3 och S5 inne). `dist/landing.html` finns men **serveras inte på `/` än** (Caddy-regeln kom i S6, RUN-333, se avsnittet längst ner; filen nåddes dessförinnan på `/landing.html` och `/landing` via `try_files`, vilket lean ingången hanterar, se `src/landing-entry/README.md`), så det här är bytes ur filerna, inte Lighthouse-tider: LCP/FCP/TBT mäts först i S6. Jämförelsen är mot S1:s tabell "Bytes" ovan (samma metod: rått, och gzip nivå 9 med `zlib`; "överfört" via Caddy kan inte mätas innan `/` serveras). Räknade filer är exakt de som `landing.html` laddar före första målningen: ingångs-JS, dess `modulepreload`-chunkar och dess `<link rel=stylesheet>`.

| Första besöket på `/` | Före (S1, `index.html` + lazy `Index`) | Efter (`landing.html`) | Skillnad |
|---|---|---|---|
| JS, rått | 728 683 B (6 filer) | **407 719 B** (7 filer) | −44 % |
| JS, gzip | 228 515 B | **133 940 B** | −41 % |
| CSS, rått | 244 508 B (`index-*.css` + `Index-*.css`) | **107 005 B** (3 filer) | −56 % |
| CSS, gzip | 37 467 B | **21 276 B** | −43 % |
| Dokumentet | 3 542 B, tom `#root` | 26 528 B (6 572 B gzip i S4), med landningen i `#root` | +23 kB rått: det är innehållet |

[Omräknat 2026-10-19 efter sidvisningarna (RUN-335, S5b), som lade till `LandingPageviews` och lean-sändaren: `landing-*.js` är 3 544 B rått (S4: 3 218) och `form-*.js` 173 993 B rått (S4: 173 722); tabellen ovan har de omräknade summorna (JS rått 407 719 B, gzip nivå 9 133 940 B, `landing.html` 26 528 B). Siffrorna i stycket nedan är S4:s, gzip-värdena för de två filerna är inte omräknade.] Ingångskedjan efter S4, rått / gzip: `landing-*.js` 3 218 / 1 475, `router-*.js` 162 532 / 53 252, `react-query-*.js` 39 697 / 11 795, `form-*.js` (delad chunk med React m.m.; Rollup döper delade chunkar efter en av sina moduler, så namnet säger inget) 173 722 / 57 587, `safeNext-*.js` (landningens komponenter och delade moduler) 25 332 / 8 379, `previewUsers-*.js` 1 928 / 765, `TextField-*.js` 692 / 438. CSS: `theme-*.css` (temafilen `index.css`: Tailwind, tokens, globala regler; delad med appen) 61 573 / 13 457, `form-*.css` (delad formulär- och leaderboard-CSS) 16 881 / 3 127 och `safeNext-*.css` (landning, film, väntelista) 28 551 / 4 692. Inloggningsdialogen, `/legal`, skalet, huvudsidorna och touren (`driver.js`) ligger inte i kedjan (testat mot byggets chunkgraf, `landingBuild.test.ts`). Dialogen är en egen lazy chunk som förhämtas på pekare/fokus/beröring mot Sign in och bär skalets överlagerlager (`app-shell-*.css`, 10 911 B rått / 2 204 B gzip) med sig; det lagret ligger alltså inte i första besökets CSS men är samma fil som appen länkar, så det är varmt efter överlämningen.

**Fullappen (`index.html`, alla adresser utom exakt `/`)** delar nu några chunkar med landningen. Ingångskedjan på `/board` är 700 373 B rått / 220 545 B gzip mot 698 078 / 218 040 i S1 (ingång + router + react-query): +2,3 kB rått, +2,5 kB gzip i extra chunkgränser, CSS 217 147 B rått mot 216 871. Den dagliga vägen in är alltså i praktiken oförändrad i vikt. Dokumentet är 6 287 B mot 3 542 B: laddningsvyn (stadion-ovalen) står nu förrenderad i `#root` och målas när CSS:en är laddad, före ingångs-JS.

**Byggtid.** `vite build` ≈ 11–12 s lokalt (Windows), förrenderingssteget (SSR-bygge av `landing-ssr.tsx` och två `render*`-anrop) lägger ≈ 3 s; hela `npm run build` ≈ 15 s. Ingen webbläsare och inga nya beroenden. SSR-bunten byggs under `node_modules/.cache/rq-prerender-*`, importeras en gång och raderas (också när bygget faller).

**Kontroller som inte är siffror.** Beräknade stilar (alla egenskaper på alla element, Chromium headless, reducerad rörelse, 390 och 1440 px) är identiska mellan S4:s bygge och bygget före S4 för `/`, `/legal`, `/preview`, `/preview/challenges`, `/preview/badges`, för landningen i lean ingången (`landing.html`) mot den gamla klientrenderade landningen, för inloggningsdialogen öppen i lean ingången mot fullappen, och för `/legal` nådd från lean landningen: inget element skiljer sig på någon av sidorna (136 till 1 476 element per sida). Bundlingen delar CSS mellan två ingångar, så ordningen i kaskaden kunde ha ändrats; se nästa stycke. Hydreringen av den byggda `landing.html` i Chromium headless ger inga konsolfel eller varningar, ersätter inget serverritat element (306 av 306 behålls) och startar om inga CSS-animationer (12 körande på 390 px, 21 på 1 440 px, alla med oförändrad starttid).

**Kaskadordningen (RUN-331, integrationskritiken).** Den ändrades faktiskt för fullappen: temat (`index.css`) delas av båda ingångarna, Rollup lade det i en delad fil och Vite länkar delade filer före ingångens egen CSS, så `index.html` länkade temat FÖRST. Före S4 låg temat sist i appens enda stilmall. Följden var att driver.js `.driver-popover-close-btn { all: unset }` (lika specificitet som temats globala `:focus-visible`, senare regel vinner) tog bort fokusringen på tourens stängknapp på `/board`. Det syntes inte i den tidigare jämförelsen eftersom den inte öppnade touren. Rotfix: temat är en egen chunk (`manualChunks` `theme`) och `stylesheetOrder.ts` placerar den **sist** i `index.html` (som förr) och **först** i `landing.html` (som landningen alltid haft den: landnings-CSS:en lazy-laddades efter temat). Därtill har stängknappen en egen `:focus-visible`-regel som inte beror på ordning. Provet `landingBuild.test.ts` läser byggets länkordning, och bygget faller om temat inte är länkat. Beräknade stilar (alla egenskaper på alla element, headless Chromium, reducerad rörelse, 390 och 1 440 px) för `/board` inloggad med touren öppen (inkl. fokusringen på tourens knappar vid sex Tab-tryck), `/legal`, `/preview`, `/preview/challenges` och `/preview/badges` mot bygget före S4: 0 skillnader. `/` och `/login` i fullappen och lean landningen mot bygget före kaskadfixen: 0 skillnader. Mot bygget före S4 skiljer sig landningen och `/login` bara i höjder (+73,39 px) från sifferradens reserverade remsa (S3), inga kaskadegenskaper. Läget var laddningsläget, innan sifferraden fått något API-svar (`—` på tre platser); så beskrev kritikern det, och det är inte omprovat i andra lägen (RUN-333).

**Stilmallarnas vikt efter kaskadfixen** (rått / gzip nivå 5 som Caddys `encode` / gzip nivå 9): `index.html` länkar 5 filer, 217 147 B / 36 606 B / 35 421 B (S1: 1 fil, 216 871 B / 34 326 B / 32 913 B; före kaskadfixen: 4 filer, 36 027 B gzip 5). `/legal` lägger `LegalPage-*.css` (1 449 B rått): 6 filer, 218 596 B / 37 147 B. `landing.html` länkar 3 filer: 107 005 B / 21 741 B / 21 276 B. Budgeten `resource-summary:stylesheet:size` är 50 000 B överfört. **Mätt överfört (RUN-333, Chrome mot Caddy, `encodedDataLength` inklusive svarshuvuden, kall cache):** `/` före S6 (serverad av `index.html`, som också hämtade den lazy landningschunkens CSS: `safeNext-*.css` och dialogens) **46 667 B, alltså 3 333 B marginal mot 50 000 B**; `/legal` **41 473 B** (8 527 B marginal, oförändrad av S6); `/` efter S6 (`landing.html`) **23 710 B, 26 290 B marginal**. [Rättat 2026-10-19: den tidigare uppskattningen "≈ 41,7 kB gzip nivå 5, ≈ 6 kB marginal" var för snäll. Caddys gzip är ca 6 % större än zlib nivå 5 och varje fil bär ca 0,3 kB svarshuvuden, så det verkliga läget före S6 var 3,3 kB marginal (kritikerns Lighthouse-mätning: ca 4,2 kB).] Kaskadfixen kostar ≈ 0,6 kB på `/` och `/legal` (en extra fil, sämre komprimering), och att temat delades ut ur den stora filen ger landningen och appen samma temafil i cachen. Provet `landing.spec.ts` ("the stylesheets on / and /legal stay under the budget") läser samma mått mot staging i varje e2e-körning och skriver siffrorna i loggen.


## Förrenderingen påslagen (RUN-333, S6)

Caddy-regeln för exakt `/` är på (`Caddyfile`): `/` ger `landing.html`, alla andra adresser `index.html`. Mätt 2026-10-19 med `bash scripts/lighthouse/run.sh` i båda lägena (API ger fel / falskt API) på prodbygget, lokalt på Windows i Microsoft Edge 155 (Lighthouse 12.6.1 via lhci, mobil, simulerad långsam 4G och 4x CPU, medianen av 3). Samma metod och maskin som baslinjen i S1, alltså inte CI-runnern (Linux, Chrome) och inte prod: poäng och tider är jämförbara mot S1, inte mot S7:s CI-mätning.

| Mått, medianen | `/` före (S1, `index.html`) | `/` efter (`landing.html`), API ger fel | `/` efter, falskt API | `/legal` efter (`index.html`, laddningsvy), fel / falskt |
|---|---|---|---|---|
| Prestanda | 0,81 | **0,91** | 0,90 | 0,89 / 0,89 |
| LCP | 4 347 / 4 326 ms | **3 011 ms** | 3 014 ms | 3 069 / 3 053 ms (S1: 2 909 / 2 961) |
| FCP | 2 722 / 2 727 ms | 2 563 ms | 2 457 ms | 2 856 / 2 855 ms |
| TBT | 7 / 27 ms | 54 ms | 86 ms | 7 / 0 ms |
| CLS | 0,018 / 0 | 0,001 | 0,001 | 0 / 0 |
| JS (överfört) | 237 kB | **141,6 kB** | 141,6 kB | 233,8 kB |
| CSS (överfört) | 42 kB | **23,7 kB** | 23,7 kB | 41,5 kB |
| Totalvikt | 428 kB | **319 kB** | 319 kB | 314 kB |

- **Förrenderad `/` är det som mäts.** `run.sh` vägrar mäta om `dist/landing.html` saknas och kontrollerar via Caddy att `/` innehåller `landing-title` och `/legal` laddningsvyn (`rq-shell__pending`); dokumentet på `/` är 7,1 kB överfört, `/legal` 2,4 kB. LCP-elementet är fortfarande filmens poster (`landing-film-poster-480`).
- **Stilmallsbudgeten (50 000 B) har nu 26,3 kB marginal på `/`** (23,7 kB; samma 23 710 B mäter e2e-provet, inklusive svarshuvuden, mot ≈ 3,3 kB marginal före S6 då `index.html` också hämtade den lazy landningschunkens CSS) men bara ≈ 8,5 kB på `/legal` (41,5 kB; `/legal` serveras av fullappen och är oförändrad i vikt). Tillgänglighet 1, SEO 1, best practices 0,96–1.
- **Målet 2 500 ms nås inte lokalt: LCP 3 011 ms.** Faserna för `/` (första körningen): TTFB 453 ms, load delay 0 ms, load time 83 ms, **render delay 2 474 ms (82 %)**. Postern hämtas alltså direkt och snabbt; det som väntar är första målningen (FCP 2,56 s), dvs. stilmallarna som blockerar ritning under simulerad långsam 4G. Beslut C (ADR 006) handlar om postern, men posterns hämtning är inte flaskhalsen i den här mätningen. Siffran är lokal (release-dokumentet noterar att lokalt mäts ca 0,9 s högre än prod); S7 sätter taket efter minst fem CI-körningar. [Uppföljning 2026-10-20 (RUN-343): stilmallarna var inte huvudorsaken i simuleringen; JS:et som hämtades före första ritningen var det. Se avsnittet "Landningens LCP mot 2,5 s" längst ner.]
- **TBT** är högre än baslinjen (54 respektive 86 ms mot 7 respektive 27 ms) men långt under taket 200 ms: hydreringen av hela landningen syns (ADR 006, risk 2). `/legal` ligger något sämre än i S1 lokalt (poäng 0,89 mot 0,91–0,92, LCP 3 069 mot 2 909 ms, ca 0,15 s); laddningsvyn i `index.html` är den enda ändringen av den adressen, men före/efter är mätt i olika sessioner och orsaken är inte utredd. S7 jämför `/legal` före/efter i CI.

## Landningens LCP mot 2,5 s (RUN-343)

Mätt 2026-10-20 på `integration/v0.8.1` (3a2731a1) före och på branchen `perf/run-343-landing-lcp` efter, båda som prodbygge (`npm run build` i `apps/frontend`), med `bash scripts/lighthouse/run.sh` oförändrat i båda lägena (`STATS_MODE=error|mock`), lokalt på Windows. **Medianen av 9 körningar per sida och läge** (`LHCI_COLLECT__NUMBER_OF_RUNS=9`; `lighthouserc.json` är orörd, budgeten likaså), före och efter växelvis på samma maskin i samma session. Lighthouse 12.6.1 via lhci, mobil, simulerad långsam 4G och 4x CPU. Webbläsaren är Playwrights headless-skal (Chromium 151): Edge 155, som S1 och S6 mätte i, startar inte via Lighthouses startare i den här miljön. Absoluta tal går därför inte att jämföra mot S6:s tabell (där `/` låg på LCP 3 011 ms) eller mot CI (Linux, Chrome); före/efter nedan är jämförbara sinsemellan. **CI-siffrorna fyller Lead i** (utkast-PR:er före och efter, minst 6 körningar per läge): se "CI" längst ner.

### Mått (median av 9)

| Sida, läge | Perf | LCP (ms) | FCP (ms) | CLS | TBT (ms) | CSS (B, överfört) | JS (B) | Totalt (B) |
|---|---|---|---|---|---|---|---|---|
| `/` före, API ger fel | 0,92 | 2 859 | 2 560 | 0,0006 | 14 | 23 338 | 126 494 | 303 101 |
| **`/` efter, API ger fel** | **0,99** | **1 956** | **1 506** | 0,0001 | 11 | 23 338 | 127 347 | 304 073 |
| `/` före, falskt API | 0,92 | 2 856 | 2 559 | 0,0005 | 12 | 23 338 | 126 494 | 303 370 |
| **`/` efter, falskt API** | **0,99** | **1 955** | **1 505** | 0,0001 | 10 | 23 338 | 127 347 | 304 342 |
| `/legal` före, API ger fel | 0,90 | 3 011 | 2 706 | 0 | 0 | 41 101 | 232 664 | 312 474 |
| `/legal` efter, API ger fel | 0,90 | 3 085 | 2 706 | 0 | 2 | 41 101 | 232 664 | 312 474 |
| `/legal` före, falskt API | 0,90 | 3 011 | 2 705 | 0 | 0 | 41 101 | 232 664 | 312 474 |
| `/legal` efter, falskt API | 0,90 | 3 011 | 2 705 | 0 | 0 | 41 101 | 232 664 | 312 474 |

- **`/` LCP −903 ms (−32 %), FCP −1 054 ms (−41 %), prestandapoäng 0,92 till 0,99.** Målet 2 500 ms nås lokalt med 544 ms marginal. Spridningen efter är 1 954–1 958 ms över alla 18 körningar; före var 2 855–2 898 ms utom en körning på 2 144 ms (API ger fel).
- **`/legal` är oförändrad.** Den serveras av `index.html`, som den här ändringen inte rör (samma filer byte för byte; skillnaden 3 011 mot 3 085 ms är mätbrus). `/legal` ligger kvar på ca 3,0 s: den är inte med i det här målet.
- **Vikt:** JS +853 B (boot-skriptet, se nedan), CSS oförändrad. Stilmallsbudgeten (50 000 B) har samma marginal som förut: 26,7 kB på `/`, 8,9 kB på `/legal`.
- **LCP-elementet** är fortfarande mobilpostern (`div#film-mobile > … > picture.rq-film__poster > img`) i alla körningar, före och efter.

### LCP-faser, mobil `/` (median av 9, simulerad)

| Fas | Före, fel | **Efter, fel** | Före, falskt API | **Efter, falskt API** |
|---|---|---|---|---|
| TTFB | 453 ms | **452 ms** | 452 ms | **452 ms** |
| Load delay | 151 ms | **0 ms** | 111 ms | **0 ms** |
| Load time | 233 ms | **143 ms** | 206 ms | **144 ms** |
| Render delay | 2 034 ms | **1 355 ms** | 2 082 ms | **1 360 ms** |

Faserna är medianer var för sig och summerar därför inte exakt till LCP. Render delay är fortfarande den största fasen men är nu 1,36 s mot 2,03–2,08 s.

### Vad som kostade tiden (och att stilmallarna inte var huvudorsaken)

Hypotesen i S6 var att stilmallarna (tre länkade filer) blockerar första ritningen. De gör det, men i Lighthouses simulering är de inte det som kostar mest. Lighthouse (lantern) räknar in **allt som hämtats före den observerade första ritningen** i FCP och LCP, och landningens ~126 kB JS (ingångsmodulen + sex delade chunkar, alla begärda direkt av modulskriptet och sex `modulepreload`-länkar) delar 1,6 Mbit/s och 4x CPU med stilmallarna, typsnittet och mobilpostern. Mätt med varianter av `dist/landing.html` (5–9 körningar per variant, läget API ger fel, samma maskin; enstaka körningar sprider ±100 ms och är inte lika stränga som tabellen ovan):

| Variant | FCP (ms) | LCP (ms) |
|---|---|---|
| Före (länkade stilmallar, JS direkt) | 2 560 | 2 859 |
| Alla tre stilmallar inline i dokumentet (105 kB `<style>`), JS direkt | 2 300–2 490 | 2 710–2 930 (typiskt 2 855, alltså oförändrad) |
| JS med `fetchpriority="low"` direkt (ingen annan ändring) | 1 510 | 2 870–2 930 |
| **JS efter första ritningen** (vald), länkade stilmallar | 1 656 | 1 956 |
| JS efter första ritningen + Barlow Condensed 400 förladdad (**levererat**) | **1 506** | **1 956** |
| JS efter första ritningen, stilmallarna inline | 1 505 | 2 105 |
| JS efter första ritningen + Barlow 400 och 600 förladdade | 1 506 | 2 105 |
| Golvet: ingen JS alls, länkade stilmallar | 1 654 | 1 954 |

Läsning: det som flyttar LCP är att JS:et inte hämtas före första ritningen. Det levererade resultatet ligger på golvet för en sida med de här stilmallarna, postern och typsnitten (1 956 mot 1 954 ms utan JS).

### Vald åtgärd: ingångsmodulen laddas efter första ritningen

`landing.html` är färdig HTML och syns utan JS, så modulskriptet och de sex `modulepreload`-länkarna byts i bygget mot ett enda litet modulskript (`assets/landing-boot-<hash>.js`, 927 B rått) som lägger in förladdningarna och ingångsmodulen först när `PerformanceObserver` rapporterar `first-contentful-paint`. Vite-pluginet `apps/frontend/deferLandingEntry.ts` gör omskrivningen i `generateBundle` (efter att Vite skrivit HTML-filen), texten kommer ur `src/landing-entry/deferredEntry.ts` (en ren textgenerator som `sessionHintScript`, prövad mot en riktig DOM). Bygget faller om `landing.html` inte har exakt ett modulskript med `src`. `index.html` (fullappen) rörs inte.

**Motivering.** Den enda åtgärden som flyttade LCP i mätningen, och den rör det som faktiskt kostar (JS-bytes före ritningen), inte en gissning om stilmallarna. Skriptet är en separat fil och inget inline-skript: `landing.html` har kvar exakt två inline-skript, inga `on*`-attribut, och en framtida CSP (RUN-344) behöver inget nytt i `script-src` utöver `'self'`. Fallbackerna: webbläsare utan ritningsmätning startar efter nästa bildruta, och en tidsgräns på 1,5 s startar ändå när ingen ritning kommer (en flik som öppnats i bakgrunden).

**Förkastade alternativ.**

- *Kritisk CSS inline i `landing.html`* (hela CSS:en, 105 kB, i ett `<style>`): lägre FCP (−0,07 till −0,26 s) men ingen LCP-vinst med JS direkt, och när JS:et väntar steg LCP med ca 150 ms (1 956 mot 2 105 ms): dokumentet blir 130 kB rått och postern begärs senare i simuleringen. Kostnaden går inte att motivera för ett sämre LCP. Därtill: en inline `<style>` kräver en hash i en framtida CSP (`style-src`), hashen byts vid varje CSS-ändring, och Vites förladdningslista för inloggningsdialogen (`landing-*.js` pekar på `form-*.css`) skulle ha hämtat samma stilmall en gång till när dialogen öppnas, i en annan kaskadordning (`__vitePreload` hittar ingen `<link>`), vilket hade krävt en omskrivning av den listan. En delmängd som "kritisk CSS" kräver dessutom ett verktyg som avgör vilka regler som används och en asynkron laddning av resten utan `onload` (CSP).
- *`fetchpriority="low"` på JS:et direkt:* FCP 1 510 ms men LCP oförändrad (2 870–2 930 ms), eftersom Lighthouse fortfarande räknar in begäran före ritningen.
- *Förladda både Barlow Condensed 400 och 600:* tar bort de sista 0,0001 CLS men kostar +150 ms LCP (600 är "Sign in", 14 px).
- *Färre och mindre stilmallar:* tre filer, 23,3 kB överfört, redan under budgeten med 26,7 kB marginal; utan JS är golvet 1 954 ms med dem på plats, så mindre CSS flyttar högst tiotals millisekunder.
- *Ett tredje inline-skript som laddar ingången:* gav samma LCP men kräver en hash per bygge (skriptet innehåller ingångens hashade namn) och bryter vakten på exakt två inline-skript (ADR 006, punkt 4).

### Typsnitt och CLS

Ovanför vikningen ritas rubriken med Bebas Neue 400 (redan förladdad), ingress och meny med Barlow Condensed 400, "Sign in" med Barlow 600, logotypen med Oswald och sifferraden (mobil, y = 672) med Share Tech Mono. Barlow Condensed 400 förladdas nu (`/fonts/barlow-condensed-400.v1.woff2`, 21,5 kB, `crossorigin`): utan den byter ingressen och menyn typsnitt efter första ritningen och rubriken med allt under den hoppar. Filnamnen är de manuellt versionerade filerna i `public/fonts` (inte byggets hashar) och prövas mot `@font-face` i `index.css` och mot `public/` i `staticHead.test.ts`. Mätt i Chromium, ostrypt, API-anrop avbrutna, 8 laddningar per bredd (`layout-shift`, det Lighthouse utgår från):

| Bredd | CLS före | CLS efter |
|---|---|---|
| 390 px | 0,0006 | 0,0001 |
| 1 024 px | 0,0014 | 0,0001 |
| 1 350 px | 0,0174 | 0,0001 |

Återstoden 0,0001 är "Sign in" (Barlow 600). Att förladda den också tog bort den men kostade 150 ms LCP (tabellen ovan).

### Följder att känna till

- **Hydreringen kommer senare.** Under *applicerad* strypning (Chromium DevTools-nät 1,6 Mbit/s, 150 ms latens, 4x CPU, mobil 390 px, median av 7) föll FCP från 1 276 till 1 012 ms och LCP från 1 276 till 1 028 ms, men tiden tills väntelistans formulär är levande (hydrerat, inte längre `inert`) steg från 1 634 till 2 268 ms (+634 ms): JS:et hämtas nu efter ritningen i stället för parallellt med den. Det är priset för mätningen ovan och följer av hur Lighthouse räknar. Landningen är fullt läsbar under tiden; "Sign in" är en vanlig länk (till `/login`, fullappen) och formuläret är `inert` tills hydreringen (`landing-waitlist.spec.ts`).
- **DOM:en ändras inte** av att hydreringen kommer senare (klientens första rendering är identisk med serverns; `hydrateLanding.test.tsx` och de befintliga hydreringsproven är gröna). e2e: `landing.spec.ts` och `landing-waitlist.spec.ts` kördes lokalt mot ett stagingbygge med `E2E_STUB_API=1` (23 gröna, 4 hoppade enligt `docs/e2e.md`).
- **`holdLandingScript`** i e2e-hjälparna (`**/assets/landing-*.js`) träffar nu boot-skriptet först; specerna går igenom (de håller hela kedjan och släpper den).
- **Sidvisningar:** Umami-sidvisningen skickas av den hydrerade ingången, så en besökare som lämnar innan ingången hunnit köras (efter första ritningen) räknas inte längre. Antalet för besökare som stannar är oförändrat (sidvisningsproven i e2e är gröna).
- **TBT** på `/` efter, API ger fel: hydreringen ligger nu efter FCP och räknas in. Kritikerns reproduktion (5 körningar) gav 20–73 ms (median 38) mot 11 ms i tabellen ovan; långt under taket 200 ms.
- **CSP (RUN-344):** inga nya inline-block, ingen ny hash. Oförändrade i `landing.html`: sessionstipset `'sha256-ZOYfxyHFjZ5/ZypzQqo7o6mVTAHx2LSg5JpFHQYE7bQ='` och `next-themes`-skriptet `'sha256-y6TTgelvIX7DWIP0PdL2CA4Hx4x30cz3z0XnqmSNwpw='` (prodbygget, räknat ur färdig fil). Boot-skriptet är en extern fil under `script-src 'self'`. `landing.html` har 24 `style="…"`-attribut från den förrenderade markupen (före och efter), vilket RUN-344 behöver ta ställning till för `style-src-attr`.
- **Stagingbannern** är oförändrad (stilmallen länkad i båda HTML-filerna, lazy-chunken startas av hydreringen och ingår inte i boot-skriptets graf; prövat i `landingBuild.test.ts`).

### Öppna rader

- ~~RUN-334 (skärpt budget) kan utgå från CI-siffrorna; budgeten är orörd här.~~ Genomförd i RUN-334: budgeten är skärpt per sida efter CI-mätningen (LCP på `/` ≤ 2 500 ms i stället för 5 000 ms), se avsnittet "Lighthouse-budgeten skärpt efter mätningen (RUN-334, S7)" nedan.
- **Hydreringen +0,6 s under riktig strypning** (ovan): ägaren godtog avvägningen 2026-10-20 ("snabbare text"). Värt att följa i Umami/Sentry (första interaktion) efter release; ligger den inte i vägen för väntelistans konvertering behövs inget mer. Alternativet är att starta JS:et tidigare, vilket i Lighthouses modell ger tillbaka LCP (2,87 s), så det går inte att få båda.
- `/legal` (3,0 s) och övriga sidor som serveras av `index.html` har inte åtgärdats här.
- Sentry: boot-skriptet har ingen källkarta; uppladdningen (`sentryVitePlugin`) kördes inte här (ingen token). Kontrollera i staging att byggsteget med uppladdning tål en JS-fil utan karta.

### CI

Mätt 2026-10-20 i CI-jobbet `Lighthouse — prestandabudget` (Linux, Chrome, `run.sh` oförändrat, 3 körningar per jobb). **Före:** utkast-PR #52 (`integration/v0.8.1`), sex jobb på 3a2731a1, 7a003a68, 22213447, 4b1c16d3, f61f34ad och 48fe1103 (landningen ändrades bara med +272 B JS i RUN-360 mellan dem), 18 körningar per sida och läge. **Efter:** utkast-PR #53 (RUN-343 ovanpå f61f34ad), två jobb, 6 körningar per sida och läge. Medianer, spridning för LCP inom hakparentes.

| Sida, läge | Perf | LCP (ms) | FCP (ms) | CLS | TBT (ms) |
|---|---|---|---|---|---|
| `/` före, API ger fel | 0,915 | 2 858 [2 854–3 543] | 2 555 | 0,0205 | 35 |
| **`/` efter, API ger fel** | **0,99** | **1 959** [1 956–2 106] | **1 507** | **0,0002** | 29 |
| `/` före, falskt API | 0,92 | 2 857 [2 707–2 860] | 2 557 | 0,0205 | 23 |
| **`/` efter, falskt API** | **0,99** | **1 960** [1 957–2 104] | **1 511** | **0,0002** | 26 |
| `/legal` före, API ger fel | 0,89 | 3 197 [3 003–3 225] | 2 703 | 0 | 0 |
| `/legal` efter, API ger fel | 0,89 | 3 208 [3 058–3 214] | 2 704 | 0 | 1 |
| `/legal` före, falskt API | 0,89 | 3 202 [3 007–3 213] | 2 703 | 0 | 0 |
| `/legal` efter, falskt API | 0,89 | 3 210 [3 058–3 215] | 2 704 | 0 | 3 |

**Målet nås i CI:** mobil-LCP på `/` 1 959–1 960 ms (−899 ms), 540 ms under 2 500 ms, i båda lägena. CLS på `/` i CI var 0,0205 före (över lokalt, Linux-typsnittsbyte) och är 0,0002 efter. `/legal` är oförändrad (≈ 3,2 s i CI). Lokalt och i CI ger samma LCP på `/` (1 956 mot 1 959 ms) men inte på `/legal` (3,0 mot 3,2 s).


## Lighthouse-budgeten skärpt efter mätningen (RUN-334, S7)

ADR 006, punkt 10: taken för landningen sattes ur CI-körningarna efter RUN-343 (Linux, Chrome, jobbet `Lighthouse — prestandabudget`, `run.sh` oförändrat, 3 körningar per jobb). Underlag: två jobb efter RUN-343, alltså **6 körningar per sida och läge** (fler än de fem som ADR:n kräver), i båda lägena (API ger fel / falskt API), och sex jobb före RUN-343 (18 körningar per sida och läge) som jämförelse. Raderna, de gamla och nya taken, CI-medianen, den sämsta körningen och marginalen per rad står i `docs/release.md` ("Lighthouse-budget"); här står resultatet och det som är öppet. `lighthouserc.json` har nu `assertMatrix` med egna rader för `/` och `/legal`.

### Medianer i CI (efter RUN-343, 6 körningar per läge)

| Sida, läge | Perf | LCP (ms) [min–max] | FCP (ms) [min–max] | CLS | TBT (ms) [max] | JS (B) | CSS (B) | Totalt (B) |
|---|---|---|---|---|---|---|---|---|
| `/`, API ger fel | 0,99 | 1 959 [1 956–2 106] | 1 507 [1 505–1 656] | 0,0002 | 29 [839] | 127 553 | 23 338 | 304 866 |
| `/`, falskt API | 0,99 | 1 960 [1 957–2 104] | 1 511 [1 504–1 655] | 0,0002 | 26 [30] | 127 553 | 23 338 | 305 135 |
| `/legal`, API ger fel | 0,89 | 3 208 [3 058–3 214] | 2 704 | 0 | 1 [7] | 232 577 | 41 101 | 312 964 |
| `/legal`, falskt API | 0,89 | 3 210 [3 058–3 215] | 2 704 | 0 | 3 [22] | 232 577 | 41 101 | 312 964 |

- **Målet 2 500 ms nåddes på `/`** (medianen 1 960 ms ligger under 2 250 ms, som ADR:n kräver för att målet ska bli taket). Det finns därför ingen öppen rad för `/` mot RUN-260:s mål. Taket är 2 500 ms och den sämsta enskilda körningen (2 106 ms) har 394 ms marginal.
- **FCP** hoppar i steg om ca 150 ms (1 505 ms eller 1 655 ms; ett jobb i läget falskt API hade medianen 1 655 ms). Därför räknades FCP-taket (1 950 ms) på den högsta jobbmedianen och inte på medianen av alla körningar, som hade gett 1 750 ms och bara 94 ms marginal mot den sämsta körningen.
- **Före RUN-343** låg `/` på LCP 2 857–2 858 ms, FCP 2 555 ms, CLS 0,0205 och prestanda 0,915–0,92 i CI. De nya raderna hade fällt de tolv jobb som mättes då på LCP, FCP och CLS, och släpper igenom de fyra efter. Det är uppspelat med lhci:s egen `assert` mot de sparade rapporterna, inte bara räknat för hand.

### `/legal` före och efter laddningsvyn i `index.html`

| Mätning | Prestanda | LCP | FCP |
|---|---|---|---|
| Före laddningsvyn, S1 (lokalt, Windows/Edge, median av 3) | 0,91–0,92 | 2 909 / 2 961 ms | anges inte i S1 |
| Efter laddningsvyn, S6 (lokalt, samma maskin) | 0,89 | 3 069 / 3 053 ms | 2 856 / 2 855 ms |
| Efter laddningsvyn, CI före RUN-343 (18 körningar, median) | 0,89 | 3 197 / 3 202 ms | 2 703 ms |
| Efter laddningsvyn, CI efter RUN-343 (6 körningar, median) | 0,89 | 3 208 / 3 210 ms | 2 704 ms |

- Det finns **ingen CI-mätning före laddningsvyn**: den kom med v0.8.0 (e3dbc015) samtidigt som Lighthouse-jobbet, så den enda mätningen utan laddningsvyn är den lokala från S1. Lokalt ökade LCP med ca 0,1–0,16 s; CI-skillnaden före/efter RUN-343 (11 ms) är mätbrus, `/legal` rördes inte av RUN-343.
- `/legal` behåller alla sina rader utom LCP. Taket sänks från 5 000 till 3 600 ms (uppmätt 3 210 × 1,1 = 3 531, uppåt till 100 ms), 375 ms över den sämsta enskilda körningen (3 225 ms). Det är en skärpning, inte en lättnad.

### Planterade regressioner (lokalt, `LIGHTHOUSE_BLOCKING=true`, bara 127.0.0.1)

- *`landing.html` borttagen ur en kopia av `dist`:* `run.sh` avslutar med 1 och säger att `landing.html` saknas innan något mäts (provet finns också i `lighthouse-ci.test.mjs`, i båda lägena av flaggan). I jobbet fäller det PR:en först när `LIGHTHOUSE_BLOCKING` är `'true'`.
- *200 kB oförpackbar JS tillagd i `landing.html`:* `/` fick JS 237 kB och totalt 414 kB, LCP 2 613 ms. `run.sh` avslutade med 1 och skrev tre anteckningar, bara för `/` (`/legal` med samma 233 kB JS klarar sitt tak 275 kB): `/ largest-contentful-paint … found 2612.924, expected <= 2500`, `/ resource-summary.script.size … found 237076, expected <= 150000`, `/ resource-summary.total.size … found 413823, expected <= 355000`. Med den gamla budgeten (275 kB / 500 kB / 5 000 ms) hade den regressionen gått igenom.

### Öppna rader

- **`/legal` LCP ca 3,2 s i CI ligger över 2,5 s.** Det är inte målet i S7 (`/legal` serveras av fullappens `index.html` och delar inte landningens vikt), men det är öppet: `/legal` och övriga sidor som serveras av `index.html` är inte åtgärdade (samma rad som i RUN-343:s "Öppna rader"). Taket 3 600 ms är ett golv under det som uppmättes, inte ett mål.
- **Kallstartsavvikare i TBT och prestanda (läget API ger fel).** I CI efter RUN-343 hade 2 av 12 körningar av `/` avvikande värden, båda i läget API ger fel och båda den första körningen av `/` i jobbet (kall Chrome och kall Caddy): TBT 489 ms och prestanda 0,86 (jobb 39495701891) respektive 839 ms och 0,78 (after2). I de åtta jobb i läget API ger fel som mättes (sex före, två efter RUN-343) har första körningen TBT över 150 ms i fyra jobb och prestanda under 0,90 i fem, värst 1 748 ms och 0,63; ett jobb hade dessutom TBT-medianen 128 ms. Läget falskt API, som körs efteråt, har 0 avvikare på 24 körningar. lhci prövar medianen av tre, så en avvikare fäller inget, men två i samma jobb gör det (prestandagolvet 0,90 och TBT-taket 150 ms). Kritikerns uppskattning var ca 6–8 % risk per CI-jobb att medianen av tre fäller TBT 150 ms eller prestanda 0,90, med intervall ca 1–20 %. **Åtgärdat i RUN-368:** `run.sh` värmer upp med en kasserad körning per sida före de tre räknade. Mätt på 34 CI-jobb (2026-10-19 till 2026-10-24) var första körningen av `/` i läget API ger fel över budgeten i 24 jobb (16 av 20 efter RUN-343), körning 2 och 3 i 1 fall av 68; den räknade risken per jobb är ca 2,4 % före och ca 0,13 % efter uppvärmningen (siffror, formel och antaganden i `docs/release.md`, avsnittet "Uppvärmningen").
- **Omslaget till blockerande** (`LIGHTHOUSE_BLOCKING` i `ci.yml`) var orört i RUN-334 och slogs om till `'true'` i RUN-368, efter uppvärmningen; vad som återstår (required check, kontroll av efter-datan) står i `docs/release.md`.
- **CSS- och totalraderna på `/`** (30 kB och 355 kB) följer samma regel som JS-raden (× 1,15 uppåt till 5 kB). ADR:n nämner bara JS; ägaren eller Lead kan lätta tillbaka dem mot 50/500 kB, men det är då en lättnad som kräver ägarens ok.

### Verktygstestet gjordes robust

`scripts/lighthouse-ci.test.mjs` ("run.sh when a served page cannot be fetched") föll en gång under last och på "något svarar redan på port 3001" när en annan process höll API-porten. Orsaken var fasta portar (API 3001, Caddy 18090) och korta gränser i `run.sh` (portkoll 1 s, 50 försök mot `/health`). Testet tar nu lediga portar (`API_PORT`, nya `LHCI_SERVE_PORT`), fler försök (`CADDY_WAIT_TRIES`), en rymlig portkoll i det upptagna-porten-testet (`PORT_PROBE_SECONDS`) och en timeout på `spawnSync`; standardvärdena i `run.sh` är oförändrade och CI sätter inga av dem. Provat: porten 3001 upptagen (före: 2 av 2 röda; efter: gröna), 20 körningar i följd (20/20 gröna, 5,3–5,5 s) och 8 körningar under egen CPU-last (32 räkneprocesser på 16 kärnor, 51–83 s per körning, 8/8 gröna).

## Fokus tillbaka till öppnaren (RUN-452, v0.8.3)

- Fullappens ingångs-JS (`index-*.js`) växer med cirka +228 B gzip (+143 B brotli; rått 351 451 till 352 195 B) för öppnarminnet (`shared/utils/runnerOpener.ts`) och klicklyssnaren som skalet startar; `/legal` får +188 B. Landningen `/` påverkas inte: `landing.html` och filerna den länkar är identiska före och efter. Mätt på lokala byggen före och efter ändringen; Lighthouse kördes inte lokalt.

