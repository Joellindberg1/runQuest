# Titles Feature — `/titles`

Räknarrad ("N in play · you hold M") · filter All/Mine/Unclaimed · kategorigrupper som dragspel · titelkort ·
"On display" (välj upp till tre titlar för leaderboard-kortet) · "Closest chase" (bara desktop).
Mobil = App Prototypens titles-skärm, desktop = Web Prototypens (grupper | sidokolumn). `pages/TitlesPage.tsx` är tunn.
Titlarna är per grupp sedan v0.8.0 (se "Titlar per grupp" nedan).

## Struktur

- **components/**
  - `TitlesScreen` — all datakoppling, filter (`?filter=`), grupper, tour
  - `TitleGroupSection` — dragspelsrubrik (ikon, namn, antal) + titelkorten
  - `TitleCard` — namn · regel · innehavare + värde · runner-ups #2/#3 · "Nobody yet" + "Best so far" · valknapp på mina titlar
  - `DisplayPanel` — "ON DISPLAY": valet, förhandsvisning, Save
  - `ChasePanel` — "CLOSEST CHASE" (desktop)
- **titlesModel.ts** — rena, testade vymodeller: rader, grupper, filter, räknarrad, visningsvalet, jakter
- **titleCategories.ts** — frontend-mappningen `metric_key → kategori + ikon` (se nedan)
- **titleFormat.ts** — värden som text per mått, könsböjda namn, "kan en differens läsas?" (delas med Runner card och Profile)
- **hooks/** — `useTitlesQueries` (`useTitleBoard`, `useGroupEligibility`, `useSaveDisplayedTitles`), `useDisplaySelection`
- `titles.css` — enda stilfilen; mått (`--rq-titles-*`) i temafilen, sektion 1.22

## Titlar per grupp (ADR 012, v0.8.0)

En titel tillhör en (användare, grupp). Frontend ritar bara det backend ger; reglerna ligger i backend och `packages/shared`.

- **Egen topp 10 per grupp.** `title_leaderboard` och `user_titles` har `group_id` (migration 055), och `/titles/leaderboard` ger anroparens grupp:
  innehavare (#1) och runner-ups (#2/#3) kommer bara ur den gruppen. Samma titel kan alltså ha olika innehavare i två grupper. Titlar utan innehavare
  i gruppen finns kvar i listan (`holder: null`) och visas som "Nobody yet".
- **Medlemskapets fönster.** Ett medlemskap (`group_members`) har `starts_on`. `null` betyder hela historiken (användarens första grupp, så
  dagens spelare räknas som förut). Ett senare medlemskap räknar bara rundor från och med joindagen, så man börjar från noll i den nya gruppen.
  `titleWindow` och `runsInWindow` i `packages/shared` är den enda källan; omräkningen och `/titles/group-eligibility` ("Best so far") använder samma fönster,
  så siffrorna på korten stämmer med de lagrade innehavarna. Fönstret gäller bara titlarna: XP, nivå, streak och Board är fortfarande per användare.
- **Tomläge utan grupp.** Man kan inte spela utan grupp, så en användare utan aktivt medlemskap har inga titlar. Rutterna tar gruppen ur
  token (`group_id` i JWT): `/titles/leaderboard`, `/titles/user/:id` och `/titles/group-eligibility` svarar med en tom lista när token saknar grupp,
  och Titles-skärmen visar då tomläget "No titles yet". Det är inget fel. Token uppdateras först vid ny inloggning, så någon som gått med i en
  grupp efter inloggningen ser tomläget tills hen loggar in igen.
- **404 för löpare utanför gruppen.** `/titles/user/:userId` ger 404 när löparen inte är aktiv medlem i anroparens grupp, med samma svar som för en
  användare som inte finns. `getUserTitles` läser 404 som en tom lista, så Runner card visar sitt tomläge utan felkort och utan omförsök.
- **Typer ur shared.** Svaren typas av `TitleLeaderboardEntry`, `UserTitleEntry` och `GroupEligibilityEntry` i `packages/shared/src/contracts/titles.ts`;
  inga handskrivna kopior i klienten.
- **Titelnyheter per grupp.** Pack News får `title_unlocked`, `title_taken` och `title_revoked` från en före/efter-bild av gruppens position 1–2
  (`snapshotTitleHolders(groupId)`, `emitTitleNews(groupId, …)` i backend). En ändring i grupp A ger aldrig en nyhet i grupp B. Admin-omräkning
  (`/titles/reprocess-all`) skriver inga nyheter.
- **Låg tvåa (RUN-256).** När någon tar en titel och en annan låg på plats 2 i samma grupp precis före bytet, bär `title_taken` den personen som
  `runner_up_user_id` (inte när den nya innehavaren själv var tvåa, och inte vid `reason: 'revoked'`). Det ger notisslaget
  `title_taken_runner_up` ("Someone sneaks past you and takes a title you were chasing as runner-up", på som standard) och gör att raden räknas
  in i "Involves me" i Pack News. I flödet står " — you were runner-up" efter den vanliga texten, bara för den som var tvåa och varken tog titeln eller förlorade den.

## Regler värda att komma ihåg

- **Titlar, regler och värden kommer ur databasen** (`/titles/leaderboard`, `/titles/group-eligibility`, båda för anroparens grupp; ägarbeslut 3).
  Inga titelnamn i koden — guards.test vaktar det. Regeln på kortet är `titles.description` ordagrant.
- **Kategorin är en frontend-mappning på `metric_key`** (backend har ingen kategori). En titel vars nyckel saknas i
  mappningen hamnar i **Other** — den försvinner aldrig. `titleCategories.test.ts` kräver att alla 23 motorer är mappade; ingen motor får ligga i Other. Weather (`sun`, före Other) rymmer stormRunCount, coldRunCount och winterKm
  och läser backendens `titleEngines/` från disk: lägger du till en motor fäller testet tills du lagt en rad i
  `titleMetricKeys.fixture.ts` OCH `titleCategories.ts`.
- **Enheten** på ett värde kommer ur `metric_key` (`titleFormat`); ett mått utan känd enhet visar bara talet, aldrig en gissad enhet.
- **Olåsta titlar** (`holder: null`) visar "Nobody yet" och "Best so far · namn värde" ur group-eligibility (högst värde > 0,
  även under tröskeln). Laddar eligibility inte ritas korten ändå, utan bästa försöket — det är en bonus, inget felkort.
- **Titellistan** har en query som kastar vid fel (`useTitleBoard`), så att "No titles yet" aldrig blir en lögn vid nätverksfel.
  Den delas av Titles, Playbook, admin, profilens My titles och löparens titelpanel (en cache-nyckel under `titleQueryKeys.all`);
  de två senare visar felkort med Retry när den felar, i stället för värden utan enhet.
- **Gruppernas öppet/stängt**: första gruppen öppen i All-vyn (designen), alla öppna när ett filter är aktivt.
- **Visningsvalet** (max 3, `PUT /auth/me/displayed-titles`) finns kvar från gamla "My Titles"-fliken: valknapp på mina titlar,
  borttag med ✕ i panelen, Save (sekundärknapp — visningsval är inte sidans primära handling) sparar och hämtar om användarna så Board följer med. Förlorade titlar städas ur valet.
- **Closest chase** = mina #2/#3, titlar jag håller med någon precis bakom, och olåsta titlar jag närmar mig; närhet = avstånd
  relativt värdet. Mått där en differens inte går att läsa (tider, pace-spridning, datum) hoppas över.
- Tour `tour_titles_v2` (ankare `titles-filter`, `titles-display`) startar först när titlarna är ritade.
