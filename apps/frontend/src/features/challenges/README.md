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
    `SidePanels` (`TokensPanel`, `BoostPanel`, `RecordPanel`), `SendSheet`, `TokenChoice` (send-flödets steg 2: tokenkorten som en radiogrupp med roving tabindex, bock och "Selected"), `OpponentChoice` (steg 3: motståndarna som en radiogrupp; en motståndare i en duell eller med väntande utmaning är `aria-disabled` med orsaken synlig, och pilarna hoppar över dem), `StakeBlocks`, `TierRibbon` (nivåns vimpel — enda `<svg>` i featuren; sitter på tokenkorten och Board), `TierChip` (nivåchipet "MINOR ×3": filterval med nivåns accent, delas av Your tokens och send-flödets steg 1), `TokenCard` (ett tokenkort: vimpel utan siffra, mått och längd i versaler på första raden, tokenets egen insats på andra; handlingen sätts in som barn, i Your tokens är det Send)
- **duelsFormat.ts** — tier/mått/insatser/tider som text (en-GB, Stockholm-kalenderdagar, `now` skickas in)
- **duelsModel.ts** — live-kort, inkommande/skickad, token-grupper (alltid tre nivåer med `count`/`empty`/`selectable`, ett kort per token — identiska tokens slås inte ihop), standings, historikrader, boosts, rekord, rubrikrad
- **sendModel.ts** — varför man inte kan skicka (`sendBlocker`), motståndarval, head-to-head-tips, `?opponent=`-validering, förval av nivå och kort (`SendPreselection`, `startingChoice`), "The bet" (`betSummary`, `startRuleText`: "Starts" byggs ur samma `LEGENDARY_AUTO_START_DAYS` som schemaläggaren) och head-to-head-tipsets text (`h2hHint`)
- **rulesModel.ts** — insatser per nivå (verkliga data först, seed som reserv) och "How it works"
- **hooks/** — `useDuelsQueries` (`useMyChallenges`, `useGroupStats`, `useLiveProgress`, `useGroupHistory`, `useOpponentRecords`),
  `useChallengeActions` (send/accept/decline/withdraw som mutationer som kastar vid fel)
- `duels.css` — enda stilfilen; mått (`--rq-duels-*`) i temafilen, sektion 1.23. `duels.fixture.ts` — testdata.
- `ActiveChallengeWidget` + `TierBadge` (gamla designen, visas av LeaderboardPreviewPage) bor numera i `pages/preview/` — featuren är ren.

## Regler värda att komma ihåg

- **Spelreglerna är oförändrade (ägarbeslut 1).** Ett token fixerar nivå, mått (km/runs/total_xp) OCH längd; avsändaren väljer bara nivå, token och motståndare.
  Därför har send-sheeten steg "1 · Pick a tier" (nivåchips), "2 · Pick a challenge" (ett kort per token) och "3 · Pick an opponent", inte designens fria val av mått/längd, och "The bet" visar mått och längd som fakta.
  Insatserna kommer ur data (token/utmaning/historikrad), aldrig ur konstanter; `DEFAULT_STAKES` (migration 006) används bara för en nivå utan något exempel.
  Legendary har straff i databasen (−0.25×/14 d) — designens "no penalty" gäller inte; delta 0 läses "No penalty".
- **Förval i send-flödet** är komponenttillstånd i `DuelsScreen` (`SendPreselection | null`), aldrig adress: Send på ett tokenkort → nivå och kort, en nivåchip → bara nivån,
  Challenge från popupen → bara motståndaren (`?opponent=`). Ett ensamt kort på nivån är förvalt. Sheeten monteras per öppning och `closeSend` nollställer förvalet,
  så förra valet följer aldrig med.
- **"The bet" och fokus.** "The bet" är en permanent `aria-live="polite"`-region med `aria-atomic`: bara texten ändras, så en ändring läses upp en gång och ett oförändrat val ingen gång.
  "Starts" kommer ur `startRuleText` (midnatten efter accepten; legendary också efter `LEGENDARY_AUTO_START_DAYS` dagar utan svar, samma konstant som `challengeScheduler`), aldrig
  prototypens "when accepted". Cancel syns på mobil och desktop. Efter en skickad utmaning är kortet som öppnade arket borta eller avstängt: fokus går till bekräftelsen
  (`.rq-duels-notice`, `tabIndex -1`); annars till öppnaren, rubrikens Send eller sidans rubrik. Vinst- och förlusttext på en tonad yta använder `--rq-up-text`/`--rq-down-text`.
  Bekräftelsen efter en skickad utmaning ("Challenge sent to …") bygger sin startregel på `startRuleSentence`, samma `unansweredClause` som "Starts", så de två säger aldrig olika.
- **Arkets skal.** `SendSheet` är en Radix-dialog med `aria-modal="true"` (Radix sätter det inte själv). Huvudet och knappraden ligger utanför det scrollande mellanstycket, så
  stegrubrikerna kan aldrig hamna under knappraden (därför ingen `scroll-padding`); på mobil står Send och Cancel på en rad ovanför hemindikatorn (`--rq-tabbar-pb`, som läser
  `env(safe-area-inset-bottom)`). Medan ett skick pågår går arket inte att stänga: Cancel och ✕ är avstängda, Escape och tryck på skrimmen ignoreras (`onOpenChange`), och fokus
  flyttas till arket så att det inte hamnar på `<body>` när Send stängs av. Tomt läge och blockerat läge (`sendBlocker`) visar orsaken och en Close som följer samma `returnFocus` som Cancel.
  Webbläsarens Back är inte låst: den avmonterar arket under skicket. `SendSheet` ser det på sin fas (`sendPhase`: `pending` när arket stängs utan svar) och fokuserar löparens rad om popupen öppnade flödet
  (`originRunnerId`, samma `focusRunnerRowWhenRendered` som skalet), annars gäller `returnFocus` som vanligt. Svaret avgörs sedan i `DuelsScreen.sendChallenge` en gång: arket som skickade hålls i `openSheet`
  (en identitet per öppning), och bara om det fortfarande är öppet stänger skärmen det (`closeSend`) eller lämnar felet till arket. Är det stängt visar `/duels` utfallet som bekräftelse eller felnotis; är skärmen
  borta syns inget mer än att mutationens omhämtning (`useChallengeActions`) visar en skapad utmaning vid nästa besök, och användaren flyttas aldrig.
  Arket har ingen glid-in-rörelse (varken på mobil eller desktop): `prefers-reduced-motion` har alltså inget att stänga av, och e2e-provet vaktar att arket står still. Raderna i steg 3 heter
  personen (avataren är `aria-hidden`).
- **Backend avvisar `/send` om jag har en aktiv ELLER väntande utmaning (som utmanare eller motståndare).** `sendBlocker` speglar det: live-duell, skickad,
  inkommande, inga tokens. En motståndare som är upptagen som *mottagare* av en väntande utmaning syns inte i group-stats — då svarar servern 400
  och sheeten visar meddelandet inline.
- **EN guldknapp per vy:** "Send" är guld bara när det går att skicka (och då finns ingen inkommande); annars är första inkommande "Accept" guld
  (övriga sekundära) och Send sekundär. Saknas båda är vyn utan guldknapp.
- **Legendary** kan varken avböjas (Decline saknas) eller dras tillbaka, och startar av sig själv fyra dagar efter att den skickats; minor/major
  förfaller efter tre dagar utan svar och tokenet återgår (challengeScheduler). Autostarten följer samma start- och längdregel som en accept
  (nedan), är villkorad på `status = pending` (idempotent, schemat körs var sjätte timme) och skriver ingen `challenge_accepted` (ADR 011 beslut 7).
- **När en duell startar (ägarregel 2026-10-19).** Vid gruppens nästa midnatt (00:00) efter accepten, aldrig i samma ögonblick, annars går det att utnyttja:
  rundor från acceptansdagen räknas aldrig. Regeln är `groupNextMidnight` i `packages/shared/src/calendar.ts` (Stockholm tills tidszon per grupp finns, RUN-21,
  då byter bara zonen där). Backend (accept och legendary-autostart) och frontend (Right nows duellfönster räknas med `stockholmWallClockToInstant`, inte
  webbläsarens `new Date(`${dag}T00:00:00`)`) går via shared; datumvakten i `calendarSingleSource.test.ts` fäller lokala klockslagsmallar.
- **Exakt N dagar (ägarregel 2026-10-19).** En duell på N dagar räknar exakt N kalenderdagar, från startdagens 00:00 till och med dag N:
  `end_date = start_date + N − 1`, avgörande 03:00 Stockholm dagen efter slutdagen (`challengeWindow` i `packages/shared`). En 5-dagarsduell som startar
  måndag slutar fredag 24:00. `end_date` är alltså sista dagen som räknas (inklusive); all visning (`timeLeft`, Right now) läser det värdet och räknar
  aldrig själv ut slutet ur längden. Gäller bara nya dueller: pågående dueller behåller sitt lagrade `end_date` (ingen migration, ingen omräkning), så
  en äldre duell kan ha en dag mer än sin längd.
- **Bekräftelser är statusmeddelanden på sidan** (`role="status"`/`"alert"`), inte `toast()`: samma mönster som Log och Profile, och texten finns kvar och läses upp pålitligt. (Toastern är monterad i `AppProviders`; äldre features använder den fortfarande.)
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
  dagsboosts går på `expires_at`. Båda läser boostens SPARADE fönster (`start_date`/`end_date`, migration 059) med `boostWindow`/`boostRemaining` i shared, samma fönster som
  XP-omräkningen: en ny boost på n dagar gäller exakt n kalenderdagar och visar "n days" på sin startdag och före den; en gammal boost har sitt gamla fönster.
  Kvar-räkningen tar dagens datum i gruppens tidszon (klienten får ingen zon i payloaden än, så standardzonen; RUN-21). Bakgrunden ("Won against Adam …") hittas i min egen historik (`/challenges/my` ger 20 senaste) och utelämnas annars.
- **CSS-ordning:** feature-CSS hamnar före `index.css` i kaskaden (main.tsx importerar index.css sist). En override av en delad `.rq-*`-primitiv på
  samma specificitet förlorar därför — använd sammansatta selektorer (`.rq-card.rq-duels-standings`, `.rq-hairgrid > .rq-duels-…`).
- Vimpeln (`TierRibbon`, svalstjärt, RUN-147) ritas ur samma geometri som Boards challenge-vimpel (`shared/components/challengeMark`: path, text-x/y, viewBox) men har egen stil; den återanvänder `--rq-board-ribbon-*`-måtten. Ingen kod i `apps/frontend/src` får innehålla den gamla sköldens path (vakt i `shared/components/challengeMark.test.ts`).
- Tour `tour_duels_v2` (ankare `duels-tokens`, `duels-send`, `duels-tabs`) startar först när sidan är ritad.
- Tokenkortet (`TokenCard`) är två textrader (`.rq-duels-token__what`, `.rq-duels-token__stake`) och bär ingen knapp själv. Send i Your tokens (`.rq-duels-send`) är en sekundär knapp i nivåns accent, aldrig fylld: kant = `--rq-tier-send-edge`, text = `--rq-tier-<nivå>-send` (temafilen, sektion 1.6; ljust läge har en mörkare Major för att hålla 4.5:1 mot kortet), träffyta `--rq-control-hit` i båda riktningarna (44 × 44 px på mobil). Det tillgängliga namnet bär nivån: "Send a minor challenge: Most km, 7 days"; två identiska tokens ger två knappar med samma namn, och var och en skickar sitt eget id. Måtten (två rader på 320–1440 px, kontrast, träffyta, hover, fokus) bevisas i `apps/e2e/tests/token-card-send.spec.ts`.
- Nivåchipset (`TierChip`) är ett filterval (`aria-pressed`) i en `.rq-segmented`-rad och ärver därför träffytan (44 px på mobil) och den inåtriktade fokusringen ur `shared/components/view-controls.css`; det är en egen komponent i stället för ett `SegmentedControl`-alternativ eftersom det bär nivåns färg och kan vara tomt: en tom nivå är `aria-disabled` (aldrig `disabled`: den ska gå att fokusera och förklara sig, "No Major tokens right now" i en `role="status"`) och räknas aldrig som vald. Chipet bär ingen insats; insatsen står på korten. Valt chip tar nivåns tint/kant/text (`--rq-tier-*`).
