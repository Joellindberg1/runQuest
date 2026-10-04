<!--
  FÖRSLAG från Arkitekten (Audit-läge, beslut 22) — Lead skriver in som STATE.md i repo-roten (beslut 21).
  Allt under rubriken "Audit-underlag" i slutet ska INTE med i STATE.md (tokenbudget, beslut 50).
  Verifierat mot kod 2026-10-04 om inget annat anges. "OVERIFIERAT" = kräver DB-/Railway-åtkomst som saknades i denna körning.
-->
# STATE.md — RunQuest
Uppdaterad: 2026-10-04 av lead-orchestrator (enda skribent — beslut 21)

## Läge
Produkt          ← live på runquest.dev, 6 aktiva användare

## Stack
- Monorepo, npm workspaces (`apps/*`, `packages/*`), ESM överallt, TypeScript. Ingen ADR motiverar stackvalen (de är historiska) — retroaktiva ADR:er föreslås, se Audit-underlag.
- Frontend `apps/frontend`: React ^18.3, Vite ^7.2 (SWC), Tailwind ^3.4 + shadcn/Radix, TanStack Query ^5, react-router-dom ^6, react-hook-form + zod, recharts, driver.js (onboarding-tour). Dev-port 8080. SPA (`appType: 'spa'`).
- Backend `apps/backend`: Express ^5.1, TypeScript ^5.9 (strict, noUnusedLocals), `@supabase/supabase-js` ^2.58 med service role, egen JWT-auth (jsonwebtoken + bcryptjs), node-cron ^3.0, helmet, cors. Dev: `tsx watch src/server.ts` (port 3001). Bygge: esbuild-bundle av `src/server.ts` → `dist/server.js` (`--packages=external`).
- `packages/shared` (`@runquest/shared`): XP-per-runda-formel och streak-multiplikator (rena funktioner, 35 tester). Konsumeras ENDAST av backend (`routes/runs.ts`) — frontend har den som dependency men importerar den inte. `packages/types` (`@runquest/types`): endast `run.ts`-typer, används av frontend.
- Databas: Supabase Postgres, projekt `yrrqaxdngayakcivfrck` (24 tabeller, RLS på; migration 030 körd 2026-10-04 tog bort anonyma skriv-/läspolicyer på runs/users/user_titles). Supabase Storage-bucket `profile-pictures`. Enda DB-miljön är prod — ingen staging/preview-databas finns.
- Hosting: Railway, två tjänster — runQuest-frontend (www.runquest.dev), runQuest-backend (api.runquest.dev). Deploy vid push till `main`. Backendens Railway-konfig är rotens `railway.toml`, frontendens `apps/frontend/railway.toml` (bara buildCommand — hur frontend serveras är OVERIFIERAT).
- Externa API:er: Strava (OAuth2, aktiviteter), Open-Meteo (väder + prognos, ingen nyckel).
- Test/CI: Vitest ^4 (backend 67 tester, packages/shared 35, frontend 0). `.github/workflows/ci.yml`: backend = tsc + build + test, frontend = `tsc --noEmit` (se sköra zoner: troligen verkningslös). Node 20 i CI (engines `>=18`).
- Miljövariabler: backend `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `CORS_ORIGIN`, `NODE_ENV`, `PORT`; frontend `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Arkitekturdiagram: `docs/architecture/runquest-architecture.json` (SSOT) + genererad `.html`.

## Arkitektur
ADR-index (beslut 50 — Lead underhåller; en rad per ADR, ur Arkitektens rapport):
  (inga ADR:er ännu)
