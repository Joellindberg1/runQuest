# Leaderboard Feature — The Standings (`/board`)

Tre delvyer över `?view=` (ADR 006): `season` (visas som **All-time**, default) · `week` · `streaks`.
Mobil (<1024 px) och desktop (≥1024) är två varianter av samma data; exakt en finns i DOM.

## Struktur

- `pages/BoardPage.tsx` — rubrik, flikar (`ViewTabs` över `useViewParam`), tour, väljer delvy.
- **components/**
  - `SeasonView` (hämtar grupp + titlar + rank-delta) → `SeasonBoard` (ren presentation, används även av preview-sidan) → `PodiumCard`, `SeasonRest` (`RestList` mobil / `RestTable` desktop)
  - `WeekView` — dagstaplar, Mover of the week, pack-total (`/api/leaderboard/week`)
  - `StreaksView` — status, multiplikator, nedräkning, trappan (`/api/config/xp`)
  - `BoardParts` — avatar, delta-pil, namn-knapp, challenge-vimplar (`ChallengeRibbons`), `cssVars`
- **Vymodeller (rena, testade):** `seasonModel`, `weekModel`, `streakModel`, `boardFormat`
- **hooks/** `useBoardQueries` (week, rank-delta); `usePositionHistory(weeks, enabled)` (`['leaderboard','positions',weeks]`, delas av Leaderboard och profilen, antalet veckor i svaret styr: anta aldrig 8); `shared/hooks/useXpConfig`, `useViewParam`
- **Veckoetiketter:** `positionWeekLabels` är enda stället som gör `W27` / `week 27` / intervalltext ur `iso_week` + `iso_year` (år i skärmläsartexten över ISO-årsskiftet)
- `board.css` — enda stilfilen; bara tokens utanför mått-blocket i toppen.

## Regler värda att komma ihåg

- Streak-status går genom `streakDeadline` (app-shell/rightNowItems) — samma logik som Right now-pillen.
- Multiplikatortrappan kommer ALLTID ur `/api/config/xp`; ingen import av `constants/streakConstants` här.
- `challenge_counts` = osända tokens (vimplar + "N left"), inte vunna utmaningar.
- Dynamiska värden (`--w`, `--h`, `--rq-delay`) går in via `cssVars()`; inga inline-färger/mått (guards.test).
- **Visade badges (RUN-131, spec F5):** `SeasonView` hämtar `useGroupBadges` (en delad query) och ger `SeasonBoard` `badgesByUser` (`badgeShowcaseMap`: användarens ordning,
  max 3, okända serier/tiers släpps). Raden får `showcase`; `BadgeMinis` (features/badges) ritar gruppen som ETT `role="img"` ("Badges: Rare Milestoner, Epic Climber"), minisen
  `decorative`. Laddar/felar queryn är `badgesByUser` odefinierad: Board ritas som förut, inga felkort eller spinners.
  - Placering (RUN-147, spec F12): podiet har minis högerställda på namnraden (`margin-left: auto; margin-right: var(--rq-board-minis-inset)`, 28 px mobil / 46 px desktop, sektion 1.20
    i temafilerna) i ordningen namn, delta, minis (glappet är `--rq-sp-8`, >= 8 px); wide-podiet har "Lvl N" + delta på rad 1 och namn + minis på rad 2; mobilens rest-rader har minis på
    `sub`-raden efter km; desktoptabellen har namnet ensamt på namnraden och minis på sub-raden efter "Lvl N · X km" (glapp `--rq-sp-8`). Minis krymper aldrig.
  - Utmaningstecknet är en vimpel (vertikal, svalstjärt; geometrin `PENNANT_*` i `shared/components/challengeMark`, ur designens `pennant()`, delas med Duels), inte en sköld. Vimpel och minis står aldrig i en gemensam
    behållare (Council 8, F12.4): podiet har vimplarna i foten; mobila rest-rader i högerkolumnen under "N d to lvl" (`.rq-board-cell-ribbons`, alltid, oavsett minis — ingen tom
    behållare utan tokens); desktoptabellen i Last run-cellen under tiden (`.rq-board-cell-stack`). `BoardPage.test` fäller om någon behållare mellan en minis-grupp och radens/kortets rot också
    rymmer en vimpel. `features/challenges/TierRibbon` (Duels) ritar samma vimpel ur samma konstanter men med egen stil.
  - Alla rest-rader har en sub-rad med min-height `--rq-badge-h-sm` (`.rq-board-sub--list` mobil, `.rq-board-sub--table` desktop) så raderna inte hoppar när queryn landar.
  - Legendary-minis har sin statiska glöd på Board (Council 12-fallbacken "utan glöd" är inte byggd: namn och rank dominerar fortfarande på skärmdumpen).
  - Minis-gruppens layout (`.rq-board .rq-badge-minis`) ligger i `board.css`; en annan vy som återanvänder `BadgeMinis` (Runner card) behöver egen layoutregel.
- Tour-ankare: `data-tour="leaderboard-card"` sitter på det främsta podiekortet (Season-vyn).
