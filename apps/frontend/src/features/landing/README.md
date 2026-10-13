# Landing — `/` för utloggade

Den publika startsidan: header med ankarlänkar och Sign in, hjälte med arena-banan och en sifferrad, exempelkort ("Sample pack"), How it works med XP-formeln,
funktionsrutnät och footer. `pages/Index.tsx` visar den för utloggade (inloggade skickas som förut vidare till `/board` eller, för gamla `?tab=`-länkar, till sina
nya routes). `pages/LandingPage.tsx` är tunn. Login är en popup ovanpå Landing (RUN-145): headerns "Sign in" öppnar `LoginDialog` (`features/auth`), och `/login` är samma
sida med dialogen redan öppen (ADR 006 beslut 1, addendum 2026-10-11; `/` och `/login` ligger utanför `RequireAuth`).

Mobil = App Prototypens landing i en kolumn (390 px). Desktop (≥ 1024 px) är Landing-designen (`docs/design/claude-design/RunQuest Landing.dc.html`, rutan "Landing page",
1440 px): text | bana i hjälten, band med hårlinjer, fyra stegkolumner, tre kortkolumner. Brytpunkten är skalets (`useIsDesktop`); det som skiljer i DOM (headerns nav, banans
geometri, ingressens längd, de tre förklaringarna) renderas efter den, resten är CSS och token-värden.

## Struktur