Fulltexter: docs/adr/
Konventioner (kodens FAKTISKA mönster, inte README:s):
- Backend: en Express-router per domän i `routes/`, handlers med inline-Supabase-anrop via `getSupabaseClient()`; domänlogik i `services/`, `titleEngines/`, `utils/`. Inget repository-lager, inget valideringsbibliotek (manuella `if`-kontroller), ingen global felhanterare. Varje handler har egen try/catch och loggar via `utils/logger` (JSON i prod). Svarsformen är INTE enhetlig: `{success,data}`, `{runs}`, `{events}`, `{seen}`, `{ok:true}` och `{error}` förekommer.
- Auth: egen JWT (HS256, 7 d, `/auth/refresh` är en stub). `authenticateJWT` sätter `req.user` (user_id, name, email, group_id från token); `requireAdmin` slår upp `users.is_admin` i DB per anrop. Gruppavgränsning (tenancy) sker i handlers via `group_id` ur JWT.
- Frontend: servertillstånd i TanStack Query; EN HTTP-klient, singletonen `backendApi` i `shared/services/backendApi.ts` (JWT i `localStorage['runquest_token']`, 401 → `onUnauthorized`); auth i `AuthProvider` (context). Struktur `features/<x>/{components,hooks}`, tunna `pages/`, delat i `shared/{components/ui,hooks,services,utils}`. README:s regler "komponenter anropar aldrig backendApi direkt" och "inga cross-feature-importer" bryts i praktiken (~8 komponentfiler + några sidor resp. 1 import) — behandla dem som riktning, inte som sanning.
- Tid: dagar för utmaningar/events är Stockholm via `backend/src/utils/dateUtils.ts` (Intl), men cron-scheman är UTC, `routes/runs.ts` validerar datum mot serverns tid och `StreakService.calculateCurrentStreak` använder UTC-datum. Nya tidsberoende funktioner ska använda dateUtils.
- Importer i backend blandar `.js`-ändelse (korrekt ESM) och ändelselösa (titles-routes, enhancedTitleService, titleLeaderboardService, titleEngines); fungerar bara tack vare esbuild/tsx. Skriv nya importer med `.js`.
- DB-ändringar: numrerade SQL-filer i `apps/backend/migrations/`, körs manuellt (Supabase SQL-editor/MCP); inget verktyg, ingen ledger.
Ordlista (domänterm sv → en; koden är engelsk):
- löprunda/pass → run (`runs`) · sträcka → distance (km) · löpband → treadmill (`is_treadmill`) · höjdmeter → elevation gain
- erfarenhetspoäng → XP (`xp_gained`, `total_xp`) · nivå → level (`level_requirements`, max 30) · streak/svit → streak (`streak_day`, `current_streak`) · streak-multiplikator → streak multiplier · admininställningar → `admin_settings`
- titel → title (`titles`, `user_titles`) · titelmotor → title engine (`titleEngines/`, `metric_key`) · titelranking → title leaderboard (`title_leaderboard`, `title_leaderboard_view`)
- utmaning → challenge (1v1; nivåer minor/major/legendary) · utmaningstoken → challenge token (`user_challenge_tokens`, delas ut vid level-up via `level_challenge_rewards`) · boost → boost (`user_boosts`, `multiplier_days`/`multiplier_runs`, `delta`)
- event → event (typ participation/competition; `event_templates`, `event_pools` med trigger_chance, medlemmar med weight) · dragning → draw · avräkning → settlement
- grupp → group (`groups`, `group_id`, `invite_code`) · väder → weather (`run_weather`) · onboarding "sedda objekt" → `user_seen_items`

