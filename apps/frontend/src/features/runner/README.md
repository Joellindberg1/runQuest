# Runner Feature — Runner card (`/runner/:id`)

Hjältekort · Frodo's journey · statflikar · titlar · head-to-head · Challenge (ADR 006 beslut 6, ADR 007 B6).
Mobil/direktladdning = sida i skalet (`variant="page"`, Back-knapp); desktop inifrån appen = overlay
(`variant="overlay"`, "Runner profile"). Datahämtning och innehåll är gemensamma — bara ramen skiljer.
`pages/RunnerPage.tsx` äger routing (eget id → `/profile`, okänt id → NotFound) och dialogen.

## Struktur

- **components/**
  - `RunnerCard` — ramen + all datakoppling; renderar de fem korten och Challenge-knappen
  - `HeroCard` — `.rq-card--hero`: nivåring (`.rq-ring` + `--rq-ring-p`), namn + badge-minis (`BadgeMinis`)/rank/rundor/"N XP to level M", statceller (3 mobil, 5 desktop)
  - `JourneyCard` — Frodo: enkel stapel (mobil) eller zoombar väg med waypoints (desktop); matematiken i `features/profile/frodoModel`
  - `StatsPanel` — `ViewTabs variant="underline"` över `?view=` (`distance` · `streak` · `fun`, default distance)
  - `BadgePanel` (`features/badges/components`) — den skrivskyddade BADGES-panelen (RUN-130); data och placering ägs av `RunnerCard`
  - `TitlesPanel` — "TITLES HELD · N held" + Runner-up (position 2–3, "held by X", avstånd)
  - `HeadToHeadPanel` — rekordet (you won · drawn · you lost) + senaste mötena
  - `ChallengeButton` — den enda guldknappen; `/duels?send=1&opponent=<id>`
- **runnerModel.ts** — rena, testade vymodeller (hjälte, celler, distans-/streak-/fun-rader, titlar, head-to-head)
- **hooks/useRunnerQueries.ts** — `useHeadToHead`, `useRunnerTitles`
- `runner.css` — enda stilfilen; mått (`--rq-runner-*`) i temafilen, sektion 1.21

## Regler värda att komma ihåg

- **Challenge** är en sekundärknapp (guld-hårlinje, ingen fylld guldknapp på kortet); med pågående utmaning visas en statuschip. Länken är `duelsSendPath(id)` i `paths.ts`. `opponent`-parametern konsumeras av send-sheeten (`features/challenges`, inkrement 5),
  som förväljer löparen om hen är i gruppen och inte upptagen. (ADR 006 beslut 4 uppdaterad till samma form.)
- **Streak-trappan** kommer ur `/api/config/xp` (`useXpConfig`), aldrig ur konstanter. Effektiv streak (0 när bruten) delas med Board.
- **Double-run days** = dagar där två rundors starttider ligger ≥ 4 h isär (samma 4 h-gräns som titeln The Double Trouble; titeln kräver dessutom 5 km per runda och mäter km).
  Rundor utan `start_time` (manuell loggning) kan inte bevisa avståndet och räknas inte.
- **Titlar** har en egen query (`useRunnerTitles`) som kastar vid fel — `useUserTitles` sväljer fel och skulle ge "No titles".
  Enheten på värdena kommer från `metric_key` i `/titles/leaderboard`; saknas den visas bara talet.
- `useViewParam` bär med sig router-state, annars tappar overlayn sin `background` när statfliken byts.
- Dynamiska värden går in via `cssVars()` (`--w`, `--x`, `--rq-ring-p`); inga inline-färger/mått (guards.test).
- **Andras badges (RUN-130, spec F4, Council 1/13/16):** `RunnerCard` hämtar `useUserBadges(user.id)` (löparens samling, inget `seen_tier`) och `useGroupBadges()` — båda ur
  badge-hookarna, så query-nycklarna (`BADGE_QUERY_KEYS`) aldrig krockar med Runner/Duels. `buildRunnerBadges` (badges/badgeModel) ger minis (de visade) och panelrader
  (bara intjänade: visade först i löparens ordning, sedan högst nivå, sedan serieordning). Minis och panel är badge-tillägg, inte kortets kärna:
  - **Placering:** mobil = panelen direkt under hjältekortet; desktop (≥1024, `useIsDesktop`) = samma panel först i 340 px-sidokolumnen, ovanför TITLES. Aldrig båda (en instans, flyttas i trädet).
  - **Held-by** ("Held by X of N in your pack") göms när X = N och utelämnas utan platshållare när group-queryn felar eller laddar.
  - **Fel/laddning:** laddar → laddaren i panelen; fel → felkort med Retry (`ErrorState`) och inga minis — "No badges yet." gäller bara ett lyckat, tomt svar. 404 kan inte nås via UI:t (kortet öppnas bara för gruppmedlemmar). Challenge och head-to-head berörs aldrig.
  - **Minis** ligger efter `<h1>`, inte i den (rubriken förblir bara namnet). Namnraden har `min-height: var(--rq-badge-h-sm)` så kortet inte hoppar när badge-queryn landar; ryms inte namn + minis på en rad hamnar minisen under namnet.
  - **Stilen** för `.rq-badge-panel*` bor i `runner.css` (kommentar överst i blocket) tills Profile återanvänder panelen i RUN-128 — då flyttas blocket till `badges.css`.
- Head-to-head visas aldrig på egen profil (routingen redirectar). `active` (pending/live) stänger av Challenge-knappen.
