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
