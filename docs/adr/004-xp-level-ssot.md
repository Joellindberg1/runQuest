# 004. XP-/level-matematik: shared som enda hem, en källa för streak-multiplikatorerna

## Status
Godkänd av ägaren 2026-10-04 (Fas 2-paketet). Beslut 4 (multiplikatorernas
datakälla) är villkorat av DB-verifiering som Lead gör före implementation —
se Beslut 4 och Konsekvenser.

## Kontext
Spelmatematiken (XP, level, streak-multiplikator) är kärnan i RunQuest och
bor på flera ställen (STATE.md zon 4, audit i `docs/STATE-proposal.md`).
Verifierat i koden 2026-10-04:

- **XP per runda: en källa, bra.** `packages/shared/src/xpCalculation.ts`
  (`calculateCompleteRunXP`, `calculateStreakMultiplier`, `AdminSettings`,
  `StreakMultiplier`) plus `boostCalculation.ts`; 42 tester. Används av
  backendens `routes/runs.ts`. Frontend har paketet som dependency men
  importerar det inte (README:s påstående är fel).
- **Backendens `utils/xpCalculation.ts` är till stor del död kod med
  avvikande fallback:** `calculateRunXP`/`calculateRunXPLegacy` (DB-läsande
  duplikat av formeln, fallback min-distans 1.6 km mot den levande
  `runs.ts`-fallbackens 1.0 km), `metersToKm`, `getXPForLevel` och
  `getLevelProgress` anropas ingenstans utom som mock-mål i `runs.test.ts`
  och `runs-idor.test.ts`. Modulens ENDA levande del är den tunna
  `getLevelFromXP`-wrappern, som anropas av `utils/calculateUserTotals.ts`
  och `services/eventService.ts` (två ställen, rad ~212 och ~354).
- **Levelgränser i två DB-läsande kopior:** backend
  `services/levelService.ts` (läser `level_requirements`, cache för
  processens livstid, hårdkodad 30-nivåers fallback som LÅSES permanent efter
  ett enda DB-fel, `MAX_LEVEL` 30 hårdkodad) och frontend
  `shared/services/levelService.ts` (anon-läsning, localStorage-cache,
  samma hårdkodade tabell, plus en TREDJE approximation i den synkrona
  vägen före init: hårdkodade trösklar till nivå 15, därefter
  `floor(xp/100)+1`; en annan hårdkodad tabell i `getXPForLevelSync` som
  bara har 15 nivåer). Ändrad `level_requirements` kräver backend-omstart.
  Frontend använder de synkrona varianterna i `UserProfileModal`,
  `leaderboardUtils`, `StatsTab`.
- **Streak-multiplikatorernas källa är tvetydig:** `routes/runs.ts`
  (`fetchAdminSettings`) läser KOLUMNEN `admin_settings.streak_multipliers`
  (`?? []` -> multiplikator 1.0 om tom; vid select-fel, t.ex. om kolumnen
  saknas, tyst fallback till hårdkodade defaults); admin-endpointen
  `GET/PUT /api/auth/streak-multipliers` läser/skriver TABELLEN
  `streak_multipliers` (PUT = `delete` alla + `insert`, ej atomärt);
  `PUT /api/auth/admin-settings` rör inte kolumnen; frontend har en tredje,
  hårdkodad kopia (`constants/streakConstants.ts`, 5/15/30/60/90/120/180/220/
  240/270 dagar -> 1.1…2.0). Ingen migration i repot skapar kolumnen. Vilken
  källa som faktiskt styr XP-beräkningen i prod är **overifierat** (Lead har
  DB-åtkomst, Arkitekten har inte).
- Streak-BERÄKNING (per-runda `streak_day` i `reprocessRunsFromDate` vs
  `StreakService` current/longest) är två oberoende implementationer
  (zon 4c) — **ligger utanför denna ADR** (se Beslut 6).
- Relaterade ADR:er: 001 (teststrategi: ny logik ska vara ren och testbar,
  beteendetest av XP-kedjan), 003 (app-factory: ingen koppling, men
  `routes/runs.ts`-testerna påverkas av mock-ändringen här). Ingen ADR
  ersätts.