- **components/**
  - `LandingScreen` — sidan: rutnät och glöd (dekor), header, `main`, footer. Inget annat än sammansättning, och platserna för film och väntelista (se nedan).
  - `LandingHeader` — wordmark, `nav aria-label="Sections"` (bara desktop: The game → `#film`, XP & levels → `#how-it-works`, Titles → `#features`) och Sign in (`rq-btn--secondary`)
  - `LandingParts` — `LandingHero` (h1 · bana · ingress · knappar · film (mobil) · sifferrad; **h1 `id="landing-title"` ligger här**), `PackPreview`, `HowItWorks` (stegen och XP-formeln)
  - `LandingStats` — sifferraden; `LandingFeatures` — de sex korten; `LandingFooter` — Privacy, Legal, Strava, versionen
  - `ArenaTrack` — banan: desktop fem banor och sex löpare med XP-pop (−31°), mobil tre banor och tre löpare (−72°). Ren dekor (`aria-hidden`)
- **hooks/usePublicStats.ts** — landningens enda anrop: `GET /api/public/stats` via `backendApi.getPublicStats()`, react-query, `staleTime = PUBLIC_STATS_MAX_AGE_MS`
- **landingModel.ts** — vymodellen: ankar-id:n, `buildStatViews`, `buildPreviewRows`, `buildHowItWorks`, `buildXpFormula`, `buildFeatures` och banans geometri (`ARENA`)
- `landing.css` — enda stilfilen; mått (`--rq-landing-*`) i temafilen, sektion 1.27 (index.css + docs/design/temafil-forslag.css)

## Platser för film och väntelista

Lead byter in komponenterna från de andra spåren vid integrationen; platserna har kommentarer som börjar med `PLATS (Lead):`.

- `LandingHero` tar `watchFilm` och `mobileFilm`. Ordning i textspalten: knappraden (Join the waitlist + `watchFilm`), `mobileFilm`, sifferraden. Platshållaren för `watchFilm` är en länk till `#film`.
- `<div id="film" data-slot="film" />` mellan hjälten och previewn; `<div id="waitlist" data-slot="waitlist" />` efter funktionsrutnätet, före footern. Komponenterna som byts in bär själva ankar-id:t.

## Regler värda att komma ihåg

- **Ett anrop (ADR 006-addendum 2026-10-13, ändrar ägarbeslut 4).** Landing gör exakt ett anrop vid sidladdning, `GET /api/public/stats` (utan Authorization). Bara `hooks/usePublicStats.ts`
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
- **Funktionsrutnätet** har sex kort (01–06): Strava-kortet säger "every 30 minutes" (`STRAVA_SYNC_MINUTES` i Playbookens fakta), Journey-kortet "mapped". Det finns på mobil och desktop.
- **Footern:** Privacy och Legal (→ `legalPrivacyPath` / `legalTermsPath`), Stravas "Compatible with Strava" (oförändrad: ingen filter, ingen hover, högst textens teckenhöjd, skild från
  RunQuests wordmark; svart variant på ljus botten via `next-themes`; vaktas av Stylelint-regeln `rq/strava-logo` i `stylelint.config.js`: ingen filter, opacity, transform, animation eller hover, höjd högst 1em) och versionen (`v` + `version` ur `apps/frontend/package.json`, som `scripts/check-versions.mjs` vaktar). Inga länkar till inloggade sidor.
- **Rörelse.** Bara det som lever loopar: rutnätet (`rqGrid`), löparna (`rqOrbit`, offset-path på SVG-cirklar) och deras XP-pop, previewkortets guldring (`rqRing`) och sweep (`rqSweep`).
  Staplarna (`rqBar`) går en gång. `prefers-reduced-motion` hanteras av temafilens globala regel (CSS); sweep-bandet ligger utanför kortet i basläget så det inte blir kvar när rörelsen är avstängd.
- **Tillgänglighet.** `header`/`main`/`footer`; en h1, en h2 per sektion (sifferradens och funktionsrutnätets är `sr-only`, och på mobil även previewns och stegens), h3 per steg, kort och förklaring;
  delta-pilarna läses upp ("Up 1 place"); banan, rutnätet och glöden är `aria-hidden`. Knappar och footerlänkar är minst 44 px höga på mobil; fokusringen är temafilens globala.
- **Inget `<title>`/SEO-arbete ännu.** ADR 006:s revisit-trigger (statisk rendering av publik `/`) är inte åtgärdad — sidan är fortfarande en klientrenderad SPA-route.
- **Smala telefoner.** Banan är en smal ruta (`--rq-landing-track-w`, 100 px) bredvid rubriken. Under 380 px rymmer rubrikkolumnen (viewport − marginaler − banan) inte "LEADERBOARD" i full storlek, och ordet får aldrig brytas — då ligger banan under rubriken i stället för bredvid (CSS-media i `landing.css`). Radbrytningen är mätt i Chromium på 320–1440 px (`getClientRects()` = 1 rektangel för "leaderboard"): 380–390 px ger "Your group / chat deserves / a leaderboard", och ingen bredd lämnar ett ensamt "a". Rubriken har ingen `overflow-wrap`. Sifferraden (nowrap) bryts inte på 320 px, inte ens med 1 000 000 km.
- **Vilopositioner.** Löparnas `offset-distance` (0/35/70/15/50/85 %) gäller bara när rörelsen är avstängd; loopen skriver över den. Därför visar reducerad rörelse spridda löpare (sex på desktop, tre på mobil), inte en klump.
- **Sign in-knappen och adressen.** Knappen (headern, alla bredder) är en vanlig `<Link to={paths.login} state={FROM_LANDING_STATE}>`: adressen blir `/login` (push), `pages/Index` monterar `LoginDialog` ovanpå, och Landing ligger kvar under (samma element på samma plats i routerträdet — ingen ommontering, banan startar inte om). Back stänger dialogen; ✕/Esc/scrim gör samma sak (`useCloseLogin`: ett steg bakåt när dialogen öppnades härifrån, annars `replace` till `/`).
  Landing-FEATUREN importerar inget ur `features/auth` eller `providers/auth` (vaktat i `guards.test.ts`): gränsen går vid att Landing bara navigerar; dialogen — som gör inloggningsanropet via `AuthProvider` — monteras av sidan (`pages/Index`), inte av featuren.
- **Back efter inloggning (känt beteende, ej åtgärdat).** Historiken blir `/` → `/login`; efter lyckad inloggning `replace`:ar `Index` `/login` med `next`/`/board`, så historiken är `/` → `/board`. Back går då till `/`, som för en inloggad `replace`:ar vidare till `/board` — användaren måste trycka Back två gånger för att lämna appen. Samma mönster som övriga redirects i ADR 006 beslut 7.
- **Inloggningen är en dialog, inte en sida, men Landing gör den till huvudvägen in.** `AuthProvider.login` sätter ingen global `loading` längre (den bytte ut hela routerträdet mot en loader, så dialogen avmonterades och fel/fält försvann); `loading` betyder bara "sessionen återställs vid appstart". Dialogen har egen laddning. Testad i `App.login.test.tsx`.
- **Utloggning och 401.** Log out (AvatarMenu) leder hit, till `/` utan dialog och utan `next`. Ett 401 mitt i sessionen leder till `/login?next=<sidan>` — Landing med dialogen öppen — så att man kommer tillbaka dit man var. Se `features/auth/README.md`.
