# Landing — `/` för utloggade

Den publika startsidan: header med ankarlänkar och Sign in, hjälte med arena-banan och en sifferrad, exempelkort ("Sample pack"), How it works med XP-formeln,
funktionsrutnät och footer. `pages/Index.tsx` visar den för utloggade (inloggade skickas som förut vidare till `/board` eller, för gamla `?tab=`-länkar, till sina
nya routes). `pages/LandingPage.tsx` är tunn. Login är en popup ovanpå Landing (RUN-145): headerns "Sign in" öppnar `LoginDialog` (`features/auth`), och `/login` är samma
sida med dialogen redan öppen (ADR 006 beslut 1, addendum 2026-10-11; `/` och `/login` ligger utanför `RequireAuth`).

Mobil = App Prototypens landing i en kolumn (390 px). Desktop (≥ 1024 px) är Landing-designen (`docs/design/claude-design/RunQuest Landing.dc.html`, rutan "Landing page",
1440 px): text | bana i hjälten, band med hårlinjer, fyra stegkolumner, tre kortkolumner. Brytpunkten är skalets (1024 px), men landningen väljer aldrig variant i JS
(ADR 006-addendum 2026-10-19, punkt 5: den förrenderade sidan vet inte bredden). Det som skiljer (headerns nav, banans geometri, ingressens längd,
ögonbrynet och de tre förklaringarna, sektionsrubrikernas synlighet, filmens vy) ligger i HTML i båda varianterna och CSS visar en med
`@media (min-width: 1024px)`; den dolda är `display: none` (utanför tillgänglighetsträdet och tab-ordningen, och utan animationer). Ett undantag från
skalets beslut 5 ("exakt EN variant i DOM") som bara gäller landningen. ESLint (`LANDING_NO_VIEWPORT_OR_LOCALE` i `eslint.config.js`) förbjuder
`useIsDesktop`, `matchMedia`, `Intl` och `toLocaleString` i featuren; tal formateras med `formatInt` (regex med NBSP, samma text på server och klient).
Rörelsepreferensen vid klick läses via `shared/utils/prefersReducedMotion`. En ny variant får alltså en regel i `landing.css`/`landingFilm.css`
(grundregeln mobil, desktop i `@media (min-width: 1024px)`) och en rad i listan i `guards.test.ts`.

## Struktur

