# Changelog

## v0.6.0 — Badges, väder- och vintertitlar, väggklocka och Strava-lås (2026-10-11)

Rullar ihop epicsen RUN-1 (Badges), RUN-91 (Stormborn, Iceborn, Winter Warrior) och RUN-92 (städning och nivåtabellen via backend), plus
Strava-låset (RUN-139), ägarens badge-omritning v2 (RUN-146–152) och login som popup (RUN-145). Migrationerna 035–037 och en badge-backfill är prod-steg som kräver ägar-ja (038/039 applicerades redan som säkerhetshotfix; 040 skrivs separat efter releasen) (se "Prod-steg" nedan).

### Nytt
- **Badges (ADR 009, RUN-1).** Åtta serier × sex nivåer (Common till Legendary) som gruppen samlar över säsonger: Milestoner, Earth Trotter, Climber,
  Streak Keeper, Early Bird, Night Owl, Speedster och Precisionist. Reglerna, trösklarna (v2, en mätning per serie, strikt stigande) och texterna bor i
  `packages/shared/src/badges.ts`. Badges är härledda och återkallbara: `evaluateBadges` körs i `calculateUserTotals`, diffar mot `user_badges` (en rad per
  användare och serie, migration 035) och skriver bara skillnaden; raderas eller ändras en runda så sjunker nivån. Precisionist räknar bara Strava-rundor
  (servern sätter `source`, RUN-136). Lästa via `GET /api/badges/user/:userId` och `/group` (gruppavgränsade), skrivna via `PUT /api/badges/showcase` (max 3 visade,
  `users.displayed_badge_series`) och `POST /api/badges/seen` (popup-vattenmärket `seen_tier`).
  - Badges-sidan `/badges` (v2, se nedan): kort per serie ("Held by X of N in your pack") och valet av visade badges (Show / On display + SAVE DISPLAY). Profile visar en kompakt sammanfattning med "All badges →"; minis i hjältekortet (desktop).
  - Board: de visade badgesen som minis på podiet och i Season-raderna. Runner card: andras badges som en kompakt, skrivskyddad rad emblem (v2).
  - Uppgraderingspopupen visas i skalet när `tier > seen_tier` (en gång per nivå, väntar på onboarding och turer). Pack News: `badge_earned` (migration 036) under
    filtret Levels, med emblem i raden och i klock-popovern; raden dras tillbaka om nivån tappas.
  - `npm run backfill:badges` (dry-run som standard, `--apply`, `--silent`) räknar ut historiska badges utan news och utan popup-flod.
- **Badge-design v2 (RUN-146–152, ägarens omritning 2026-10-11).** Ersätter v1:s profilsamling, väljare och Runner card-panel; facit är `docs/design/badges/spec.md` (avsnittet "v2") och
  designkällan i `docs/design/claude-design/`. Ingen backend, inget API och ingen migration ändras.
  - **Designkälla, färger, storlekar (RUN-146).** De fyra designfilerna ligger i repot (`RunQuest Web Prototype.dc.html` är nu hel, den var avkapad). Dämpade nivåfärger (bl.a. Heroic `#d97070`,
    Legendary `#e3c23e`), svagare glöd och en fjärde emblemstorlek `cp` (44 × 49 px, ikon 20): storlekarna är 28/44/56/96 px. Nivåchippet har en egen bakgrundstint (`--rq-badge-chip-tint`) så att alla sex nivåer klarar 4.5:1.
  - **Vimpeln som utmaningstecken (RUN-147).** Sköldarna för osända challenge-tokens är vimplar (svalstjärt) på Board och i Duels, med delad geometri (`shared/components/challengeMark.ts`).
    Minis står högerställda på podiet (`--rq-board-minis-inset`), och vimpel och minis delar aldrig behållare.
  - **Route och navigering (RUN-148).** `/badges` och "Badges" (ikon `shield`) i sidonavet under YOU. Mobilnaven är oförändrad; mobilens ingång är "All badges →" på profilen.
  - **Byggstenarna (RUN-149).** `buildBadgeSummary`, `useShowcaseDraft` (utkast + spara), liggande `BadgeSeriesCard` med växlare och `BadgeEmblemDetail` (44 px-emblem som öppnar en popover med nivå och krav).
  - **Badges-sidan (RUN-150).** ON DISPLAY-remsa med SAVE DISPLAY / SAVING… / SAVED, ett kort per serie med Show / On display — N / Locked, "3 of 3 on display — remove one first." och tillstånden laddar/tomt/fel.
    Den separata väljaren är borttagen (`ShowcasePicker`, `ShowcaseSlots`, `showcasePickerId`). Ingen global procent någonstans, bara "Held by X of N in your pack".
  - **Profilen (RUN-151).** Kompakt `BadgeSummary` (intjänade som 44 px-emblem på nivå, låsta under en hårlinje) med "All badges →"; `BadgeCollection` är borttagen. Mobilprofilens hjältekort har inga minis; desktop behåller dem.
  - **Runner card (RUN-152).** Kompakt `BadgePanel` (bara emblem, popover för detaljer) bredvid Head to head i det nedre rutnätet (desktop), efter TITLES på mobil.