## Sköra zoner
Ordnade efter risk. Varje punkt är verifierad i koden om inget annat anges.
1. **Skrivvägen för varje runda** — `apps/backend/src/routes/runs.ts` (`reprocessRunsFromDate`) + `utils/calculateUserTotals.ts`. Kör vid manuell logg, edit, delete OCH Strava-import. Ej transaktionell kedja: rad infogas med XP 0 → omräkning → totaler → titlar för hela gruppen → leaderboard-RPC. `calculateUserTotals` sväljer alla fel (returnerar void) och returnerar tidigt om användaren har noll rundor — raderas sista rundan står total_xp/level/streak kvar (trolig bugg). `PUT /runs/:id` saknar datum-/minimidistans-valideringen som `POST` har. Titlar räknas om för ALLA gruppens användare vid varje skrivning. Mockas i alla tester (se zon 9).
2. **Dataåtkomst/RLS efter migration 030** — migrationen säger själv att kvarvarande anon-SELECT "ses över i kommande audit". Publishable key ligger i frontend-bundlen. `users` har `password_hash`, `strava_tokens` har access-/refresh-tokens, `admin_settings` har `admin_password_hash` (enligt frontendens genererade typer). OVERIFIERAT vilka policyer som finns kvar — kör `pg_policies` + Supabase security advisors före allt annat. Commit `bc26fa9` antyder att nycklar tidigare var hårdkodade: OVERIFIERAT att de roterats.
3. **Två backend-entrypoints** — `server.ts` (produktion: CORS-allowlist via `CORS_ORIGIN`, env-validering, request-logg, schedulers, egen montering av alla routes) vs `app.ts` (endast tester: öppen `cors()`, ingen logg, egen routelista). Bygg/start använder bara `server.ts`; alla 5 route-testfiler importerar `app.ts`. Produktionens CORS, middleware-ordning, routemontering och scheduler-start är därmed otestade, och en ny route kan läggas till på ett ställe men saknas på det andra.
4. **XP-/level-/streak-logik på flera ställen** — (a) XP per runda: en källa, `packages/shared`, används bara av `runs.ts`; backendens `utils/xpCalculation.ts` (`calculateRunXP`, `calculateRunXPLegacy`) är död kod med avvikande fallback (min 1.6 km mot 1.0) och finns bara kvar som mock-mål i tester. (b) Levelgränser: backend `services/levelService.ts` (DB-läsning, cache för processens livstid, hårdkodad fallback som låses permanent efter ett DB-fel) och frontend `shared/services/levelService.ts` (anon-läsning + localStorage + samma hårdkodade tabell + en tredje approximation `floor(xp/100)+1` över nivå 15 före init); MAX_LEVEL=30 hårdkodad på båda sidor. Ändrad `level_requirements` kräver backend-omstart. (c) Streak: `reprocessRunsFromDate` (per-runda `streak_day`) och `StreakService` (current/longest) är två oberoende implementationer; `current_streak` räknas bara om vid skrivning (inget dagligt jobb → kan vara inaktuell, OVERIFIERAT i UI). (d) Streak-multiplikatorer: `runs.ts` läser kolumnen `admin_settings.streak_multipliers`, admin-endpointen skriver till tabellen `streak_multipliers`, frontend har hårdkodad kopia (`constants/streakConstants.ts`) — om kolumnen saknas ger `fetchAdminSettings` hårdkodade default-värden, om den är tom multiplikator 1.0. OVERIFIERAT mot DB vilken som gäller. README:s påstående att `@runquest/shared` används av frontend är fel.
5. **Strava-integrationen** — `routes/strava.ts` (914 rader: OAuth, token-refresh, sync, backfill, debug, admin) + `scheduler/stravaSync.ts`. Access-/refresh-token i klartext i `strava_tokens`. `GET /status` saknar `return` efter expired-grenen → dubbelt `res.json` (ERR_HTTP_HEADERS_SENT). `GET /debug-activities` finns i produktion. Refresh-token roteras hos Strava före DB-skrivning (misslyckad skrivning tappar token). Dedupe sker via `external_id` i applikationskod; att en unik constraint finns i DB är OVERIFIERAT. Importen anropar `calculateUserTotals(userId)` utan groupId (titlar räknas för alla grupper). Inga tester. Sync-state (`getSyncInfo`) ligger bara i minnet.
6. **Schedulers** — `scheduler/*.ts`, startas i `server.ts` endast när `NODE_ENV==='production'` (tyst avstängda annars; att Railway sätter variabeln är OVERIFIERAT). In-process node-cron utan lås: två samtidiga instanser (överlapp vid Railway-deploy, eller fler repliker) KAN ge dubbla dragningar och dubbel XP vid avräkning, eftersom `settleCompetitionEvents` delar ut XP per rad och sätter `settled` sist (ej idempotent). Cron är UTC medan kommentarerna säger "19:00 Stockholm" (stämmer på sommaren, en timme fel på vintern). `settleChallenge` sätter status `completed` före W/D/L och boosts (krasch mitt i = utmaning utan boost); wins/draws/losses uppdateras read-modify-write.
7. **Migrationer och schema** — `apps/backend/migrations/`: dubbla 005 och 010, 003/004 saknas, inget körverktyg. Kärntabellerna (`users`, `runs`, `titles`, `user_titles`, `groups`, `strava_tokens`, `admin_settings`, `level_requirements`, `streak_multipliers`) har ingen `CREATE TABLE` i repot → schemat går inte att återskapa och en staging-databas kan inte byggas ur repot. `002` hårdkodar admin = 'Joel Lindberg'. Frontendens `integrations/supabase/types.ts` är föråldrad (t.ex. `admin_settings.id: string` medan backend gör `.eq('id', 1)`).
8. **Auth och session** — JWT 7 d utan refresh/återkallning, lagrad i localStorage; `group_id` ligger i token och är inaktuell efter `POST /groups/join` tills ny inloggning; ingen rate limiting på login; `server.ts`/`database.ts` loggar prefix av service-nyckel och JWT-secret; admin-skapa-användare (`auth.ts` ~rad 246) bygger `.or()`-filter med strängar från body (PostgREST-filterinjektion, endast admin); `POST /titles/refresh/:titleId` kräver bara inloggning; titelleaderboarden och `/titles/user/:userId` är inte gruppavgränsade (`title_leaderboard` är global).
9. **Verifieringsnätet** — frontend-CI kör `npx tsc --noEmit` mot en solution-`tsconfig.json` med `"files": []` → kontrollerar sannolikt ingenting (Vite bygger utan typkontroll); ingen frontend-lint eller några frontend-tester i CI; `packages/shared`s 35 tester körs inte i CI; backend saknar lint; backendtesterna mockar DB, `@runquest/shared` och `calculateUserTotals`, så XP-/streak-/titelkedjan saknar riktigt beteendetest; titelmotorerna (21 st) har inga egna tester. Om CI blockerar deploy är OVERIFIERAT (Railway deployar på push).
10. **Stora filer med stor sprängradie** — `frontend/src/shared/services/backendApi.ts` (1043 rader, ~65 metoder, enda HTTP-klienten, upprepar fetch/401/try-catch), `routes/strava.ts` (914), `routes/auth.ts` (622; auth + admin + inställningar + users-with-runs blandat), `services/eventService.ts` (585), `pages/PlaybookPage.tsx` (549), `pages/EventsPage.tsx` (499). Inga delade API-svarstyper mellan backend och frontend — kontraktet speglas för hand.
11. **Titelsystemet (orkestrering, inte motorerna)** — `enhancedTitleService` tilldelar/uppdaterar bara titlar, återkallar aldrig när värdet sjunker under `unlock_requirement`; leaderboard uppdateras tre gånger per skrivning (DB-trigger per `user_titles`-rad, `update_all_title_leaderboards`-RPC, per-titel-refresh). Motor utan matchande `metric_key` hoppas över med varning.

