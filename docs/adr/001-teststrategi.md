# 001. Teststrategi

## Status
Godkänd av ägaren 2026-10-04 (Fas 2-paketet)

## Kontext
RunQuest är en live-produkt (Produkt-läge, runquest.dev, 6 aktiva användare).
Obligatorisk teststrategi-ADR enligt `templates/adr-teststrategi-mall.md`,
kalibrerad mot verkligheten 2026-10-04 (audit i `docs/STATE-proposal.md` zon 9
plus CI-fixen samma dag):

- Vitest ^4 finns i backend och `packages/shared`. Backend: 67 route-tester
  (supertest mot `app.ts`, DB/shared/`calculateUserTotals`/`xpCalculation`
  mockade) plus `streakService.test.ts`. Shared: 42 enhetstester (XP-formel,
  streak-multiplikator, boostberäkning). Frontend: 0 tester, ingen testrigg.
- CI (`.github/workflows/ci.yml`). Blockerande: backend `tsc` + build + test,
  shared-tester, frontend-build. Icke-blockerande (`continue-on-error`):
  frontend `tsc -b` (~98 fel) och `eslint` (37 problem: 15 fel, 22 varningar).
  Branch protection på `main` kräver grön CI, men Railway deployar på push
  OBEROENDE av CI.
- Det som skyddar användarna mest saknar beteendetest: skrivvägen för varje
  runda (`reprocessRunsFromDate` -> `calculateUserTotals`, STATE zon 1) körs
  aldrig mot riktig logik i test — route-testerna mockar hela kedjan, så de
  bevisar HTTP-formen men inte att XP, level, streak och boostar blir rätt.
  De 21 titelmotorerna (`titleEngines/`) är rena funktioner
  (`calculate(runs, userStats) => number`) men har noll tester.
- Enda DB-miljön är prod; ingen staging (öppet vägval, avgörs separat av
  ägaren och låses INTE här — se ADR 002). Tester får därför aldrig skriva mot
  prod, och en riktig-DB-nivå (integrationstest mot lokal/staging-Supabase)
  kan inte antas finnas.
- Befintliga ADR:er: inga (detta är den första). Relaterade samtidiga ADR:er:
  002 (baslinjeschema — förutsättning för riktig DB i test), 003 (app-factory —
  gör wiring testbar), 004 (level-matematik i shared — gör level-logik ren).

## Beslut

### Ramverk
- **Vitest** för enhets- och integrationstester i alla workspaces (finns i
  backend/shared; installeras i frontend).
- **React Testing Library + jsdom** i frontend (beteende, aldrig utseende).
  Installeras som första steg i Fas 2 — utan rigg kan "ny kod kräver tester"
  inte uppfyllas i frontend.
- **Playwright** antas som E2E-ramverk men INSTALLERAS först när en
  icke-prod-miljö finns (staging eller lokal Supabase byggd ur baslinjen,
  ADR 002). Se "E2E-rök" nedan.

### Nivåer (pyramiden, kalibrerad)
1. **Enhetstester (bredast).** Ren logik utan I/O: shared (XP, streak, boost,
   level — ADR 004), titelmotorer, `dateUtils`, frontendens rena
   utils/hooks.
2. **Beteendetest av XP-kedjan (ny nivå, motiverad nedan).**
3. **Route-/wiring-tester (supertest mot `createApp()`, ADR 003).** Varje ny
   eller ändrad endpoint: happy path + viktigaste felfallet + auth-/IDOR-fall
   där resursen är användarägd.
4. **E2E-rök** (Playwright, villkorad av miljö) — exakt STATE.md:s sju kritiska
   flöden.

### Beteendetest för XP-kedjan
`reprocessRunsFromDate` och `calculateUserTotals` ska testas mot RIKTIG logik
(riktiga `@runquest/shared`, riktig level-logik från ADR 004, riktig
kedjeordning) med en **minimal in-memory-fake av Supabase-klienten**:
- Fake i `apps/backend/src/test-utils/fakeSupabase.ts`: tabeller som arrayer,
  stöder bara den delmängd av query-buildern kedjan använder
  (`from/select/eq/in/gte/lte/order/insert/update/delete/single/maybeSingle/rpc`).
  Anrop utanför delmängden KASTAR (aldrig tyst pass) så fakens täckning är
  synlig.
- Gränsen mockas bara där den är extern eller separat testad:
  `EnhancedTitleService.processAllUsersTitles` och leaderboard-RPC (titlar
  testas via motorerna), Strava och väder.
- Obligatoriska scenarier: första rundan (XP/level/streak_day); streak-
  multiplikator slår in vid 5 dagar; redigering av datum ordnar om kedjan;
  radering av mellanrunda räknar om efterföljande; `event_xp` ingår i
  `total_xp`; `multiplier_days` OCH `multiplier_runs`-boost tillämpas
  (regressionsskydd för fix `ca23e1f`); level-up ger token via
  `reconcileTokensForLevel`.
