# Challenges Feature — `/duels` (1v1-utmaningar)

Rubrik "Challenges" + räknarrad · flikar Standings / Live / Rules / History (`?view=`, default Live) · "Waiting on you" /
"Sent" · live-kort · tokens · boost · rekord · send-sheet (`?send=1&opponent=<id>`, ADR 006 beslut 4).
Mobil = App Prototypens challenges-skärm (vy, sedan tokens under), desktop = Web Prototypens (vy | sidokolumn på 320 px).
`pages/DuelsPage.tsx` är tunn; `pages/ChallengesPreviewPage.tsx` (`/preview/challenges`, utan inloggning) matar samma layout med exempeldata.

## Struktur

- **components/**
  - `DuelsScreen` — all datakoppling, handlingar, send-sheetens URL-tillstånd, tour. Ritar `DuelsLayout`.
  - `DuelsLayout` — ren presentation av färdiga vymodeller (rubrik, flikar, aktiv vy, sidokolumn). Preview-sidan återanvänder den.
  - `OfferCards` (`IncomingOffer` "Waiting on you", `SentOffer`), `LiveSection` (live-kort), `StandingsTable`, `HistoryList`, `RulesView`,
    `SidePanels` (`TokensPanel`, `BoostPanel`, `RecordPanel`), `SendSheet`, `StakeBlocks`, `TierRibbon` (nivåns sköld — enda `<svg>` i featuren)
- **duelsFormat.ts** — tier/mått/insatser/tider som text (en-GB, Stockholm-kalenderdagar, `now` skickas in)
- **duelsModel.ts** — live-kort, inkommande/skickad, token-grupper, standings, historikrader, boosts, rekord, rubrikrad
- **sendModel.ts** — varför man inte kan skicka (`sendBlocker`), motståndarval, head-to-head-tips, `?opponent=`-validering
- **rulesModel.ts** — insatser per nivå (verkliga data först, seed som reserv) och "How it works"
- **hooks/** — `useDuelsQueries` (`useMyChallenges`, `useGroupStats`, `useLiveProgress`, `useGroupHistory`, `useOpponentRecords`),
  `useChallengeActions` (send/accept/decline/withdraw som mutationer som kastar vid fel)
- `duels.css` — enda stilfilen; mått (`--rq-duels-*`) i temafilen, sektion 1.23. `duels.fixture.ts` — testdata.
- `ActiveChallengeWidget` + `TierBadge` (gamla designen, visas av LeaderboardPreviewPage) bor numera i `pages/preview/` — featuren är ren.

## Regler värda att komma ihåg

- **Spelreglerna är oförändrade (ägarbeslut 1).** Ett token fixerar nivå, mått (km/runs/total_xp) OCH längd; avsändaren väljer bara token och motståndare.
  Därför har send-sheeten steg "1 · Spend a token" och "2 · Pick an opponent", inte designens fria val av mått/längd, och "The bet" visar mått och längd som fakta.
  Insatserna kommer ur data (token/utmaning/historikrad), aldrig ur konstanter; `DEFAULT_STAKES` (migration 006) används bara för en nivå utan något exempel.
  Legendary har straff i databasen (−0.25×/14 d) — designens "no penalty" gäller inte; delta 0 läses "No penalty".
- **Backend avvisar `/send` om jag har en aktiv ELLER väntande utmaning (som utmanare eller motståndare).** `sendBlocker` speglar det: live-duell, skickad,
  inkommande, inga tokens. En motståndare som är upptagen som *mottagare* av en väntande utmaning syns inte i group-stats — då svarar servern 400
  och sheeten visar meddelandet inline.
- **EN guldknapp per vy:** "Send" är guld bara när det går att skicka (och då finns ingen inkommande); annars är första inkommande "Accept" guld
  (övriga sekundära) och Send sekundär. Saknas båda är vyn utan guldknapp.
- **Legendary** kan varken avböjas (Decline saknas) eller dras tillbaka, och startar av sig själv fyra dagar efter att den skickats; minor/major
  förfaller efter tre dagar utan svar och tokenet återgår (challengeScheduler).
- **Toaster är inte monterad i appen** — därför bekräftas handlingar med ett statusmeddelande på sidan (`role="status"`/`"alert"`), inte `toast()`.
  guards.test förbjuder `sonner` i featuren.
- **Boost-panelen på mobil är en avvikelse från mobilprototypen** (som bara har tokens under vyn). Lead har beslutat att den får vara kvar; väntande ägarbeslut om den ska bort/ritas om i designen.
- **Live-regioner:** meddelandet efter en handling (`role="status"`) och sheetens felrad (`role="alert"`) är permanenta, tomma behållare som texten monteras i — dynamiskt monterade live-regioner annonseras inte pålitligt.
- **Delad cache:** `['challenges','my']` är samma query som skalets "Right now" (samma form); handlingar invaliderar `['challenges']`,
  users-with-runs (tokens/W-D-L på Board) och Runner cards head-to-head. Send-sheetens head-to-head-tips delar Runner cards query FULLT ut (nyckel, sidstorlek och dataform = hela
  `HeadToHeadResponse`; `record` härleds i `combine`) — en annan form under samma nyckel kraschar Runner card (integrationstestet låser skarven).
- **Känd begränsning:** en motståndare med en INKOMMANDE väntande utmaning ser ledig ut i sheeten (`group-stats.has_pending_challenge` sätts bara för
  utmanaren). Backend avvisar `/send` med 400 och sheeten visar meddelandet inline. Åtgärd = backend-kontraktsfråga (nytt fält i group-stats); ingen ändring nu.
- **Framdrift** hämtas per live-duell (`/challenges/:id/progress`, ingen batch-endpoint finns); ett fel lämnar bara det kortet utan värden ("—").
  Progress-anropet avgör dessutom en duell som passerat `determine_at` (backend), så kortet kan försvinna vid nästa hämtning.
- **Match history** är offset-sidor (20 per sida, "Show more"); filtret "My matches" gäller de sidor som hunnit laddas. Hämtas först när fliken visas.
- **Boosts:** `user_boosts.remaining` är TOTALA laddningar för per-runda-boosts och förbrukas av mina rundor efter skapandet (som `boostCalculation`);
  dagsboosts går på `expires_at`. Bakgrunden ("Won against Adam …") hittas i min egen historik (`/challenges/my` ger 20 senaste) och utelämnas annars.
- **CSS-ordning:** feature-CSS hamnar före `index.css` i kaskaden (main.tsx importerar index.css sist). En override av en delad `.rq-*`-primitiv på
  samma specificitet förlorar därför — använd sammansatta selektorer (`.rq-card.rq-duels-standings`, `.rq-hairgrid > .rq-duels-…`).
- Skölden (`TierRibbon`) har samma form/recept som Boards challenge-sköld men egen stil; den återanvänder `--rq-board-ribbon-*`-måtten.
- Tour `tour_duels_v2` (ankare `duels-tokens`, `duels-send`, `duels-tabs`) startar först när sidan är ritad.