## Kritiska flöden
Rök-test per flöde = den kortaste kedjan som bevisar att flödet lever.
1. **Login → JWT → skyddade anrop.** `POST /api/auth/login` (namn eller e-post + lösenord, bcrypt) → token i localStorage → `Authorization: Bearer`; admin-gate via `requireAdmin`; 401 loggar ut i frontend. Rök: logga in, öppna leaderboard, öppna /admin som admin och som icke-admin.
2. **Logga runda (manuellt) → XP/level/streak.** `POST/PUT/DELETE /api/runs` → `reprocessRunsFromDate` (streak_day, multiplikator, boost-delta, XP) → `calculateUserTotals` (total_xp inkl. `event_xp`, level, streak, tokens via `reconcileTokensForLevel`, titlar, leaderboard-RPC) → `checkEventQualification`. Rök: logga 5 km, kontrollera XP-uppdelning, level och streak; radera rundan och kontrollera att totalerna återgår (zon 1).
3. **Strava: koppla och synka.** Popup → `/strava-popup.html` → `postMessage` → `POST /api/strava/callback` (token-utbyte) → cron var 30:e minut (`syncAllStravaUsers`) eller `POST /api/strava/sync` → insert → `reprocessRunsFromDate` → väder (Open-Meteo) → `calculateUserTotals` → eventkvalificering. Rök: manuell sync för en kopplad användare, ingen dubblett vid andra körningen.
4. **Titlar och leaderboard.** 21 titelmotorer (`titleEngines/index.ts`, nyckel = `titles.metric_key`) → `user_titles` → `title_leaderboard` (cache) → `GET /api/titles/leaderboard`; användarleaderboard via `GET /api/auth/users-with-runs`. Rök: efter en ny runda ändras innehavare/värde som förväntat.
5. **Utmaningar (1v1).** Token delas ut vid level-up → `POST /challenges/send` → `PUT /:id/respond` (startar nästa midnatt Stockholm) → avgörs av cron (varje timme) eller lazy via `/:id/progress` → W/D/L + boosts → boost verkar via `reprocessRunsFromDate` (endast `multiplier_days`). Rök: skicka, acceptera, avbryt/avböj och kontrollera att token återställs.
6. **Events.** Cron-dragningar (daglig 17:00 UTC, tors/fre/lör/veckotävling) skapar `events` per grupp → `checkEventQualification` vid runda → participation-XP direkt via `increment_event_xp` / competition avräknas söndag → status `settled`. Rök: `POST /api/events/admin/trigger-daily-draw` som admin, `GET /api/events`.
7. **Profilbild.** `POST /api/users/profile-picture` (rå bild i body, jpeg/png/webp/gif, max 5 MB) → Storage `profile-pictures` → `users.profile_picture` → gammal fil raderas. Rök: ladda upp, bilden syns i leaderboard; icke-bild ger 400.

