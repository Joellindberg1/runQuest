# STATE.md — RunQuest
Uppdaterad: 2026-10-04 av lead-orchestrator (enda skribent — beslut 21)

## Läge
Produkt          ← live på runquest.dev, 6 aktiva användare (DB-verifierat).
                   Kända gap mot Produkt-nivån: Sentry saknas, ingen staging-DB
                   (öppet vägval, se ADR-förslagen i docs/STATE-proposal.md).

## Stack
- Monorepo, npm workspaces (`apps/*`, `packages/*`), ESM överallt, TypeScript. Ingen ADR motiverar stackvalen (historiska) — retroaktiva ADR:er föreslagna.
- Frontend `apps/frontend`: React ^18.3, Vite ^7.2 (SWC), Tailwind ^3.4 + shadcn/Radix, TanStack Query ^5, react-router-dom ^6, react-hook-form + zod, recharts, driver.js (onboarding-tour). Dev-port 8080. SPA.
- Backend `apps/backend`: Express ^5.1, TypeScript ^5.9 (strict), `@supabase/supabase-js` ^2.58 med secret-nyckel (service role), egen JWT-auth (jsonwebtoken + bcryptjs), node-cron ^3.0, helmet, cors. Dev: `tsx watch src/server.ts` (port 3001). Bygge: esbuild → `dist/server.js`.
- `packages/shared`: XP-per-runda-formel + streak-multiplikator (rena funktioner, 35 tester). Konsumeras ENDAST av backend (`routes/runs.ts`). `packages/types`: `run.ts`-typer, används av frontend.
- Databas: Supabase Postgres, projekt `yrrqaxdngayakcivfrck` (24 tabeller, RLS på; migration 030 2026-10-04 tog bort anonyma skrivpolicyer). Storage-bucket `profile-pictures`. Enda DB-miljön är prod — ingen staging/preview.
- Hosting: Railway, två tjänster — runQuest-frontend (www.runquest.dev), runQuest-backend (api.runquest.dev). Deploy vid push till `main`, OBEROENDE av CI (CI är merge-grinden via branch protection, inte deploy-grinden). `NODE_ENV=production` satt på backend-tjänsten (verifierat i Railway).
- Externa API:er: Strava (OAuth2), Open-Meteo (väder, ingen nyckel).
- Test/CI: Vitest ^4 (backend 67, packages/shared 35, frontend 0). CI (fixad 2026-10-04): blockerande = backend tsc+build+test, shared-tester, frontend-build; icke-blockerande (känd skuld) = frontend `tsc -b` (~98 fel) + eslint (15 fel/22 varn). Branch protection på main kräver grön CI (admin-undantag finns). Node 20 i CI.
- Miljövariabler: backend `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `CORS_ORIGIN`, `NODE_ENV`, `PORT`; frontend `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Nycklarna roterade 2026-10-03/04 (gamla verifierat döda, 401); hemligheter aldrig i kod — se docs/permissions.md.
- Arkitekturdiagram: `docs/architecture/runquest-architecture.json` (SSOT) + renderad `.html` (ej archify-validerad ännu).

## Arkitektur
ADR-index (beslut 50 — Lead underhåller; en rad per ADR):
  (inga ADR:er ännu — sju föreslagna i docs/STATE-proposal.md, körs som council-ärenden)
