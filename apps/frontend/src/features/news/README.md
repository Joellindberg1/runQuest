# News Feature — `/news` + klock-popovern

Pack News (ADR 008): vad gruppen gjort — titelbyten, utmaningsutfall, level ups, milstolpar, brutna streaks, events — som ett dag-grupperat flöde.
Klockan i headern (`app-shell/NotificationsPopover`) öppnar en popover med de fem senaste och en oläst-räknare ur SAMMA flöde; "See all pack news" går
till `/news`. Mobil = App Prototypens skärm (filtret som chip-rad), desktop = Web Prototypens (flöde | 300 px filterkort). `pages/NewsPage.tsx` är tunn.
Badge-komponenterna i prototyperna är medvetet INTE byggda (ägaren designar dem).

## Struktur

- **components/**
  - `NewsScreen` — all datakoppling (flöde, filter i `?type=`, "Mark all read", Show more), laddning/fel/tomt, tour
  - `NewsDayList` + `NewsRow` — dag-grupper (hårlinjegrid) och rader: ikon · typ · tid · text, 3 px kant i kategorins färg
  - `NewsFilters` — Titles · Challenges · Events · Levels · Streaks (`aria-pressed`, räknare); chip-rad på mobil, kort på desktop (bara CSS skiljer)
  - `NewsPopoverPanel` — innehållet i klock-popovern (Radix-skalet och bell-knappen bor i `app-shell/NotificationsPopover`)
- **newsModel.ts** — ren logik: kategorier/ikoner/filterkarta, adressparametern, kursor/dedupe/sammanslagning, oläst, tider, dag-gruppering, texterna
  (`describeNews`), vymodeller. `now` skickas alltid in.
- **hooks/** — `useNewsQueries` (`useNewsFeed`, `useNewsUnreadCount`, `useMarkNewsSeen`) — den ENDA query-definitionen; `useNewsContext` (vem som tittar, klockan, namn-/könsuppslag)
- `news.css` — enda stilfilen; mått (`--rq-news-*`) i temafilen, sektion 1.28 (index.css + docs/design/temafil-forslag.css)
- `news.fixture.ts` — testdata + `newsServer` (en liten fake av GET /news + POST /news/seen med serverns keyset-/oläst-semantik)

## Regler värda att komma ihåg

- **Typerna kommer ur `@runquest/shared`** (`NewsItem`/`NewsMeta`/`NewsResponse`/`NewsSeenResponse`, `ACTIVITY_TYPES`) — aldrig speglade. Ett test kräver att varje händelsetyp
  hör till exakt ett filter och en kategori, så en ny typ i shared tvingar fram ett beslut här.
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
- **Oläst** kommer ur `is_unread`/`meta.unread_count` (backend räknar bort egna handlingar, backfill och rader före min inträdestid) — klienten litar på dem. En backfill-rad
  markeras ändå aldrig som oläst. Badgen på klockan är dold vid 0 och "99+" över hundra; knappens namn bär siffran ("Pack news, 4 unread").
- **"Mark all read" är den enda kvitteringen** (prototypen har knappen i popover och skärm; inget kvitterar vid besök). `POST /news/seen { up_to_id }` med högsta id i flödet för alla typer, oavsett vilket filter
  som visas. Optimistiskt: räknaren och raderna är lästa direkt i alla flöden; serverns svar (kan vara > 0 om nya rader hann komma) skriver över, ett fel återställer, och flödena invalideras (catch-up).
- **Live regions:** bekräftelsen ("N marked as read") står i en permanent `role="status"` som får fokus (knappen försvinner när inget är oläst), fel i `role="alert"` — inga toasts.
  Tomma behållare är kvar i tillgänglighetsträdet (ingen display:none).
- **Filtret** mappas i klienten (`NEWS_FILTERS`; Levels = level_up + run_milestone) till serverns `type=`; `?type=` bär chip-nycklar (`titles,levels`). Flera kan vara valda, alla fem = inget.
  Varje filter har egen cache; räknarna är antal i det laddade ofiltrerade fönstret.
- **Dag-grupper** i Stockholm-tid: Today · Yesterday · Earlier this week · en grupp per äldre dag. Ordningen är `occurred_at` (backfill kan ha högt id men gammal dag).
- **Tour:** `tour_news_v1` (ny skärm — ingen gammal slug fanns). Ankare `news-feed`, `news-filter`, `news-mark-read`; klockan (`header-news`) har ingen egen tourstep. Turen monteras bara när flödet har rader (tomt flöde = flytande rutor över en tom skärm, och slugen markeras sedd för alltid), och `news-mark-read`-steget bara när något är oläst.
- **Rörelse:** ingenting animerar. **Färg:** kategorin sätter de delade chip-variablerna (`--rq-c`, `--rq-c-edge`, `--rq-c-solid`); oläst/läst-bakgrund och kantstyrka är tokens ur 1.9.
- Öppna antaganden: `docs/open-assumptions.md` → "Pack News (inkrement 9)".
