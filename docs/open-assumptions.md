# Öppna antaganden

Gäller hela appen. Lead underhåller. En rad per antagande: vad som antagits, var det bor, och vad som skulle göra det fel. Antaganden som blivit beslut
flyttas till STATE.md/ADR; backend-kontraktsfrågor samlas längst ned. Avgjorda punkter tas bort härifrån och står kort under Historik.

## Events (inkrement 6)
- "Your record" aggregeras i klienten: historiken läses i sidor om 50 (max 10
  sidor, trunkering loggas med console.warn). Blir fel den dag en grupp passerar
  500 avslutade event — ett aggregat-endpoint är rätt lösning på sikt.
- Event som avslutades innan en medlem gick med räknas som "missade" i facit
  (datan saknar inträdesdatum). Överdriver "left on the table" för sena medlemmar.
- Nedräkningsringens fyllnad = andel av fönstret som återstår (prototypens 62 %
  är hårdkodad och har ingen semantik).
- "Up next" = det event som öppnar först, oavsett typ; resten hamnar i This week.
- Ett event räknas som öppet efter klockan, inte efter `status` (cron flyttar
  scheduled→active var 5:e min). Skal och skärm delar regeln via eventPhase.
- Historik-pagern navigerar med `replace: true` — webbläsarens Back lämnar
  /events i stället för att stega sidor. Medvetet val (sidorna är inte egna
  platser i historiken).

## Duels (inkrement 5)
- Progress hämtas per live-duell (`/challenges/:id/progress`) — ingen
  batch-endpoint. Fel lämnar kortet utan värden, inget felkort.
- Head-to-head-tips i send-sheeten = en query per gruppmedlem (delar cache och
  nyckel med Runner card). OK för små grupper, skalar inte till stora.
- "My matches" filtrerar client-side bara de sidor som hunnit laddas.
- Boost-bakgrunden ("Won against …") hämtas ur de 20 senaste i `/challenges/my`;
  saknas den utelämnas raden.
- Insatser/straff läses ur data (token/utmaning/historikrad); `DEFAULT_STAKES`
  (= seed i migration 006) används bara när exempel saknas för en nivå.

## Titles (inkrement 4)
- Kategorierna är en ren frontend-mappning på `metric_key` med "Other" som
  reserv — nya motorer utan mappning hamnar i Other (driftvakt-test läser
  backendens titleEngines från disk).
- Tre placeringar väntar på ägarbeslut: The Finisher (Time of day?),
  The Commuter (Consistency?), The Hamster (Volume?).

## Log (inkrement 7)
- Estimated XP räknar inte med aktiva utmaningsboostar (servern lägger på dem
  vid sparande; kortet säger det) och visar inte bakdaterings-kaskaden (en
  runda som fyller ett glapp räknar om senare rundors streak/XP).
- Streakdag och ranking i förhandsvisningen räknas ur users-with-runs med
  backendens regel (logModel ekvivalent med reprocessRunsFromDate, testat).
- Group history: 10 per sida (prototypen 5), staleTime 0 så Profile-edit/delete
  inte lämnar gamla rader. Guldkant = min egen runda; underlag NULL (äldre
  manuella) ger ingen chip; "min runda" avgörs via user_id-jämförelse.
- Manuella outdoor-rundor skickar explicit `is_treadmill: false` (ADR 007
  addendum 12 — numeriskt inert tills manuella rundor får höjddata).

## Profile (inkrement 8)
- Profilbildsraden i hjältekortet är ett tillägg — prototypen har ingen yta för
  uppladdning (gamla flödet var dessutom onåbart). Ägaren kan flytta kontrollen.
- Heatmapens intensitetssteg = dagens km: 0 / <5 / 5–10 / 10–15 / 15+ (följer
  distansbonusarna; prototypens data var påhittad). En vecka tillhör månaden
  där måndagen ligger; månadsetiketten speglar verkligt antal ritade block.
- "Longest streak" i heatmapen är användarens rekord (inte fönstrets);
  "Longest gap" räknar bara avslutade uppehåll.
