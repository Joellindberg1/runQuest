# Profile Feature — `/profile`

Hjältekort · Frodo's journey (zoom) · statflikar (`?view=distance|streak|fun|consistency`, `useViewParam`) · MY TITLES · RUN HISTORY med redigera/radera
och profilbild. Mobil = App Prototypens profil (allt i en kolumn), desktop = Web Prototypens (hjälte · Frodo · statflikar | titlar + rundhistorik på 340 px).
`pages/ProfilePage.tsx` är tunn. Bottenbarens "You" och sidnavens Profile pekar hit (ADR 006). Badge-sammanfattningen (kompakt rad med "All badges →", RUN-151, spec v2 F10; komponenterna bor i `features/badges/components`)
ersatte samlingskortet (RUN-128), och väljaren för visade badges (RUN-129) är ersatt av badges-sidan `/badges` (RUN-150). Hjältekortets minis finns kvar bara på desktop.

Runner card (`/runner/:id`, `features/runner`) är samma skärm sedd utifrån: hjälte-, cell-, distans-, streak- och titellogiken är EN definition i
`runner/runnerModel`; Profile skiljer sig i Fun facts, Consistency-fliken, rundhistoriken och att den egna profilen kan ändras.

## Struktur

- **components/**
  - `ProfileScreen` — all datakoppling (`useUsersWithRuns`, titlar), laddning/fel/"User not found", tour, layout
  - `ProfileHero` — `.rq-card--hero`: nivåring (`.rq-ring` + `--rq-ring-p`), namn (+ badge-minis, `BadgeMinis`, bara desktop)/rank/rundor/"N XP to level M", statceller (3 mobil, 5 desktop) och profilbilden
  - BADGES-sammanfattningen (`BadgeSummary`, `features/badges`, RUN-151, spec v2 F10) — kompakt rubrikrad med "All badges →" (länk till `/badges`, mobilens enda ingång), intjänade serier som 44 px-emblem på nivå och en låsta-rad; varje emblem öppnar en popover (`BadgeEmblemDetail`).
    `ProfileScreen` äger badge-queryerna (`useUserBadges(me.id)`, `useGroupBadges()`) och renderar den på EN plats åt gången: **desktop** sist i `.rq-profile__main` (efter statflikarna, i ett `.rq-card`), **mobil** i `.rq-profile__side` mellan MY TITLES och RUN HISTORY
    (utan kortyta; mobilens kolumn staplar main → side). Ett badgefel/laddning stannar i sammanfattningen (felkort med Retry, skelett) och rör aldrig resten av sidan. Ingen tur-ankare för den (turen `tour_profile_v2` är oförändrad)
  - **Ingen väljare i profilen (RUN-150/151):** valet av visade badges görs på `/badges` (`features/badges`, `BadgesScreen`). `ProfileScreen` äger ingen `pickerOpen`/`editRef`/panel och sammanfattningen har ingen Edit-knapp. Tur-ankarna är oförändrade.
  - `FrodoRoad` — vägen (waypoints, ticks, stapel, markör, ändetiketter) och `ZoomButton`; EN komponent som även Runner cards desktop-väg använder (`prefix` styr klassnamnen)
  - `JourneyCard` — Frodo: vägen med waypoints/ticks, zoomknapp (Overview → Zoomed → Close-up) på mobil OCH desktop, procent, nästa mål
  - `StatsPanel` — skalet: `ViewTabs variant="underline"`, kontrollerad (`view`, `onChange`, `label`, `dataTour` från värden): `ProfileScreen` äger `?view=` (`useViewParam`), panelen läser aldrig adressen
  - `StatsContent` — innehållet för en vy utan skal (Distance, Streak med trappan hämtad bara när den visas, Fun facts, Consistency = `Heatmap`, som ritar den löpare den får som prop). Delas av profilens `StatsPanel` och popupens `OverviewPanel` (`features/runner`); `extraFunRows` är det som en värd lägger sist i Fun facts (popupens utmaningsrekord), profilens modell har inga
  - `TitlesPanel` — "MY TITLES": mobil "5 held · 3 runner-up" + tre titlar + "Show all 8", desktop "Holding · 5" / "Runner-up · 3" med innehavare och avstånd
  - `RunHistory` — fyra rader + "Show all N runs"; varje rad har "Time" och "Pace" och under listan står "Total time"/"Pace" för de rundor som visas just nu (räknas om vid "Show all").
    Vymodellen (`buildRunTime`, `buildRunTimeSummary` i `profileModel`) använder bara `summariseRunTime`/`paceSecPerKm` (shared) och `runTimeFormat`; saknad, null, 0, NaN eller negativ tid ger "—" med dold text
    "no time recorded", och "based on N of M runs" visas bara när N < M. Skärmläsaren får en mening per rad/summa (från en timme med ord: "1 hour 9 minutes 40 seconds"), de synliga fälten är `aria-hidden`.
    `EditRunSheet` — redigera/radera (bottensheet mobil, dialog desktop)
  - `PositionChart` — Position-flikens graf (RUN-401; fliken själv är RUN-402): en handritad SVG (ingen diagramlib) ur `positionModel`, som prop. Linjen är en SVG som sträcks över ytan (`non-scaling-stroke`), dottarna är HTML ovanpå
    (24 px, siffran `aria-hidden`), veckoetiketterna `W27…` sitter under och axelsiffror saknas. `role="img"` bär en mening (`summary`), "Show as table" (`aria-expanded`) visar en `<table>` med rubrikceller. `hidden` ritar ingenting,
    `new-runner` och `no-finished-week` ger modellens text i stället för graf. Ritas en gång, inget rör sig. Komponenten ska laddas med `React.lazy` (dynamisk import) av fliken och får aldrig hamna i landningens eller profilens huvudbunt;
    den har egen stilfil, `positionChart.css`, som följer med chunken. Tokens `--rq-profile-position-*` (index.css sektion 1.26 + temafilen). `<svg>` är undantaget i `eslint.config.js` (måste vara `aria-hidden`).
- **profileModel.ts** — hjälte/celler/titlar (via runnerModel), rundrader, redigeringsregler, bekräftelsetexter, XP-uppräkning, bildvalidering
- **statsModel.ts** — Distance/Streak (delade med Runner card) och profilens egna Fun facts ("Longest gap between runs"); `STAT_VIEWS`
- **heatmapModel.ts** — Consistency-rutnätet och dess tre siffror
- **frodoModel.ts** — waypoint-/viewport-matematiken; delas med Runner card
- **positionModel.ts** — Position-flikens vymodell ur `PositionHistoryResponse` (lägen `hidden`/`no-finished-week`/`new-runner`/`ready`, axel, dottar, linje, Best/Lowest/Now, meningen och tabellen). Perioden (`range`) och veckoetiketterna kommer ur
  leaderboardens `positionWeekLabels`, texterna för den pågående veckan ("this week so far") och tankstrecket (`—`, "not in the group yet", fotnoten) ur `leaderboard/positionTexts` — delade med leaderboardens `positionChartModel`,
  så att båda skriver samma sak om samma svar (testet `positionTextsAgree` matar samma svar genom båda)
- **profileFormat.ts** — "1 day"/"19 days"; tal, km och månadsnamn ligger i shared/utils/format
- **hooks/** — `useRunChanges` (`useUpdateRun`/`useDeleteRun`), `useProfilePictureUpload`
- `profile.css` — stilfilen för skärmen (utom positionsgrafen, som har `positionChart.css`); mått (`--rq-profile-*`) i temafilen, sektion 1.26 (index.css + docs/design/temafil-forslag.css)
- `profile.fixture.ts` — testdata (rundor, användare)

## Regler värda att komma ihåg

- **Allt härleds klient-side ur `users-with-runs`** (samma cache som skalet, Board, Log och Runner card) plus `GET /titles/user/:id` och `/titles/leaderboard`.
  Ingen ny endpoint — heatmapen, längsta uppehåll, favoritdag m.m. räknas ur rundorna. Payloaden är idag hela rundlistan per användare; blir den tung är
  `GET /users/me/stats` rätt lösning (inget som behövs än).
- **Redigera/radera använder SAMMA invalideringskedja som POST** (`features/runs/runEffects.invalidateAfterRunChange`, delad med Log): users-with-runs
  (väntas in), leaderboard, öppna event (direkt + en gång efter 4 s), titlar (båda rötterna), utmaningar, head-to-head och gruppens historik. Förr hämtades bara
  users-with-runs om — leaderboard, Duels och Group history stod kvar med gamla siffror. Rutan stängs först när omhämtningen är klar; då visas bekräftelsen och fokus flyttas dit (rutan är kontrollerad och har ingen Dialog.Trigger, så Radix har inget att återföra fokus till — det föll till body; `EditRunSheet.onRestoreFocus` styr i stället: bekräftelsen efter sparat/raderat, annars tillbaka till Edit-knappen, även vid Cancel, ✕ och Esc).
- **Strava-rundor är skrivskyddade (RUN-139, ägarbeslut 2026-10-11).** Strava är sanningskällan för distans och datum, och `PUT /runs/:id` redigerar
  bara de två fälten — en Strava-runda har alltså inget redigerbart kvar. `EditRunSheet` visar då distans och datum som text, "Synced from Strava. Distance and date come from Strava and can't be changed
  here.", ingen Save och Delete spärrad (som förut). Servern är sista skyddet: PUT på en Strava-runda ger `409 { error: 'Strava runs are read-only' }` utan
  skrivning eller omräkning (ägarskapet 404/403 kontrolleras först); en gammal klient eller kapplöpning ser felet i rutans alert-region. Manuella rundor
  (`source` manual, null eller saknad) är oförändrade. Rutans rubrik är då "Run details" och radens knapp "View" (manuella rundor: "Edit", som förut).
- **Inga toasts i det här flödet.** Bekräftelser ligger i permanenta `role="status"`-regioner (rundhistoriken, bildraden), fel i `role="alert"` (redigeringsrutan,
  bildraden): samma mönster som Log och Duels, texten finns kvar tills man gör något annat och läses upp pålitligt. (Toastern är monterad i `AppProviders` och
  äldre features använder den; de gamla anropen i Profile-flödet visades alltså, men ersattes av konsekvensskäl.) `guards.test.ts` förbjuder sonner/toast i featuren.
- **Redigeringsrutan** speglar backendens regler (PUT /runs/:id validerar som POST): minst 1.0 km, inte före 2025-06-01, inte framtida datum (Stockholm-dagen).
  Felen visas först efter ett inlämningsförsök (fältet är förifyllt), fokus går till första felet och inget anrop görs. Save är avstängd tills något ändrats.
  Rundans surface kan inte ändras (servern tar bara datum och distans). Rutan visar vad rundan gav senast servern räknade, och att streak och XP räknas om från den dagen.
  Delete är en röd hårlinje som öppnar ett eget bekräftelsesteg — där finns den fyllda röda knappen (oåterkalleligt). Ingen guldknapp på sidan; EN i rutan (Save).
- **Strava-rundor kan inte raderas här** (`isStravaRun`: `source === 'strava'`; null/saknas = manuell). DELETE lämnar ingen gravsten, så synken importerar tillbaka
  rundan inom sitt 7-dagarsfönster. Delete-knappen i redigeringsrutan är avstängd med "Strava runs come back from Strava — delete it in Strava instead"
  (`title` + `sr-only`-text i knappen, som Titles valknapp; en synlig rad med samma text för touch). Redigering är också låst (RUN-139, se nedan): Strava-rundor öppnas skrivskyddade via View. `source` följer med ur users-with-runs
  (`mapApiUser`). **409 vid radering** (rundan kvalificerade ett event, ADR 008 addendum 5): serverns klartext visas i rutans `role="alert"` och rutan står kvar.
- **Heatmapen:** en ruta per dag, veckor mån–sön, en vecka tillhör månaden där dess måndag ligger (4–5 per månad, som prototypen). Intensitet = dagens km:
  0 · <5 · 5–10 · 10–15 · 15+ (stegen följer distansbonusarna). Desktop 12 månader, mobil 6. Raden är scrollbar (fokus går att panorera) och visar nyaste delen. Etiketten räknar de block som faktiskt ritas ("runs · 5 months" tidigt i en månad). Rutor med runda har `role="img"` + aria-label (dag · km · rundor); dagar utan runda är dekor.
  Nuvarande streak är den effektiva (samma `streakDeadline` som Board/Right now), "longest streak" är rekordet — samma tal som Streak-fliken. Rutorna växer in en gång
  (`rqGrowY`, stagger per vecka) och står sedan still.
- **Longest gap between runs** = största antalet dagar mellan två löpardagar (två dagar i rad = 1). Bara avslutade uppehåll; tiden sedan senaste rundan räknas inte.
- **Frodo-zoom** på båda skärmstorlekarna (prototypen har den i båda). Mobil visar procent + "Next X — N km", desktop dessutom "Last checkpoint", "away" och en ring
  där nästa checkpoint ligger. Vid 0 km / framme finns ingen zoomknapp.
- **Profilbilden:** `POST /users/profile-picture` (via `backendApi`) finns kvar. Prototypen har ingen yta för den, så hjältekortet har en slank rad längst ned
  (avatar + "Change photo"). JPEG, PNG, WebP eller GIF (serverns typer), högst 5 MB (klienten nekar utan anrop). Efter en lyckad uppladdning omhämtas users, leaderboard, historiken, utmaningarna och head-to-head.
- **Titlar** har en egen query (`useRunnerTitles`) som kastar vid fel, så att ett nätverksfel inte blir "No titles". Fel → felkort med Retry.
- **Tour:** `tour_profile_v2` (ankare `profile-hero`, `profile-journey`, `profile-stats`, `profile-titles`, `profile-history`); v1-ankaren fanns inte längre.
- **CSS-ordning:** Tailwind 3 plattar ut `@layer` till vanlig CSS i bygget, så det finns inga riktiga kaskadlager — vid lika specificitet avgör laddningsordningen.
  Profile ligger i huvudbunten, och där laddas `profile.css` FÖRE `index.css` (importordningen i `main.tsx`), så en enkel klass förlorar mot de delade
  `.rq-*`-primitiverna. Overrides görs därför med sammansatta selektorer (`.rq-card.rq-profile-statcard`, `.rq-track.rq-profile-track`,
  `.rq-ring.rq-profile-ring > .rq-ring-hole` …) — specificiteten avgör, inte laddningsordningen. z-index 66 finns bara på redigeringsrutan
  (samma lager som skalets sheet/modal; ingen z-token finns).
