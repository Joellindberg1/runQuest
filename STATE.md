# STATE.md — RunQuest
Uppdaterad: 2026-10-04 (kväll) av lead-orchestrator (enda skribent — beslut 21)

## Läge
Produkt          ← live på runquest.dev, 6 aktiva användare. v2.0.0 (redesignen) DEPLOYAD 2026-10-05: main 93e1f21, tagg v2.0.0, backfill körd (26 rader), prod-rökt (Landing + /api/news 401 + SPA-fallback).
                   Kända gap mot Produkt-nivån: Sentry saknas, ingen staging-DB
                   (öppet vägval, se ADR-förslagen i docs/STATE-proposal.md).
Pågående: redesign på `redesign/integration` (plan: docs/design/redesign-plan.md).
                   Inkrement 0–8 mergade och integrationskritiker-godkända (i8 efter fixrunda i8b)
                   (tema/tokens, skal+login, Board, Runner card, Titles, Duels,
                   Events) + alla ADR 007-dataendpoints. i5b: cachefix
                   Runner↔Duels + ShellErrorBoundary. i6: skal och Events delar
                   EN events-query (getEvents borta) och klock-regeln eventPhase;
                   i6b: skalet visar tävling utan entry ("Not entered").
                   i7 Log mergad (XP-preview via shared-formeln, group history,
                   Strava-queries delade i shared/hooks). i8 Profile mergad (heatmap, delad Frodo-väg, edit/delete + full invalideringskedja via runEffects, toast-sanering). i10+i10b Landing mergad och integrationskritiker-godkänd (publik /, dummy-data; login-felvisning och onboarding-cachen fixade på vägen). ÄGARBESLUT 2026-10-04: migration 034 GODKÄND. i9-dataspåret MERGAT och critic-data-godkänt (activity_log live i prod med RLS-bevis, news-API, backfill dry-run: 26 rader väntar ägarens --apply, 409-raderingsspärr, source-fält, Stockholm-datum). i9 frontend MERGAT (News-skärm, klock-popover, Strava-raderingsblock, 409-text). REDESIGNEN RELEASAD som v2.0.0 (PR #14, deploy-critic-godkänd, ägar-preview + kör vidare 2026-10-05). Redesign-brancherna kan arkiveras. Nästa: Fas 2-ADR-ämnena (datasäkerhet/Strava-tokens, felhantering) + ägarlistans designfrågor + Playwright när icke-prod-miljö finns (ADR 001).
                   Antaganden + backend-kontraktsfrågor:
                   docs/open-assumptions.md (NY — Lead underhåller). Öppna
                   ägarbeslut: titelkategorier (Finisher/Commuter/Hamster);
                   boost-panel på mobil-Duels; competition-kortet på Events
                   (egen design, saknar prototypförlaga).

## Stack
- Monorepo, npm workspaces (`apps/*`, `packages/*`), ESM överallt, TypeScript. Ingen ADR motiverar stackvalen (historiska) — retroaktiva ADR:er föreslagna.
- Frontend `apps/frontend`: React ^18.3, Vite ^7.2 (SWC), Tailwind ^3.4 + shadcn/Radix, TanStack Query ^5, react-router-dom ^6, react-hook-form + zod, recharts, driver.js (onboarding-tour). Dev-port 8080. SPA.
- Backend `apps/backend`: Express ^5.1, TypeScript ^5.9 (strict), `@supabase/supabase-js` ^2.58 med secret-nyckel (service role), egen JWT-auth (jsonwebtoken + bcryptjs), node-cron ^3.0, helmet, cors. Dev: `tsx watch src/server.ts` (port 3001). Bygge: esbuild → `dist/server.js`.
- `packages/shared`: XP-formel, boost-tillämpning, level-matematik, streak-/multiplikator-defaults (rena funktioner, 49 tester). Konsumeras av backend OCH frontend (ADR 004); paketets exports pekar på `src/` (ingen dist-byggordning). `packages/types`: `run.ts`-typer, används av frontend.
- Databas: Supabase Postgres, projekt `yrrqaxdngayakcivfrck` (25 tabeller efter migration 034 2026-10-05, RLS på; migration 030 2026-10-04 tog bort anonyma skrivpolicyer). Storage-bucket `profile-pictures`. Enda DB-miljön är prod — ingen staging/preview.
- Hosting: Railway, två tjänster — runQuest-frontend (runquest.dev + www.runquest.dev, båda custom domains med Let's Encrypt-cert; DNS hos Vercel, apex via ALIAS), runQuest-backend (api.runquest.dev). Frontend serveras av Caddy via Railpack med repo-rotens `Caddyfile` (no-cache på index.html, immutable på /assets, 404 för saknade assets — verifieras i CI av scripts/verify-static-serving.sh); backend påverkas inte av Caddyfilen (eget startkommando). Deploy vid push till `main`, OBEROENDE av CI (CI är merge-grinden via branch protection, inte deploy-grinden). `NODE_ENV=production` satt på backend-tjänsten (verifierat i Railway).
- Externa API:er: Strava (OAuth2), Open-Meteo (väder, ingen nyckel).
- Test/CI: Vitest ^4 (backend 446, packages/shared 156, frontend 1249 på redesign/integration). CI: blockerande = backend tsc+build+test, shared-tester, frontend tsc -b + eslint --max-warnings 0 + test + build (skulden betald 2026-10-04). Branch protection på main kräver grön CI (admin-undantag finns). Node 20 i CI.
- Miljövariabler: backend `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `CORS_ORIGIN`, `NODE_ENV`, `PORT`; frontend `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Nycklarna roterade 2026-10-03/04 (gamla verifierat döda, 401); hemligheter aldrig i kod — se docs/permissions.md.
- Arkitekturdiagram: `docs/architecture/runquest-architecture.json` (SSOT) + renderad `.html` (ej archify-validerad ännu).

## Arkitektur
ADR-index (beslut 50 — Lead underhåller; en rad per ADR):
  001 · Godkänd · Teststrategi: Vitest (+RTL); beteendetest av XP-kedjan mot in-memory-fake; kontraktstest för titelmotorer; Playwright beslutad men installeras först när icke-prod-miljö finns; ny kod kräver tester; frontend tsc/eslint ratchet → blockerande vid 0 fel
  002 · Godkänd · Migrationshantering: genererad 000_baseline.sql (prod efter 031, utan hemligheter), 001–031 fryses, ny DB = baslinje + ≥032, nya migrationer via MCP apply_migration + expand/contract; staging-beslutet EJ låst
  003 · Godkänd · App-factory: createApp() i app.ts äger ALL http-wiring; server.ts har env/schedulers/listen; default-export bevaras för tester (implementerad)
  004 · Godkänd · XP-/level-SSOT: shared enda hem för level-matematik + fallback + multiplikator-defaults; streak_multipliers-TABELLEN är runtime-källa (DB-verifierat: gamla kolumn-selecten felade alltid → defaults; tabell == defaults, ingen XP-påverkan); död kod borttagen (implementerad)
  005 · Godkänd · users-totaler har EN skribent: appens calculateUserTotals; DB-triggrarna tas bort (migration 032); noll-runs nollställer korrekt; titlar återkallas när krav ej längre uppfylls (implementerad; migration 032 körs separat)
  006 · Godkänd · Navigering: riktiga routes (/board /titles /duels /events /news /log /profile /runner/:id /playbook …) via layout-routes RequireAuth→AppShell; delvyer med ?view=; bottenbar<1024px/sidnav≥1024px, exakt en skalvariant i DOM; Runner card = route (overlay på desktop); gamla ?tab=/ /challenges redirectas; tour-ankare ägs av skalet; strangler-leverans från inkrement 1
  007 · Godkänd · Härledningsendpoints (inga tabeller): leaderboard/week, leaderboard/rank-delta, config/xp (läsbar för inloggade), challenges group-history + head-to-head, events participantCount/memberCount, offset-paginering (events/history, runs/group-history), POST /runs is_treadmill; nya endpoints {success,data,meta}/snake_case, delade typer i shared/contracts
  008 · Godkänd · Händelselogg: tabell activity_log (monoton id, type+CHECK, dedupe_key, is_backfill) + GET /api/news (keyset) + POST /api/news/seen; skrivs best-effort via services/activityLog.ts efter underliggande skrivning; titelbyten loggas endast framåt (snapshot-diff), övrigt backfillas; oläst = users.news_last_seen_id; migration 034 kräver ägargodkännande
  Ännu ej skrivna (förslag 2, 6, 7 i docs/STATE-proposal.md): datasäkerhet/session, scheduler-idempotens (delvis täckt av buggfixpaketet), felhantering/API-kontrakt
Fulltexter: docs/adr/
Konventioner (kodens FAKTISKA mönster, inte README:s):
- Backend: en Express-router per domän i `routes/`, handlers med inline-Supabase-anrop via `getSupabaseClient()`; domänlogik i `services/`, `titleEngines/`, `utils/`. Inget repository-lager, inget valideringsbibliotek, ingen global felhanterare. Varje handler har egen try/catch, logg via `utils/logger` (JSON i prod). Svarsform (ADR 007): NYA endpoints svarar `{success,data,meta?}`/`{error}` med snake_case och `limit/offset`+`meta` (news: keyset); befintliga behåller sin form tills de ritas om — dagens spretighet (`{runs}`, `{events}`, `{ok:true}` …) är känd skuld. Händelser loggas icke-kastande via `services/activityLog.ts` efter underliggande skrivning (ADR 008).
- Auth: egen JWT (HS256, 30 d enligt Railways `JWT_EXPIRES_IN=30d`, `/auth/refresh` är stub; ogiltig/utgången token ger 401 → klienten loggar ut). `authenticateJWT` sätter `req.user`; `requireAdmin` slår upp `users.is_admin` per anrop. Gruppavgränsning sker i handlers via `group_id` ur JWT.
- Frontend: servertillstånd i TanStack Query; EN HTTP-klient, singletonen `backendApi` (JWT i `localStorage['runquest_token']`, 401 → `onUnauthorized`); auth i `AuthProvider`. Struktur `features/<x>/{components,hooks}`, tunna `pages/`, delat i `shared/`. README:s regler "komponenter anropar aldrig backendApi direkt" och "inga cross-feature-importer" bryts i praktiken — riktning, inte sanning.
- Tid: dagar för utmaningar/events är Stockholm via `backend/src/utils/dateUtils.ts`, men cron är UTC och `StreakService` använder UTC-datum. Nya tidsberoende funktioner ska använda dateUtils.
- Importer i backend blandar `.js`-ändelse och ändelselösa; fungerar tack vare esbuild/tsx. Skriv nya importer med `.js`.
- DB-ändringar (ADR 002): `000_baseline.sql` + frysta 001–031 som historik; nya migrationer = nästa nummer ≥032, körs via Supabase MCP apply_migration (ledger i `supabase_migrations.schema_migrations`) efter ägargodkännande (docs/permissions.md), committas i samma veva; expand/contract för destruktiva ändringar.
Ordlista (domänterm sv → en; koden är engelsk):
- löprunda/pass → run (`runs`) · sträcka → distance (km) · löpband → treadmill (`is_treadmill`) · höjdmeter → elevation gain
- erfarenhetspoäng → XP (`xp_gained`, `total_xp`) · nivå → level (`level_requirements`, max 30) · streak/svit → streak (`streak_day`, `current_streak`) · streak-multiplikator → streak multiplier
- titel → title (`titles`, `user_titles`) · titelmotor → title engine (`titleEngines/`, `metric_key`) · titelranking → title leaderboard (`title_leaderboard`)
- utmaning → challenge (1v1; minor/major/legendary) · utmaningstoken → challenge token (`user_challenge_tokens`) · boost → boost (`user_boosts`, `multiplier_days`/`multiplier_runs`)
- event → event (participation/competition; `event_templates`, `event_pools`) · dragning → draw · avräkning → settlement
- grupp → group (`groups`, `invite_code`) · väder → weather (`run_weather`) · onboarding "sedda objekt" → `user_seen_items`
- vecka → week (Stockholm, mån–sön) · händelselogg/nyhetsflöde → activity_log / news (`GET /api/news`)

## Sköra zoner
Ordnade efter risk; verifierade i koden om inget annat anges.
1. **Skrivvägen för varje runda** — `routes/runs.ts` + `utils/calculateUserTotals.ts`. DELVIS LÖST 2026-10-04 (buggfixpaketet, ADR 005): noll-runs-vägen nollställer nu korrekt (issue #3), PUT validerar som POST (#8), titlar återkallas (#10), EN skribent till totalerna när migration 032 körts (#4). KVAR: kedjan är fortfarande ej transaktionell och fel sväljs; titlar räknas om för hela gruppen vid varje skrivning; mockas i alla tester (zon 9).
2. **Dataåtkomst/RLS** — efter migration 030+031 (körda 2026-10-04, DB-verifierat): anon läser INGET utom `level_requirements` och skriver ingenting; `strava_tokens`/`users`-policyer i praktiken stängda. KVAR: Strava-tokens lagras i klartext i DB (datasäkerhets-ADR föreslagen). Supabase security advisors 2026-10-03: SECURITY DEFINER-vyn `title_leaderboard_view` (ERROR), `handle_new_user()` körbar av anon, mutable search_path på `increment_event_xp`, `pg_net` i public-schemat, Postgres-patchar tillgängliga.
3. **LÖST av ADR 003 (2026-10-04)** — `app.ts` är nu en createApp()-factory med ALL http-wiring; `server.ts` har bara env/schedulers/listen. Testerna kör mot produktionens wiring.
4. **TILL STOR DEL LÖST av ADR 004 (2026-10-04)** — level-matematik + fallback + multiplikator-defaults bor i `packages/shared` och konsumeras av båda sidor; `utils/xpCalculation.ts` raderad; frontend-approximationen borta; multiplikator-källan är TABELLEN `streak_multipliers` (bugfix: gamla kolumn-selecten `admin_settings.streak_multipliers` felade ALLTID → både XP-inställningar och multiplikatorer körde på hårdkodade defaults; DB-värden == defaults så ingen XP-påverkan, men admin-UI:t hade ingen effekt). KVAR: streak-beräkningens dubbelimplementation (reprocessRunsFromDate vs StreakService) — egen ADR föreslagen; `PUT /streak-multipliers` LÖST 2026-10-05: upsert på unika `days` först, borttagning av utgångna steg sist — trappan kan aldrig bli tom (testat med fel i båda stegen); #13 (admin-settings 500 pga obefintlig kolumn + uuid-id) fixad samtidigt.
5. **Strava-integrationen** — `routes/strava.ts` (~930 rader). DELVIS LÖST 2026-10-04: `/status`-dubbelsvaret fixat (#5), token-skrivning har retry + kritisk-larm (#9), unikt dedupe-index i migration 033 (#9, körs separat; prod dubblettfri). KVAR: `/debug-activities` i prod (JWT-skyddad); import anropar `calculateUserTotals` utan groupId; inga tester; sync-state bara i minnet.
6. **Schedulers** — TILL STOR DEL LÖST 2026-10-04 (#6): avräkningar claimar nu status-raden FÖRE utbetalning (exakt en instans vinner — dubbel XP omöjlig), cron-dragningar kör med timezone Europe/Stockholm, nytt nattligt streak-jobb (03:00 Sthlm, #7). KVAR: startas endast i `NODE_ENV=production`; krasch EFTER claim ger settlat utan utbetalning (syns i logg); W/D/L är read-modify-write (ofarligt efter claim).
7. **Migrationer och schema** — dubbla 005/010, 003/004 saknas, inget körverktyg; kärntabellerna saknar `CREATE TABLE` i repot → schema ej återskapbart, staging kan inte byggas ur repot; `002` hårdkodar admin-namn; frontendens `integrations/supabase/types.ts` är föråldrad.
8. **Auth och session** — JWT 30 d utan refresh/återkallning, i localStorage; `group_id` i token blir inaktuell efter `groups/join`; login har nu rate limiting (20/15 min per IP, in-memory — #11, kräver en replika; `trust proxy` satt); admin-skapa-användare bygger `.or()`-filter av body-strängar (filterinjektion, endast admin); `/titles/refresh/:titleId` kräver bara inloggning; titelleaderboarden är global, inte gruppavgränsad.
9. **Verifieringsnätet** — typskulden BETALD 2026-10-04 (0 tsc-fel, 0 lint-problem, blockerande i CI med --max-warnings 0). KVAR: frontend har 0 tester; backend saknar lint; backendtesterna mockar DB/shared/`calculateUserTotals` → XP-/streak-/titelkedjan saknar beteendetest (ADR 001:s in-memory-fake ej byggd än); titelmotorerna (21) otestade; Railway deployar på push oberoende av CI.
10. **Stora filer** — `backendApi.ts` (1043 rader, ~65 metoder), `routes/strava.ts` (914), `routes/auth.ts` (622, blandar auth/admin/users), `eventService.ts` (585), `PlaybookPage.tsx` (549), `EventsPage.tsx` (499). Inga delade API-svarstyper — kontraktet speglas för hand.
11. **Titelsystemet (orkestrering)** — DELVIS LÖST 2026-10-04 (#10): titlar återkallas nu när kravet inte längre uppfylls (även vid noll rundor). KVAR: leaderboard uppdateras tre gånger per skrivning; motor utan matchande `metric_key` hoppas tyst över (varning i logg).

## Kritiska flöden
Rök-test per flöde = kortaste kedjan som bevisar att flödet lever.
1. **Login → JWT → skyddade anrop.** `POST /api/auth/login` → token i localStorage → Bearer; admin-gate via `requireAdmin`. Rök: logga in, öppna leaderboard, öppna /admin som admin och icke-admin.
2. **Logga runda (manuellt) → XP/level/streak.** `POST/PUT/DELETE /api/runs` → `reprocessRunsFromDate` → `calculateUserTotals` → `checkEventQualification`. Rök: logga 5 km, kontrollera XP/level/streak; radera och kontrollera att totalerna återgår (zon 1).
3. **Strava: koppla och synka.** Popup-OAuth → `POST /api/strava/callback` → cron var 30:e min eller `POST /api/strava/sync` → insert → omräkning → väder → eventkvalificering. Rök: manuell sync, ingen dubblett vid andra körningen.
4. **Titlar och leaderboard.** 21 motorer → `user_titles` → `title_leaderboard` → `GET /api/titles/leaderboard`. Rök: ny runda ändrar innehavare/värde som förväntat.
5. **Utmaningar (1v1).** Token vid level-up → send → respond → avgörs via cron eller lazy → W/D/L + boosts (endast `multiplier_days` tillämpas). Rök: skicka, acceptera, avböj — token återställs.
6. **Events.** Cron-dragningar per grupp → kvalificering vid runda → participation-XP direkt / competition avräknas söndag. Rök: admin-trigger daily draw, `GET /api/events`.
7. **Profilbild.** `POST /api/users/profile-picture` (rå bild, max 5 MB) → Storage → `users.profile_picture`. Rök: ladda upp, syns i leaderboard; icke-bild ger 400.
8. **Pack News (ADR 008).** Avgjord utmaning → exakt EN `challenge_won`-rad i activity_log (omkörning ger ingen dubblett, dedupe_key) → `GET /api/news` visar den → `POST /api/news/seen` nollar oläst-räknaren. Rök: avgör en utmaning, kontrollera raden + räknaren.

## Designspråk
Temafil: apps/frontend/src/index.css — EN tokenuppsättning (--rq-*, källa: docs/design/temafil-forslag.css); mörkt är standard, ljust brons via <html data-theme="light"> (förberett, ej designat). Referens: docs/design/claude-design/ (Components = tokens, App Prototype = skärmar; designprojektet är sanningen). Regler: docs/design/designsprak-forslag.md.
Ton: mörk arena (#070e09-bas, panel #212121) där guld (#ffd700) är belöningssignalen — XP, rank 1, primär handling. Skarpa hörn (radius 0), hårlinjer i stället för kanter, ett kort = 3 px vänsterkant i tillståndsfärg. Tagline "RUN - RANK - REIGN". En guldknapp per vy.
Typ: Bebas Neue (rubriker/siffror/primärknappar) · Barlow Condensed (allt annat; namn VERSALER 700) · Share Tech Mono (klockor, XP, eyebrows) · Oswald endast i logotypen.
Rörelse: staplar växer från noll en gång (1.6 s) och står still; bara live-saker loopar (pulserande prickar, sweep på live-kort, grid-drift, podium #1-glöd).
Skuld: 240 inline-styles + 7 typsnitt i nuvarande kod ersätts per inkrement (redesign-plan.md); shadcn-alias + legacy --rq-* i temafilen är temporära.

## Verifieringsnivå (styrs av Läge)
Produkt: ny kod kräver tester · hela sviten grön + CI-status före merge ·
         release-preview + användarens "kör vidare" före live · release =
         tagg + changelog · hotfix: direkt till builder-par, full svit + rök
         före deploy (hoppa councils, aldrig verifiering) · error tracking
         aktiv (Sentry — GAP, ej uppsatt) · previewns databas: ÄGARBESLUT
         2026-10-05 — ingen staging så länge appen har EN testgrupp;
         preview/verifiering får ske mot prod med testgruppen som testare.
         OMPRÖVAS när multi-grupp byggs (då krävs staging enligt
         ursprungsregeln; baslinjen 000_baseline.sql gör den snabb att resa).
         Frontend-typecheck/lint: blockerande, 0 fel/0 varningar (ADR 001,
         skulden betald 2026-10-04).