## Designspråk
Temafil: apps/frontend/src/index.css (HSL-tokens för ljust/mörkt tema; Tailwind-mappning i apps/frontend/tailwind.config.ts; shadcn-primitiver i apps/frontend/src/shared/components/ui/)
[Tom — Designern fyller i ton och känsla vid första design-jobbet.]

## Verifieringsnivå (styrs av Läge)
Produkt: ny kod kräver tester · hela sviten grön + CI-status före merge ·
         release-preview + användarens "kör vidare" före live · release =
         tagg + changelog · hotfix: direkt till builder-par, full svit + rök
         före deploy (hoppa councils, aldrig verifiering) · error tracking
         aktiv (Sentry) · previewns databas enligt staging-ADR, aldrig prod.

---

# Audit-underlag (tas INTE med i STATE.md)

## Gap mot Produkt-nivån i dag
- Error tracking (Sentry): ingen finns (frontendens `shared/utils/logger.ts` rad 44 har bara en "Future"-kommentar). Sentry hanterar användardata (stacktraces, ev. användar-id) → extern tjänst, flagga i ADR; Sentrys gratisplan räcker troligen för 6 användare (kostnad 0 kr, OVERIFIERAT mot aktuell prislista).
- Preview/staging: ingen preview-databas; `.mcp.json` pekar Supabase-MCP på prod-projektet (medvetet låst, bra, men gör att agenter ser prod).
- Lint: finns bara i frontend (`eslint .`), körs inte i CI. Tester: ingen frontend-svit.
- Release = tagg + changelog: `apps/frontend/src/data/changelog.json` + `docs/version-docs/` finns; git-taggar OVERIFIERADE; README säger 0.3.0, rotens package.json 0.0.1.
- Hygien: `@vercel/speed-insights` importeras i `main.tsx` trots Railway-hosting; `bcryptjs` och `dotenv` ligger som frontend-dependencies utan användning; `supabase.auth.signOut()` i `AuthProvider` är kvarleva från Supabase Auth; `apps/backend/scripts/reprocessTitles.ts` ligger utanför tsconfigens `rootDir`; README säger "Strava var 3:e timme" men koden kör var 30:e minut.