Fulltexter: docs/adr/
Konventioner (kodens FAKTISKA mönster, inte README:s):
- Backend: en Express-router per domän i `routes/`, handlers med inline-Supabase-anrop via `getSupabaseClient()`; domänlogik i `services/`, `titleEngines/`, `utils/`. Inget repository-lager, inget valideringsbibliotek, ingen global felhanterare. Varje handler har egen try/catch, logg via `utils/logger` (JSON i prod). Svarsformen är INTE enhetlig: `{success,data}`, `{runs}`, `{events}`, `{seen}`, `{ok:true}`, `{error}` förekommer.
- Auth: egen JWT (HS256, 7 d, `/auth/refresh` är stub). `authenticateJWT` sätter `req.user`; `requireAdmin` slår upp `users.is_admin` per anrop. Gruppavgränsning sker i handlers via `group_id` ur JWT.
- Frontend: servertillstånd i TanStack Query; EN HTTP-klient, singletonen `backendApi` (JWT i `localStorage['runquest_token']`, 401 → `onUnauthorized`); auth i `AuthProvider`. Struktur `features/<x>/{components,hooks}`, tunna `pages/`, delat i `shared/`. README:s regler "komponenter anropar aldrig backendApi direkt" och "inga cross-feature-importer" bryts i praktiken — riktning, inte sanning.
- Tid: dagar för utmaningar/events är Stockholm via `backend/src/utils/dateUtils.ts`, men cron är UTC och `StreakService` använder UTC-datum. Nya tidsberoende funktioner ska använda dateUtils.
- Importer i backend blandar `.js`-ändelse och ändelselösa; fungerar tack vare esbuild/tsx. Skriv nya importer med `.js`.
- DB-ändringar: numrerade SQL-filer i `apps/backend/migrations/`, körs manuellt (ask-regel i docs/permissions.md); inget verktyg, ingen ledger.
Ordlista (domänterm sv → en; koden är engelsk):
- löprunda/pass → run (`runs`) · sträcka → distance (km) · löpband → treadmill (`is_treadmill`) · höjdmeter → elevation gain
- erfarenhetspoäng → XP (`xp_gained`, `total_xp`) · nivå → level (`level_requirements`, max 30) · streak/svit → streak (`streak_day`, `current_streak`) · streak-multiplikator → streak multiplier
- titel → title (`titles`, `user_titles`) · titelmotor → title engine (`titleEngines/`, `metric_key`) · titelranking → title leaderboard (`title_leaderboard`)
- utmaning → challenge (1v1; minor/major/legendary) · utmaningstoken → challenge token (`user_challenge_tokens`) · boost → boost (`user_boosts`, `multiplier_days`/`multiplier_runs`)
- event → event (participation/competition; `event_templates`, `event_pools`) · dragning → draw · avräkning → settlement
- grupp → group (`groups`, `invite_code`) · väder → weather (`run_weather`) · onboarding "sedda objekt" → `user_seen_items`

## Sköra zoner
Ordnade efter risk; verifierade i koden om inget annat anges.
1. **Skrivvägen för varje runda** — `routes/runs.ts` (`reprocessRunsFromDate`) + `utils/calculateUserTotals.ts`. Ej transaktionell kedja (insert XP 0 → omräkning → totaler → titlar → leaderboard-RPC); fel sväljs; raderas sista rundan står total_xp/level/streak kvar (trolig bugg); `PUT /runs/:id` saknar POST:ens validering; titlar räknas om för hela gruppen vid varje skrivning. Mockas i alla tester (zon 9).
2. **Dataåtkomst/RLS** — kontrollerat mot DB 2026-10-04: efter migration 030 är anon-skrivning stängd; anon-SELECT kvar på konfigtabeller + `admin_settings` (⚠ `admin_password_hash` LÄSBAR för anon — migration 031 föreslagen, väntar på ägarbeslut), `user_boosts`, `user_challenge_tokens`, `title_leaderboard`; `users`-SELECT endast authenticated (aldrig uppfyllt — ofarligt); `strava_tokens` i praktiken stängd (auth.uid()-villkor). Strava-tokens lagras i klartext i DB. Supabase security advisors 2026-10-03: SECURITY DEFINER-vyn `title_leaderboard_view` (ERROR), `handle_new_user()` körbar av anon, mutable search_path på `increment_event_xp`, `pg_net` i public-schemat, Postgres-patchar tillgängliga.
3. **Två backend-entrypoints** — `server.ts` (produktion) vs `app.ts` (tester: öppen cors, egen routelista). Produktionens CORS, wiring och scheduler-start är otestade; ny route kan glömmas på ena stället. App-factory-ADR föreslagen.
4. **XP-/level-/streak-logik spridd** — XP per runda: en källa (`packages/shared`), men backendens `utils/xpCalculation.ts` är död kod med avvikande fallback (finns kvar som mock-mål); levelgränser i två DB-läsande kopior med hårdkodade fallbacks + en tredje approximation i frontend över nivå 15; streak i två oberoende implementationer; streak-multiplikatorer har oklar sanningskälla (runs.ts läser KOLUMNEN `admin_settings.streak_multipliers`, admin-endpointen skriver till TABELLEN `streak_multipliers`, frontend har hårdkodad kopia — vilken som gäller är overifierat mot DB). README:s påstående att shared används av frontend är fel.
5. **Strava-integrationen** — `routes/strava.ts` (914 rader). `GET /status` saknar `return` efter expired-grenen → dubbelt `res.json`; `/debug-activities` kvar i prod; refresh-token roteras hos Strava före DB-skrivning (misslyckad skrivning tappar token); dedupe via `external_id` endast i appkod (unik constraint i DB overifierad); import anropar `calculateUserTotals` utan groupId; inga tester; sync-state bara i minnet.
6. **Schedulers** — startas endast när `NODE_ENV==='production'`. In-process node-cron utan lås: överlappande instanser (t.ex. vid deploy) kan ge dubbla dragningar/dubbel XP (`settleCompetitionEvents` ej idempotent). Cron är UTC men kommentarerna säger Stockholm — en timme fel på vintern. `settleChallenge` sätter `completed` före W/D/L+boosts; wins/draws/losses uppdateras read-modify-write.
7. **Migrationer och schema** — dubbla 005/010, 003/004 saknas, inget körverktyg; kärntabellerna saknar `CREATE TABLE` i repot → schema ej återskapbart, staging kan inte byggas ur repot; `002` hårdkodar admin-namn; frontendens `integrations/supabase/types.ts` är föråldrad.
8. **Auth och session** — JWT 7 d utan refresh/återkallning, i localStorage; `group_id` i token blir inaktuell efter `groups/join`; ingen rate limiting på login; nyckelprefix loggas vid start; admin-skapa-användare bygger `.or()`-filter av body-strängar (filterinjektion, endast admin); `/titles/refresh/:titleId` kräver bara inloggning; titelleaderboarden är global, inte gruppavgränsad.
9. **Verifieringsnätet** — frontend: 0 tester, typecheck+lint i CI är icke-blockerande (känd skuld: ~98 typfel inkl. en villkorligt anropad React-hook, 15 lint-fel); backend saknar lint; backendtesterna mockar DB/shared/`calculateUserTotals` → XP-/streak-/titelkedjan saknar beteendetest; titelmotorerna (21) otestade; Railway deployar på push oberoende av CI.
10. **Stora filer** — `backendApi.ts` (1043 rader, ~65 metoder), `routes/strava.ts` (914), `routes/auth.ts` (622, blandar auth/admin/users), `eventService.ts` (585), `PlaybookPage.tsx` (549), `EventsPage.tsx` (499). Inga delade API-svarstyper — kontraktet speglas för hand.
11. **Titelsystemet (orkestrering)** — titlar återkallas aldrig när värdet sjunker; leaderboard uppdateras tre gånger per skrivning; motor utan matchande `metric_key` hoppas tyst över (varning i logg).

