# RunQuest

En löparapp där du och dina vänner tävlar, följer era framsteg och importerar rundor från Strava — med XP och nivåer, leaderboards, streaks, titlar, badges, duellutmaningar och event.

**Live:** [runquest.dev](https://www.runquest.dev) · **Version:** 0.6.1

---

## Teknik

| Del | Teknik |
|-----|--------|
| Frontend | React 18, TypeScript, Vite, Tailwind 3 med egen tokenuppsättning (`--rq-*`), Radix-primitiver, TanStack Query, react-router v6 |
| Backend | Node.js 20 (`.nvmrc`), Express 5, TypeScript, node-cron |
| Databas | Supabase (PostgreSQL). Bara backend pratar med databasen (service-nyckel); frontend har ingen Supabase-klient |
| Auth | Egen JWT (backend) + Strava OAuth2 |
| Externa API:er | Strava, Open-Meteo (väder, ingen nyckel) |
| Hosting | Railway: två tjänster (frontend och backend), deploy vid push till `main`. Frontend serveras av Caddy via Railpack |
| Tester | Vitest (React Testing Library i frontend) |

---

## Projektstruktur

```
runquest/
├── apps/
│   ├── frontend/
│   │   └── src/
│   │       ├── app-shell/      # Skalet: header, bottenbar/sidnav, RequireAuth
│   │       ├── features/       # Funktionsmoduler: admin, auth, badges, challenges, changelog, events, landing,
│   │       │                   #   leaderboard, log, news, onboarding, playbook, profile, runner, runs, settings, titles
│   │       ├── pages/          # Tunna route-komponenter: layout + feature-importer
│   │       ├── providers/      # AppProviders (QueryClient, tema, toaster) och AuthProvider
│   │       └── shared/         # Delade komponenter, hooks, services (backendApi, levelService) och utils
│   └── backend/
│       ├── migrations/         # 000_baseline.sql + migrationer ≥ 032 (ADR 002)
│       └── src/
│           ├── routes/         # En Express-router per domän
│           ├── services/       # Affärslogik (streak, utmaningar, event, väder, badges, titlar …)
│           ├── titleEngines/   # En titelmotor per mått (24 st)
│           ├── scheduler/      # Cron: Strava-synk, utmaningar, event
│           ├── scripts/        # Engångs- och releaseskript (backfill, announce:release …)
│           ├── middleware/     # Auth, admin-kontroll, rate limiting
│           └── config/         # Databas, miljö
├── packages/
│   ├── shared/                 # Ren logik och API-kontrakt som både frontend och backend använder
│   └── types/                  # Delade typer (User, Run …)
├── scripts/                    # Versionsvakt och CI-vakter
└── docs/                       # ADR:er, release, behörigheter, designunderlag
```

---

## Komma igång

```bash
# Installera beroenden (Node 20)
npm install

# Kopiera miljöfilerna och fyll i värden
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env

# Starta frontend (port 8080) och backend (port 3001) i varsin terminal
npm run dev:frontend
npm run dev:backend
```

Backend behöver Supabase-, JWT- och Strava-nycklar i `apps/backend/.env` (se `.env.example`). Frontend behöver bara `VITE_API_URL`
(standard `http://localhost:3001/api`). Hemligheter ligger aldrig i kod eller i repot.

---

## Tester

Testerna ligger nära koden de testar, i `__tests__/`-mappar eller bredvid filen (`*.test.ts(x)`).

```bash
npm test --workspace=packages/shared    # 654 tester i 16 filer
npm test --workspace=apps/backend       # 1145 tester i 86 filer
npm test --workspace=apps/frontend      # 2371 tester i 141 filer

# Bevakningsläge (kör om vid filändring)
npm run test:watch --workspace=packages/shared
npm run test:watch --workspace=apps/backend
npm run test:watch --workspace=apps/frontend

# Repo-vakter (inga beroenden behövs)
node scripts/check-versions.mjs && node --test scripts/check-versions.test.mjs
node scripts/ci-guards.mjs && node --test scripts/ci-guards.test.mjs
```

Antalen är uppmätta 2026-10-12 på `release/v0.6.1.1` och förändras med koden; CI är facit.

### Vad som testas

- **`packages/shared`** — den rena logiken: XP-formeln, streak och multiplikator, boost, nivåmatematik, badgeregler och badgeutvärdering, händelsetyper, kalender och väggklocka, API-kontrakt.
- **`apps/backend`** — route-tester (supertest mot `createApp()`, databasen ersatt av en in-memory-fake, `fakeDb`), tjänster (streak, utmaningar, event, väder, badges, titlar), titelmotorerna (regressionssvit plus tester för de nyare motorerna), `calculateUserTotals`-kedjan och migrationsfilerna (statiska tester).
- **`apps/frontend`** — komponent- och hooktester (RTL), modellfunktioner per feature, routing och skal, samt statiska vakter per feature.

CI (`.github/workflows/ci.yml`) är blockerande på varje PR mot `main`: backend `tsc` + build + test, shared-test, och för frontend versionsvakt, repo-vakter, build, Caddy-kontroll, `tsc -b`, `eslint --max-warnings 0` och test. Teststrategin står i `docs/adr/001-teststrategi.md`.

---

## Funktioner

- **Leaderboard (Board)** — Säsong, vecka och streaks med pall och rankingrader.
- **XP och nivåer** — Basxp + xp per km + distansbonusar + streakmultiplikator, 30 nivåer. Värdena kan justeras av admin; shared har standardvärdena.
- **Streaks** — Dagliga rundor ger en växande multiplikator (standardtrappan går från ×1,1 vid dag 5 till ×2,0 vid dag 270); en missad dag nollar streaken.
- **Strava** — Koppla via OAuth2 (popup). Rundor synkas automatiskt var 30:e minut och kan synkas manuellt. Strava-rundor är skrivskyddade i appen; bara manuella rundor kan ändras eller raderas.
- **Logga rundor** — Manuell loggning med XP-förhandsvisning.
- **Titlar** — 24 titelmotorer (längsta runda, flest km, tidpunkt på dygnet, tempo, höjdmeter, comeback, väder- och vintertitlar som Stormborn, Iceborn och Winter Warrior …), indelade i kategorier. Titlar kan återkallas när kravet inte längre uppfylls.
- **Badges** — Åtta serier × sex nivåer (Common till Legendary), härledda ur rundorna och återkallbara. Sidan `/badges`, upp till tre visade badges, uppgraderingspopup.
- **Duels (utmaningar)** — 1 mot 1 i tre nivåer (Minor, Major, Legendary). Token delas ut vid nivåuppgång och lottar nivå, mått (km, rundor, XP), längd och insats; vid sändning väljer spelaren token och motståndare. Vinnaren får en XP-boost.
- **Events** — Deltagarevent som ger XP direkt vid kvalificerande runda (bland annat det väderberoende Storm Chaser) och veckotävlingar som avräknas på måndagen.
- **Pack News** — Gruppens händelseflöde (titlar, nivåer, badges, utmaningar, event, streakbrott, milstolpar) med filter, oläst-räknare i headern och en rad per release.
- **Runner card** — Andras profil med head-to-head, titlar och badges.
- **Profil** — Statistik, heatmap och rundhistorik.
- **Playbook** — Spelets regler, med siffror ur konfigurationen.
- **Features & Version** — Funktionslista, vad som är på gång och versionshistorik; "What's new"-popupen visar nya releaser.
- **Landing och inloggning** — Publik startsida; inloggningen är en dialog över den (`/login`).
- **Onboarding** — Guidade turer.
- **Admin** — XP-inställningar, streaktrappa och medlemmar.
- **Tema** — Mörkt tema är standard och det enda som är designat. Ljust tema är förberett i temafilen (`data-theme="light"`) men inte designat.

---

## Arkitekturprinciper

Det här är riktningen. Den fullständiga bilden med kända avsteg står i `STATE.md` ("Konventioner") och besluten i `docs/adr/`.

- **Sidor är lim** — en sida importerar features och sätter layouten. Ingen affärslogik.
- **Features äger sin logik** — komponenter, hooks och modeller bor i `features/<x>/`. Det som flera features behöver ligger i `shared/`. Importer mellan features förekommer ändå på några ställen och är skuld, inte mönster.
- **Servertillstånd i TanStack Query** — datahämtning går via hooks med cache och invalidering, och EN HTTP-klient (`backendApi`). Några admin- och profilkomponenter anropar den fortfarande direkt.
- **Delad logik i `packages/shared`** — XP, nivåer, streak, boost, badges och kalender är rena funktioner som körs identiskt i frontend (förhandsvisning) och backend (sparande). Paketet konsumeras direkt ur `src/`.
- **Typer och kontrakt** — `packages/types` har `User`, `Run` m.fl.; nya endpoints delar sina svarstyper via `packages/shared/src/contracts/` (ADR 007).
- **Databasändringar** — `000_baseline.sql` + migrationer ≥ 032, körda via Supabase MCP efter ägargodkännande (ADR 002, `docs/permissions.md`).

---

## Dokumentation

| Dokument | Innehåll |
|----------|----------|
| `STATE.md` | Nuläget: stack, konventioner, sköra zoner, kritiska flöden |
| `CHANGELOG.md` | Teknisk historik per release |
| `docs/dokumentation.md` | Vem läser vad, versionsschemat och releasechecklistan |
| `docs/release.md` | Releasekedjan från PR till live, med rollback |
| `docs/adr/` | Arkitekturbeslut |
| `docs/permissions.md` | Vad som kräver ägarens ja |
| `docs/open-assumptions.md` | Öppna antaganden och kontraktsfrågor |
