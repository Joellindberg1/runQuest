# Leaderboard Feature — The Standings (`/board`)

Tre delvyer över `?view=` (ADR 006): `season` (visas som **All-time**, default) · `week` · `streaks`.
Mobil (<1024 px) och desktop (≥1024) är två varianter av samma data; exakt en finns i DOM.

## Struktur

- `pages/BoardPage.tsx` — rubrik, flikar (`ViewTabs` över `useViewParam`), tour, väljer delvy.
- **components/**
  - `SeasonView` (hämtar grupp + titlar + rank-delta) → `SeasonBoard` (ren presentation, används även av preview-sidan) → `PodiumCard`, `SeasonRest` (`RestList` mobil / `RestTable` desktop)
  - `WeekView` — dagstaplar, Mover of the week, pack-total (`/api/leaderboard/week`)
  - `StreaksView` — status, multiplikator, nedräkning, trappan (`/api/config/xp`)
  - `BoardParts` — avatar, delta-pil, namn-knapp, challenge-ribbons, `cssVars`
- **Vymodeller (rena, testade):** `seasonModel`, `weekModel`, `streakModel`, `boardFormat`
- **hooks/** `useBoardQueries` (week, rank-delta); `shared/hooks/useXpConfig`, `useViewParam`
- `board.css` — enda stilfilen; bara tokens utanför mått-blocket i toppen.

## Regler värda att komma ihåg

- Streak-status går genom `streakDeadline` (app-shell/rightNowItems) — samma logik som Right now-pillen.
- Multiplikatortrappan kommer ALLTID ur `/api/config/xp`; ingen import av `constants/streakConstants` här.
- `challenge_counts` = osända tokens (ribbons + "N left"), inte vunna utmaningar.
- Dynamiska värden (`--w`, `--h`, `--rq-delay`) går in via `cssVars()`; inga inline-färger/mått (guards.test).
- Tour-ankare: `data-tour="leaderboard-card"` sitter på det främsta podiekortet (Season-vyn).