## Beslut
1. **`packages/shared` blir enda hemmet för level-matematiken**, som rena
   funktioner med data som argument (ingen I/O, inga globala singletons):
   - `LEVEL_REQUIREMENTS_FALLBACK` — den kompletta 30-nivåerstabellen
     (`{level, xp_required}[]`; enda hårdkodade kopian i repot).
   - `MAX_LEVEL = 30`.
   - `getLevelFromXP(totalXP, requirements)`, `getXPForLevel(level,
     requirements)`, `getXPForNextLevel(level, requirements)`,
     `getLevelProgress(totalXP, requirements)` (samma returform som i dag:
     `currentLevel, currentLevelXP, nextLevelXP, progress, xpToNext`).
     `requirements` är ett OBLIGATORISKT argument (inget tyst default) så att
     anroparen måste välja sin datakälla.
   - `normalizeLevelRequirements(rows)` — validerar och sorterar rader från DB
     (icke-tom, stigande, nivå 1 = 0 XP) och returnerar `null` om ogiltig, så
     att anroparen faller tillbaka till fallback-tabellen med en loggad varning.
   - Semantiken bevaras (högsta nivå vars tröskel ≤ XP, cap `MAX_LEVEL`,
     progress 100 / xpToNext 0 på max). Enhetstester per tröskel (gräns-1,
     gräns, gräns+1), negativt XP, över max, ogiltig tabell, progress på max.
2. **Datahämtning ligger kvar i apparna, men är tunn och delar logiken:**
   - Backend: `services/levelRequirements.ts` med
     `getLevelRequirements()` — läser `level_requirements`, validerar via
     `normalizeLevelRequirements`, cachar med TTL (5 min, så ändrad tabell
     slår igenom utan omstart), returnerar senaste goda cache eller
     fallback vid fel och **låser aldrig fallbacken** (nytt försök efter
     kort TTL, 30 s). `calculateUserTotals` och `eventService` anropar
     `getLevelFromXP(xp, await getLevelRequirements())`.
   - Frontend: en `useLevelRequirements()`-hook (TanStack Query, läser
     `level_requirements` via nuvarande anon-läsning, lång `staleTime`,
     `placeholderData` = shared-fallbacken) så att synkron användning aldrig
     blockerar och aldrig ger fel nivå. Komponenter/utilar
     (`UserProfileModal`, `leaderboardUtils`, `StatsTab`) tar `requirements`
     som argument eller via hooken. `localStorage`-cachen och alla
     synkrona hårdkodade trösklar/approximationer tas bort.
3. **Död kod bort:** hela `apps/backend/src/utils/xpCalculation.ts` (inkl.
   `getLevelFromXP`-wrappern; de två anropen flyttas enligt beslut 2),
   klassen `LevelService` i backendens `services/levelService.ts` (filen
   ersätts av `levelRequirements.ts`), frontendens `FrontendLevelService`
   (`shared/services/levelService.ts`), `frontend/src/constants/
   streakConstants.ts`, samt hårdkodade defaults i `routes/runs.ts` som
   flyttas till shared (`DEFAULT_ADMIN_SETTINGS`, `DEFAULT_STREAK_MULTIPLIERS`).
   Mock-blocken för `xpCalculation.js` i `runs.test.ts` och
   `runs-idor.test.ts` tas bort/anpassas. Frontend importerar
   `@runquest/shared` (Vite-alias/tsconfig-paths eller byggt paket — Builders
   val; kravet är att `frontend-build` i CI och Railway-bygget från ren
   checkout går igenom och att shared förblir fritt från Node-/DB-beroenden).
