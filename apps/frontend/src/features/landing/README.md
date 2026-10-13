# Landing — `/` för utloggade

Den publika startsidan: hjälte med arena-banan, aggregat, anonymiserat previewkort och "How it works". `pages/Index.tsx` visar den för utloggade
(inloggade skickas som förut vidare till `/board` eller, för gamla `?tab=`-länkar, till sina nya routes). `pages/LandingPage.tsx` är tunn.
Login är en popup ovanpå Landing (RUN-145): sidans knapp ("Sign in to your pack") öppnar `LoginDialog` (`features/auth`), och `/login` är samma sida med dialogen redan öppen (ADR 006 beslut 1, addendum 2026-10-11; `/` och `/login` ligger utanför `RequireAuth`).

Mobil = App Prototypens landing i en kolumn. **Web Prototype har ingen landing** — desktop (≥ 1024 px) är samma komposition med större yta:
text | bana i hjälten, preview | steg bredvid varandra, vänsterjusterad logga, knapparna på en rad. Det är ett antagande (docs/open-assumptions.md).

## Struktur

- **components/**
  - `LandingScreen` — sidan: glöd, header (wordmark), `main` (hjälte, aggregat, preview + steg), footer. Inget annat än sammansättning.
  - `LandingParts` — `LandingHero` (märke · h1 · bana · ingress · knappar), `LandingStats`, `PackPreview`, `HowItWorks`
  - `ArenaTrack` — banan: tre banor, tre löpare (guld/silver/brons, olika takt), mållinje, "+50 XP"-pop. Ren dekor (`aria-hidden`)
- **landingModel.ts** — all hårdskriven data och vymodellen: aggregaten, `buildPreviewRows`, `buildHowItWorks`, banans geometri, uppräkningens matematik
- **hooks/useCountUp.ts** — framsteget 0 → 1 (en gång, 1.7 s); med `prefers-reduced-motion` hoppar det direkt till slutvärdet
- `landing.css` — enda stilfilen; mått (`--rq-landing-*`) i temafilen, sektion 1.27 (index.css + docs/design/temafil-forslag.css)

## Regler värda att komma ihåg

- **Ingen backend (ägarbeslut 4).** Landing-FEATUREN gör inga anrop: ingen endpoint, ingen react-query, ingen `useAuth`. `guards.test.ts` och `LandingScreen.test.tsx`
  (renderar utan QueryClientProvider och bevakar `fetch`) vaktar det. Siffrorna (128 430 km · 9 412 runs · 1 284 600 XP · "14 packs running") är påhittade.
  (App-skalet hämtar nivåtabellen via backenden, `GET /api/config/levels` (`useLevelRequirements`, `enabled: !!user`, anropad från `useAppInit`), bara när användaren är inloggad. Utloggad — inklusive `/` — görs inget anrop och shareds fallback-tabell används. Onboarding-prefetchen i samma hook gör inget anrop utan token. Inget av det är Landing.)
- **Previewn återanvänder `features/leaderboard/previewUsers`** — samma påhittade flock som `/preview` (LeaderboardPreviewPage importerar nu därifrån). Bara förnamn visas.
  Radens delta-pil är Boards `DeltaMark`/`deltaView`. Topp fem sorteras som Board (nivå, sedan XP).
- **How it works ur shared.** XP-raden (15 + 2/km, bonus vid 5/10/15/20 km) och streak-raden (från dag 5 ×1.1 upp till ×2.0 vid dag 270) läses ur
  `DEFAULT_ADMIN_SETTINGS` / `DEFAULT_STREAK_MULTIPLIERS` (spelets VERKLIGA standardregler, ägarbeslut 1 — prototypens "up to 2× / resets to 1×" var påhittat).
  Landing hämtar inte admin-inställningarna, så en ändring där syns inte i texten.
- **EN guldknapp: Sign in.** Prototypens "Create your pack — free" finns inte (väntar på multi-grupp, ägarbeslut 4); sidan säger "Starting your own pack is coming soon."
  Den sekundära knappen hoppar till `#how-it-works`.
- **Rörelse.** Bara det som lever loopar: löparna (`rqOrbit`, offset-path på SVG-cirklar), "+50 XP"-poppen, previewkortets guldring (`rqRing`) och sweep (`rqSweep`),
  blink-pricken. Staplarna (`rqBar`) och aggregatens uppräkning går en gång. `prefers-reduced-motion` hanteras av temafilens globala regel (CSS) och av
  `useCountUp` (siffrorna); sweep-bandet ligger utanför kortet i basläget så det inte blir kvar när rörelsen är avstängd.
- **Tillgänglighet.** `header`/`main`/`footer`; en h1, h2 per sektion (aggregatens rubrik är `sr-only`), h3 per steg; aggregaten har ett gömt animerat tal och ett `sr-only`
  slutvärde; delta-pilarna läses upp ("Up 1 place"); banan och glöden är `aria-hidden`.
- **Inget `<title>`/SEO-arbete ännu.** ADR 006:s revisit-trigger (statisk rendering av publik `/`) är inte åtgärdad — sidan är fortfarande en klientrenderad SPA-route.
- **Smala telefoner.** Under 380 px rymmer rubrikkolumnen (viewport − marginaler − banan) inte "LEADERBOARD" i full storlek, och ordet får aldrig brytas — då ligger banan under rubriken i stället för bredvid (CSS-media i `landing.css`; 320–1440 px är mätta i Chromium, `getClientRects()` = 1 rektangel). Rubriken har ingen `overflow-wrap`.
- **Vilopositioner.** Löparnas `offset-distance` (0/35/70 %) gäller bara när rörelsen är avstängd; loopen skriver över den. Därför visar reducerad rörelse tre spridda löpare, inte en klump.
- **Sign in-knappen och adressen.** Knappen är en vanlig `<Link to={paths.login} state={FROM_LANDING_STATE}>`: adressen blir `/login` (push), `pages/Index` monterar `LoginDialog` ovanpå, och Landing ligger kvar under (samma element på samma plats i routerträdet — ingen ommontering, banan och uppräkningen startar inte om). Back stänger dialogen; ✕/Esc/scrim gör samma sak (`useCloseLogin`: ett steg bakåt när dialogen öppnades härifrån, annars `replace` till `/`).
  Landing-FEATUREN importerar inget ur `features/auth` eller `providers/auth` (vaktat i `guards.test.ts`): gränsen går vid att Landing bara navigerar; dialogen — som gör inloggningsanropet via `AuthProvider` — monteras av sidan (`pages/Index`), inte av featuren.
- **Back efter inloggning (känt beteende, ej åtgärdat).** Historiken blir `/` → `/login`; efter lyckad inloggning `replace`:ar `Index` `/login` med `next`/`/board`, så historiken är `/` → `/board`. Back går då till `/`, som för en inloggad `replace`:ar vidare till `/board` — användaren måste trycka Back två gånger för att lämna appen. Samma mönster som övriga redirects i ADR 006 beslut 7.
- **Inloggningen är en dialog, inte en sida, men Landing gör den till huvudvägen in.** `AuthProvider.login` sätter ingen global `loading` längre (den bytte ut hela routerträdet mot en loader, så dialogen avmonterades och fel/fält försvann); `loading` betyder bara "sessionen återställs vid appstart". Dialogen har egen laddning. Testad i `App.login.test.tsx`.
- **Utloggning och 401.** Log out (AvatarMenu) leder hit, till `/` utan dialog och utan `next`. Ett 401 mitt i sessionen leder till `/login?next=<sidan>` — Landing med dialogen öppen — så att man kommer tillbaka dit man var. Se `features/auth/README.md`.

## Filmen, ikonerna och delningsbilden

**Källa.** Filmen "RunQuest Mixed" (1920×1080, 30 fps, H.264, 49 s, inget ljudspår; namnen i den är påhittade). Originalet ligger i ägarens OneDrive och i Claude Design-projektet, **utanför git**: `.gitignore` håller `docs/design/*.mp4` och `docs/design/landing-media/` utanför, och CI-vakten `media` (`node scripts/ci-guards.mjs media`) fäller en spårad `.mp4`/`.mov` utanför `apps/frontend/public/media/`. Bara de komprimerade filerna nedan spåras. Ingen Git LFS.

**Filer och gränser** (`apps/frontend/public/media/`, vaktade av `ci-guards`, summan högst 7 MiB):

| Fil | Mått | Gräns | Storlek nu |
|---|---|---|---|
| `landing-film-720.v1.mp4` | 1280×720 | 4 194 304 byte | 3 067 216 |
| `landing-film-480.v1.mp4` | 854×480 | 2 621 440 byte | 1 751 580 |
| `landing-film-poster-720.v1.webp` | 1280×720 | 61 440 byte | 50 954 |
| `landing-film-poster-480.v1.webp` | 854×480 | 30 720 byte | 27 246 |

**Versionsregeln.** `.v1` är versionen. Caddy cachar `/media/*` som `immutable` i ett år, så en ändrad kodning får ett **nytt filnamn** (`.v2`) och skrivs aldrig över; spelaren (`components/LandingFilm.tsx`) och vakten pekar då på det nya namnet.

**Kodning** (ffmpeg 9.0 med libx264 och libwebp, körd från mappen med originalet; verktyget är inget beroende i repot). Inget ljud (`-an`), ingen metadata (`-map_metadata -1`, bitexact, och x264:s SEI-text borttagen), `moov` före `mdat`, en nyckelruta varannan sekund:

```
ffmpeg -i "RunQuest Mixed (1).mp4" -map 0:v:0 -an -map_metadata -1 -fflags +bitexact -flags:v +bitexact -vf "scale=1280:-2:flags=lanczos" -c:v libx264 -preset veryslow -profile:v high -pix_fmt yuv420p -crf 27 -maxrate 650k -bufsize 1300k -g 60 -keyint_min 60 -sc_threshold 0 -bsf:v filter_units=remove_types=6 -movflags +faststart landing-film-720.v1.mp4
ffmpeg -i "RunQuest Mixed (1).mp4" -map 0:v:0 -an -map_metadata -1 -fflags +bitexact -flags:v +bitexact -vf "scale=854:-2:flags=lanczos" -c:v libx264 -preset veryslow -profile:v high -pix_fmt yuv420p -crf 28 -maxrate 400k -bufsize 800k -g 60 -keyint_min 60 -sc_threshold 0 -bsf:v filter_units=remove_types=6 -movflags +faststart landing-film-480.v1.mp4
ffmpeg -ss 20.5 -i "RunQuest Mixed (1).mp4" -frames:v 1 -map_metadata -1 -vf "scale=1280:-2:flags=lanczos" -c:v libwebp -quality 88 -compression_level 6 landing-film-poster-720.v1.webp
ffmpeg -ss 20.5 -i "RunQuest Mixed (1).mp4" -frames:v 1 -map_metadata -1 -vf "scale=854:-2:flags=lanczos" -c:v libwebp -quality 85 -compression_level 6 landing-film-poster-480.v1.webp
```

Libx264 skriver strömtaggen `encoder=Lavc libx264` trots bitexact, så båda mp4-filerna remuxades därefter utan omkodning (byte för byte lika stora, ffprobe visar ingen encoder-tagg):

```
ffmpeg -i landing-film-720.v1.mp4 -map 0:v:0 -c copy -an -map_metadata -1 -metadata:s:v:0 encoder= -fflags +bitexact -movflags +faststart ut.mp4
```

**Postern** är rutan vid **20,5 s**: ledartavlan "The standings" med appen i bild (inte en svart övergång). Samma ruta i båda storlekarna.

**Spelaren.** Videon har `preload="none"` och inget `autoplay`, `loop` eller `controls`; ingenting av filmen hämtas före play. Källorna står i ordning: 720p med `media="(min-width: 1024px)"`, sedan 480p utan `media` som reserv. Postern är en `<picture>` (720-postern från 1024 px, annars 480-postern). När filmen spelat klart återgår spelaren till postern med play. Ingen ljudknapp och ingen "sound on" (filmen saknar ljud). Webbläsaren skickar `error` på varje `<source>` som inte passar media-frågan (720p på en telefon), så bara `<video>` med ett `MediaError` och den sista källan räknas som fel.

**Ikonerna** är löparsymbolen (gruppen `runner` i `logo()`, `RQLogo.tsx`) i guld `#ffd700` på `#070e09`. Geometrin är oförändrad; streckbredden är 4,5 i stället för 3,5 och huvudets radie 4,2 i stället för 3,5, så att figuren håller i 16 px. `favicon.svg` (viewBox 64×64, rundade hörn) är källan. ffmpeg-bygget saknar librsvg, så SVG:erna rastrerades med Edge headless (1024 px) och skalades med ffmpeg (`scale=N:N:flags=area`): `favicon.ico` (PNG-poster i 16, 32 och 48 px), `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png` (heltäckande ruta) och `icon-maskable-512.png` (symbolen på 80 % skala, innanför den säkra cirkeln med 80 % diameter). ICO-filen packades i Node utan beroenden. Hjälpskripten committas inte; ändras symbolen görs ikonerna om på samma sätt.

**Delningsbilden** `og-image.v1.png` (1200×630, högst 300 kB; nu 41 652 byte) är filmens slutruta (RUNQUEST-wordmarken på mörk botten):

```
ffmpeg -sseof -0.1 -i "RunQuest Mixed (1).mp4" -frames:v 1 -map_metadata -1 -vf "crop=1280:670:310:154,scale=1200:630:flags=lanczos" -compression_level 100 og-image.v1.png
```

Beskärningen (1280×670 kring wordmarken) ger 1.91:1; wordmarken klipps varken där eller vid en centrerad 1:1-beskärning (630×630 i mitten). Ändras bilden: nytt namn (`og-image.v2.png`) och nya `og:image`-adresser i `index.html`, eftersom plattformarna cachar länkkort per adress.

**Metadata** (`apps/frontend/index.html`, statisk enligt ADR 006-addendum 2026-10-13): title, description, canonical (`https://www.runquest.dev/` för alla SPA-adresser), Open Graph, Twitter, ikonlänkar, `theme-color`, `site.webmanifest` och en `<noscript>` med samma h1 som landningen. Siffror står aldrig där (de är påhittade exempel). `src/test/staticHead.test.ts` läser filen från disk och jämför noscript-rubriken med h1-texten ovan.

**Leverans.** `Caddyfile` har blocket `handle /media/*` (immutable, 404 med `no-store` för saknad fil, aldrig `index.html`; mp4 komprimeras inte och Range ger 206) och ett explicit `Content-Type: application/manifest+json` för `.webmanifest`. `scripts/verify-static-serving.sh` prövar filmen (MED `Accept-Encoding`), Range, saknad fil, ikonerna, manifestet och delningsbilden mot det byggda `dist/`.
