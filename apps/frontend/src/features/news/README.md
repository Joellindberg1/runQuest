# News Feature — `/news` + klock-popovern

Pack News (ADR 008): vad gruppen gjort — titelbyten, utmaningsutfall, level ups, milstolpar, brutna streaks, events — som ett dag-grupperat flöde.
Klockan i headern (`app-shell/NotificationsPopover`) öppnar en popover med de fem senaste rader som räknas för användaren (påslagna slag, inga egna handlingar, ADR 011) och en oläst-räknare ur SAMMA flöde; "See all pack news" går
till `/news`. Notiserna (ADR 011, v0.7.0) styr bara klockan: `/news` visar alltid allt, och reglagen bor både på Settings (kortet "Notifications") och här. Mobil = App Prototypens skärm (filtret som chip-rad), desktop = Web Prototypens (flöde | 300 px filterkort). `pages/NewsPage.tsx` är tunn.
`badge_earned` (ADR 009, spec F7) har eget filterchip Badges sedan v0.6.1; raderna behåller kategorin Levels (grön kant) och ritar ett `sm`-emblem i ikonkolumnen (RUN-128); se nedan.
`release_published` (RUN-161) är en systemrad ("New version", `RunQuest vX is out — titel`, ikon `sparkles`) i kategorin `release` med samma ink-token som events och UTAN filterchip — den syns när inget filter är valt. Raden har ingen länk (bara läs-knappen som täcker raden). Den skrivs aldrig av appen/servern, bara av `npm run announce:release` (backend).

## Struktur

