# Runner Feature — Runner card (`/runner/:id`)

Hjältekort · Frodo's journey · statflikar · titlar · head-to-head · Challenge (ADR 006 beslut 6, ADR 007 B6).
Mobil/direktladdning = sida i skalet (`RunnerCard`, Back-knapp); desktop inifrån appen = profil-popupen (`RunnerPopup`, Radix Dialog, "Runner card"; ADR 006 addendum 2026-10-26).
Datahämtning och paneler är gemensamma (`RunnerPanels`) — bara ramen skiljer.
`pages/RunnerPage.tsx` äger routing (eget id → `/profile`, okänt id → NotFound) och laddar popupen lazy (`React.lazy` bakom Suspense, egen chunk).

## Struktur

- **components/**
  - `RunnerCard` — sidan: Back-knapp, Challenge och `RunnerPanels`; `?view=` för statflikarna
  - `RunnerPanels` — panelerna (hjälte · journey · statflikar | titlar · badges | head to head) och all deras datakoppling; delas av sidan och popupen
  - `RunnerPopup` — profil-popupen, lazy: dialogramen (Radix Dialog över `.rq-scrim`/`.rq-modal`, bredd `--rq-modal-w`) med fast huvudyta (rubriken "Runner card", Challenge, ✕) och en scrollande yta (`.rq-runner-popup__content`) för innehållet. Fokus in = rubriken (`tabIndex={-1}`); fokus tillbaka = första synliga `[data-runner-id]` för löparen efter stängning (`onCloseAutoFocus`; Challenge-navigering undantagen). Statfliken är komponenttillstånd (`key={id}`), aldrig `?view=`. Tills flikarna (378·S6–S11) är byggda ritar den `RunnerPanels`
  - `HeroCard` — `.rq-card--hero`: nivåring (`.rq-ring` + `--rq-ring-p`), namn + badge-minis (`BadgeMinis`)/rank/rundor/"N XP to level M", statceller (3 mobil, 5 desktop)
  - `JourneyCard` — Frodo: enkel stapel (mobil) eller zoombar väg med waypoints (desktop); matematiken i `features/profile/frodoModel`
  - `StatsPanel` — `ViewTabs variant="underline"`, kontrollerad: `RunnerCard` äger `?view=` (`distance` · `streak` · `fun`, default distance; listan i `statViews.ts`)
  - `BadgePanel` (`features/badges/components`) — den kompakta BADGES-panelen (44 px-emblem med popover, RUN-152); data och placering ägs av `RunnerCard`
  - `TitlesPanel` — "TITLES HELD · N held" + Runner-up (position 2–3, "held by X", avstånd)
  - `HeadToHeadPanel` — rekordet (you won · drawn · you lost) + senaste mötena; bor i `.rq-runner__lower` bredvid BADGES
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
- **Titlar** har en egen query (`useRunnerTitles`) som kastar vid fel, så att ett nätverksfel inte blir "No titles".
  Enheten på värdena kommer från `metric_key` i `/titles/leaderboard`; saknas den visas bara talet.
- `useViewParam` (sidan) bär med sig router-state. Popupen använder inte `?view=`: dess flikar är komponenttillstånd som nollställs vid varje öppning.
- Id-prefixet i `StatsPanel` här är `runner-stats`; profilens panel har `profile-stats`. Popupen öppnas bara från ytor med `data-runner-id`-rader (Board, Log, Duels och preview-widgeten), och ingen av dem ritar någon av panelerna; sidan och popupen finns aldrig samtidigt (bakgrunden är aldrig en `/runner/`-adress).
- Dynamiska värden går in via `cssVars()` (`--w`, `--x`, `--rq-ring-p`); inga inline-färger/mått (guards.test).
- **Andras badges (RUN-130, spec F4, Council 1/13/16):** `RunnerCard` hämtar `useUserBadges(user.id)` (löparens samling, inget `seen_tier`) och `useGroupBadges()` — båda ur
  badge-hookarna, så query-nycklarna (`BADGE_QUERY_KEYS`) aldrig krockar med Runner/Duels. `buildRunnerBadges` (badges/badgeModel) ger minis (de visade) och panelrader
  (bara intjänade: visade först i löparens ordning, sedan högst nivå, sedan serieordning). Minis och panel är badge-tillägg, inte kortets kärna:
  - **Placering (RUN-152, spec F11.1):** EN DOM-ordning för alla bredder, utan `isDesktop`-villkor: `hero · journey · .rq-runner__split(StatsPanel | .rq-runner__side(TitlesPanel)) · .rq-runner__lower(BadgePanel | HeadToHeadPanel)`.
    `.rq-runner__lower` är ett rutnät med `--rq-runner-split-cols` (samma kolumner som raden ovanför): desktop = BADGES till vänster, Head to head i 340 px-kolumnen (sträcks till radens höjd); mobil (en kolumn) = efter TITLES, före Head to head. Utan inloggad (ingen head to head) står panelen ensam i första kolumnen.
  - **Held-by** ("Held by X of N in your pack") göms när X = N och utelämnas utan platshållare när group-queryn felar eller laddar.
  - **Popover:** nivå, krav, "On display" och held-by bor i varje emblems popover (`BadgeEmblemDetail`), inte i panelen. Held-by följer samma regler som förut (göms vid X = N, utelämnas utan group-data).
  - **Fel/laddning:** laddar → laddaren i panelen; fel → felkort med Retry (`ErrorState`) och inga minis — "No badges yet." gäller bara ett lyckat, tomt svar. 404 kan inte nås via UI:t (kortet öppnas bara för gruppmedlemmar). Challenge och head-to-head berörs aldrig.
  - **Minis** ligger efter `<h1>`, inte i den (rubriken förblir bara namnet). Namnraden har `min-height: var(--rq-badge-h-sm)` så kortet inte hoppar när badge-queryn landar; ryms inte namn + minis på en rad hamnar minisen under namnet.
  - **Stilen** för `.rq-badge-panel*` bor i `features/badges/badges.css`; `runner.css` har bara `.rq-runner__lower` (rutnätet) och `align-self: stretch` för head to head.
- Head-to-head visas aldrig på egen profil (routingen redirectar). `active` (pending/live) stänger av Challenge-knappen.
