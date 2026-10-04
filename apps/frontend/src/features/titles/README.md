# Titles Feature — `/titles`

Räknarrad ("N in play · you hold M") · filter All/Mine/Unclaimed · kategorigrupper som dragspel · titelkort ·
"On display" (välj upp till tre titlar för leaderboard-kortet) · "Closest chase" (bara desktop).
Mobil = App Prototypens titles-skärm, desktop = Web Prototypens (grupper | sidokolumn). `pages/TitlesPage.tsx` är tunn.

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

## Regler värda att komma ihåg

- **Titlar, regler och värden kommer ur databasen** (`/titles/leaderboard`, `/titles/group-eligibility`; ägarbeslut 3).
  Inga titelnamn i koden — guards.test vaktar det. Regeln på kortet är `titles.description` ordagrant.
- **Kategorin är en frontend-mappning på `metric_key`** (backend har ingen kategori). En titel vars nyckel saknas i
  mappningen hamnar i **Other** — den försvinner aldrig. `titleCategories.test.ts` kräver att alla 21 motorer är mappade
  och läser backendens `titleEngines/` från disk: lägger du till en motor fäller testet tills du lagt en rad i
  `titleMetricKeys.fixture.ts` OCH `titleCategories.ts`.
- **Enheten** på ett värde kommer ur `metric_key` (`titleFormat`); ett mått utan känd enhet visar bara talet, aldrig en gissad enhet.
- **Olåsta titlar** (`holder: null`) visar "Nobody yet" och "Best so far · namn värde" ur group-eligibility (högst värde > 0,
  även under tröskeln). Laddar eligibility inte ritas korten ändå, utan bästa försöket — det är en bonus, inget felkort.
- **Titellistan** har en egen query som kastar vid fel (`useTitleBoard`): `useTitleLeaderboard` sväljer fel och skulle ge
  "No titles yet" som lögn vid nätverksfel.
- **Gruppernas öppet/stängt**: första gruppen öppen i All-vyn (designen), alla öppna när ett filter är aktivt.
- **Visningsvalet** (max 3, `PUT /auth/me/displayed-titles`) finns kvar från gamla "My Titles"-fliken: valknapp på mina titlar,
  borttag med ✕ i panelen, Save sparar och hämtar om användarna så Board följer med. Förlorade titlar städas ur valet.
- **Closest chase** = mina #2/#3, titlar jag håller med någon precis bakom, och olåsta titlar jag närmar mig; närhet = avstånd
  relativt värdet. Mått där en differens inte går att läsa (tider, pace-spridning, datum) hoppas över.
- Tour `tour_titles_v2` (ankare `titles-filter`, `titles-display`) startar först när titlarna är ritade.