- **components/**
  - `NewsScreen` — all datakoppling (flöde, filter i `?type=`, "Mark all read", Show more), laddning/fel/tomt, tour
  - `NewsDayList` + `NewsRow` — dag-grupper (hårlinjegrid) och rader: ikon · typ · tid · text, 3 px kant i kategorins färg. **badge_earned (F7, RUN-128):** raden har `row.emblem` (`{ series, tier }` ur `emblemOf` i newsModel —
    bara en känd serie med nivå 1..6) och ritar då `BadgeEmblem size="sm" decorative` (`aria-hidden`, Council 23: typraden "Badge earned"/"Badge evolved" och texten bär betydelsen) i stället för kategorins ikon; kanten förblir
    Levels-grön och raden får `data-emblem` (ikonkolumnen `--rq-news-row-icon-badge-w`, 30 px mobil / 34 desktop). Okänd serie eller tier utanför 1..6 → `emblem: null` → den vanliga `zap`-ikonen. Levels-filterchippet behåller `zap`; Badges-chippet har Levels-färg men egen ikon (`shield`, `NewsFilter.icon`).
    **Klock-popovern** (`NewsPopoverPanel`): en badge_earned-rad med `row.emblem` ritar samma emblem (`.rq-news-pop__emblem`, `aria-hidden`) i stället för pricken, med kolumnbredden `--rq-news-row-icon-badge-w`
    (`data-emblem` på raden); alla andra rader (och en okänd serie) behåller pricken oförändrad.
  - `NewsFilters` — sju chips ur `NEWS_FILTERS`: Titles · Challenges · Ranks · Events · Levels · Badges · Streaks (`aria-pressed`, räknare); chip-rad på mobil (scrollar sidledes, 44 px träffyta, ett fokuserat chip scrollas i bild), kort på desktop (bara CSS skiljer)
    **Ranks (RUN-195):** egen blå kategori (`--rq-news-rank-rgb`/`-ink`, ägarundantag från regel 10 — himmelsblå `#38bdf8`/`#7dd3fc` godkänd av ägaren 2026-10-15, se `docs/design/designsprak-forslag.md` — strikt skild från tier-minor och badge-serierna). `rank_passed`-raden visar placeringen som en bricka
    (`PlacementBadge`, `placement` ur `describeNews`): läsarens egen rang ("You're #3") eller passerarens ("Karl #2") för en utomstående; brickan är `aria-hidden` och radens namn får "You are now number 3" i stället.
  - `NewsPopoverPanel` — innehållet i klock-popovern (Radix-skalet och bell-knappen bor i `app-shell/NotificationsPopover`); `NewsPopoverRow` och `ReadGestureScope` (läs-gesternas rörelsevakt per lista)
  - `NewsSettingsColumn` (desktop: `NotificationSettingsPanel` som kort i sidokolumnen under filtret), `NewsSettingsSheet` (mobil: kugghjulsknapp i sidhuvudet som öppnar ett bottenblad) och `NewsSettingsNote` ("This page always shows everything" under panelen på båda) —
    se "Notisinställningarna på /news" nedan
- **newsModel.ts** — ren logik: kategorier/ikoner/filterkarta, adressparametern, kursor/dedupe/sammanslagning, oläst, tider, dag-gruppering, texterna
  (`describeNews`), vymodeller. `now` skickas alltid in.
- **hooks/** — `useNewsQueries` (`useNewsFeed`, `useNewsUnreadCount`, `useMarkNewsSeen`, `useMarkNewsRead`) — den ENDA query-definitionen; `useNewsContext` (vem som tittar, klockan, namn-/könsuppslag)
- `news.css` — enda stilfilen; mått (`--rq-news-*`) i temafilen, sektion 1.28 (index.css + docs/design/temafil-forslag.css)
- `news.fixture.ts` — testdata + `newsServer` (en liten fake av GET /news, POST /news/seen, POST /news/read och GET/PUT /settings; oläst avgörs av samma `isNotifiable` som servern)

## Regler värda att komma ihåg

- **Typerna kommer ur `@runquest/shared`** (`NewsItem`/`NewsMeta`/`NewsResponse`/`NewsSeenResponse`, `ACTIVITY_TYPES`) — aldrig speglade. Ett test kräver att varje händelsetyp
  hör till exakt ett filter och en kategori, så en ny typ i shared tvingar fram ett beslut här.
- **Okända händelsetyper kraschar aldrig News** (RUN-138): backend kan vara nyare än fliken, så typen är en `string` (`WireNewsItem`/`UnknownNewsItem`). `buildNewsRow` ger `null` för en okänd typ
  eller en känd typ vars payload/tid inte går att rendera, och `buildNewsGroups`/`buildPopoverRows` filtrerar bort raden (popovern före gränsen på fem). Raden ligger KVAR i `NewsFeed` så att
  "Mark all read" kvitterar upp till det verkliga högsta id:t. Okända typer klassas som `null` av `classifyNotification` och räknas aldrig av servern; bara en känd typ vars payload eller tid inte går att rendera kan ge en dold rad, så siffran kan i det fallet innehålla dolda rader tills de kvitterats.
  `describeNews`s switch har `never`-kontroll i default: en ny typ i `ACTIVITY_TYPES` utan case ger tsc-fel.
- **Raden är ett faktum, texten renderas här** ur typ + payload + vem som tittar ("took … from you"). Förnamn som prototypen; en raderad användare är "a former member".
- **EN query-definition.** `useNewsFeed(types)` används av skalet (klockan + popovern, alla typer) och av skärmen (valt filter + alla typer för räknarna).
  Nyckel `['news','feed', <type-param|all>]`, poll 2 min + fönsterfokus. Skalet hämtar 30 rader (popovern visar fem) — en enda hämtning delas.
- **Första hämtningen = nyaste sidan; omhämtning = catch-up** (ADR 008 addendum 4): `?after=<högsta kända id>` ger de nyaste raderna, en lucka större än en sida fylls med
  upprepade `?before=next_before` tills klienten når sitt kända id; sammanslagning dedupar på id. Äldre sidor ("Show more") och scrollpositionen står alltså kvar.
  Mer än fem catch-up-sidor à 100 → flödet ersätts av de nyaste (inget hål i mitten). Sammanslagningen sker i `setQueryData`-uppdateraren så att en Show more som landar samtidigt inte skrivs över.
- **Borttagna rader läker vid fokus/omladdning, inte vid poll.** Catch-up kan bara LÄGGA TILL rader, så en rad backend tar bort (en utmaning som återkallas eller avböjs
  retractas) ligger kvar i klienten tills flödet läker: när fönstret får fokus (och flödet är äldre än 15 s) ersätts den nyaste sidan helt (`replaceNewest`; rader äldre än
  sidan behålls), och en omladdning börjar om. Pollen läker inte. `refetchOnWindowFocus` är avstängt — fokus går via den egna lyssnaren, en hämtning per flöde och händelse.
- **Cachen är användarbunden:** `AuthProvider` rensar `['news','feed']` (och sett-listan) vid login, logout och 401; en avbruten hämtning skriver inte tillbaka.
  Egna handlingar invalidérar flödet direkt (`invalidateAfterRunChange` och utmaningsmutationerna), så klockan inte väntar på nästa poll.
- **Playwright-kandidat:** chip-radens `position: relative` (news.css) hindrar sr-only-spans (position:absolute) från att ge sidled scroll på mobil (scrollWidth 572 vid 390) — jsdom
  har ingen layout och ser inte detta. Ett guard-test låser regeln i CSS:en; själva scrollWidth bör provas i en renderingsrök.
- **Oläst** kommer ur `is_unread`/`meta.unread_count` — klienten litar på dem. Servern avgör med den delade `isNotifiable` (ADR 011 beslut 4): raden ligger ovanför golvet `users.news_last_seen_id`,
  finns inte i `news_read` (kvitton ovanför golvet), är inte backfill, är nyare än användarens konto, klassas som ett slag som inte är `own` och slaget är påslaget i `user_settings` (saknad nyckel = slagets default).
  `unread_count` mättas vid 500. Badgen på klockan är dold vid 0 och "99+" över hundra; knappens namn bär siffran ("Pack news, 4 unread").
- **Klockan följer inställningarna, `/news` visar allt (ADR 011 beslut 3, ägarbeslut B2):** `buildPopoverRows` filtrerar de 30 inladdade raderna med samma `classifyNotification` och `isKindEnabled` som servern (inställningarna ur `useUserSettings`,
  defaults medan de laddar eller om de inte gick att läsa), tar bort egna handlingar och okända typer INNAN gränsen på fem, så en dold rad aldrig tar en plats. Är rader inladdade men alla filtrerade visar popovern "Nothing new for you" med en rad förklaring
  (undantag från designregel 9, se designsprak-forslag.md) och bara länken till `/news`; ett helt tomt flöde har kvar "No news yet — go make some.". Popovern har inget kugghjul (ägarbeslut 6): reglagen nås från Settings och `/news`.
  På `/news` tonas bara de rader klockan räknar som olästa.
- **"Mark all read" kvitterar allt på en gång** (knappen finns i popover och på skärmen; att öppna popovern eller besöka sidan kvitterar inget — enskilda rader kvitteras av läs-gesterna nedan). `POST /news/seen { up_to_id }` med högsta id i flödet för alla typer, oavsett vilket filter
  som visas; servern höjer golvet och rensar `news_read`-rader under det. Optimistiskt: räknaren och raderna är lästa direkt i alla flöden; serverns svar (kan vara > 0 om nya rader hann komma) skriver över, ett fel återställer, och flödena invalideras (catch-up).
- **Läs-gesterna (ADR 011 addendum 2026-10-14, RUN-197):** raden (`NewsRow`, `NewsPopoverRow`) är ett `li` med EN `button` som täcker raden (inga länkar i raden, så ingen interaktiv ruta ligger i en annan; namnet är radens text inkl. "(unread)").
  Gesterna bor i `useRowReadGestures`: mus/penna som rör sig in över raden (`pointerenter`/`pointermove`, `pointerType ≠ touch`, inte under `POINTER_SETTLE_MS`) och `click` (Enter/Space, skärmläsare, touch-tap — en scroll ger pointercancel, aldrig click).
  Fokus markerar inte. Rörelsevakten är per LISTA, inte per rad: `ReadGestureScope` (dag-listan, popovern runt sin lista) räknar från monteringen, så Show more/poll-rader inte får eget fönster och varje öppning av popovern ger ett nytt.
  Klockans räknare har EN polite live-region (`NotificationsPopover`, `useUnreadAnnouncement`): bara minskningar, debouncade (`UNREAD_ANNOUNCE_MS`), och inte när minskningen är "Mark all read" (den har sin egen bekräftelse; skiljs åt via vattenmärket `last_seen_id`, som bara kvitteringen flyttar). jsdom saknar PointerEvent: tester importerar `@/test/pointerEvent`.
- **Läst per rad (ADR 011 beslut 4, datalagret):** `useMarkNewsRead().markRead(id)` är hela ytan; gesterna ovan använder `POINTER_SETTLE_MS` (150, rörelsevakten) och `READ_FLUSH_MS` (300, buntningen) ur newsModel.
  `READ_DWELL_MS` (0) är en namngiven krok för en framtida dröjsmålsregel (ADR 011 addendum) och används inte av någon gest idag: hover efter rörelse markerar direkt. Raden och räknaren är lästa i ALLA flödescacher direkt (`markReadInFeed`; räknaren minskar i varje cache, även där raden inte är
  laddad). Anropen buntas av `createReadBatcher` (högst 50 id per `POST /news/read`, dubbletter slås ihop) och töms vid avmontering. Ett fel återställer exakt de flippade raderna (`markUnreadInFeed`)
  och räknaren tyst. Serverns `unread_count` skriver över den lokala först när inget annat anrop väntar. En pågående hämtning avbryts innan uppdateringen (som "Mark all read"). Rader som inte är olästa ger inget anrop.
  `?involves=me` finns i `getNews` och i nyckeln (`NEWS_QUERY_KEYS.feed(typeParam, 'me')`); servern tar den sedan RUN-188 (se "Involves me" nedan).
- **Involves me (ADR 011 beslut 9, frame N5):** ett vyfilter vid sidan av typchipsen, inte ett av dem och helt skilt från notisslagen. Adressen `?involves=me` (`parseInvolvesParam`/`serializeInvolvesParam`: bara exakt `me` är på, allt annat av),
  kombinerat (AND) med `?type=`. `NewsScreen` anropar `useNewsFeed(types, enabled, 'me')` för det aktiva flödet (egen cache; catch-up, fokusläkning och Show more bär samma parameter); chip-räknarna, oläst-siffran och "Mark all read"
  läser fortfarande det ofiltrerade flödet (`feed(undefined)`), och klockan/popovern rörs inte. Knappen (`NewsFilters`) ligger först i filterkortet på desktop (med en beskrivningsrad) och på en egen rad ovanför den scrollande chip-raden på mobil
  (44 px, `--rq-news-involves-hit`); den bär `aria-pressed` och siffran = rader i det laddade fönstret som rör mig (`involvesMe`, samma fönster som chip-räknarna — servern skickar ingen siffra).
  **Annonsering:** en egen permanent, visuellt dold `role="status"` ("Filter result") som får text först när det nya flödet har landat ("Showing 4 rows that involve you" / "Showing all pack news", `involvesAnnouncement`);
  typchipsen annonserar ingenting idag och rör inte regionen. Tomläget "Nothing involves you yet" gäller toggeln ensam; med ett typfilter ovanpå är det vanliga "Nothing here", och båda har "Show all news" som rensar allt i ett steg.
  Ingen `data-tour`-ankare för knappen (varken N4 eller ADR 011 beslut 9 nämner ett); `news-settings` ligger orört.
- **Live regions:** bekräftelsen ("N marked as read") står i en permanent `role="status"` som får fokus (knappen försvinner när inget är oläst), fel i `role="alert"` — inga toasts.
  Tomma behållare är kvar i tillgänglighetsträdet (ingen display:none).
- **Filtret** mappas i klienten (`NEWS_FILTERS`; Levels = level_up + run_milestone, Badges = badge_earned) till serverns `type=`; `?type=` bär chip-nycklar (`titles,levels`). Flera kan vara valda, alla sju = inget.
  Varje filter har egen cache; räknarna är antal i det laddade ofiltrerade fönstret.
- **Dag-grupper** i Stockholm-tid: Today · Yesterday · Earlier this week · en grupp per äldre dag. Ordningen är `occurred_at` (backfill kan ha högt id men gammal dag).
- **Tour:** `tour_news_v2` (RUN-251; slugen är bumpad så att alla ser turen igen, `tour_news_v1` ligger kvar som oanvänd rad i `user_seen_items`). Fem steg (ägarbeslut 7): flödet och läs-gesten som ETT steg, filtret (Involves me nämns där, utan eget ankare), notisinställningarna, Mark all read och ett flytande avslut.
  Ankare `news-feed`, `news-filter`, `news-settings` (kortet i sidokolumnen på desktop, kugghjulsknappen på mobil — samma attribut), `news-mark-read`; klockan (`header-news`) har ingen egen tourstep. Copyn får inte nämna fokus som läs-gest (`featureTourSteps.test.ts`).
  Turen monteras bara när flödet har rader (tomt flöde = flytande rutor över en tom skärm, och slugen markeras sedd för alltid), och `news-mark-read`-steget bara när något är oläst.
- **Notisinställningarna på /news (ADR 011 beslut 9, frame N1, RUN-249):** `NotificationSettingsPanel` ägs av `features/settings` och importeras hit (cross-feature-riktning enligt ADR 011); här monteras den på EXAKT ett ställe åt gången — kolumnen på desktop, bladet på mobil — så att det aldrig finns två live-regioner av samma slag.
  Sektionerna börjar hopfällda och totalsumman utelämnas på de smala ytorna (`defaultExpanded={false}`, `showTotal={false}`); Settings fäller upp alla. Ankaret `news-settings` sitter på kolumnens omslag respektive kugghjulsknappen. I bladet bär `Dialog.Title` rubriken "Notifications" och är dit fokus går efter Retry.
  Panelen skriver via `useUserSettings` (samma query `['settings','user']` som Settings); efter en lyckad skrivning invalideras nyhetsflödet så att räknaren följer reglagen direkt.
- **Rörelse:** ingenting animerar. **Färg:** kategorin sätter de delade chip-variablerna (`--rq-c`, `--rq-c-edge`, `--rq-c-solid`); oläst/läst-bakgrund och kantstyrka är tokens ur 1.9.
- Öppna antaganden: `docs/open-assumptions.md` → "Pack News (inkrement 9)".
