# RunQuest

A running app where you and your friends compete, track progress and import runs from Strava — with an XP system, leaderboards and streak tracking.

**Live:** [runquest.dev](https://www.runquest.dev) · **Version:** 0.2.0

---

## Tech Stack

| Part | Technology |
|------|------------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Node.js, Express, TypeScript |
| Database | Supabase (PostgreSQL) |
| Auth | JWT + Strava OAuth2 |
| Deployment | Railway (backend + frontend) |
| Tests | Vitest |

---

## Project Structure

```
runquest/
├── apps/
│   ├── frontend/
│   │   └── src/
│   │       ├── features/       # Feature modules (leaderboard, runs, profile, settings, admin, auth, titles)
│   │       ├── pages/          # Pure glue components — layout + feature imports only
│   │       ├── providers/      # AppProviders (QueryClient, AuthProvider, Toasters)
│   │       ├── shared/
│   │       │   ├── components/ # Shared UI components (shadcn primitives + custom)
│   │       │   ├── hooks/      # Shared React Query hooks (useTitleQueries, useRunMutations, etc.)
│   │       │   ├── services/   # backendApi.ts, levelService.ts
│   │       │   └── utils/      # formatters, errorHandling, logger, etc.
│   │       └── types/          # Shared TypeScript types (run.ts)
│   └── backend/
│       └── src/
│           ├── routes/         # API routes
│           ├── services/       # Business logic (streak, XP, titles, Strava)
│           ├── middleware/     # Auth, error handling
│           └── config/         # Database, env
└── packages/
    └── shared/                 # Shared logic (xpCalculation) — used by both frontend and backend
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Start frontend and backend in separate terminals
npm run dev:frontend
npm run dev:backend
```

Requires a `.env` file in `apps/backend/` with Supabase and JWT keys.

---

## Tests

Tests live close to the code they test, in `__tests__/` folders.

```bash
# XP calculation (packages/shared) — 35 tests
npm run test --workspace=packages/shared

# Streak logic + integration tests (apps/backend) — 40 tests
npm run test --workspace=apps/backend

# Watch mode (re-runs on file save)
npm run test:watch --workspace=packages/shared
npm run test:watch --workspace=apps/backend
```

### What is tested

**`packages/shared/src/__tests__/xpCalculation.test.ts`** — 35 tests
- `calculateRunXP` — base XP, km XP, distance bonuses (5/10/15/20km), edge cases
- `calculateStreakMultiplier` — multiplier thresholds (1.0x → 2.0x), empty/null lists
- `calculateCompleteRunXP` — streak does not affect distance bonus, finalXP always integer

**`apps/backend/src/services/__tests__/streakService.test.ts`** — 17 tests
- `calculateLongestStreak` — consecutive days, gaps, long streaks
- `calculateStreakDayForSpecificRun` — retroactively added runs, gap just before target
- `calculateCurrentStreak` — broken streak, active streak from yesterday/today

**`apps/backend/src/routes/__tests__/`** — 23 integration tests
- `auth.test.ts` (6) — login, token validation
- `runs.test.ts` (9) — create, fetch, update, delete runs
- `titles.test.ts` (8) — title leaderboard, holder calculation

---

## Features

- **Leaderboard** — Real-time ranking with XP and levels
- **XP & Level System** — Gamification: base XP + km bonus + distance bonus + streak multiplier
- **Streak Tracking** — Daily run streaks with escalating multiplier (up to 2x)
- **Strava Integration** — Automatic run import every 3 hours via OAuth2
- **Titles** — Competitive titles (longest run, longest streak, most km, best weekend average)
- **Dark Mode** — Toggle between light and dark theme, defaults to system preference
- **Admin Panel** — Configure XP settings, manage users, refresh title leaderboards

---

## Architecture Principles

- **Pages are pure glue** — a page imports features and sets the layout. No business logic.
- **Features own their logic** — each feature has its own components, hooks and utils. No cross-feature imports.
- **Shared logic in shared/** — hooks, utils and components used by multiple features live in `shared/`, not in a specific feature.
- **All data fetching via hooks** — components never call `backendApi` directly. Everything goes through hooks with React Query caching.
- **Shared XP logic in packages/shared** — `xpCalculation` runs identically on frontend (preview) and backend (save).
- **Single source for types** — `types/run.ts` is the only place where `User`, `Run` etc. are defined.