- Kända buggar dokumenteras som `it.fails(...)` med hänvisning till STATE-zon
  (t.ex. "radera sista rundan nollställer totalerna", zon 1) — de blir gröna
  och vänds till `it(...)` när buggen fixas. En fix av en känd bugg kräver
  att testet vänds i samma PR.
- Fakens trohet mot PostgREST är en känd risk (se Konsekvenser); den hålls
  liten med flit.

### Titelmotorer
- **Kontraktstest för alla 21** (en parametriserad fil): unik `metricKey`, alla
  nycklar i `titleEngines/index.ts` finns i registret, tom runlista kastar inte
  och ger ändligt tal, ingen `NaN`.
- **Beteendetester med fixtures för de icke-triviala** (tid-/datumberoende och
  fönsterlogik): `earlyRunCount`, `lunchRunCount`, `nightRunCount`,
  `lastRunOfWeek`, `maxWeekdayStreak`, `longestRunAfterBreak14/30`,
  `maxKmRolling30`, `maxRunsOneWeek`, `weekendAvg`, `bestDoubleDayKm`,
  `avgPaceStdDev`, `lowestPaceStdDev`, `fastest5km/HalfMarathon/Marathon`.
  Triviala motorer (`totalKm`, `longestStreak`, `longestRun` m.fl.) täcks av
  kontraktstestet. Att ett test avslöjar tidszonsantagande i `start_time`
  (UTC vs Stockholm) är ett förväntat fynd — det rapporteras, fixas inte tyst.
- Motor skapad eller ändrad efter detta beslut kräver eget beteendetest
  (samma regel som övrig ny logik).

### E2E-rök (Playwright)
- Ramverket och platsen beslutas nu (`apps/e2e/` eller motsvarande, en spec per
  kritiskt flöde, miljö via `BASE_URL`/`API_URL`/testkonton från env). Specarna
  skrivs för de sju flödena i STATE.md ("Rök" per flöde).
- **Muterande E2E körs aldrig mot prod** (de skapar rundor, utmaningar,
  Strava-länkar i de 6 användarnas riktiga data). De körs mot den
  icke-prod-miljö som staging-/lokal-DB-beslutet ger.
- Tills den miljön finns: Playwright installeras inte (oprövad testkod är
  skuld). Flödena verifieras i stället av (a) beteendetesterna ovan för
  flöde 2/4/5/6-kärnan och (b) STATE.md:s manuella rök-checklista inför
  release och vid hotfix. Detta är en medveten, tidsbegränsad lucka mot
  Produkt-nivån, spårad av revisit-triggern nedan.
- Prioritetsordning när miljön finns: flöde 2 (logga runda), 1 (login/admin-
  gate), 7 (profilbild), 3 (Strava mot mockad Strava), sedan 4/5/6.

### Vad som krävs av NY kod nu (Produkt-läge)
| Typ av ändring | Krav |
|---|---|
| Ny/ändrad affärslogik (beräkning, regel, motor) | Enhetstest i samma PR; ren logik placeras så att den KAN enhetstestas (data som argument, ADR 004) |
| Ny/ändrad endpoint | Route-test (happy + viktigaste fel + auth/IDOR vid användarägd resurs) |
| Ändring i skrivvägen för runda (zon 1) | Beteendetest mot fake i samma PR |
| Buggfix | Regressionstest som fallerar före fixen |
| Ny frontend-hook/util med logik, formulär, villkorat flöde | RTL/Vitest-test |
| Ny frontend-kod: typcheck och lint | Får inte öka antalet `tsc -b`-fel eller eslint-problem (se ratchet) |
| Ren styling, trivial kod utan logik, tredjepartsbibliotek | Inget test (YAGNI) |
| Befintlig otestad kod som berörs | Ingen retroaktiv täckningsplikt; testa det du ändrar |

Builder skriver test + kod tillsammans; Kritikern godkänner inte ny logik utan
tester (beslut 5). Coverage är riktmärke, aldrig mål; frågan är om de
kritiska flödena är täckta. Tom svit i ett workspace räknas som FAIL (beslut
4) — gäller så fort frontend har sin första testfil.

### CI-grind: nu och när typskulden är betald
**Nu (övergång, Fas 2):**
- Blockerande: backend `tsc` + build + test, shared-tester (och shared
  typecheck om backendens `tsc` inte täcker den — verifieras av Builder),
  frontend-build, frontend-tester så snart de finns.
- Icke-blockerande men **ratchet**: ett litet CI-steg räknar `tsc -b`-fel och
  eslint-problem och jämför mot en incheckad baslinjefil
  (`.ci/frontend-debt-baseline.json`); ÖKNING fäller bygget, minskning
  uppmuntras (baslinjen skärps i samma PR). Detta gör övergångsregeln i
  STATE.md ("får inte öka") maskinellt kontrollerbar i stället för
  Kritikerns ögonmått.