- Alla stats härleds klient-side ur users-with-runs (hela rundlistan finns
  redan i payloaden; GET /users/me/stats ej aktuell än).
- En runda kan bara ändras på datum och distans (servern tar inget annat).
- Strava-rundor: Delete är avstängd (title + sr-only enligt Titles valknapp) och en synlig rad med samma text
  (`aria-hidden`) lades till i redigeringsrutan så att touch-användare ser förklaringen — det ligger utanför det
  Lead bad om. Ägaren kan ta bort raden. `source` null/saknas behandlas som manuell.

## Pack News (inkrement 9)
- **"Mark all read" är den enda kvitteringen** (prototypen: knappen finns i både popover och skärm, inget i designen kvitterar vid
  besök/öppning). Att öppna popovern eller besöka /news markerar alltså INTE som läst — olästa rader förblir tintade tills knappen
  trycks. Vill ägaren ha "besök = läst" är det en rad i NewsScreen (kvittera vid mount/unmount).
- **Filtret:** `?type=` bär chip-nycklar (`titles,levels`), inte rå `ActivityType` — ADR 006 säger bara "kommaseparerat". Flera chips
  kan vara valda; alla sex (Badges eget chip sedan v0.6.1) = inget filter. Mobil har en chip-rad (App Prototype saknar filter; Web Prototype har ett statiskt kort
  med räknare — gjort klickbart). Chip-räknaren är antal i det laddade, ofiltrerade fönstret (ADR 008), inte serverns totaler.
- **Popover = samma flöde som skärmen** (en query-definition, 30 rader initialt i stället för `limit=5`; popovern visar de fem
  översta). Poll 2 min + fönsterfokus (ADR 008 nämner 60 s). Oläst-badgen cappas vid "99+".
- **Dag-grupperna:** Today · Yesterday · Earlier this week (mån–sön, Stockholm) · därefter en grupp per dag ("Fri 2 Oct").
  Raderna ordnas på `occurred_at`, inte id (en backfillad rad kan ha högt id men gammal dag).
- **Texterna** använder förnamn (som prototypen) — två medlemmar med samma förnamn skulle bli tvetydiga. "You"/"you" när den som tittar
  är aktör/mål. `event_closed` för tävlingar namnger vinnaren ur users-with-runs-cachen (payloaden har bara id). "…boost is live"
  visas bara för dagsboostar som faktiskt pågår; körboostar (`multiplier_runs`) får ingen "live"-claim. Streak-texten
  "multiplier back to 1.0×" är prototypens. Titelvärden formateras med Titles-skärmens `titleValueText`.
- Popoverns prick/typrad är röd för en förlorad utmaning (Web Prototypens popover), orange på skärmen (båda prototyperna).
  Olästa rader har guldtint i popovern också (prototypens data har `unread` men markupen använder den inte).
- Raderna är inte klickbara (prototypens desktop-hover antyder det men anger inget mål).
- Katastroffall: fler nya rader än fem catch-up-sidor à 100 → flödet ersätts av de nyaste 500 (inget hål i mitten).

## Landing (inkrement 10)
- **Web Prototype har ingen landing.** Desktop (≥ 1024 px) är samma komposition som mobilens med större yta (text | arena-bana i hjälten,
  preview | steg bredvid varandra, vänsterjusterad logga, max 1120 px). Måtten är antaganden i temafilens sektion 1.27. Skulle ägaren rita en
  desktop-landing ersätter den detta.