- **Login som popup (RUN-145).** Inloggningen är en dialog (`LoginDialog`) över Landing på `/login` i stället för en egen sida (`LoginPage`/`LoginScreen` borta); `?next=` bevaras.
  Log out (AvatarMenu) går till startsidan `/` utan dialog. ADR 006, addendum 2026-10-11.
- **Cachen rensas vid inloggning, utloggning och 401 (RUN-143).** `AuthProvider` anropar `queryClient.clear()` vid login, logout och `onUnauthorized`, så att förra användarens data (badges, grupp, users-with-runs, sett-listan, news) aldrig visas för nästa. Ingen loop: `clear()` startar ingen omhämtning.
- **Tre nya titlar i kategorin Weather (RUN-91).** Stormborn (flest rundor med vindbyar på minst 12 m/s, `stormRunCount`), Iceborn (flest rundor vid 5 °C eller kallare,
  `coldRunCount`) och Winter Warrior (flest km under vintern 1 december–28/29 februari; utanför vintern räknas senast avslutade vinter, `winterKm`/`winterWindow`).
  Titelramverket fick väder i `RunData` och `ctx.now`; väder hämtas nu även för användare utan grupp, och titlarna räknas om efter väder-backfill. Migration 037 lägger
  till de tre raderna (prod har 20 titlar före). Playbook förklarar säsongstitlarna.
- **Nivåtabellen via backend (RUN-110, RUN-111).** `GET /api/config/levels` ersätter frontendens direktläsning av `level_requirements`, så att anon-läsningen kan stängas.

### Ändrat
- **Strava-rundor är skrivskyddade (RUN-139).** `PUT` och `DELETE /api/runs/:id` svarar 409 `Strava runs are read-only` för `source = 'strava'` (Strava är sanningskällan för
  distans och datum). Profilens rundrad har en View-knapp i stället för Edit, och arket heter "Run details" och har ingen Save. Delete-spärren satt tidigare bara i UI:t.
- **`start_time` tolkas som lokal väggklocka (RUN-106, RUN-107).** Strava-importen lagrar `start_date_local` med ett falskt Z. Nya `wallClockToInstantMs` i shared ger
  det verkliga ögonblicket (Europe/Stockholm, sommartid hanterad); väderfönstrets ålder räknas därifrån, Board-raden "x h ago" var 1–2 h fel och är rättad, och
  frontendens datumläsning av titelvärdet `lastRunOfWeek` (`titleFormat.ts`, motorn är oförändrad) glider inte längre till nästa dag i zoner öster om UTC. Klockslagsmotorerna (Early Bird, Night Owl, lunch) och badgeserierna läser väggklockan
  oförändrad och konverterar aldrig; kontraktstester vaktar att ingen "fixar" dem. Rundor utomlands får fortfarande en "x h ago" som är fel med tidszonsskillnaden.
- **Titelomräkning är gruppavgränsad och fail-closed (RUN-104):** `processAllUsersTitles` räknar bara om användarens egen grupp.
- **News tål okända händelsetyper (RUN-138):** en rad med en typ klienten inte känner kraschar inte längre News; den filtreras bort men kvitteras av "Mark all read".