- **components/**
  - `LandingScreen` — sidan: rutnät, glöd och headerns ton (dekor), header, `main`, footer. Inget annat än sammansättning, inklusive filmen och väntelistan (se nedan).
  - `LandingHeader` — wordmark, `nav aria-label="Sections"` (visas bara från 1024 px: The game → `#film`, XP & levels → `#how-it-works`, Titles → `#features`) och Sign in (`rq-btn--secondary`)
  - `LandingParts` — `LandingHero` (h1 · bana · ingress · knappar · film (mobil) · sifferrad; **h1 `id="landing-title"` ligger här**), `PackPreview`, `HowItWorks` (stegen och XP-formeln)
  - `LandingStats` — sifferraden; `LandingFeatures` — de sex korten; `LandingFooter` — Privacy, Legal, Strava, versionen
  - `ArenaTrack` — banan: två SVG i samma ruta (`data-arena="mobile|desktop"`), desktop fem banor och sex löpare med XP-pop (−31°), mobil tre banor och tre löpare (−72°). Ren dekor (`aria-hidden`)
- **hooks/usePublicStats.ts** — landningens enda anrop: `GET /api/public/stats` via `backendApi.getPublicStats()`, react-query, `staleTime = PUBLIC_STATS_MAX_AGE_MS`
- **landingModel.ts** — vymodellen: ankar-id:n, `buildStatViews`, `buildPreviewRows`, `buildHowItWorks`, `buildXpFormula`, `buildFeatures` och banans geometri (`ARENA`)
- `landing.css` — enda stilfilen; mått (`--rq-landing-*`) i temafilen, sektion 1.27 (index.css + docs/design/temafil-forslag.css)

## Film och väntelista

- `LandingHero` tar `watchFilm` (`<WatchFilmButton />`) och `mobileFilm` (`<LandingFilm variant="mobile" />`). Ordning i textspalten: knappraden (Join the waitlist + Watch the film), filmen (mobil), sifferraden.
- `<LandingFilm variant="desktop" />` ligger mellan hjälten och previewn och `<LandingWaitlist />` efter funktionsrutnätet, före footern. Komponenterna bär själva ankar-id:t: desktopfilmen `#film`, mobilfilmen `#film-mobile` (båda ligger i HTML, CSS döljer den som inte passar; ett id får bara finnas en gång) och `#waitlist`. "Watch the film" scrollar till den film vars ankare har rutor (`getClientRects`), alltså den CSS visar, och faller annars tillbaka på länkens `#film`.

## Regler värda att komma ihåg

- **Ett anrop (ADR 006-addendum 2026-10-13, ändrar ägarbeslut 4).** Landing gör exakt ett anrop vid sidladdning, `GET /api/public/stats` (utan Authorization), plus ett omförsök vid 5xx eller nätverksfel (inget vid 4xx). Väntelistans formulär skickar `POST /api/waitlist` först när besökaren trycker. Bara `hooks/usePublicStats.ts`
  får importera klienten och react-query (ESLint, `eslint.config.js`), och `LandingScreen.test.tsx` kräver exakt ett anrop med exakt den sökvägen. Ingen `useAuth`, ingen annan data.
  (App-skalet hämtar nivåtabellen via backenden, `GET /api/config/levels` (`useLevelRequirements`, `enabled: !!user`, anropad från `useAppInit`), bara när användaren är inloggad.
  Utloggad — inklusive `/` — görs inget annat anrop och shareds fallback-tabell används. Inget av det är Landing.)
- **Siffrorna är sanna.** "4 551 km logged · 6 runners · 4 challenges", i den ordningen (km i guld), med `formatInt` (smalt mellanslag) och singular för ental. Ingen uppräkning och inga
  reservsiffror: medan svaret laddas står "—" (`aria-busy="true"`), vid fel (nätverk, 5xx, ogiltigt svar) döljs hela raden utan meddelande, noll visas som 0. Varje tal läses som en
  enhet ("4 551 km logged"); ingen live-region. Ingen "packs running" förrän grupperna är fler (inte i v0.6.2).
- **Previewn återanvänder `features/leaderboard/previewUsers`** — samma påhittade flock som `/preview` (LeaderboardPreviewPage importerar därifrån). Kortet heter "Sample pack", är märkt
  "Example" (inte "Live") och har ingen nedräkning. Bara förnamn visas. Radens delta-pil är Boards `DeltaMark`/`deltaView`. Topp fem sorteras som Board (nivå, sedan XP).
- **How it works och XP-formeln ur shared.** XP-raden (15 + 2/km, bonus vid 5/10/15/20 km), streak-raden (från dag 5 ×1.1 upp till ×2.0 vid dag 270) och formelrutan
  ("BASE 15 + KM × 2 + DISTANCE BONUS × STREAK 1.0–2.0×", exemplet 10 km → +50 XP) läses ur `DEFAULT_ADMIN_SETTINGS` / `DEFAULT_STREAK_MULTIPLIERS` / `calculateRunXP` (spelets VERKLIGA
  standardregler, ägarbeslut 1). Landing hämtar inte admin-inställningarna, så en ändring där syns inte i texten. Formeln finns på mobil och desktop och har en textversion för skärmläsare.
- **EN guldknapp: Join the waitlist** (`rq-btn--primary`, `href="#waitlist"`). Formulärets skickaknapp har samma namn och mål men syns aldrig samtidigt; inga andra element har `rq-btn--primary`.
  "Sign in" är guldkontur (`rq-btn--secondary`), "Watch the film — 0:49" en neutral konturknapp (`rq-btn--ghost`, guld vid hover). Inga "Create a pack"-knappar.
- **Funktionsrutnätet** har sex kort (01–06): Strava-kortet säger att rundor kommer när de sparas, med en reservkontroll (intervallet ur `stravaPollIntervalLabel()` i shared), Journey-kortet "mapped". Det finns på mobil och desktop.
- **Footern:** Privacy och Legal (→ `legalPrivacyPath` / `legalTermsPath`), Stravas "Compatible with Strava" (oförändrad: ingen filter, ingen hover, högst textens teckenhöjd, skild från
  RunQuests wordmark; svart variant på ljus botten via `next-themes`; vaktas av Stylelint-regeln `rq/strava-logo` i `stylelint.config.js`: ingen filter, opacity, transform, animation eller hover, höjd högst 1em) och versionen (`v` + `version` ur `apps/frontend/package.json`, som `scripts/check-versions.mjs` vaktar). Inga länkar till inloggade sidor.
- **Rörelse.** Bara det som lever loopar: rutnätet (`rqGrid`), löparna (`rqOrbit`, offset-path på SVG-cirklar) och deras XP-pop, previewkortets guldring (`rqRing`) och sweep (`rqSweep`).
  Staplarna (`rqBar`) går en gång. `prefers-reduced-motion` hanteras av temafilens globala regel (CSS); sweep-bandet ligger utanför kortet i basläget så det inte blir kvar när rörelsen är avstängd.
- **Fast header (v0.6.2.1).** `LandingHeader` är `position: sticky; top: 0` på lagret `--rq-z-landing-header` (20, under skalets `.rq-scrim` 65 / `.rq-modal` 66, så inloggningsdialogen ritas över den; rutnät och glöd har inget z-index och ligger under) och med sidans mörka bas (`--rq-bg-shell`, ogenomskinlig: ett halvgenomskinligt glas lät rubrikerna skymta igenom). Under en notch/statusyta fyller headern remsan själv: `padding-top` är `--rq-landing-header-inset` (= `env(safe-area-inset-top, 0px)`) plus ordinarie luft, så inget innehåll syns ovanför wordmarken (mätt med CDP `Emulation.setSafeAreaInsetsOverride` top 47). Minsta höjden är inset plus `--rq-landing-header-h` (mobil 76, desktop 88; naturlig höjd är lika stor eller mindre), och samma token räknas bort av ankarna: `html:has(.rq-landing) { scroll-padding-top }` (+ `scroll-margin-top` på mobilfilmen, som saknar rubrik), så ankarmålen landar under headern och sidan hoppar inte när den fastnar. Guldglöden får ingen hård kant mot den ogenomskinliga headern tack vare `.rq-landing__fade` (`data-decor="fade"`): en 24 px gradient (`--rq-bg-shell` → transparent) som är dekor i sidan, absolut placerad direkt under headern, efter glöden men FÖRE innehållet i trädet. Den ligger medvetet inte i headern (en `::after` där ligger på headerns lager, ovanpå innehållet, och dämpade hjältens rubrik på mobil, där hjälten börjar direkt under headern); nu ritas texten ovanpå tonen och dämpas aldrig, och tonen följer sidan så den försvinner vid scroll. Känt tak (granskarens mätning): vid 200 % text på 320 px hamnar ankarmålen 27 px under headerns nederkant, eftersom headerns mått är fasta tokens och inte följer textstorleken. Målen är inte dolda; ingen åtgärd.**Ingen förfader till headern får ha `overflow: hidden/auto/scroll`:** det gör förfadern till scrollbehållare och sticky fastnar då mot den i stället för mot fönstret. `.rq-landing` klipper därför med `overflow: clip` (med `hidden` direkt före som reserv för äldre Safari), och `guards.test.ts` går igenom `.rq-landing`, `.rq-landing__inner`, `html`, `body` och `#root`. Ingen blur, ingen övergång, ingen skugga, ingen scrollstatus i JS. Dialogerna som lämnar tillbaka fokus (`LoginDialog`, `BadgeUpgradeDialog`) gör det med `focus({ preventScroll: true })`: utan det flyttar webbläsaren sidan när Sign in-länken i den fasta headern får fokus tillbaka. Mätt i Chromium (390 och 1440 px): efter scroll 2000 px ligger headern kvar på top 0, och scrollY ligger kvar efter Esc och klick på scrimmen.
- **Inget pris.** Väntelistans faktarad säger bara "No app to install". Ägaren har inte bestämt något om pris, så inget på sidan får antyda att RunQuest är gratis (`LandingScreen.test.tsx` kräver att ingen text eller etikett innehåller "free").
- **Tillgänglighet.** `header`/`main`/`footer`; en h1, en h2 per sektion (sifferradens och funktionsrutnätets är `sr-only`, och på mobil även previewns och stegens), h3 per steg, kort och förklaring;
  delta-pilarna läses upp ("Up 1 place"); banan, rutnätet och glöden är `aria-hidden`. Knappar och footerlänkar är minst 44 px höga på mobil; fokusringen är temafilens globala.
- **Förrenderad vid bygget (ADR 006, addendum 2026-10-19).** `npm run build` renderar landningen med `react-dom/server` till `dist/landing.html` och en separat, lean ingång hydrerar den (`src/landing-entry/`, se dess README). Innan Caddy-regeln i S6 serveras filen inte: `/` ger fortfarande `index.html` och fullappens klientrenderade landning (`pages/Index`). Featuren ska därför klara serverrendering: inget `window`/`document` på modulnivå eller i renderingen, inga val på bredd i JS, ingen `Date`/`Math.random`/`Intl` i renderingen.
- **Smala telefoner.** Banan är en smal ruta (`--rq-landing-track-w`, 100 px) bredvid rubriken. Under 380 px rymmer rubrikkolumnen (viewport − marginaler − banan) inte "LEADERBOARD" i full storlek, och ordet får aldrig brytas — då ligger banan under rubriken i stället för bredvid (CSS-media i `landing.css`). Radbrytningen är mätt i Chromium på 320–1440 px (`getClientRects()` = 1 rektangel för "leaderboard"): 380–390 px ger "Your group / chat deserves / a leaderboard", och ingen bredd lämnar ett ensamt "a". Rubriken har ingen `overflow-wrap`. Sifferraden (nowrap) bryts inte på 320 px, inte ens med 1 000 000 km.
- **Vilopositioner.** Löparnas `offset-distance` (0/35/70/15/50/85 %) gäller bara när rörelsen är avstängd; loopen skriver över den. Därför visar reducerad rörelse spridda löpare (sex på desktop, tre på mobil), inte en klump.
- **Sign in-knappen och adressen.** Knappen (headern, alla bredder) är en vanlig `<Link to={paths.login} state={FROM_LANDING_STATE}>`: adressen blir `/login` (push), `pages/Index` monterar `LoginDialog` ovanpå, och Landing ligger kvar under (samma element på samma plats i routerträdet — ingen ommontering, banan startar inte om). Back stänger dialogen; ✕/Esc/scrim gör samma sak (`useCloseLogin`: ett steg bakåt när dialogen öppnades härifrån, annars `replace` till `/`).
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
