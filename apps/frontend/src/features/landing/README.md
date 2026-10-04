# Landing — `/` för utloggade

Den publika startsidan: hjälte med arena-banan, aggregat, anonymiserat previewkort och "How it works". `pages/Index.tsx` visar den för utloggade
(inloggade skickas som förut vidare till `/board` eller, för gamla `?tab=`-länkar, till sina nya routes). `pages/LandingPage.tsx` är tunn.
Login nås via sidans knapp ("Sign in to your pack") och `/login` direkt (ADR 006 beslut 1; `/` ligger utanför `RequireAuth`).

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
  (App-skalet gör ett Supabase-anrop, `level_requirements` via `useAppInit`, på alla routes — även `/`. Onboarding-prefetchen i samma hook gör inget anrop utan token. Inget av det är Landing och ändrades inte.)
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
