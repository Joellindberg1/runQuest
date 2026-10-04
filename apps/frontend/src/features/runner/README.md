# Runner Feature — Runner card (`/runner/:id`)

Hjältekort · Frodo's journey · statflikar · titlar · head-to-head · Challenge (ADR 006 beslut 6, ADR 007 B6).
Mobil/direktladdning = sida i skalet (`variant="page"`, Back-knapp); desktop inifrån appen = overlay
(`variant="overlay"`, "Runner profile"). Datahämtning och innehåll är gemensamma — bara ramen skiljer.
`pages/RunnerPage.tsx` äger routing (eget id → `/profile`, okänt id → NotFound) och dialogen.

## Struktur

- **components/**
  - `RunnerCard` — ramen + all datakoppling; renderar de fem korten och Challenge-knappen
  - `HeroCard` — `.rq-card--hero`: nivåring (`.rq-ring` + `--rq-ring-p`), namn/rank/rundor/"N XP to level M", statceller (3 mobil, 5 desktop)
  - `JourneyCard` — Frodo: enkel stapel (mobil) eller zoombar väg med waypoints (desktop); matematiken i `features/profile/frodoModel`
  - `StatsPanel` — `ViewTabs variant="underline"` över `?view=` (`distance` · `streak` · `fun`, default distance)
  - `TitlesPanel` — "TITLES HELD · N held" + Runner-up (position 2–3, "held by X", avstånd)
  - `HeadToHeadPanel` — rekordet (you won · drawn · you lost) + senaste mötena
  - `ChallengeButton` — den enda guldknappen; `/duels?send=1&opponent=<id>`
- **runnerModel.ts** — rena, testade vymodeller (hjälte, celler, distans-/streak-/fun-rader, titlar, head-to-head)
- **hooks/useRunnerQueries.ts** — `useHeadToHead`, `useRunnerTitles`
- `runner.css` — enda stilfilen; mått (`--rq-runner-*`) i temafilen, sektion 1.21

## Regler värda att komma ihåg

- **Challenge** är en sekundärknapp (guld-hårlinje, ingen fylld guldknapp på kortet); med pågående utmaning visas en statuschip. Länken är `duelsSendPath(id)` i `paths.ts`. `opponent`-parametern konsumeras av send-sheeten i inkrement 5;
  tills dess landar länken på `/duels`. (ADR 006 beslut 4 uppdaterad till samma form; sheeten validerar `opponent` mot gruppen.)
- **Streak-trappan** kommer ur `/api/config/xp` (`useXpConfig`), aldrig ur konstanter. Effektiv streak (0 när bruten) delas med Board.
- **Double-run days** = dagar där två rundors starttider ligger ≥ 4 h isär (samma 4 h-gräns som titeln The Double Trouble; titeln kräver dessutom 5 km per runda och mäter km).
  Rundor utan `start_time` (manuell loggning) kan inte bevisa avståndet och räknas inte.
- **Titlar** har en egen query (`useRunnerTitles`) som kastar vid fel — `useUserTitles` sväljer fel och skulle ge "No titles".
  Enheten på värdena kommer från `metric_key` i `/titles/leaderboard`; saknas den visas bara talet.
- `useViewParam` bär med sig router-state, annars tappar overlayn sin `background` när statfliken byts.
- Dynamiska värden går in via `cssVars()` (`--w`, `--x`, `--rq-ring-p`); inga inline-färger/mått (guards.test).
- Head-to-head visas aldrig på egen profil (routingen redirectar). `active` (pending/live) stänger av Challenge-knappen.
