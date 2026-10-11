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
- **Visade badges (RUN-131, spec F5):** `SeasonView` hämtar `useGroupBadges` (en delad query) och ger `SeasonBoard` `badgesByUser` (`badgeShowcaseMap`: användarens ordning,
  max 3, okända serier/tiers släpps). Raden får `showcase`; `BadgeMinis` (features/badges) ritar gruppen som ETT `role="img"` ("Badges: Rare Milestoner, Epic Climber"), minisen
  `decorative`. Laddar/felar queryn är `badgesByUser` odefinierad: Board ritas som förut, inga felkort eller spinners.
  - Placering: mobilpodiet på namnraden i ordningen namn, delta, minis (glappet är `--rq-sp-8`, >= 8 px); wide-podiet efter namnet; mobilens rest-rader på `sub`-raden efter km;
    desktoptabellen efter namnet. Namnet ellipsiserar och minis krymper inte, men bara på rader med minis (`data-minis`) — övriga rader har exakt samma layout som förut.
  - Utmaningsskölden står aldrig på samma rad som minis: podiet har skölden i foten, desktoptabellen på sub-raden, och på mobilens rest-rader med minis flyttar den till
    högerkolumnen (under "N d to lvl", `.rq-board-cell-ribbons`). Rader utan minis behåller skölden på sub-raden.
  - Alla mobila rest-rader har `.rq-board-sub--list` (min-height `--rq-badge-h-sm`) så raderna inte hoppar när queryn landar.
  - Legendary-minis har sin statiska glöd på Board (Council 12-fallbacken "utan glöd" är inte byggd: namn och rank dominerar fortfarande på skärmdumpen).
  - Minis-gruppens layout (`.rq-board .rq-badge-minis`) ligger i `board.css`; en annan vy som återanvänder `BadgeMinis` (Runner card) behöver egen layoutregel.
- Tour-ankare: `data-tour="leaderboard-card"` sitter på det främsta podiekortet (Season-vyn).
