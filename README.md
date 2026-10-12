# RunQuest

A running app where you and your friends compete, track progress and import runs from Strava — with XP and levels, leaderboards, streaks, titles, badges, 1v1 duels and events.

**Live:** [runquest.dev](https://www.runquest.dev) · **Version:** 0.6.1

---

## Tech Stack

| Part | Technology |
|------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind 3 with its own token set (`--rq-*`), Radix primitives, TanStack Query, react-router v6 |
| Backend | Node.js 20 (`.nvmrc`), Express 5, TypeScript, node-cron |
| Database | Supabase (PostgreSQL). Only the backend talks to the database (service key); the frontend has no Supabase client |
| Auth | Own backend JWT + Strava OAuth2 |
| External APIs | Strava, Open-Meteo (weather, no key) |
| Hosting | Railway: two services (frontend and backend), deployed on push to `main`. The frontend is served by Caddy via Railpack |
| Tests | Vitest (React Testing Library in the frontend) |

---

## Project Structure

```
runquest/
├── apps/
│   ├── frontend/
│   │   └── src/
│   │       ├── app-shell/      # The shell: header, bottom bar/side nav, RequireAuth
│   │       ├── features/       # Feature modules: admin, auth, badges, challenges, changelog, events, landing,
│   │       │                   #   leaderboard, log, news, onboarding, playbook, profile, runner, runs, settings, titles
│   │       ├── pages/          # Thin route components: layout + feature imports
│   │       ├── providers/      # AppProviders (QueryClient, theme, toaster) and AuthProvider
│   │       └── shared/         # Shared components, hooks, services (backendApi, levelService) and utils
│   └── backend/
│       ├── migrations/         # 000_baseline.sql + migrations ≥ 032 (ADR 002)
│       └── src/
│           ├── routes/         # One Express router per domain
│           ├── services/       # Business logic (streak, challenges, events, weather, badges, titles …)
│           ├── titleEngines/   # One title engine per metric (24)
│           ├── scheduler/      # Cron: Strava sync, challenges, events
│           ├── scripts/        # One-off and release scripts (backfill, announce:release …)
│           ├── middleware/     # Auth, admin check, rate limiting
│           └── config/         # Database, env
├── packages/
│   ├── shared/                 # Pure logic and API contracts used by both frontend and backend
│   └── types/                  # Shared types (User, Run …)
├── scripts/                    # Version guard and CI guards
└── docs/                       # ADRs, release process, permissions, design material
```

---

## Getting Started

```bash
# Install dependencies (Node 20)
npm install

# Copy the env files and fill in the values
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env

# Start frontend (port 8080) and backend (port 3001) in separate terminals
npm run dev:frontend
npm run dev:backend
```

The backend needs Supabase, JWT and Strava keys in `apps/backend/.env` (see `.env.example`). The frontend only needs `VITE_API_URL`
(default `http://localhost:3001/api`). Secrets never go in code or in the repo.

---

## Tests

Tests live close to the code they test, in `__tests__/` folders or next to the file (`*.test.ts(x)`).

```bash
npm test --workspace=packages/shared    # 654 tests in 16 files
npm test --workspace=apps/backend       # 1145 tests in 86 files
npm test --workspace=apps/frontend      # 2371 tests in 141 files

# Watch mode (re-runs on file save)
npm run test:watch --workspace=packages/shared
npm run test:watch --workspace=apps/backend
npm run test:watch --workspace=apps/frontend

# Repo guards (no dependencies needed)
node scripts/check-versions.mjs && node --test scripts/check-versions.test.mjs
node scripts/ci-guards.mjs && node --test scripts/ci-guards.test.mjs
```

The counts were measured on 2026-10-12 on `release/v0.6.1.1` and change with the code; CI is the source of truth.

### What is tested

- **`packages/shared`** — the pure logic: the XP formula, streak and multiplier, boosts, level math, badge rules and evaluation, activity types, calendar and wall clock, API contracts.
- **`apps/backend`** — route tests (supertest against `createApp()`, the database replaced by an in-memory fake, `fakeDb`), services (streak, challenges, events, weather, badges, titles), the title engines (a regression suite plus tests for the newer engines), the `calculateUserTotals` chain and the migration files (static tests).
- **`apps/frontend`** — component and hook tests (RTL), model functions per feature, routing and shell, and static guards per feature.

CI (`.github/workflows/ci.yml`) is blocking on every PR to `main`: backend `tsc` + build + test, shared tests, and for the frontend the version guard, repo guards, build, Caddy check, `tsc -b`, `eslint --max-warnings 0` and tests. The test strategy is in `docs/adr/001-teststrategi.md`.

---

## Features

- **Leaderboard (Board)** — Season, week and streak views with a podium and ranking rows.
- **XP & Levels** — Base XP + XP per km + distance bonuses + streak multiplier, 30 levels. Admins can adjust the values; `packages/shared` holds the defaults.
- **Streaks** — Daily runs give a growing multiplier (the default ladder goes from ×1.1 at day 5 to ×2.0 at day 270); a missed day resets the streak.
- **Strava** — Connect via OAuth2 (popup). Runs sync automatically every 30 minutes and can be synced manually. Strava runs are read-only in the app; only manual runs can be edited or deleted.
- **Log runs** — Manual logging with an XP preview.
- **Titles** — 24 title engines (longest run, most km, time of day, pace, elevation, comeback, weather and winter titles such as Stormborn, Iceborn and Winter Warrior …), grouped into categories. Titles can be revoked when the requirement is no longer met.
- **Badges** — Eight series × six tiers (Common to Legendary), derived from the runs and revocable. The `/badges` page, up to three displayed badges, an upgrade popup.
- **Duels (challenges)** — 1v1 across three tiers (Minor, Major, Legendary). A token is awarded at level-up and draws tier, metric (km, runs, XP), duration and stake; when sending, the player only picks the token and the opponent. The winner gets an XP boost.
- **Events** — Participation events that give XP right away on a qualifying run (including the weather-dependent Storm Chaser) and weekly competitions settled on Monday.
- **Pack News** — The group's activity feed (titles, levels, badges, challenges, events, streak breaks, milestones) with filters, an unread counter in the header and one row per release.
- **Runner card** — Another member's profile with head-to-head, titles and badges.
- **Profile** — Stats, heatmap and run history.
- **Playbook** — The rules of the game, with numbers read from the configuration.
- **Features & Version** — Feature list, what is coming and the version history; the "What's new" popup shows new releases.
- **Landing and login** — A public start page; login is a dialog over it (`/login`).
- **Onboarding** — Guided tours.
- **Admin** — XP settings, streak ladder and members.
- **Theme** — Dark is the default and the only designed theme. A light theme is prepared in the theme file (`data-theme="light"`) but not designed.

---

## Architecture Principles

This is the direction. The full picture, including known deviations, is in `STATE.md` ("Konventioner") and the decisions are in `docs/adr/`.

- **Pages are glue** — a page imports features and sets the layout. No business logic.
- **Features own their logic** — components, hooks and models live in `features/<x>/`. What several features need lives in `shared/`. Imports between features still occur in a few places and are debt, not a pattern.
- **Server state in TanStack Query** — data fetching goes through hooks with caching and invalidation, and ONE HTTP client (`backendApi`). A few admin and profile components still call it directly.
- **Shared logic in `packages/shared`** — XP, levels, streak, boosts, badges and calendar are pure functions that run identically in the frontend (preview) and the backend (save). The package is consumed directly from `src/`.
- **Types and contracts** — `packages/types` holds `User`, `Run` etc.; new endpoints share their response types via `packages/shared/src/contracts/` (ADR 007).
- **Database changes** — `000_baseline.sql` + migrations ≥ 032, run via Supabase MCP after owner approval (ADR 002, `docs/permissions.md`).

---

## Documentation

| Document | Contents |
|----------|----------|
| `STATE.md` | Current state: stack, conventions, fragile zones, critical flows |
| `CHANGELOG.md` | Technical history per release |
| `docs/dokumentation.md` | Who reads what, the versioning scheme and the release checklist |
| `docs/release.md` | The release chain from PR to live, with rollback |
| `docs/adr/` | Architecture decisions |
| `docs/permissions.md` | What requires the owner's approval |
| `docs/open-assumptions.md` | Open assumptions and contract questions |