- **"Create your pack — free" är borta.** Det väntar på multi-grupp (ägarbeslut 4), så den enda guldknappen är "Sign in to your pack" → /login och
  sidan säger "Starting your own pack is coming soon." Sekundärknappen "See how it works" hoppar till stegen. Planens rekommendation ("kontakta
  ägaren") kräver en kontaktväg som inte finns — ingen e-postadress lagd på en publik sida. Ägaren väljer om en riktig kontaktlänk ska dit.
- **Siffrorna är påhittade:** 14 packs · 128 430 km · 9 412 runs · 1 284 600 XP (prototypens). "14 packs running" är sant bara som exempel — det finns
  en grupp i dag. Ägaren kan välja bort märket eller byta siffrorna (`features/landing/landingModel.ts`).
- **Previewn är anonymiserad på ett annat sätt än prototypen:** prototypens namn (Karl, Joel, Adam …) ser ut som den riktiga gruppen, så previewn
  återanvänder i stället den påhittade flocken från `/preview` (Anna, Erik, Maria …; bara förnamn) och kortet heter "Sample pack" i stället för
  "Wolfpack · week 34". Kortets "Live"-etikett och pulsen är prototypens liv-signal, inte en påstådd livedata.
- **How it works följer spelets verkliga regler (ägarbeslut 1), inte prototypens copy:** streak-steget säger "från dag 5 (×1.1) upp till ×2.0 vid dag
  270, miss a day and it starts over" (prototypen: "up to 2× … resets to 1×"). Siffrorna läses ur shared-standardvärdena
  (`DEFAULT_ADMIN_SETTINGS`, `DEFAULT_STREAK_MULTIPLIERS`); ändrar admin inställningarna i databasen följer texten inte med (Landing gör inga anrop).
  "Miss a day and it starts over" är VERIFIERAT mot streak-motorn (critic 2026-10-05): ett glapp som inte är exakt en dag ger streakdag 1, och
  currentStreak (shared/streak.ts) ger 0 när senaste dag varken är idag eller igår — ingen grace-regel finns.
- **"+50 XP"-poppen ligger i banans mitt (text-anchor middle), inte där prototypen har den** (x 770 → 700): med den ursprungliga platsen klipptes
  texten av den klippta banrutan på desktop.
- **Banans löpare går med CSS offset-path på SVG-cirklar** (samma `rqOrbit` som stadion-laddaren) i stället för prototypens SMIL `<animateMotion>`, så
  `prefers-reduced-motion` stoppar dem. Silver- och bronsprickarna är heltäckande rankfärger (prototypen hade .75/.8 i alfa).
- **`App.tsx` kör `useAppInit` på alla routes, även `/` för utloggade — men utloggad gör den inget nätverksanrop.** Landing-FEATUREN anropar inget själv.
  `useAppInit` kör `useLevelRequirements`, som hämtar nivåtabellen via `GET /api/config/levels` (kräver token) först när en användare är inloggad
  (`enabled: !!user`, även efter SPA-inloggning); utloggad och vid fel gäller `FALLBACK_LEVEL_REQUIREMENTS`. Onboarding-prefetchen gör INGET nätverksanrop utan
  token (onboardingApi kastar utan token och prefetchen sväljer felet). [RÄTTAT efter RUN-110/111: tidigare stod här att appskalet gjorde ETT Supabase-anrop för `level_requirements` även för
  utloggade — frontend har ingen Supabase-klient längre, och gating på `user` är gjord. Migration 040 (RUN-112) tar bort den sista anon-policyn på `level_requirements`; anon läser därefter ingenting.]
- Inget `<title>`/meta per route och ingen statisk rendering av `/` (ADR 006 revisit-trigger om SEO) — sidan är en klientrenderad SPA-route.

## Restsidor: Playbook, Settings, Admin, Login (inkrement 11, spår B)
- **Playbook har nio kapitel (prototypens), inte de gamla sju flikarna.** Strava-fliken är inlagd i "What counts as a run"; Levels-tabellen och Titles
  finns kvar. **Regel: Playbook påstår bara det koden gör** — prototypens copy är en skiss och citeras inte. Kapiteltexterna är verifierade mot backend:
  minimidistansen gäller bara manuella rundor (1.0 km, `routes/runs.ts`), Strava-rundor räknas oavsett längd; base-XP betalas från konfigurationens
  `min_run_distance`; streaken räknar dagar med en runda (inget "qualifying run"); streaken multiplicerar base + km men inte distansbonusen; i utmaningar
  lottas tier, mått, längd och insats när TOKEN tjänas in vid nivåuppgång (`challengeService.ts`) — vid sändning väljer spelaren bara token och motståndare
  (texten är Rules-vyns egen, `HOW_IT_WORKS`). Frodo-kapitlet läser sträckan och de sju stora målen ur `frodoModel`.
- **Siffrorna i Playbook kommer ur `GET /config/xp`** (bas-XP, XP/km, distansbonusar, trappan, min distans) via `useXpConfig`, och räkneexemplen är
  shareds formel över samma konfiguration. Går den inte att läsa visas shareds standardvärden och sidan säger det (Retry). Nivåtabellen är shareds
  `FALLBACK_LEVEL_REQUIREMENTS` (identisk med prod): `PlaybookScreen` anropar `buildChapters(rules, undefined, stakes)` och får fallback-tabellen direkt.
  `GET /api/config/levels` finns sedan RUN-110 (bara inloggad) och app-skalet hämtar den (`useLevelRequirements`), men Playbook läser den inte — ändrar
  någon tabellen i databasen följer Playbook inte med.
- **Playbook beskriver spelet SOM DET ÄR i dag** (ägardirektiv 2026-10-06) — även buggar beskrivs som de beter sig; Lead registrerar buggen separat.
- **Event-siffrorna är redaktionella — ingen endpoint exponerar `event_templates`.** `GET /events` ger bara aktiva/schemalagda events (namn, min km, XP, men inte
  fönster, spawn-regler eller väderkrav), så fönster, krav och XP bor som en kopia i `features/playbook/playbookFacts.ts`. `playbookFacts.test.ts` läser backendens
  migrationer, eventService, eventScheduler och stravaSync och faller om siffrorna glider isär — men nya/borttagna event i databasen syns inte där. En
  `GET /events/templates` (eller att Playbook läser mallarna) vore en backend-uppgift. **Verifierat mot prod (Lead, read-only SQL 2026-10-05):**

  | Event (prodnamn) | Fönster | Min km | XP | Pool |
  |---|---|---|---|---|
  | Morning run | 05–09 | 3 | +25 | daily |
  | Evening run | 18–22 | 3 | +25 | daily |
  | Storm Chaser | heldag, kräver väder (rain/drizzle/storm) | 5 | +40 | daily |
  | 5K Friday | heldag | 5 | +25 | thursday |
  | Half Marathon Chaser | fre–sön | 10 | +25 | thursday |
  | Hangover Run | heldag | 3 | +30 | weekend |
  | Weekly km, Weekly elevation | 7 dagar, topp 3: 40/30/20 XP | – | – | weekly_competition |

  Namnen är engelska i prod (migration 025/029 seedar dem; 017/022 skrevs med "Morgonrunda"/"Kvällsrunda"/"Weekly höjdmeter" och testet slår upp siffrorna där med de gamla namnen).
- **Storm Chaser-tröskeln är 15 m/s (löst i v0.5.3, issue #19).** Före v0.5.3 hämtade `eventService.checkStormChaserForecast` Open-Meteo utan `wind_speed_unit`, så `>= 15`
  jämfördes i km/h (≈ 4 m/s). Nu skickas `&wind_speed_unit=ms` (ägarbeslut 15 m/s 2026-10-06); Playbook säger "gusts of 15 m/s (about 54 km/h)", och `stormChaserForecast.test.ts` + fakta-testet kräver parametern.
  Regeln i sin helhet: ≥ 3 stormiga timmar (väderkod duggregn/regn/snö/skurar/åska) ELLER ≥ 4 timmar med byar ≥ 15 m/s, dagtimmar 06–21 imorgon. `run_weather` hämtas också i m/s från v0.5.3; äldre rader räknas om av `scripts/convertWindToMs.ts` (gräns = deploytiden, via `fetched_at`).
- **Kvalificering:** ett deltagarevent kräver att eventet är öppet när rundan loggas/synkas och att rundans datum inte ligger efter eventets slut (inte rundans starttid); bara REDIGERING (PUT, `enforceRunDateWindow`) kräver datum inom eventets dagar — Playbook säger "log or sync a run while the event is open (the run’s date can’t be after the event ends)".
- **Strava:** synken räknar från en vecka före senast Strava-importerade rundan; en aktivitet med distans 0 sparas inte ("any distance above zero"). Intervallet är `SYNC_INTERVAL_MINUTES` (30) i stravaSync.ts.
- **Utmaningstokens:** enligt seeden (006) delas token ut vid nivå 3, 5, 8, 10, 12, 14, 15 och sedan vid varje nivå från 16 (major var 5:e, legendary vid 15/30/45) — inga tokens vid 2, 4, 6, 7, 9, 11, 13. Playbook säger "many level-ups at first and, from level 16, at every level-up".
- **Insatserna per utmaningsnivå är observerade, som Rules-vyn:** verkliga tokens/aktiva/inkomna/historiska utmaningar ur `GET /challenges/my` först (hämtas när
  utmaningskapitlet visas), `DEFAULT_STAKES` (seed, migration 006) bara för nivåer utan exempel. Har man inga tokens eller historik visas alltså seed-värdena.
- **Titellistan i Playbook och Admin är `GET /titles/leaderboard`** (samma rader som Titles, delad cache) — namn, regel och låsgräns ordagrant ur databasen,
  sorterade som Titles-skärmens kategorier. Admins gamla fyra hårdkodade titlar (och texten "hardcoded") är borta.
- **Settings: Notifications-kortet ur Web Prototypen är inte byggt** (backend saknar notisinställningar; "ingen ny funktion"). **Disconnect** finns i
  prototypen men inte i dagens UI (endpointen finns) — inte tillagd; en destruktiv knapp kräver ett ägarbeslut om bekräftelse. **Sync log** blir "Latest sync":
  backend har ingen historik, bara senaste försöket (`/strava/last-sync`). Mobilprototypen saknar Settings och Admin — mobil är härledd (en kolumn).
- **Settings: "Sync now" syns fortfarande bara för "Joel Lindberg"** (namnjämförelse, som före omritningen). Efter en synk hämtas alla aktiva queries om
  (`invalidateQueries()`) i stället för den gamla hårda omladdningen efter 2 s.
- **Admin: "Min run date" är skrivskyddat; "Min km for streak" är borttaget (2026-10-06).** Save skickade dem aldrig (datumet är en
  konstant i appen; streaken har ingen distansgräns, `routes/runs.ts`). `min_run_distance` styr bara bas-XP och heter därför "Min km for base XP". Vill ägaren
  ha ett streak-minimum eller redigerbart datum behövs backend-stöd. "Add member" saknar "6 of 30 seats used" (ingen sätesgräns finns).
- **Admin: ett tomt/ogiltigt fält OCH en trappa utanför 1–9.99 (högst två decimaler) stoppas före Save** (`findSettingsProblem`) — ingenting skickas, så
  grundinställningarna sparas aldrig halvt när trappan avvisas. Servern vaktar fortfarande samma gräns och dess 400-text visas ordagrant. Fältet får `aria-invalid` utanför intervallet.
- **Admin: läsfel är felkort med Retry** (inställningar/trappa, medlemmar, titlar) i stället för toast + tomt/standardvärden. Save är låst tills BÅDA läsningarna
  lyckats (`settingsLoaded`/`canSave`, oförändrat), nu med synlig förklaring. Alla toasts (Admin, Settings) är ersatta av permanenta status/alert-regioner.
  "Admin password" är fortfarande inte kopplat till backend (som tidigare) — svaret säger det i stället för att låtsas lyckas.
- **Inloggningen är ritad utan prototyp** (sedan RUN-145 en popup över Landing, inte en egen sida — `features/auth/README.md`) i Landingens språk (glöd, logotyp, hjältekort, Components-filens fält). Felet landar i en permanent `role=alert`-region
  (`FormNotices`, som övriga formulär) och fälten pekar på det; under pågående inloggning är fälten `readOnly` och knappen `aria-disabled` (inte `disabled`), så
  fokus aldrig tappas. `App.login.test` väntar på alert-textens innehåll (regionen finns tom från början). Ingen "Forgot password" (ingen funktion).
- **Formulärfält är 16/18 px** (`--rq-fs-stat-value`), inte Components-filens 19 px och inte `.rq-field`-standardens lead (17/22): prototypens Settings/Admin-fält är
  17 px på desktop, och 16 px på mobil hindrar iOS från att zooma in vid fokus.
- **Borttaget som dött:** `constants/streakConstants.ts` (Playbook var sista användaren), `shared/components/PageTabs.tsx` (shadcn-flikar, Playbook var sista
  användaren) och de gamla `XPSettings/UserManagement/TitleConfig/AdminSecurity`, `StravaSettings/PasswordSettings`.

## Skal & delat
- RÄTTAT 2026-10-04: Toastern ÄR monterad (AppProviders) och gamla `toast()`-
  anrop visas. Nya features använder ändå permanenta `role=status`-ytor —
  motivet är konsekvens och pålitlig uppläsning, inte att Toastern saknas.
- Feature-CSS i huvudbunten laddas före index.css (main.tsx-importordningen); de lazy-laddade sidornas CSS (Playbook, Settings, Admin, Features) laddas EFTER. Tailwind 3:s `@layer` blir vanlig CSS i bygget, så ordningen avgör vid lika specificitet — overrides av
  delade klasser kräver sammansatta selektorer (dokumenterat i
  features/challenges/README.md).
- `toLocaleDateString('en-GB', {month:'short'})` kan ge "Sept" i nyare ICU —
  nya datumformat använder egna månadsnamn (eventsFormat gör rätt; titleFormat
  använder en-GB och är stabil i test men kan skilja mellan miljöer).

## Backend-kontraktsfrågor
Lösta frågor står under Historik längst ned. Öppet och orört: en bakdaterad POST kan kvalificera ett pågående event (POST och Strava saknar dagsfönstret — bedömt som acceptabelt tills vidare).
1. `group-stats` flaggar `has_pending_challenge` bara för utmanaren — en medlem
   med inkommande väntande utmaning ser ledig ut i send-sheeten (400 visas
   graciöst). Vill ha: flagga även mottagarsidan.
2. `/events` säger inte vem som är klar på ett aktivt participation-event (bara
   participantCount/memberCount) — desktop-prototypens namnrad ("Karl ✓ …")
   kräver nytt fält.
3. Aggregat för events-facit (punkt 1 under Events) — `GET /events/record` e.d.
4. Typglapp i shared: `EventItem.metric` är `string` men backend skickar `null`
   för participation; `requiresWeather` är typad `string | null` men hanterades
   som lista i gamla UI:t. Rätta typerna i packages/shared (kräver
   data-inkrement, shared får inte röras i komponentinkrement).
5. Batch-endpoint för duel-progress (punkt 1 under Duels) — lågt prioriterad.
6. **Retractade news-rader** (avböjd/återkallad utmaning) försvinner ur
   klientens flöde först vid fokus/omladdning, inte vid poll (catch-up lägger
   bara till). Medvetet val i9c; läker vid window focus.

## Feature & Version + What's new (inkrement 11A)

- **changelog.json har ny form** `{ features, workingOn, releases }` (var en ren lista av releaser) så att sidans Features-/Working on-kort kommer ur samma fil som
  releaserna ("en källa"). Äldre poster är oförändrade. `docs/dokumentation.md` uppdaterad med formen.
- **Ändringstypen heter `bugfix`** (som prototypen och alla äldre poster), inte `fix` som dokumentation.md först skrev. Dokumentet rättat; versionsvakten kräver `bugfix`.
- **Versionsvakten kräver CHANGELOG.md-rubrik bara för användarversioner från dess äldsta rubrik (v0.5.0) och uppåt** — v0.1–0.4 finns bara i changelog.json.
  Vill ägaren ha dem även i CHANGELOG.md måste historiken skrivas in där. Ägarbeslut 2026-10-05: användarversioner har tre delar (0.MINOR.PATCH), interna fyra
  (0.5.0.1) och finns bara i CHANGELOG.md/git-taggar; package.json håller de tre första delarna av översta rubriken (docs/dokumentation.md).
- **Datumformatet behålls** ("5 October 2026", som "2 April 2026") — prototypen har "24 aug 2026", men befintliga poster väger tyngre; vakten kräver formen.
- **Features-listan är kuraterad mot dagens app**: "Dark mode" och "Onboarding" från prototypens exempeldata är borta (ljust tema är förberett men inte designat; touren är
  inte ett säljargument), och nya funktioner (Duels, Runner card, Pack News, Log runs) tillagda. Working on = Notifications (Badges flyttades till Features när de släpptes i v0.6.0).
- **Popupen har ingen prototyp** — härledd ur skalets delade modal (`.rq-modal`/`.rq-scrim`), Bebas-rubrik, hårlinjegrid för punkterna, en guldknapp. Fokus startar på "Got it".
- **Prototypens textsteg snappade till tokens**: kortrubrik 18 px → `--rq-fs-name` (20 på desktop), beskrivningar 16 px → `--rq-fs-body` (17 på desktop), release-datum 15 → `--rq-fs-meta`.
- **Alla som redan sett de gamla patchnotes (`patch_2026_04_02_*`) får 0.5.0-popupen en gång** — slugen `patch_v0.5.0` är ny. De gamla slugarna ligger kvar i tabellen, ofarliga.

## Badges (v2)

- **News-radens ikonkolumn är 30 px på mobil men övriga rader har 26 px** (spec §5: `--rq-badge-news-icon-w`, "när den bär ett sm-emblem"), så texten på badge-rader börjar 4 px längre in än på övriga rader. Tokenen heter `--rq-news-row-icon-badge-w` (news-vakten läser `--rq-news-*`; badges-vakten läser bara `badges.css`). Desktop 34 px = som övriga rader. Vill ägaren ha utlinjering bör `--rq-news-row-cols` (26 px) höjas till 30 px för alla rader.
- **Flavor-storleken är `--rq-fs-body`** (15 px mobil, 17 desktop): första `--rq-fs-*`-steget ≥ 14 px som inte är en knappstorlek (`--rq-fs-btn-sm` = 14 px finns men är en knappkonstant).
- **Skelettet är en loop (`infinite`)** — F8 anger `rqSkel` 1.6 s och det är en laddare som pulserar tills datan kommer. Vakttestet "inget infinite i badges.css" gäller bara emblemreglerna (undantag för `.rq-badge-skel`).
## Historik (avgjort, kort)
Punkter som stod som öppna och sedan avgjorts. Detaljerna finns i CHANGELOG.md och ADR:erna.
- **`['events']` invalideras när en runda loggas** — löst i inkrement 7 (`useCreateRun` invaliderar direkt och en gång till efter 4 s).
- **Edit-datumets max mot serverns UTC-"idag"** — löst i i9-dataspåret (servern validerar Stockholm-dagen och avvisar ogiltiga kalenderdagar).
- **`/login` som den gamla inloggningssidan** — omritad i inkrement 11, sedan en popup över Landing (RUN-145, ADR 006 addendum).
- **Backend-kontraktsfrågor löstes i i9-dataspåret 2026-10-05:** `source` i users-with-runs (Strava-rundor kan inte raderas; null = manuell), PUT kvalificerar event med dagsfönster (DELETE medvetet utan anrop, svarar 409 för kvalificerande rundor), Stockholm-datumvalidering.
- **Utgången eller ogiltig JWT gav 403** — nu 401 (`middleware/auth.ts`), så klienten loggar ut.
- **Init-loggen skrev service-nyckelns prefix** — loggar nu bara "set"/"missing" (`config/database.ts`).
- **Logout rensade inte användarspecifika query-cachar** — löst i RUN-143 (v0.6.0): `AuthProvider` kör `qc.clear()` vid login, logout och 401 (`AuthProvider.test.tsx`).
