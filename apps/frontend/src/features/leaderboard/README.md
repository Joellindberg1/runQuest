# Leaderboard Feature — The Standings (`/board`)

Fyra delvyer över `?view=` (ADR 006): `season` (visas som **All-time**, default) · `week` · `streaks` · `position` (bara med två eller fler medlemmar).
Mobil (<1024 px) och desktop (≥1024) är två varianter av samma data; exakt en finns i DOM.

## Struktur

- `pages/BoardPage.tsx` — rubrik, flikar (`BoardTabs` över `ViewTabs` och `useViewParam`), tour, väljer delvy. Antalet medlemmar kommer ur gruppen sidan redan hämtar (`useUsersWithRuns`), aldrig ur positionssvaret: `boardViewsFor(n)` (`boardViews.ts`) och `showPositionTab(n)` (`positionTab.ts`, samma regel som profilens flik) döljer Position under två, och `?view=position` med en medlem faller tillbaka på Season utan något positionsanrop. Tills gruppen svarat godtas `?view=position` och vyn väntar (laddning) i stället för att visa Season och byta; ett fel är bestående (`errorUpdateCount`), så Season visar då sitt eget felkort. `FirstBoardGate` och touren följer Season och rörs inte av den nya vyn.
- `BoardTabs` (`components/`) — flikraden: fyra flikar ryms inte på 320 px, så raden scrollar i sidled (`boardTabs.css`, RUN-387-mönstret: `flex: 1`, `overflow-x: auto`, inåtriktad ring) med kantfade (`shared/hooks/useTabRowFade`, `shared/components/tabRowFade`: data-attributen sätts på omslaget, raden är den enda tablisten) och rapporterar flikens pekare och fokus (`onIntent`) så att sidan förladdar Position-vyns chunk (`positionViewLoader`). Stilen ligger i en egen fil, inte i `board.css`, som landningen också laddar.
- `PositionTab` (`components/`) — liten och statisk: hämtar `usePositionHistory(8)` när fliken väljs (inga begäran på de andra flikarna), visar laddning (stadion-ovalen) och fel (`ErrorState` med Retry) och lazy-laddar `PositionView` (`React.lazy` över `positionViewLoader`, en egen chunk). Chunken begärs också redan här, så den hämtas samtidigt med svaret.
- **components/**
  - `SeasonView` (hämtar grupp + titlar + rank-delta) → `SeasonBoard` (ren presentation, används även av preview-sidan) → `PodiumCard`, `SeasonRest` (`RestList` mobil / `RestTable` desktop)
  - `WeekView` — dagstaplar, Mover of the week, pack-total (`/api/leaderboard/week`)
  - `StreaksView` — status, multiplikator, nedräkning, trappan (`/api/config/xp`)
  - `BoardParts` — avatar, delta-pil, namn-knapp, challenge-vimplar (`ChallengeRibbons`), `cssVars`
- **Vymodeller (rena, testade):** `seasonModel`, `weekModel`, `streakModel`, `boardFormat`
- **hooks/** `useBoardQueries` (week, rank-delta); `usePositionHistory(weeks, enabled)` (`['leaderboard','positions',weeks]`, delas av Leaderboard och profilen, antalet veckor i svaret styr: anta aldrig 8); `useScrollsSideways` (om en yta faktiskt scrollar i sidled, för tabellens tabbstopp); `shared/hooks/useXpConfig`, `useViewParam`, `useTabRowFade`
- **Positionsgrafens vymodell:** `positionChartModel` (`buildPositionChart`, `selectRunner`, `chartHeight`) gör linjer, slutpunkter, valt läge, "Current order", tabell och `role="img"`-text ur `PositionHistoryResponse`. Sorterar aldrig själv (svarets ordning = Standings, `compareXpStandings`), bär ingen färg och antar inget antal veckor.
- **Veckoetiketter:** `positionWeekLabels` är enda stället som gör `W27` / `week 27` / intervalltext ur `iso_week` + `iso_year` (år i skärmläsartexten över ISO-årsskiftet)
- **Positionstexterna:** `positionTexts` äger den pågående veckan ("this week so far", `currentWeekSentence`), tankstrecket och dess talade text och fotnot, `placementText`, den talade perioden (`spokenRange`: "weeks 27 to 34") och `NO_FINISHED_WEEK_MESSAGE`. Profilens modell (`profile/positionModel`) och leaderboardens modell skriver ingen egen; `profile/positionTextsAgree.test` fäller om de glider isär.
- **Positionsgrafens komponenter** (Position-fliken, lazy-laddade av `PositionTab`; bara `positionViewLoader` importerar dem, så de hamnar aldrig i landningens eller ingångens bunt). Alla ritas ur `buildPositionChart`; ingen rör Supabase eller en query.
  - `PositionChartCard` — kortet: rubrik, "Show as table", förklaringsraden ("Read every Sunday midnight"; varje "·" står i samma `white-space: nowrap`-del som texten efter sig, så en smal rad aldrig slutar på ett ensamt skiljetecken), grafen eller tabellen, och `no-finished-week`-texten. Tabellytan är ett tabbstopp (`tabindex="0"`) bara när den faktiskt scrollar (`useScrollsSideways`, ResizeObserver), annars en namngiven region utan tabbstopp; radrubrikerna bryts vid mellanrum och aldrig mitt i ordet. `hidden` ritar ingenting. Importerar `positionBoard.css`.
  - `PackPositionChart` — handritad SVG för alla löpare, ingen diagramlib: en SVG per linje (viewBox 0–100 i x, px i y) och HTML-prickar/bild ovanpå, rutnät med tre kolumner (axeltal | fält | namn) så ett långt förnamn gör namnkolumnen bredare i stället för att klippas. Din linje guld och tjock, övriga ETT neutralt alias, vald löpare tjockare med fetare namn och övriga till ca 25 % (`data-me`/`data-selected`/`data-dimmed`, ingen färg per löpare). Veckoetiketterna tunnas ut av `positionWeekTicks` över åtta veckor. Roll: `role="img"` + modellens `ariaLabel`; allt inuti är `aria-hidden`.
  - `PositionHistoryTable` — samma data som tabell (fullt namn, `week 27` talat, tankstrecket som "not in the group yet" och dess fotnot).
  - `CurrentOrder` — "Current order" och legenden i EN komponent: en `<ol>` med en knapp (`aria-pressed`) per löpare i Standings ordning (modellens `order` = svarets `runners`-ordning, `compareXpStandings`), "You"-tagg i text, "Joined W30" för den som kom in senare, raderna minst 44 px på mobil och inåtriktad fokusring. Kontrollerad (`onSelect(id)`). Utan `onSelect` (ingen avslutad vecka, alltså ingen graf att lyfta en linje i) är listan bara ordningen: vanliga `div`-rader, inga knappar eller tabbstopp, ingen "Shown" och inget hint.
  - `PositionView` — fliken som en enhet: äger det delade valtillståndet (`selectedId`; samma id igen avmarkerar via `selectRunner`), bygger modellen med `useIsDesktop` (radavstånd) och ritar `PositionChartCard` + `CurrentOrder` (utan val i `no-finished-week`). Webben har legenden bredvid grafen (≥ 1024 px, två kort), mobilen under den (ett kort): samma element, bara CSS flyttar det. `PositionTab` hämtar svaret (`usePositionHistory`) och lazy-laddar `PositionView`.
  - `PositionAvatar` — profilbild i en cirkel, initialer när bilden saknas eller är trasig (en trasig URL minns att den föll, en ny bild får nytt försök).
- `boardTabs.css` — flikradens scroll, flex och kantfade (Board-sidan; inte i landningens stilmallar). `board.css` — stilfilen för Season/Week/Streaks; bara tokens utanför mått-blocket i toppen. `positionBoard.css` är Position-flikens stil (tokens `--rq-board-position-*`, temafilens sektion 1.20b), laddas bara med de lazy-laddade komponenterna.

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