### Tekniskt
- Städning (RUN-105): `supabase-js` borttagen ur frontend (inloggningen är backend-JWT), `triggerManualSync` och död kod borta, `createRun` skickar inte `source`.
- Dokumentation (RUN-108): ADR 009 (Godkänd), STATE.md, permissions, README:er för badges, news och claude-design.
- Versionsbump till 0.6.0 (rot och frontend), `changelog.json` med "What's new"-popup.
- Städning efter badge v2 (RUN-153): README:erna för badges, profile och claude-design pekar på det byggda, spec V2.12 markerar alla vyer BYGGD, och "What's new" beskriver badges-sidan, den kompakta profilen och Runner card, vimpeln och login-popupen.
  Tokens och CSS som spec V2.7 listade (`--rq-badge-grid-cols`, `--rq-badge-pick-clear`, väljar- och samlings-CSS) var redan borttagna i RUN-150/151; ingen kvarvarande badge-token eller badge-klass saknar läsare.

### Prod-steg (kräver ägar-ja var för sig, ordning enligt STATE.md)
1. Migration 035 (`user_badges`, `displayed_badge_series`) — redan applicerad 2026-10-11.
2. `backfill:badges`: dry-run, sedan `--apply` med dry-run-rapporten som underlag, FÖRE deployen av backend (efter deployen: `--apply --silent`).
3. Deploy av release/v0.6.0 (backend med motorerna `stormRunCount`, `coldRunCount`, `winterKm` måste ligga före titelraderna).
4. Migration 036 (`badge_earned` i `activity_log_type_check`) direkt efter deployen — avsiktligt efter, eftersom v0.5.3-frontendens News kraschar på okända händelsetyper; badge-news för nivåhöjningar i fönstret skrivs aldrig. Öppna flikar från v0.5.3 laddas om. Rollback av frontend till v0.5.3 efter att badge_earned-rader finns kräver att de raderas (ägar-ja).
5. Migration 037 (titelraderna) efter deployen och DIREKT därefter tyst omräkning (annars kan en vanlig skrivning hinna ge title_unlocked för de nya titlarna): `POST /api/titles/reprocess-all` (`emitNews: false`).
6. Migration 040 (stäng anon-läsning av `level_requirements`, RUN-112) först när v0.6.0 är live. Filen ingår inte i release/v0.6.0 och skrivs separat.
7. Redan applicerat 2026-10-11 som säkerhetshotfix (ägar-ja): 038 stänger alla RLS-policyer för Supabase-Auth-sessioner (users-tabellen med email och password_hash var läsbar för en Supabase-session), 039 stänger anon-läsning av `title_leaderboard_view` (namn, kön, titelvärden) och signup-triggern `on_auth_user_created`.

### Rollback (beslutas av ägaren; snabbast först)
1. **Kod:** Railway → respektive tjänst → Deployments → välj den senaste v0.5.3-deployen → Redeploy (frontend och/eller backend). Därefter en PR som revertar merge-commiten på main, så att nästa push inte deployar v0.6.0 igen.
2. **Ordning:** frontend först om felet syns i UI:t, backend först om API:t felar. Backend v0.5.3 tål 035–037 (additiva; okända `metric_key` hoppas över med varning).
3. **Data före frontend-rollback:** finns `badge_earned`-rader (efter 036) måste de raderas innan v0.5.3-frontenden tas tillbaka, annars kraschar News: `delete from activity_log where type = 'badge_earned'` (ägar-ja).
4. **Migrationer:** 036 och 037 kan ligga kvar vid kodrollback. 037 kan tas bort med den kommenterade SQL:en i filhuvudet om titlarna måste bort. 035/038/039 rullas inte tillbaka (additiva respektive stängningar).
5. **Efter 040:** v0.5.3-frontenden läser `level_requirements` direkt — en frontend-rollback efter 040 kräver att policyn öppnas igen (anges i 040:s huvud när filen skrivs).

## v0.5.3.2 — Alla CSS-overrides som avgjordes av laddningsordningen (2026-10-07)