4. **EN källa för streak-multiplikatorerna. Rekommenderad och förvald källa:
   TABELLEN `streak_multipliers`.** (Villkorat — se verifiering nedan.)
   - Backend: en funktion `getStreakMultipliers()` (TTL-cachad, läser
     tabellen) används av `runs.ts` (`fetchAdminSettings` slutar läsa
     kolumnen) och av ett nytt autentiserat läs-endpoint (inte admin) som
     frontend använder för visning (PlaybookPage m.fl.; namn/placering väljs av
     Builder, route-test krävs enligt ADR 001). Frontend läser via
     TanStack Query med `DEFAULT_STREAK_MULTIPLIERS` som `placeholderData`;
     den hårdkodade kopian i `streakConstants.ts` försvinner.
   - Tom eller ogiltig tabell räknas som felkonfiguration: fel loggas och
     `DEFAULT_STREAK_MULTIPLIERS` används (i dag ger tom kolumn tyst
     multiplikator 1.0). **Antagande att verifiera:** att "ingen
     streak-multiplikator" aldrig är en avsedd inställning.
   - `PUT /api/auth/streak-multipliers` görs atomärt (en RPC-funktion eller
     transaktion; i dag kan ett misslyckat `insert` efter `delete` lämna
     tabellen tom, vilket med tabellen som XP-källa vore allvarligt) och
     validerar indata (`days` heltal > 0 och unika, `multiplier` ≥ 1,0).
     RPC/constraints är en migration (nästa lediga nummer enligt ADR 002,
     ägargodkänd, expand/contract).
   - Kolumnen `admin_settings.streak_multipliers` (om den finns) slutar läsas
     och droppas i en senare, separat migration efter att ingen kod använder
     den.
   - **Verifiering före implementation (Lead, skrivskyddade SQL-frågor):**
     (V1) finns kolumnen `admin_settings.streak_multipliers` (information_schema)?
     (V2) vad innehåller den? (V3) vad innehåller tabellen `streak_multipliers`
     (alla rader)? (V4) stämmer V2/V3 med shared-defaults/frontend-konstanten
     (10 trappsteg, 1,1…2,0)? (V5) finns trigger/funktion som synkar tabell ->
     kolumn (`pg_trigger`/`pg_proc`)? (V6) stämmer de 30 värdena i
     fallback-tabellen med de 30 raderna i `level_requirements`?
   - **Utfall:** *Samma data överallt* (V2 = V3 = defaults, eller kolumnen
     saknas och V3 = defaults) -> ren refactor, tabellen väljs, ingen
     XP-påverkan. *Data skiljer sig* (kolumnen styr i dag med andra värden än
     tabellen/admin-UI:t, kolumnen saknas medan tabellen avviker från de
     defaults XP faktiskt räknats med, eller kolumnen är tom/null =
     multiplikator 1,0 för alla) -> **genuint öppet vägval för ägaren
     (beslut 15b)**: vilka värden ska gälla, och ska historik räknas om?
     Arkitekten avgör inte detta; Lead lägger fram de faktiska värdena för
     ägaren. Multiplikator-delen av implementationen väntar på svaret;
     level-delen (beslut 1–3) är oberoende och kan byggas direkt.
   - Ändrade multiplikatorer eller XP-inställningar räknar inte om historik
     automatiskt (som i dag); det är oförändrat och ingår inte i denna ADR.
5. **Verifiering av level-fallbacken (V6):** om `LEVEL_REQUIREMENTS_FALLBACK`
   avviker från prod-tabellen vinner prod-värdena och fallbacken
   uppdateras (fallbacken ska spegla prod, inte tvärtom). Backend- och
   frontend-fallbackarna är i dag identiska i koden (30 värden).
6. **Utanför denna ADR:** streak-beräkningens dubbelimplementation (zon 4c,
   föreslås som egen ADR), schedulers, om frontend ska sluta läsa
   `level_requirements` direkt från Supabase (anon-policyn är medvetet kvar,
   `docs/permissions.md`).

## Alternativ som övervägts

**Level-matematik**
- **Behålla två servicer men synka tabellerna manuellt** — bortvalt: det är
  nuläget, och det har redan gett tre divergerande approximationer.
- **Hårdkoda levels i shared och sluta läsa `level_requirements` från DB** —
  bortvalt: tabellen finns och är avsedd att vara justerbar; en kodändring +
  deploy för varje balansändring är sämre än en DB-rad. Fallback-tabell i shared
  + DB som sanning är kvar.
- **Frontend hämtar levels från backend i stället för anon-läsning** —
  övervägt (skulle stänga sista anon-läsningen): bortvalt för denna ADR för
  att hålla ändringen liten; omprövas om anon-policyn på `level_requirements`
  tas bort.
- **Behålla `getLevelFromXP`-wrappern i `utils/xpCalculation.ts`** — bortvalt:
  modulen är i övrigt död och bär en avvikande fallback; en halv modul är
  fortsatt förvirring.

**Multiplikatorkälla (tabell vs kolumn) — för och emot**

| | Tabell `streak_multipliers` | Kolumn `admin_settings.streak_multipliers` (jsonb) |
|---|---|---|
| För | En rad per trappsteg: kan få constraints (unik `days`, `multiplier` ≥ 1). Admin-endpoints, admin-UI och typer pekar redan hit (starkaste indicium på avsedd källa). Formen matchar shared `StreakMultiplier[]`. | Läses redan av XP-vägen i samma enda query som övriga XP-inställningar — minsta kodändring i `runs.ts`. Inställningar och multiplikatorer uppdateras atomärt i en rad med gemensam `updated_at`. |
| Emot | Ytterligare en query i skrivvägen (10 rader, TTL-cache eliminerar det). Dagens `PUT` är delete+insert utan transaktion -> måste göras atomärt innan tabellen blir XP-källa. Kräver ändring i `runs.ts`. | Ovaliderad jsonb: fel form ger tyst 1,0-multiplikator (`?? []`). Admin-endpoint/UI skriver inte hit i dag — måste kopplas om. Kolumnens existens är overifierad (ingen migration skapar den). |
| Risk | Om kolumnen i dag är den levande källan med andra värden än tabellen ändras XP framåt vid bytet. | Om tabellen är den admin-UI:t visar blir UI och verklighet kvar i konflikt tills UI kopplas om. |

