# Profile Feature — `/profile`

Hjältekort · Frodo's journey (zoom) · statflikar (`?view=distance|streak|fun|consistency`, `useViewParam`) · MY TITLES · RUN HISTORY med redigera/radera
och profilbild. Mobil = App Prototypens profil (allt i en kolumn), desktop = Web Prototypens (hjälte · Frodo · statflikar | titlar + rundhistorik på 340 px).
`pages/ProfilePage.tsx` är tunn. Bottenbarens "You" och sidnavens Profile pekar hit (ADR 006). Badge-sektionerna i prototyperna är medvetet INTE byggda
(ägaren designar dem).

Runner card (`/runner/:id`, `features/runner`) är samma skärm sedd utifrån: hjälte-, cell-, distans-, streak- och titellogiken är EN definition i
`runner/runnerModel`; Profile skiljer sig i Fun facts, Consistency-fliken, rundhistoriken och att den egna profilen kan ändras.

## Struktur

- **components/**
  - `ProfileScreen` — all datakoppling (`useUsersWithRuns`, titlar), laddning/fel/"User not found", tour, layout
  - `ProfileHero` — `.rq-card--hero`: nivåring (`.rq-ring` + `--rq-ring-p`), namn/rank/rundor/"N XP to level M", statceller (3 mobil, 5 desktop) och profilbilden
  - `JourneyCard` — Frodo: vägen med waypoints/ticks, zoomknapp (Overview → Zoomed → Close-up) på mobil OCH desktop, procent, nästa mål
  - `StatsPanel` — `ViewTabs variant="underline"` över `?view=`; `Heatmap` är Consistency-fliken
  - `TitlesPanel` — "MY TITLES": mobil "5 held · 3 runner-up" + tre titlar + "Show all 8", desktop "Holding · 5" / "Runner-up · 3" med innehavare och avstånd
  - `RunHistory` — fyra rader + "Show all N runs"; `EditRunSheet` — redigera/radera (bottensheet mobil, dialog desktop)
- **profileModel.ts** — hjälte/celler/titlar (via runnerModel), rundrader, redigeringsregler, bekräftelsetexter, XP-uppräkning, bildvalidering
- **statsModel.ts** — Distance/Streak (delade med Runner card) och profilens egna Fun facts ("Longest gap between runs"); `STAT_VIEWS`
- **heatmapModel.ts** — Consistency-rutnätet och dess tre siffror
- **frodoModel.ts** — waypoint-/viewport-matematiken; delas med Runner card
- **profileFormat.ts** — tal (delas med Log) och egna månadsnamn
- **hooks/** — `useRunChanges` (`useUpdateRun`/`useDeleteRun`), `useProfilePictureUpload`
- `profile.css` — enda stilfilen; mått (`--rq-profile-*`) i temafilen, sektion 1.26 (index.css + docs/design/temafil-forslag.css)
- `profile.fixture.ts` — testdata (rundor, användare)

## Regler värda att komma ihåg

- **Allt härleds klient-side ur `users-with-runs`** (samma cache som skalet, Board, Log och Runner card) plus `GET /titles/user/:id` och `/titles/leaderboard`.
  Ingen ny endpoint — heatmapen, längsta uppehåll, favoritdag m.m. räknas ur rundorna. Payloaden är idag hela rundlistan per användare; blir den tung är
  `GET /users/me/stats` rätt lösning (inget som behövs än).
- **Redigera/radera använder SAMMA invalideringskedja som POST** (`features/runs/runEffects.invalidateAfterRunChange`, delad med Log): users-with-runs
  (väntas in), leaderboard, öppna event (direkt + en gång efter 4 s), titlar (båda rötterna), utmaningar, head-to-head och gruppens historik. Förr hämtades bara
  users-with-runs om — leaderboard, Duels och Group history stod kvar med gamla siffror. Rutan stängs först när omhämtningen är klar; då visas bekräftelsen.
- **Inga toasts.** Toaster är inte monterad i appen, så de gamla `toast()`-anropen i flödet visade ingenting. Bekräftelser ligger i permanenta `role="status"`-
  regioner (rundhistoriken, bildraden), fel i `role="alert"` (redigeringsrutan, bildraden). `guards.test.ts` förbjuder sonner/toast i featuren.
- **Redigeringsrutan** speglar backendens regler (PUT /runs/:id validerar som POST): minst 1.0 km, inte före 2025-06-01, inte framtida datum (Stockholm-dagen).
  Felen visas först efter ett inlämningsförsök (fältet är förifyllt), fokus går till första felet och inget anrop görs. Save är avstängd tills något ändrats.
  Rundans surface kan inte ändras (servern tar bara datum och distans). Rutan visar vad rundan gav senast servern räknade, och att streak och XP räknas om från den dagen.
  Delete är en röd hårlinje som öppnar ett eget bekräftelsesteg — där finns den fyllda röda knappen (oåterkalleligt). Ingen guldknapp på sidan; EN i rutan (Save).
- **Heatmapen:** en ruta per dag, veckor mån–sön, en vecka tillhör månaden där dess måndag ligger (4–5 per månad, som prototypen). Intensitet = dagens km:
  0 · <5 · 5–10 · 10–15 · 15+ (stegen följer distansbonusarna). Desktop 12 månader, mobil 6. Raden är scrollbar (fokus går att panorera) och visar nyaste delen.
  Nuvarande streak är den effektiva (samma `streakDeadline` som Board/Right now), "longest streak" är rekordet — samma tal som Streak-fliken. Rutorna växer in en gång
  (`rqGrowY`, stagger per vecka) och står sedan still.
- **Longest gap between runs** = största antalet dagar mellan två löpardagar (två dagar i rad = 1). Bara avslutade uppehåll; tiden sedan senaste rundan räknas inte.
- **Frodo-zoom** på båda skärmstorlekarna (prototypen har den i båda). Mobil visar procent + "Next X — N km", desktop dessutom "Last checkpoint", "away" och en ring
  där nästa checkpoint ligger. Vid 0 km / framme finns ingen zoomknapp.
- **Profilbilden:** `POST /users/profile-picture` (via `backendApi`) finns kvar. Prototypen har ingen yta för den, så hjältekortet har en slank rad längst ned
  (avatar + "Change photo"). Bild, högst 5 MB (klienten nekar utan anrop). Efter en lyckad uppladdning omhämtas users, leaderboard, historiken, utmaningarna och head-to-head.
- **Titlar** har en egen query (`useRunnerTitles`, kastar vid fel) — `useUserTitles` sväljer fel och skulle ge "No titles" vid nätverksfel. Fel → felkort med Retry.
- **Tour:** `tour_profile_v2` (ankare `profile-hero`, `profile-journey`, `profile-stats`, `profile-titles`, `profile-history`); v1-ankaren fanns inte längre.
- **CSS-ordning:** `profile.css` ligger utanför `@layer`, så den slår de delade `.rq-*`-primitiverna utan sammansatta selektorer. z-index 66 finns bara på redigeringsrutan
  (samma lager som skalets sheet/modal; ingen z-token finns).