### Fixat
- Uppföljning av v0.5.3.1 (PR #23). En genomgång av alla `className` i TSX mot alla CSS-regler (specificitet och den faktiska ordningen i bygget)
  hittade fler enkla klasser som skulle åsidosätta delade `.rq-*`-primitiver på samma specificitet och därför förlorade i produktion, eftersom
  feature-CSS i huvudbunten laddas FÖRE `index.css`. De är nu sammansatta selektorer, så specificiteten avgör:
  - app-shell: `.rq-pill` (gap, padding, letter-spacing mot `.rq-chip`) och `.rq-header__avatar`
  - board: stapelhöjderna (`.rq-board-track`, `--thin`, `.rq-board-streak__track`) mot `.rq-track` (6 px)
  - duels: hairgrid-cellerna (`how__item`, `record__cell`) mot `.rq-cell`
  - landing: titelns letter-spacing mot `.rq-display-xl` (desktop-`@media` följer med)
  - runner: ringhålet, Frodo-stapeln och statkortet
  - profile: fotoknappens disabled-färg vid hover mot `.rq-btn--ghost:hover`
  - whatsNew: eyebrow-färgen (samma värde i dag; följer annars eyebrow-experimentet)
  - duels/events: den egna raden — hover vinner fortfarande, nu uttryckligen (`:not(:hover)`)
- Lazy-sidorna (admin, changelog, playbook, settings) vann bara för att de laddas sist; samma sammansatta selektorer, ingen synlig ändring.

### Tekniskt
- Filhuvudena som påstod "ligger utanför @layer så att klasserna vinner" är rättade.

## v0.5.3.1 — Log- och Profile-overrides som förlorade mot primitiverna (2026-10-06)

### Fixat
- Tailwind 3 plattar ut `@layer` i bygget, och Log/Profile ligger i huvudbunten, så `log.css`/`profile.css` laddas FÖRE `index.css`. Enkla klasser
  med samma specificitet som de delade `.rq-*`-primitiverna förlorade därför (PR #21). Nu sammansatta selektorer:
  - Log: padding på väntekortet (`.rq-card.rq-log-pending`); `.rq-log-run__name` dubblerade `.rq-name` (`font: inherit` förlorade) och återställer nu bara knappen
  - Profile: statkortets och historikens padding (`.rq-card.…`), stapelhöjden 9/11 (`.rq-track.rq-profile-track`) och ringhålets inset 7
    (`.rq-ring.rq-profile-ring > .rq-ring-hole`)

### Tekniskt
- READMEs för Log och Profile och filhuvudena beskriver nu den verkliga CSS-ordningen i stället för "utanför @layer".

## v0.5.3 — Storm Chaser kräver riktig blåst, tydligare eyebrows (2026-10-06)

### Ändrat
- **Storm Chaser (issue #19):** prognosanropet i `eventService.checkStormChaserForecast`
  skickar `wind_speed_unit=ms`. Tidigare kom byarna i km/h och jämfördes mot 15, så
  tröskeln var 15 km/h (≈ 4 m/s, en vanlig bris). Nu krävs minst 4 dagtimmar med byar
  ≥ 15 m/s (≈ 54 km/h), som koden alltid menat. Regelvägen (≥ 3 timmar nederbörd) är
  oförändrad. Nytt backendtest `stormChaserForecast.test.ts`; Playbook-texten och
  `playbookFacts` följer med (ägarbeslut 2026-10-06).
- **Eyebrows** (`.rq-eyebrow` och News dagrubrik) läser nya `--rq-text-eyebrow`
  (= `--rq-text-4`, .50) i stället för `--rq-text-5` (.28). Ägarexperiment — backas
  genom att peka token på `--rq-text-5`.

- **Rundornas väderdata i m/s** (ägarbeslut 2026-10-06): `WeatherService` hämtade
  vinden utan enhet, så `run_weather.wind_speed_ms`/`wind_gusts_ms` innehöll km/h.
  Forecast- och archive-anropen skickar nu `wind_speed_unit=ms`, och varje skrivning
  sätter `fetched_at`. De 318 befintliga raderna räknas om en gång efter deploy med
  `npm run convert:wind-ms -- --before=<deploytid> --apply --backup=<fil>`
  (`scripts/convertWindToMs.ts`: torrkörning som standard, säkerhetskopia före skrivning,
  omräknade rader flyttas över gränsen så att ingen rad delas två gånger).

## v0.5.2 — Restsidorna i ny design, Feature & Version och versionsmekanik (2026-10-06)

### Nytt
- **Playbook** omskriven i designspråket (`features/playbook/`) och faktagranskad mot
  koden: XP-tabellen och exemplen räknas ur de regler som gäller (`GET /config/xp`, standard
  som reserv), event- och titelfakta låses av `playbookFacts.test.ts` som läser
  backendens källfiler. Beskriver spelet som det är; regeländringar (issue #19 Storm
  Chaser, minimidistansen) väntar på ägarbeslut.
- **Settings, Admin och inloggningen** omritade (`features/settings/`, `features/admin/`,
  `features/auth/`) med delade formulärdelar i `shared/components/form/` (TextField,
  FormNotices). Admin stoppar ogiltig streaktrappa före Save och behåller spärren mot
  att spara innan inställningarna lästs in. Inloggningen har en permanent alert-region
  och låser fälten med readOnly + aria-disabled medan den skickar.
- Tokensektioner 1.29–1.32 (`--rq-login-*`, `--rq-settings-*`, `--rq-admin-*`,
  `--rq-playbook-*`); `src/test/designGuards.ts` samlar de gemensamma designvakterna.
- **Feature & Version-sidan** omritad i designspråket (flikarna Features · Working on ·
  Releases, `?view=`); versionsnumret och datumet överst kommer ur changelog.json i
  stället för att vara hårdkodade, och mobilvyn är härledd ur Web Prototypens skärm.
- **"What's new"-popupen** omritad (Radix Dialog, en guldknapp "Got it"); ersätter
  den gamla lucide/tailwind-modalen.
- **Versionsvakt i CI:** `scripts/check-versions.mjs` fäller bygget om rotens och
  frontendens `package.json`, översta rubriken i den här filen (dess tre första delar)
  och changelog.json inte stämmer överens (ordning, semver, rubriker, `announce`).
  Användarversioner har tre delar (`0.5.2`), interna fyra (`0.5.0.1`).

### Ändrat
- Settings sa att bara Strava-typen Run importeras (och nya texten att löpband måste loggas
  för hand); koden importerar Run, Trail Run och Virtual Run, löpband inräknat. Texten
  läser nu samma konstanter som Playbook (`playbookFacts.ts`) och låses av faktatestet.
- Admin: det påhittade fältet "Min km for streak" är borttaget (streaken har ingen
  distansgräns); `min_run_distance` heter "Min km for base XP". Playbook nämner att en
  duell-boost är undantaget från "samma distans, samma XP".
- `apps/frontend/src/data/changelog.json` är nu ENDA källan för det gruppen ser:
  `{ features, workingOn, releases }`. Posterna har valfritt `announce: true`;
  onboarding-kön och popupen läser annonserade poster därifrån (slug
  `patch_v<version>`). `features/onboarding/patchNotes.ts` och
  `shared/utils/changelogHelpers.ts` är borttagna. Poster för 0.5.0–0.5.2 ifyllda;
  bara 0.5.0 (redesignen) annonseras.
- Onboarding: ett misslyckat "sedd"-anrop (`/onboarding/mark-seen`) stänger popupen/touren
  ändå och kön går vidare i sessionen (posten visas igen nästa gång); "Got it" kan inte
  dubbelklickas. Versionsvakten stöder inte förreleaser (`-rc.1`) och ignorerar rubriker i kodstaket.
- `package.json` (rot + frontend) hade 0.0.x — satta till 0.5.2 så att de följer
  användarversionen enligt docs/dokumentation.md.

## v0.5.1 — Användarrelease: 0.5.0.1–0.5.0.4 (2026-10-05)

Rullar ihop de interna versionerna 0.5.0.1–0.5.0.4 till en användarversion (changelog.json 0.5.1,
ingen popup): appen behöver inte cache-rensas efter uppdateringar, olästa nyheter har en guldprick och
mobilens Board visar alla titlar och XP-progress. Se de fyra interna posterna nedan för detaljerna.

## v0.5.0.4 — runquest.dev skickas vidare till www (2026-10-05)

### Ändrat
- Apex-domänen `runquest.dev` omdirigeras till `www.runquest.dev` via `Caddyfile` (PR #18).

## v0.5.0.3 — Städrunda + olästmarkör (2026-10-05)

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

## v0.5.0.2 — Alla titlar på mobilens Board (2026-10-05)

### Ändrat
- Mobilens Board visar nu alla visade titlar (upp till tre) på en egen rad
  under namnet, på alla placeringar. Tidigare syntes bara den första titeln på
  pallen och ingen alls från plats 4.
- Korten från plats 4 visar nivå och XP i nivån mot vad nivån kräver, som
  pallkorten.

## v0.5.0.1 — Ingen gammal cachad app efter deploy (2026-10-05)

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

## v0.5.0 — Redesignen (2026-10-05)

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