Rekommendation: **tabellen**, främst för att admin-gränssnittet och dess
endpoints redan skriver dit (där ägarens avsikt sannolikt finns) och för att
constraints är möjliga; atomaritetsnackdelen löses med en RPC. Rekommendationen
gäller om verifieringen (Beslut 4) visar samma data överallt; skiljer sig data
är valet ägarens.

- **Behålla båda källorna och synka med trigger** — bortvalt: dubblerar
  sanningen i stället för att ta bort den.
- **Hårdkoda multiplikatorerna i shared (ingen DB-källa)** — bortvalt: bryter
  admin-UI:ts funktion (admin kan redigera dem i dag) utan att ägaren
  beslutat det; shared behåller dem bara som sista fallback.

## Konsekvenser
- **Inga nya externa tjänster, ingen kostnad.** Ingen ny datalagring; ingen
  känslig data berörs. Möjlig DB-påverkan: en migration (atomär
  ersätt-RPC/constraints på `streak_multipliers`, senare drop av kolumnen) —
  ägargodkänd per migration enligt `docs/permissions.md` och ADR 002,
  additiv först. Inga RLS-/policyändringar (anon-läsning av
  `level_requirements` kvar; anon-läsning av `streak_multipliers` stängdes redan
  av migration 031, vilket är skälet till att frontend får multiplikatorerna via
  backend).
- **Produktionsrisk:** `calculateUserTotals` (skrivvägen, zon 1) och
  `eventService`-levelräkningen byter datakälla. Skyddas av ADR 001:
  enhetstester för shared-level, beteendetest av XP-kedjan mot fake med riktig
  level-logik, route-testernas mockar uppdaterade, samt rök av flöde 2
  före deploy. Om multiplikatorkällan byts och data skiljer sig ändras XP för
  nya rundor — därför öppet vägval till ägaren i det fallet.
- **Positivt:** en sanning per begrepp; ändrade levels slår igenom utan
  omstart; frontend kan inte längre visa annan nivå än backend (tre
  approximationer borta); ~200 rader död/duplicerad kod bort; shared blir
  verkligen delad (frontend-dependency får en användning).
- **Negativt/risker:** (1) Frontend får bundla `@runquest/shared`
  (några kB) och bygget måste klara workspace-/alias-upplösningen — Railway
  deployar på push oberoende av CI, så Builder måste köra frontend-bygget från
  ren checkout före push. (2) Frontends nivåvisning blir asynkront
  data-beroende (placeholder = fallback, så ingen blockering men kan visa
  fallback-värden korta stunder om DB-värdena avviker — därför V6). (3)
  Ytterligare ett backend-endpoint (route-test krävs). (4) Streak-beräkningen
  (zon 4c) förblir dubbel tills egen ADR.
- **Arkitekturdiagram:** ingen ändring — `docs/architecture/
  runquest-architecture.json` är på runtime-komponentnivå; shared är ett
  byggtidsbibliotek och frontends direkta anon-läsning av `level_requirements`
  (kopplingen `browser-to-db-anon`) är oförändrad.
- **STATE.md-ändringar att föreslå:** zon 4 omformuleras till "löst av ADR 004
  (level + multiplikatorer); kvar: streak-beräkningens dubbelimplementation";
  Stack-raden för `packages/shared` får "XP, level-matematik, streak-multiplikator,
  boost; konsumeras av backend OCH frontend" när implementerad; README:s
  påstående rättas därmed. Ordlistan oförändrad.

## Revisit-triggers
- Verifieringen (V1–V6) visar att data skiljer sig -> ägarbeslut, ADR
  uppdateras med utfallet (valt värdeset, ev. omräkning av historik).
- Ägaren vill ha per-grupp-konfiguration av XP/level/multiplikatorer (i dag
  global `admin_settings` med `id = 1`) -> datamodellen och källan omprövas.
- `level_requirements` får admin-redigering i UI -> TTL/invalidering omprövas.
- Frontend slutar läsa `level_requirements` direkt (anon-policyn tas bort) ->
  level-data via backend, diagrammets anon-koppling ändras.
- Streak-beräkningen konsolideras (egen ADR) -> flytta även den till shared.