## Kritiska flöden
Rök-test per flöde = kortaste kedjan som bevisar att flödet lever.
1. **Login → JWT → skyddade anrop.** `POST /api/auth/login` → token i localStorage → Bearer; admin-gate via `requireAdmin`. Rök: logga in, öppna leaderboard, öppna /admin som admin och icke-admin.
2. **Logga runda (manuellt) → XP/level/streak.** `POST/PUT/DELETE /api/runs` → `reprocessRunsFromDate` → `calculateUserTotals` → `checkEventQualification`. Rök: logga 5 km, kontrollera XP/level/streak; radera och kontrollera att totalerna återgår (zon 1).
3. **Strava: koppla och synka.** Popup-OAuth → `POST /api/strava/callback` → cron var 30:e min eller `POST /api/strava/sync` → insert → omräkning → väder → eventkvalificering. Rök: manuell sync, ingen dubblett vid andra körningen.
4. **Titlar och leaderboard.** 21 motorer → `user_titles` → `title_leaderboard` → `GET /api/titles/leaderboard`. Rök: ny runda ändrar innehavare/värde som förväntat.
5. **Utmaningar (1v1).** Token vid level-up → send → respond → avgörs via cron eller lazy → W/D/L + boosts (endast `multiplier_days` tillämpas). Rök: skicka, acceptera, avböj — token återställs.
6. **Events.** Cron-dragningar per grupp → kvalificering vid runda → participation-XP direkt / competition avräknas söndag. Rök: admin-trigger daily draw, `GET /api/events`.
7. **Profilbild.** `POST /api/users/profile-picture` (rå bild, max 5 MB) → Storage → `users.profile_picture`. Rök: ladda upp, syns i leaderboard; icke-bild ger 400.

## Designspråk
Temafil: apps/frontend/src/index.css (HSL-tokens ljust/mörkt; Tailwind-mappning i tailwind.config.ts; shadcn-primitiver i shared/components/ui/)
[Tom — Designern fyller i ton och känsla vid första design-jobbet.]

## Verifieringsnivå (styrs av Läge)
Produkt: ny kod kräver tester · hela sviten grön + CI-status före merge ·
         release-preview + användarens "kör vidare" före live · release =
         tagg + changelog · hotfix: direkt till builder-par, full svit + rök
         före deploy (hoppa councils, aldrig verifiering) · error tracking
         aktiv (Sentry — GAP, ej uppsatt) · previewns databas enligt
         staging-ADR (GAP, öppet vägval), aldrig prod.
         Övergångsregel tills typskulden är betald: frontend-typecheck/lint
         är icke-blockerande i CI men får inte öka (ny kod håller full nivå).