## Fynd värda att bekräfta med användaren (produktfrågor, inte arkitekturval)
- `multiplier_runs`-boostar skapas vid avgjord utmaning, men `getActiveBoostDelta` och `decrementRunBoosts` i `challengeService.ts` anropas ingenstans och `reprocessRunsFromDate` hanterar bara `multiplier_days`. Är run-baserade boostar avsiktligt ej implementerade, eller en bugg? Beror på om någon rad i `challenge_rewards` har typen `multiplier_runs` (OVERIFIERAT, DB).

## Genuint öppet vägval (beslut 15b) — avgörs av användaren, inte av Arkitekten
**Staging-/preview-databas** (Produkt-läget kräver "previewns databas enligt staging-ADR, aldrig prod"). Alternativ:
1. Andra Supabase-projekt som staging, schema återskapat ur en baslinje-dump. Kostnad: gratis om kontot ryms inom gratisgränsen för antal projekt, annars betald plan (OVERIFIERAT; flagga som 15c vid val). Kräver att baslinjeschemat först dras ut (zon 7).
2. Supabase Branching (förhandsgranskningsgrenar). Kräver betald plan — kostnadsdrivande (15c), belopp OVERIFIERAT.
3. Ingen preview-DB: previewn kör mot mockad/read-only backend. Billigast, men bryter Produkt-nivåns krav utan undantag.
Rekommendation (ej beslut): alternativ 1 efter att baslinjeschemat dragits med `supabase db pull`. Beslutet påverkar kostnad och arbetsflöde och är därför användarens.

## Föreslagna ADR:er (retroaktiva + nya) — i prioritetsordning
1. Teststrategi (obligatorisk): Vitest finns; besluta nivåer (enhetstester för XP/streak/titelmotorer, API-test mot `server.ts`-wiring, Playwright-rök för flödena ovan), vad CI måste köra (shared + frontend-typcheck med `tsc -b` + lint), kalibrerat för Produkt-läge.
2. Datasäkerhet: RLS-modell (anon läser inget utom `level_requirements`), Strava-tokenlagring (kryptering eller Supabase Vault), rotation av nycklar, session-modell (JWT i localStorage vs httpOnly-cookie vs Supabase Auth).
3. Schema- och migrationshantering: baslinje + Supabase CLI-migrationer (rekommendation), staging (se öppet vägval).
4. En app-factory: `server.ts` importerar `app.ts` så tester och produktion delar wiring.
5. XP-/level-SSOT: flytta levelgränser och streak-logik till `packages/shared` (rena funktioner + data från en källa), ta bort död kod, avgör var multiplikatorerna bor (kolumn vs tabell).
6. Schedulers: idempotens/lås (t.ex. DB-advisory lock eller status-claim), explicit tidszon i cron (`timezone: 'Europe/Stockholm'`), `NODE_ENV`-krav.
7. Felhantering och API-kontrakt: enhetlig svarsform, global felhanterare, indatavalidering (zod finns redan i frontend), delade API-typer.
(Detta är förslag att köra som separata council-ärenden; inget av ovan är beslutat.)

## Antaganden jag gjort
- "6 aktiva användare" och "24 tabeller" är hämtat ur briefen, inte verifierat mot DB.
- Frontendens produktionsserving på Railway antas vara statisk SPA-serving av `dist/` (ingen start-/serve-konfiguration finns i repot).
- Testantalet 67/35 är räknat ur testfilerna (`it(`-rader), sviten kördes inte.
- Arkitekturdiagrammet är handplacerat med explicita `via`-punkter och har INTE körts genom `archify validate/deliver` (inget skal i denna körning); HTML:en är en enkel inbyggd rendering av JSON-datan. Kör `archify deliver … --quality showcase` för kanonisk artefakt. Texten är på svenska, så archifys fasta viewer-UI och `<html lang>` faller tillbaka till engelska.
