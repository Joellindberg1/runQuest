# Changelog

## v2.2.0 — Versionsmekanik, Feature & Version och "What's new" (2026-10-05)

### Nytt
- **Feature & Version-sidan** omritad i designspråket (flikarna Features · Working on ·
  Releases, `?view=`); versionsnumret och datumet överst kommer ur changelog.json i
  stället för att vara hårdkodade, och mobilvyn är härledd ur Web Prototypens skärm.
- **"What's new"-popupen** omritad (Radix Dialog, en guldknapp "Got it"); ersätter
  den gamla lucide/tailwind-modalen.
- **Versionsvakt i CI:** `scripts/check-versions.mjs` fäller bygget om rotens och
  frontendens `package.json`, översta `## vX.Y.Z` i den här filen och
  changelog.json inte stämmer överens (ordning, semver, rubriker, `announce`).

### Ändrat
- `apps/frontend/src/data/changelog.json` är nu ENDA källan för det gruppen ser:
  `{ features, workingOn, releases }`. Posterna har valfritt `announce: true`;
  onboarding-kön och popupen läser annonserade poster därifrån (slug
  `patch_v<version>`). `features/onboarding/patchNotes.ts` och
  `shared/utils/changelogHelpers.ts` är borttagna. Poster för 2.0.0–2.2.0 ifyllda;
  bara 2.0.0 annonseras.
- Onboarding: ett misslyckat "sedd"-anrop (`/onboarding/mark-seen`) stänger popupen/touren
  ändå och kön går vidare i sessionen (posten visas igen nästa gång); "Got it" kan inte
  dubbelklickas. Versionsvakten stöder inte förreleaser (`-rc.1`) och ignorerar rubriker i kodstaket.
- `package.json` (rot + frontend) hade 0.0.x — satta till 2.2.0 så att de följer
  taggen enligt docs/dokumentation.md.

## v2.1.1 — Städrunda + olästmarkör (2026-10-05)

### Fixat
- Admin-sidans XP-inställningar gick inte att läsa eller spara (serverfel):
  backend frågade efter en kolumn som inte finns och letade efter raden med
  fel id-typ (issue #13).
- Streak-trappan kan inte längre bli tom om en sparning avbryts: nya steg
  sparas först, gamla tas bort sist. Ogiltiga trappor (tomma, dubbla dagar,
  multiplikator utanför 1–9.99 eller med fler än två decimaler) avvisas innan
  något ändras. Admin-sidans Save är låst tills inställningarna och trappan
  faktiskt lästs in — annars kunde standardvärden skriva över den riktiga trappan.

### Ändrat
- Olästa nyheter har en guldprick vid tiden, i flödet och i klock-popovern.

### Tekniskt
- Strava-kopplingen loggar inte längre en del av engångskoden.
- TypeScripts byggcache (`tsconfig.tsbuildinfo`) spåras inte längre i git.
- Dokumentationen rättad (inloggning gäller 30 dagar, hosting/Caddy, domäner).

## v2.1.0 — Alla titlar på mobilens Board (2026-10-05)

### Ändrat
- Mobilens Board visar nu alla visade titlar (upp till tre) på en egen rad
  under namnet, på alla placeringar. Tidigare syntes bara den första titeln på
  pallen och ingen alls från plats 4.
- Korten från plats 4 visar nivå och XP i nivån mot vad nivån kräver, som
  pallkorten.

## v2.0.1 — Ingen gammal cachad app efter deploy (2026-10-05)

### Fixat
- Webbläsare kunde fastna på en gammal cachad startsida efter en deploy och
  visa vit sida tills cachen rensades. Startsidan revalideras nu alltid
  (`Cache-Control: no-cache`), saknade kodfiler ger 404 i stället för startsidan,
  och en flik som var öppen under en deploy laddar om sig själv en gång om en
  sida inte längre går att ladda. Den som redan har en gammal startsida i cachen
  kan behöva ladda om en sista gång.
- Vercel Speed Insights borttaget (sajten ligger på Railway; skriptet gav fel
  på varje sidladdning).

### Tekniskt
- Frontendens statiska server styrs av `Caddyfile` i repo-roten (Railpack);
  beteendet verifieras i CI med samma Caddy-version mot det byggda `dist/`.

## v2.0.0 — Redesignen (2026-10-05)

Hela appen omritad enligt designprojektet (RunQuest App/Web Prototype):
mörk arena, guld som belöningssignal, skarpa hörn, Bebas Neue/Barlow
Condensed/Share Tech Mono. Byggd i 11 kritikergranskade inkrement.

### Nytt
- **App-skal:** bottenbar (Ranks/Titles/+New/Duels/You) på mobil, sidonav på
  desktop; riktiga routes (`/board /titles /duels /events /news /log /profile
  /runner/:id`); "Right now"-pills; ErrorBoundary (ett panelfel ger felkort,
  aldrig vit skärm).
- **Board:** podium med spökrank, veckoflik med dagstaplar och Mover of the
  week, streaks-flik, rank-delta och XP-pace.
- **Runner card:** egen skärm/overlay med nivåring, statflikar, titlar,
  head-to-head och Challenge-knapp.
- **Titles:** kategorigrupper, titelkort med innehavare/värde/runner-ups,
  On display-val, Closest chase.
- **Duels:** Standings/Live/Rules/History, send-sheet med token-val och
  head-to-head-tips, verkliga insatser ur datan.
- **Events:** öppet-kort med nedräkningsring, competition-tabell, Up next,
  This week, facit och historik med pager.
- **Log runs:** Estimated XP-förhandsvisning via shared-formeln, effektrader
  ("streak lever", "Closes on …"), group history, löpbandsflagga.
- **Profile:** hjältekort, Frodo-zoom i tre lägen, Distance/Streak/Fun/
  Consistency-heatmap, edit/delete med full omräkningskedja, profilbild.
- **Pack News:** händelselogg (activity_log, migration 034) med klock-popover,
  oläst-badge, dag-grupperat flöde, filterchips och Mark all read. Titelbyten,
  utmaningar, level-ups, milstolpar, streak-brott och event loggas live;
  historiken backfillad.
- **Landing:** publik startsida med arena-bana, aggregat och produktglimtar.

### Fixat på vägen
- Login visar fel ("Invalid credentials") i stället för att tyst tömma
  formuläret.
- Onboarding-touren spelas inte längre om efter inloggning utan omladdning.
- Utgången session loggar ut (401) i stället för att fastna på felkort.
- Radering av rundor som kvalificerat event ger begripligt besked (409) i
  stället för serverfel; Strava-rundor kan inte längre raderas i appen (synken
  återskapade dem ändå — radera i Strava i stället).
- Datumvalidering räknar svensk tid (midnatt–02 går att logga).
- Redigering/radering av rundor uppdaterar nu leaderboard, events, titlar och
  utmaningar direkt.

### Tekniskt
- Frontend: 1268 tester (från 0), typecheck/lint blockerande i CI.
- Backend: 450 tester; shared: 156 tester med delade API-kontrakt.
- ADR 006 (navigering), 007 (härledningsendpoints), 008 (händelselogg).