**Mål (när skulden är betald):** `tsc -b` = 0 fel OCH eslint = 0 fel och 0
varningar. I PR:en som tar bort sista felet tas `continue-on-error` bort från
båda stegen och ratchet-steget raderas; från och med då är frontend-typecheck
och frontend-lint blockerande. Därefter läggs lint till i backend och shared
med samma konfiguration (blockerande från start, eftersom ingen skuld finns).
Lead uppdaterar då "CI-grind" i `docs/permissions.md` och övergångsregeln i
STATE.md.

**Alltid:** hela sviten grön + grön CI före merge (Produkt). Deploy-grinden är
fortsatt Railways push-trigger, inte CI; den luckan (CI blockerar merge, inte
deploy) hanteras via branch protection + regeln "grön lokal verifiering före
push till main" i `docs/permissions.md`, inte av denna ADR.
Svitens körtid ska hållas under ~5 min.

## Alternativ som övervägts
- **Jest i stället för Vitest** — bortvalt: Vitest finns redan i två
  workspaces, delar Vites konfiguration i frontend och har bättre TS/ESM-
  integration (projektet är ESM överallt).
- **Fake av Supabase (valt) vs riktig DB för kedje-testet.** Riktig lokal
  Supabase (Docker + `supabase start`) ger högre trohet och är mallens default
  ("integration mot lokal Supabase"), men kräver baslinjeschemat (ADR 002,
  inte klart), Docker på ägarens Windows-maskin och långsammare CI. Bortvalt
  FÖR NU; omprövas när baslinjen finns (revisit-trigger). Att fortsätta mocka
  hela kedjan som i dag ger falsk trygghet och är inte ett alternativ.
- **Playwright mot prod med dedikerat testkonto** — bortvalt: testkontot
  skulle ligga i prod-gruppens leaderboard/titelranking och mutera riktig
  data; kan inte rullas tillbaka. Endast icke-muterande smoke (sidan laddas,
  `/health`) vore säkert men bevisar för lite för att motivera ramverket.
- **Blockera frontend-typecheck/lint nu** — bortvalt: ~98 typfel + 37
  lintproblem skulle stoppa alla merger, inklusive hotfixar. Ratchet ger
  skydd mot försämring utan att frysa arbetet.
- **Fylla i täckning retroaktivt (t.ex. 70 %-mål)** — bortvalt: coverage är
  riktmärke; med 6 användare och en utvecklare är risk-riktad täckning
  (skrivvägen, motorerna) mer värd än siffran.
- **Property-/mutationstester för XP-formeln** — bortvalt (YAGNI): shared har
  42 tester och formeln är liten och ren.

## Konsekvenser
- **Inga nya externa tjänster, ingen kostnad, ingen databas.** Alla
  nytillkomna beroenden är utvecklingsberoenden (RTL, jsdom, senare
  Playwright) — ingen prod-påverkan. Inga tester skriver mot prod.
- **Positivt:** XP-/level-/boost-kedjan — där ett fel ger fel poäng åt riktiga
  användare — får ett riktigt skyddsnät; titelmotorer blir regressionssäkra;
  typskulden kan inte växa obemärkt; när skulden är betald är nivån
  Produkt-komplett för verifiering.
- **Negativt/risker:** (1) Fakens beteende kan avvika från PostgREST (t.ex.
  null-ordning, `single()`-fel) — testerna kan vara gröna medan prod beter sig
  annorlunda; mildras av en minimal fake som kastar på okänd syntax och av
  omprövning mot riktig DB. (2) Medveten lucka: inga automatiska
  E2E-rök-tester förrän icke-prod-miljö finns; flödena förlitar sig på manuell
  checklista. (3) Ratchet-steget är ytterligare ett CI-skript att underhålla
  (litet). (4) `it.fails`-tester kan förbises — Kritikern ska lista dem vid
  varje granskning av skrivvägen.
- **Beroenden mellan ADR:er:** beteendetestet för level-delen förutsätter ADR
  004:s rena level-funktioner; riktig-DB-nivån förutsätter ADR 002:s baslinje
  och ett (separat, ännu ej fattat) staging-/lokal-DB-beslut.
- **Arkitekturdiagram:** ingen ändring (testnivåer är inte runtime-
  arkitektur).
- **STATE.md-ändringar att föreslå:** Test/CI-raden uppdateras till shared 42;
  Verifieringsnivå-övergångsregeln hänvisar till ratchet (ADR 001).

## Revisit-triggers
- Staging- eller lokal Supabase-miljö finns (ADR 002 + ägarens beslut) ->
  installera Playwright, skriv specarna, ompröva riktig-DB för kedje-testet.
- Frontend `tsc -b` = 0 fel och eslint = 0 problem -> flippa till blockerande
  (se Beslut), lägg lint i backend/shared.
- Sviten tar > ~5 min (hotfix-snabbspår, beslut 20).
- Ett produktionsfel uppstår som fakens tester gav grönt för -> ompröva
  fake vs riktig DB.
- E2E-flödena i STATE.md ändras, eller fler än ~15 användare / fler
  utvecklare -> ompröva coverage-krav och retroaktiv täckning.
