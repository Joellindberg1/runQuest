# RunQuest

En löparapp där du och dina vänner tävlar, spårar progress och importerar löprundor från Strava — med XP-system, leaderboards och streak-tracking.

**Live:** [runquest.dev](https://www.runquest.dev) · **Version:** 0.1.1

---

## Tech Stack

| Del | Teknik |
|-----|--------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui |
| Backend | Node.js, Express, TypeScript |
| Databas | Supabase (PostgreSQL) |
| Auth | JWT + Strava OAuth2 |
| Deployment | Railway (backend), Vercel (frontend) |
| Tester | Vitest |

---

## Projektstruktur

```
runquest/
├── apps/
│   ├── frontend/
│   │   └── src/
│   │       ├── features/       # Feature-moduler (leaderboard, runs, profile, settings, admin, auth, titles)
│   │       ├── pages/          # Rena glue-komponenter — enbart layout + feature-imports
│   │       ├── shared/         # Delade UI-komponenter, services, utils, constants
│   │       └── types/          # Delade TypeScript-typer (run.ts)
│   └── backend/
│       └── src/
│           ├── routes/         # API-routes
│           ├── services/       # Affärslogik (streak, XP, titles, Strava)
│           ├── middleware/     # Auth, error handling
│           └── config/         # Databas, env
└── packages/
    └── shared/                 # Delad logik (xpCalculation) — används av både frontend och backend
```

---

## Kom igång

```bash
# Installera dependencies
npm install

# Starta frontend + backend parallellt
npm run dev

# Bara frontend
npm run dev --workspace=apps/frontend

# Bara backend
npm run dev --workspace=apps/backend
```

Kräver en `.env` i `apps/backend/` med Supabase- och JWT-nycklar.

---

## Tester

Testerna ligger nära koden de testar, i `__tests__/`-mappar.

```bash
# XP-beräkning (packages/shared) — 35 tester
npm run test --workspace=packages/shared

# Streak-logik (apps/backend) — 17 tester
npm run test --workspace=apps/backend

# Watch-läge (kör om vid filsparning)
npm run test:watch --workspace=packages/shared
npm run test:watch --workspace=apps/backend
```

### Vad testas

**`packages/shared/src/__tests__/xpCalculation.test.ts`**
- `calculateRunXP` — base XP, km XP, distance bonuses (5/10/15/20km), edge cases
- `calculateStreakMultiplier` — multiplikatortrösklar (1.0x → 1.5x), tomma/null-listor
- `calculateCompleteRunXP` — streak påverkar inte distance bonus, finalXP alltid heltal

**`apps/backend/src/services/__tests__/streakService.test.ts`**
- `calculateLongestStreak` — konsekutiva dagar, gap, långa serier
- `calculateStreakDayForSpecificRun` — retroaktivt inlagda rundor, gap precis innan target
- `calculateCurrentStreak` — bruten streak, aktiv streak från igår/idag

---

## Features

- **Leaderboard** — Realtidsrankning med XP och nivåer
- **XP & Level System** — Gamification: base XP + km-bonus + distance-bonus + streak-multiplikator
- **Streak Tracking** — Dagliga löpserier med eskalerande multiplier (upp till 2x)
- **Strava Integration** — Automatisk import av löprundor via OAuth2
- **Titles** — Tävlingstitlar (längsta run, längsta streak, mest km, bästa helgsnitt)
- **Admin Panel** — Konfigurera XP-settings, hantera användare, refresha title-leaderboards

---

## Arkitekturprinciper

- **Pages är ren glue** — en page importerar features och sätter layouten. Ingen affärslogik.
- **Features äger sin logik** — varje feature har egna komponenter, hooks och utils
- **Delad logik i packages/shared** — XP-beräkning körs identiskt på frontend (preview) och backend (spara)
- **En källa för typer** — `types/run.ts` är enda stället där `User`, `Run` etc. definieras
