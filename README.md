# RunQuest

A running app where you and your friends compete, track progress and import runs from Strava — with XP and levels, leaderboards, streaks, titles, badges, 1v1 duels and events. Everyone plays in a group; titles and the title leaderboard are per group.

**Live:** [runquest.dev](https://www.runquest.dev) · **Version history:** `CHANGELOG.md` (the current version is in `package.json`)

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
| Staging | A separate Railway environment (`staging`) with its own two services and its own Supabase project. It follows the `integration/<version>` branch and never touches prod (`docs/staging.md`, `docs/release.md`) |
| Monitoring | Sentry for errors and performance in both the backend (`@sentry/node`) and the frontend (`@sentry/react`), EU region, scrubbed of tokens, names and e-mail; Umami Cloud for cookieless page views. Both are off unless their ids are set in the environment (`docs/release.md`, `docs/performance.md`) |
| Tests | Vitest (React Testing Library in the frontend), a Playwright smoke suite against staging (`apps/e2e`, `docs/e2e.md`), and Node's own test runner for the tools in `scripts/` |

---

## Project Structure

```
runquest/
├── apps/
│   ├── frontend/
│   │   └── src/
│   │       ├── app-shell/      # The shell: header, bottom bar/side nav, RequireAuth
│   │       ├── features/       # Feature modules: admin, auth, badges, challenges, changelog, events, landing,
│   │       │                   #   leaderboard, legal, log, news, onboarding, playbook, profile, runner, runs, settings, titles
│   │       ├── pages/          # Thin route components: layout + feature imports
│   │       ├── providers/      # AppProviders (QueryClient, theme, toaster) and AuthProvider
│   │       └── shared/         # Shared components, hooks, services (backendApi, levelService) and utils
│   ├── e2e/                    # Playwright smoke suite; runs against staging or localhost, never prod (docs/e2e.md)
│   └── backend/
│       ├── migrations/         # 000_baseline.sql + migrations ≥ 032 (ADR 002)
│       └── src/
│           ├── routes/         # One Express router per domain
│           ├── services/       # Business logic (streak, challenges, events, weather, badges, titles …)
│           ├── titleEngines/   # One title engine per metric (24)
│           ├── scheduler/      # Cron: Strava sync and webhook worker, nightly reconcile, challenges, events, streaks, recalculation recovery
│           ├── observability/  # Sentry set-up, tracing and the scrubbing of what leaves the process
│           ├── scripts/        # One-off, release and staging scripts (backfill, announce:release, create:group, staging:* …)
│           ├── middleware/     # Auth, admin check, rate limiting
│           └── config/         # Database, env
├── packages/
│   ├── shared/                 # Pure logic and API contracts used by both frontend and backend
│   └── types/                  # Shared types (User, Run …)
├── scripts/                    # Repo tooling, mostly run by CI (see below)
└── docs/                       # ADRs, release process, staging, e2e, permissions, design material
```

### `scripts/`

| Path | What it is |
|------|------------|
| `check-versions.mjs` | The version guard: `package.json` (root and frontend), the top heading of `CHANGELOG.md` and `changelog.json` must agree |
| `ci-guards.mjs` | The repo guards: empty test suites, TODO/FIXME without a ticket key, ticket ids in test names, and the architecture rules (Strava calls, token columns, group rules, route contracts, error responses, no Supabase in the frontend, documents that name missing files …). The rules are listed at the top of the file |
| `e2e-guard.mjs` | Refuses to run the Playwright suite against anything but staging and localhost |
| `sentry-build.mjs` | The release name for the Sentry build and the rule that source maps are uploaded only when a token is present |
| `lighthouse/` | The Lighthouse performance budget for the public pages: a mock API, the runner and the budget in `lighthouserc.json` (`docs/release.md`) |
| `loadtest/` | The load test against staging (`docs/loadtest.md`); it refuses to run in CI and against prod |
| `verify-static-serving.sh` | Checks that the root `Caddyfile` serves the built frontend |

The `*.test.mjs` files next to them test the tools with Node's test runner.

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
npm test --workspace=packages/shared
npm test --workspace=apps/backend
npm test --workspace=apps/frontend

# Watch mode (re-runs on file save)
npm run test:watch --workspace=packages/shared
npm run test:watch --workspace=apps/backend
npm run test:watch --workspace=apps/frontend

# Types and lint, as CI runs them
npx tsc --noEmit -p packages/shared
npx tsc --noEmit                        # in apps/backend
npx tsc -b                              # in apps/frontend (tsc --noEmit is not enough there)
npx eslint . --max-warnings 0           # in apps/frontend
npm run lint:css --workspace=@runquest/frontend

# Repo guards and script tests (no dependencies needed)
node scripts/check-versions.mjs && node --test scripts/check-versions.test.mjs
node scripts/ci-guards.mjs && node --test scripts/ci-guards.test.mjs
node --test scripts/sentry-build.test.mjs scripts/runbook-backup-sql.test.mjs scripts/lighthouse-ci.test.mjs scripts/e2e-guard.test.mjs
node --test scripts/loadtest/*.test.mjs
```

Test counts are not kept here: they change with the code, and CI is the source of truth. The Playwright smoke suite in `apps/e2e` runs against staging only (`docs/e2e.md`).

### What is tested

- **`packages/shared`** — the pure logic: the XP formula, streak and multiplier, boosts, level math, badge rules and evaluation, activity types, calendar and wall clock, API contracts.
- **`apps/backend`** — route tests (supertest against `createApp()`, the database replaced by an in-memory fake, `fakeDb`), services (streak, challenges, events, weather, badges, titles), the title engines (a regression suite plus tests for the newer engines), the `calculateUserTotals` chain and the migration files (static tests).
- **`apps/frontend`** — component and hook tests (RTL), model functions per feature, routing and shell, and static guards per feature.
- **`apps/e2e`** — Playwright smoke tests of the critical flows (login, board, logging a run, news, the landing page, the loading view) against staging.
- **`scripts/`** — Node's test runner tests the repo tools themselves (the guards, the version check, the Sentry build settings, the load-test and Lighthouse tooling).

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR to `main`. These are its jobs and steps, in the order they run:

- **Backend — typecheck & tests:** `npm ci`; `tsc --noEmit`; `tsc --noEmit -p tsconfig.test.json` (tests that import across packages); build; tests.
- **Shared — tests:** `npm ci`; the typecheck of `packages/shared` (`tsc --noEmit -p packages/shared`); tests; and, on PRs from `integration/*` or `release/*` branches only, the data policy gate (`dataPolicy` tests with `RUNQUEST_RELEASE_CHECK=1`: the privacy text must not ship with an owner placeholder).
- **Frontend — build, typecheck & lint:**
  1. the version guard (`scripts/check-versions.mjs` and its test);
  2. the repo guards (`scripts/ci-guards.mjs` and its test);
  3. the script guards, which need no install: the Sentry build settings, the backup runbook SQL guard (SELECT only), the load-test script and the Lighthouse tooling (all `node --test`), and the E2E target guard (`scripts/e2e-guard.test.mjs`);
  4. `npm ci`, then build and the Caddy static-serving check (`scripts/verify-static-serving.sh`);
  5. `tsc -b`;
  6. the E2E suite typecheck and listing (`tsc --noEmit -p apps/e2e` and `test:e2e:list`; no browser, no network);
  7. `eslint . --max-warnings 0`;
  8. stylelint (`npm run lint:css`);
  9. tests.
- **Lighthouse — performance budget:** the only job that does not block. It builds the frontend and measures `/` and `/legal` on mobile against 127.0.0.1, once with a failing API and once with a mock API, and uploads the reports as an artefact. It becomes blocking by setting `LIGHTHOUSE_BLOCKING` to `true` in `ci.yml` (`docs/release.md`).

A separate workflow, `.github/workflows/e2e-staging.yml`, runs the Playwright smoke suite against staging, by hand and nightly. It never runs on PRs and never against prod. The test strategy is in `docs/adr/001-teststrategi.md`.

---

## Features

- **Leaderboard (Board)** — Season, week and streak views with a podium and ranking rows.
- **XP & Levels** — Base XP + XP per km + distance bonuses + streak multiplier, 30 levels. Admins can adjust the values; `packages/shared` holds the defaults.
- **Groups** — Everyone plays in exactly one group; there is no game without one. The group's admin is the member who created it, and the role (not a flag on the user) decides who may change the group's settings. Titles, the title ranking and Pack News are per group.
- **Streaks** — Daily runs give a growing multiplier (the default ladder goes from ×1.1 at day 5 to ×2.0 at day 270); a missed day resets the streak.
- **Strava** — Connect via OAuth2 (popup). Runs arrive from Strava as you save them, with a backup check every 12 hours and a nightly reconcile against Strava at 04:15 (Europe/Stockholm), and can be synced manually. Strava runs are read-only in the app; only manual runs can be edited or deleted.
- **Log runs** — Manual logging with an XP preview.
- **Titles** — 24 title engines (longest run, most km, time of day, pace, elevation, comeback, weather and winter titles such as Stormborn, Iceborn and Winter Warrior …), grouped into categories. Titles are per group (v0.8.0): a title belongs to a user in a group, counts the runs within the member's membership window and has its own top 10 per group. Titles can be revoked when the requirement is no longer met.
- **Badges** — Eight series × six tiers (Common to Legendary), derived from the runs and revocable. The `/badges` page, up to three displayed badges, an upgrade popup.
- **Duels (challenges)** — 1v1 across three tiers (Minor, Major, Legendary). A token is awarded at level-up and draws tier, metric (km, runs, XP), duration and stake; when sending, the player only picks the token and the opponent. The winner gets an XP boost; the boost's window is saved on the boost itself and counts in the group's days, so a new 3-day boost covers exactly three calendar days.
- **Events** — Participation events that give XP right away on a qualifying run (including the weather-dependent Storm Chaser) and weekly competitions settled on Monday.
- **Pack News** — The group's activity feed (titles, levels, badges, challenges, events, streak breaks, milestones) with filters, an unread counter in the header and one row per release.
- **Runner card** — Another member's profile with head-to-head, titles and badges.
- **Profile** — Stats, heatmap and run history.
- **Playbook** — The rules of the game, with numbers read from the configuration.
- **Features & Version** — Feature list, what is coming and the version history; the "What's new" popup shows new releases.
- **Landing and login** — A public start page, prerendered at build time, with a waitlist form; login is a dialog over it (`/login`).
- **Loading view** — One loading view (the stadium oval) from the first HTML to the first screen of the app; its runner dots follow the clock across each hand-over, so they never jump.
- **Onboarding** — Guided tours.
- **Admin** — XP settings and streak ladder, members, titles, security and the Waitlist (the sign-ups from the landing page).
- **Theme** — Dark is the default and the only designed theme. A light theme is prepared in the theme file (`data-theme="light"`) but not designed.

---

## Architecture Principles

This is the direction. The full picture, including known deviations, is in `STATE.md` ("Konventioner") and the decisions are in `docs/adr/`.

- **Pages are glue** — a page imports features and sets the layout. No business logic.
- **Features own their logic** — components, hooks and models live in `features/<x>/`. What several features need lives in `shared/`. Imports between features still occur in a few places and are debt, not a pattern.
- **Server state in TanStack Query** — data fetching goes through hooks with caching and invalidation, and ONE HTTP client: `backendApi` is the only code that calls `fetch`, and every request passes one method that adds the token, handles a 401 session expiry and unpacks the response. Only the auth provider and one admin panel (`SecurityPanel`) still call `backendApi` outside a query hook or a feature API module.
- **Shared logic in `packages/shared`** — XP, levels, streak, boosts, badges and calendar are pure functions that run identically in the frontend (preview) and the backend (save). The package is consumed directly from `src/`.
- **Types and contracts** — `packages/types` holds `User`, `Run` etc.; every route answers against a response type from `packages/shared/src/contracts/` (ADR 007, enforced by a repo guard).
- **One response envelope** — A successful answer is `{ success: true, data, meta? }` and an error is `{ success: false, error, code }`, built with `ok` and `fail` in `apps/backend/src/utils/respond.ts`; a repo guard forbids hand-written error responses (ADR 007 Addendum 2026-10-20). Step 1 (v0.8.1) is the transition window: the old bare keys are still sent next to `data`, and the client reads `data` and the error `code` first. Step 2, in a later version, removes the bare keys.
- **The group's day** — Day boundaries (boost windows, event bounds, "today") are counted in the group's time zone through one resolver, `groupTimeZone` (`packages/shared`, wrapped in `apps/backend/src/utils/groupTimeZone.ts`). No per-group setting exists yet, so it answers Europe/Stockholm for every group; the backend file lists the places that still count in Stockholm.
- **Database changes** — `000_baseline.sql` + migrations ≥ 032, written to the repo and run via Supabase MCP after owner approval, staging first and then prod, one yes per migration (ADR 002, `docs/release.md`, `docs/permissions.md`).

---

## Documentation

| Document | Contents |
|----------|----------|
| `STATE.md` | Current state: stack, conventions, fragile zones, critical flows |
| `CHANGELOG.md` | Technical history per release |
| `docs/dokumentation.md` | Who reads what, the versioning scheme and the release checklist |
| `docs/release.md` | The release chain from PR to live, with rollback |
| `docs/staging.md` | Rebuilding the staging database from scratch |
| `docs/e2e.md` | The Playwright smoke suite against staging |
| `docs/loadtest.md` | The load test against staging |
| `docs/performance.md` | Performance monitoring in Sentry (what is measured, thresholds) and the landing page measurements |
| `docs/runbook-backup.md`, `docs/runbook-token-key.md` | Backup and restore of the data; handling the Strava token key |
| `docs/adr/` | Architecture decisions |
| `docs/permissions.md` | What requires the owner's approval |
| `docs/open-assumptions.md` | Open assumptions and contract questions |
| `docs/archive/` | Superseded documents (earlier state proposal, roadmap, cleanup plans) |
