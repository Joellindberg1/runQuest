# Log Feature — `/log`

Rubrik "Log runs" + två flikar (`?view=form` · `?view=group`, `useViewParam`): **Log a run** (formulär, Estimated XP, "What this run does")
och **Group history** (gruppens rundor som kort med "Show more").
Mobil = App Prototypens log-skärm (allt i en kolumn, Strava-rad överst), desktop = Web Prototypens (formulär | 400 px förhandsvisning;
historikkortet i tre kolumner). `pages/LogPage.tsx` är tunn. +New-sheetens "Log a run" och skalets Right now-streak pekar på `paths.log` — oförändrat kontrakt.

## Struktur

- **components/**
  - `LogScreen` — all datakoppling, flikar, laddning/fel, väljer mobil/desktop-text
  - `RunForm` — datum, distans, snabbval, utomhus/löpband, EN guldknapp, permanenta live-regioner
  - `XpPanels` — `XpCard` (Estimated XP + uppställning) och `EffectsCard` ("What this run does")
  - `GroupHistory` — kort, skelett/fel/tomt, "Show more"
  - `StravaBanner` — mobilens Strava-rad
- **logModel.ts** — formulärtillstånd, validering (backendens regler), `buildSubmission`, `streakOutlook` (streakdagen en ny runda får), bekräftelsetext
- **xpPreviewModel.ts** — `buildXpPreview`: uppställning via `calculateCompleteRunXP` (shared) + effekterna streak/nivå/Frodo/ranking
- **historyModel.ts** — `buildHistoryRow` (kort: initialer, underlag, väder, källa, fem celler), sidstorlek
- **stravaModel.ts** — banderollens text ur `/strava/status` + `/strava/last-sync`
- **logFormat.ts** — en-GB-tal, egna månadsnamn, "32 min ago"/"in 28 min", WMO-väderkod → etikett
- **hooks/** — `useLogForm` (formulärets tillstånd, överlever flikbyte), `useCreateRun` (mutation + invalideringar), `useLogQueries` (`useGroupHistory`, Strava)
- `log.css` — enda stilfilen; mått (`--rq-log-*`) i temafilen, sektion 1.25 (index.css + docs/design/temafil-forslag.css)
- `log.fixture.ts` — testdata (rundor ur `GET /runs/group-history`)

## Regler värda att komma ihåg

- **Valideringen speglar `POST /runs`:** minst 1.0 km, inget datum före 2025-06-01, inget framtida datum. Felen är vänliga och visas bredvid fältet
  (`aria-invalid` + `aria-describedby`); fokus går till första felet vid inlämning och inget anrop görs. Ett tomt distansfält är först ett fel vid
  inlämning (annars skriker formuläret innan man hunnit skriva). Distansen läser både "8.4" och "8,4".
- **"Idag" är Stockholm-dagen** (`stockholmClock`, som streaken i resten av appen), inte webbläsarens eller UTC-dagen. Datumfältets `max` är samma dag.
- **Estimated XP = shared-formeln** (`calculateCompleteRunXP`, ADR 004) över config-trappan och inställningarna från `GET /config/xp` (`useXpConfig`).
  Inget är hårdkodat i featuren. Går config inte att läsa räknar shareds `DEFAULT_ADMIN_SETTINGS`/`DEFAULT_STREAK_MULTIPLIERS` och kortet säger det.
  Förhandsvisningen räknar **inte** med aktiva utmaningsboostar (servern lägger på dem vid sparande — kortet säger det) och visar **inte** bakdaterings-
  kaskaden: en bakdaterad runda som fyller ett glapp räknar i verkligheten om streak och XP för alla senare rundor, förhandsvisningen visar bara rundans egen dag.
- **Streakdagen** räknas med backendens egen regel (`reprocessRunsFromDate`) ur mina rundor i `users-with-runs`: närmast föregående runda → dagen efter
  = +1, längre bort = dag 1, redan en runda samma dag = samma streakdag. Därför är "Stays alive · day 5" faktisk data, inte en gissning, och ett
  annat datum i fältet ger en annan multiplikator.
- **"What this run does":** streak (stays alive / continues / already counted / new streak), nivå (kvar-XP eller "Level up"), Frodos resa (km mot nästa
  waypoint, "Reaches …") och rankingen med samma sortering som Board (nivå, sedan XP): "Passes Karl", "Closes on Karl · N XP behind", "Holds 1st".
  Prototypens hårdkodade "Level 25/Balin's Tomb/Karl" är ersatt av användarens egna värden.
- **`is_treadmill` skickas alltid som bool** (Outdoor = false, Treadmill = true): valet är gjort i formuläret. Äldre manuella rundor har `null` — de får
  ingen underlags-chip i Group history i stället för en gissning.
- **Efter en lyckad runda** invalideras `users-with-runs` (väntas in — förhandsvisningen läser den), `['leaderboard']`, öppna event (`['events']`, exakt),
  `['titles']` och `['multiple-user-titles']` (ligger utanför titles-roten), `['challenges']`, Runner cards `['runner','head-to-head']` och gruppens historik. Event-listan hämtas dessutom om efter `EVENT_FOLLOW_UP_MS` (4 s): backend kör eventkvalificeringen
  i bakgrunden (`checkEventQualification` är fire-and-forget), så den första omhämtningen kan komma före den — "N of M done" ska inte vänta på nästa
  intervall. Bekräftelsen ("Run logged: 8.0 km for 44 XP · streak day 5 at 1.1×") visar serverns siffror.
- **Meddelanden** ligger i två permanenta live-regioner i formuläret (`role="status"` bekräftelse, `role="alert"` serverfel) — behållarna finns innan
  texten monteras, annars annonseras de inte pålitligt. Toaster är inte monterad i appen, så inga `toast()`.
- **Formulärets tillstånd bor i `useLogForm`** (inte i vyn): det man skrivit överlever ett byte till Group history och tillbaka. Att skriva efter en
  bekräftelse tar bort den.
- **Group history** läser `GET /runs/group-history?limit=10&offset=…` (`useInfiniteQuery`, `meta.has_more` styr "Show more"; nästa sida börjar vid summan
  av det som hämtats). `staleTime: 0` — en runda som ändrats/raderats i Profile ska inte stå kvar. Fel på första sidan = felkort med Retry; fel på nästa sida
  lämnar raderna kvar och visar ett felkort under dem. Min egen runda har guldkant (samma "jag"-markering som Events/Duels). Namn och avatar öppnar Runner card.
- **Väder utan emojis** (regel 10): sol- och snöikon ur ikonsetet där de finns, annars temperatur + etikett ("14 °C · Rain").
- **Strava-raden (bara mobil)** läser `shared/hooks/useStravaQueries` (`useStravaStatus`, `useStravaLastSync`) — samma hooks som skalets `useRightNow`, EN definition med
  gemensam retry, så en hämtning delas (`pages/LogShellSeam.test.tsx`). Ej kopplad / utgången → raden pekar på Settings. Ett fel döljer raden (sidoinformation, inget felkort).
- **Ingen guldknapp utöver submit** (Group history har ingen alls). "Show more" är ghost, Retry sekundär.
- **Ingen tour:** det fanns ingen `tour_log_*` att bumpa — skärmen har inga `data-tour`-ankare.
- **Löpbandets blå** = minor-nivåns blå (`--rq-tier-minor-*`) under rollnamnet `--rq-log-treadmill*` (prototypens Treadmill-chip).
- **CSS-ordning:** `log.css` ligger utanför `@layer`, så den slår de delade `.rq-*`-primitiverna (`@layer components`) utan sammansatta selektorer.
