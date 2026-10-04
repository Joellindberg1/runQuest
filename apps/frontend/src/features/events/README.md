# Events Feature — `/events`

Rubrik + räknarrad ("1 open now · 4 of 12 taken") · öppna event (participation med ring, competition med tabell) · "Up next" ·
"This week" · "Your record" · historik med pager (`?page=`).
Mobil = App Prototypens events-skärm (allt i en kolumn, ring till vänster), desktop = Web Prototypens (innehåll | 340 px kolumn med
rekord + historik, ring till höger, fakta-taggar). `pages/EventsPage.tsx` är tunn. Inga flikar — skärmen har ingen `?view=`.

## Struktur

- **components/**
  - `EventsScreen` — all datakoppling, `?page=`-tillstånd, laddning/fel/tomt, tour
  - `OpenEventCard` — ett pågående event: eyebrow, namn, regel, chips, `CountdownRing`, "N of M done", (competition) `CompetitionBoard`
  - `UpNextCard` — det första schemalagda eventet med nedräkning till öppning
  - `WeekList` — resten av det schemalagda (mobil rader, desktop tre kort)
  - `RecordPanel` — "Your record" (all-time)
  - `HistoryPanel` — sex rader per sida + pagern
  - `EventChips`, `CountdownRing`, `CompetitionBoard` — delar
- **eventsModel.ts** — rena vymodeller: öppet/up next/veckan, facit, historikrader, pager, räknarrad
- **eventsFormat.ts** — tider i Stockholm (`stockholmClock`), nedräkningar, mått; egna månads-/veckodagsnamn (en-GB, aldrig "Sept")
- **hooks/** — `useEventsQueries`: `useOpenEvents`, `useEventHistoryPage`, `useEventRecordSource`
- `events.css` — enda stilfilen; mått (`--rq-events-*`) i temafilen, sektion 1.24 (index.css + docs/design/temafil-forslag.css)
- `events.fixture.ts` — testdata (fasta klockslag, Stockholm = CEST)

## Regler värda att komma ihåg

- **Spelets verkliga regler slår prototypens text.** *Participation*: XP betalas direkt när en runda klarar minimidistansen inom
  fönstret (`checkEventQualification`), inget ranking. *Competition*: alla som loggat en runda under veckan är med, tabellen är live,
  och söndag natt avräknas topp tre (1st/2nd/3rd ur mallen). Events dras slumpmässigt kvällen före — det finns inget framtida schema.
- **"This week" = bara det som faktiskt är schemalagt.** `/events` ger aktiva + schemalagda event; det första som öppnar blir "Up next",
  resten hamnar under "This week". Utan schemalagda event finns ingen sektion; utan något alls visas ett streckat tomt läge.
- **Öppet nu avgörs av klockan, inte av `status`.** Backend flyttar `scheduled → active` var 5:e minut men behandlar ett startat event som
  aktivt (`eventPhase`). Ett participation-event som passerat sitt slut visas inte (avräknas inom fem minuter → historiken); en tävling
  efter slutdatum visas som "Settling" tills söndagens avräkning har körts.
- **Ringen** = andel av fönstret som återstår (`ringFraction`), siffran är nedräkningen (`6h 14m`, `2d 5h`; useNow tickar var 30:e s).
- **Backend skickar "Du" som namn för mig** i tävlingstabellen — modellen visar "You".
- **"Your record" är all-time** (ägarbeslut 2: begreppet *season* finns inte i datamodellen). Endpointen har inget aggregat, så
  `useEventRecordSource` läser hela historiken i sidor om 50 (endpointens max, högst tio sidor) och `buildRecord` räknar: klarade/avslutade
  participation-event, XP från events (participation + tävlingspriser) och XP för de event jag missade ("left on the table"). Räknaren i
  rubriken använder samma siffror. Ett fel här utelämnar bara panelen och räknaren — resten av skärmen påverkas inte.
  Event som avslutades innan jag gick med räknas som missade (datan säger inte när någon gick med).
- **Historiken** är server-sidad: `?page=N` → `GET /events/history?limit=6&offset=(N-1)*6`, `meta.total` ger antalet sidor. Föregående sida
  står kvar (dämpad) medan nästa hämtas; en sida bortom slutet landar på sista sidan; ett ogiltigt värde är sida 1; en enda sida har ingen pager.
  Raden visar "N of M finished/entered" ur `participantCount`/`memberCount` (aldrig fler än gruppen).
- **Gamla funktioner som INTE finns i prototypen och därför är borta:** uppfällbara historikrader med full ranking/deltagarlista. Resultatet
  per event (klarat/missat, min placering, XP) finns kvar. Aktiva participation-event har ingen deltagarlista i `/events` (bara antalet), så
  Web Prototypens namnrad ("Karl ✓ 8.4 km …") ersätts på desktop av en stapel "4 of 6 done".
- **Ingen guldknapp:** skärmen har ingen primär handling (att logga en runda ligger i skalets +New). Retry är sekundär.
- **Delad cache, en definition:** skalets "Right now" (`useRightNow`) använder samma hook (`useOpenEvents`) som skärmen — nyckeln `['events']`, formen `{ events }` och hämtintervallet kan inte glida isär. `getEventList()` är den enda events-metoden i `backendApi`. Skalet och skärmen avgör öppet/avslutat med klockan (`eventPhase`), så kalenderpricken, pillerna och skärmen säger samma sak under cron-släppet; `src/pages/EventsShellSeam.test.tsx` låser skarven (delad QueryClient, en handler).
- **Historik/facit följer avräkningen:** tappar öppet-listan ett event mellan två hämtningar (participation-cron, söndagens avräkning) invalideras `['events','history']` — inga egna intervall. Historiken ligger under `['events','history',…]`.
- **Facit-loopen** loggar (`console.warn`) när den kapas vid tio sidor (500 event).
- **En tom historiksida medan gruppen har avslutade event** är aldrig ett tomt läge (det är `?page=` bortom slutet som rättas) — skelett visas.
- **CSS-ordning:** feature-CSS hamnar före `index.css` i kaskaden — override av delade primitiver (`.rq-card`, `.rq-ring`, `.rq-row`,
  `.rq-track > .rq-fill`) görs med sammansatta selektorer.
- Tour `tour_events_v2` (ankare `events-open`, `events-history`) startar först när eventen är ritade.
