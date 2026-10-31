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
- **Att öppna popovern eller besöka /news kvitterar ingenting** (prototypen: knappen finns i både popover och skärm, inget i designen kvitterar vid
  besök/öppning). Sedan v0.7.0 finns två kvitteringar: "Mark all read" (allt på en gång) och läs-gesten per rad (mus över raden efter verklig rörelse, tryck, eller Enter/Space; fokus ensam räknas inte, ADR 011 addendum 2026-10-14).
  Olästa rader förblir tintade tills någon av dem används. Vill ägaren ha "besök = läst" är det en rad i NewsScreen (kvittera vid mount/unmount).
- **Filtret:** `?type=` bär chip-nycklar (`titles,levels`), inte rå `ActivityType` — ADR 006 säger bara "kommaseparerat". Flera chips
  kan vara valda; alla sju (Badges eget chip sedan v0.6.1, Ranks sedan v0.7.0) = inget filter. Mobil har en chip-rad (App Prototype saknar filter; Web Prototype har ett statiskt kort
  med räknare — gjort klickbart). Chip-räknaren är antal i det laddade, ofiltrerade fönstret (ADR 008), inte serverns totaler.
- **Popover = samma flöde som skärmen** (en query-definition, 30 rader initialt i stället för `limit=5`). Sedan v0.7.0 visar popovern de fem senaste raderna vars
  slag är påslaget, utan egna handlingar (ADR 011 beslut 3), filtrerade i klienten ur de 30 inladdade; är alla filtrerade bort visas "Nothing new for you" + länken till /news.
  Poll 2 min + fönsterfokus (ADR 008 nämner 60 s). Oläst-badgen cappas vid "99+".
- **Dag-grupperna:** Today · Yesterday · Earlier this week (mån–sön, Stockholm) · därefter en grupp per dag ("Fri 2 Oct").
  Raderna ordnas på `occurred_at`, inte id (en backfillad rad kan ha högt id men gammal dag).
- **Texterna** använder förnamn (som prototypen) — två medlemmar med samma förnamn skulle bli tvetydiga. "You"/"you" när den som tittar
  är aktör/mål. `event_closed` för tävlingar namnger vinnaren ur users-with-runs-cachen (payloaden har bara id). "…boost is live"
  visas bara för dagsboostar som faktiskt pågår; körboostar (`multiplier_runs`) får ingen "live"-claim. Streak-texten
  "multiplier back to 1.0×" är prototypens. Titelvärden formateras med Titles-skärmens `titleValueText`.
- Popoverns prick/typrad är röd för en förlorad utmaning (Web Prototypens popover), orange på skärmen (båda prototyperna).
  Olästa rader har guldtint i popovern också (prototypens data har `unread` men markupen använder den inte).
- Raderna har inget länkmål (prototypens desktop-hover antyder det men anger inget mål). Sedan v0.7.0 är en rad en knapp som markerar den läst (ADR 011 addendum 2026-10-14); får raden en annan primär åtgärd krävs ett nytt beslut om hur aktiveringen delas.
- Katastroffall: fler nya rader än fem catch-up-sidor à 100 → flödet ersätts av de nyaste 500 (inget hål i mitten).

## Landing (inkrement 10, uppdaterad v0.6.2)
- **Desktop är nu ritad** (Landing-designen, 1440 px: `docs/design/claude-design/RunQuest Landing.dc.html`, rutan "Landing page"). Mobil = App Prototypens landing
  (390 px). Måtten ligger i temafilens sektion 1.27 (desktopvärdena är designens). Avvikelser från designen, alla ägarbeslut 2026-10-13: knappar (en guldknapp,
  "Join the waitlist"), siffror (sanna, se nedan), exempelgruppen ("Sample pack"), footern och funktionsrutnätet (se de följande raderna).
- **Siffrorna är sanna:** "4 551 km logged · 6 runners · 4 challenges" kommer från `GET /api/public/stats` (landningens enda anrop, ADR 006-addendum 2026-10-13).
  Ingen uppräkning, inga reservsiffror: laddar visas "—" (aria-busy); vid fel står raden kvar osynlig (aria-hidden, visibility: hidden) med samma höjd, så ingenting flyttas (ADR 006-addendum 2026-10-19, ägarbeslut B). "Packs running" visas först när grupperna är fler än en.
  Svaret cachas i backenden i 5 min (`PUBLIC_STATS_TTL_MS`); klienten speglar tiden i `PUBLIC_STATS_MAX_AGE_MS` (shared) och hämtar en gång per sidvisning.
- **Exempelgruppen är påhittad och märkt "Example", inte "Live":** kortet heter "Sample pack" och återanvänder den påhittade flocken från `/preview`
  (Anna, Erik, Maria …; bara förnamn). Designens "Wolfpack · week 34", "Göteborgsvarvet", nedräkningen och foten "Next event" är borta. Guldringen och sweepen
  behålls som designens uttryck för ett levande kort, inte som påstådd livedata. Den tredje förklaringen ("Events give easy XP — recurring events open on a
  schedule; join one and the XP lands on the board") ersätter designens nedräkningsförklaring; **ägaren bekräftar copyn i previewn** (liksom ingressen).
- **Ingressen:** desktop har designens långa text ordagrant, mobil den korta.
- **How it works följer spelets verkliga regler (ägarbeslut 1), inte designens copy:** streak-steget säger "från dag 5 (×1.1) upp till ×2.0 vid dag 270, miss a day and
  it starts over" (designen: "up to 2× … resets to 1×"). Siffrorna, och XP-formelns termer ("BASE 15 + KM × 2 + DISTANCE BONUS × STREAK 1.0–2.0×") och exempelrunda
  (10 km → +50 XP), läses ur shared (`DEFAULT_ADMIN_SETTINGS`, `DEFAULT_STREAK_MULTIPLIERS`, `calculateRunXP`); ändrar admin inställningarna i databasen följer
  texten inte med (landningen läser inte admin-inställningarna). Formeln finns även på mobil (designens mobilruta saknar den) och har en textversion för skärmläsare.
  "Miss a day and it starts over" är VERIFIERAT mot streak-motorn (critic 2026-10-05): ett glapp som inte är exakt en dag ger streakdag 1, och
  currentStreak (shared/streak.ts) ger 0 när senaste dag varken är idag eller igår — ingen grace-regel finns.
- **Funktionsrutnätet:** Strava-kortet säger att rundor kommer när de sparas, med en reservkontroll var 12:e timme (`stravaPollIntervalLabel()` i shared, prövad mot konstanten), inte designens "three hours"; Journey-kortet
  säger "mapped", inte "walked". Events-kortets exempel (morning runs, 5K Fridays, hangover runs) finns i seedade mallar (migration 017); **Lead kontrollerar mot prod.**
  Rutnätet finns även på mobil (en kolumn).
- **Footern:** Privacy och Legal (→ `/legal`), Strava-attribution och versionen (`v` + `version` i `apps/frontend/package.json`). Playbook, FAQ och Bug report är borta
  (inloggade sidor och ingen FAQ finns). Stravas "Compatible with Strava" visas oförändrad i footern, vit på mörk botten och svart på ljus (`data-theme="light"` kan
  nås av den som valt ljust tema i appen och sedan loggat ut).
- **Väntelistformuläret finns i den förrenderade HTML:en men är `inert` tills komponenten har hydrerats** (`LandingWaitlist.tsx`, kommentaren på rad 36-37 och attributet på rad 97): före hydreringen går inget att skriva eller skicka, så ingenting ifyllt skrivs över av tomt state och Enter i fältet ger ingen nativ GET-submit som laddar om sidan.
- **Mobilens header** har Sign in som konturknapp bredvid wordmarken (designens mobil hade den under hjälten). Wordmarken är ingen länk (en tabbstopp till samma sida).
- **Rutnätet `rqGrid`** ligger över hela sidan även på mobil (designens mobilram har det inte), och reducerad rörelse stoppar det.
- **Desktopbanans "+XP"-text** följer ovalens lutning (−31°) som i designen; mobilens text (−72°) vrids tillbaka och läses upprätt (som före v0.6.2).
- **Rubriker på mobil:** h2 för "The leaderboard, live" och "Four things decide your rank" finns men är gömda (`sr-only`); synliga är ögonbrynen. "How the game works" är
  ögonbrynstexten på både mobil och desktop (mobilens design hade "How it works").
- **Banans löpare går med CSS offset-path på SVG-cirklar** (samma `rqOrbit` som stadion-laddaren) i stället för designens SMIL `<animateMotion>`, så
  `prefers-reduced-motion` stoppar dem. Silver- och bronsprickarna är heltäckande rankfärger (prototypen hade .75/.8 i alfa).
- **`App.tsx` kör `useAppInit` på alla routes, även `/` för utloggade — men utloggad gör den inget nätverksanrop.** Landningen anropar bara `/api/public/stats`.
  `useAppInit` kör `useLevelRequirements`, som hämtar nivåtabellen via `GET /api/config/levels` (kräver token) först när en användare är inloggad
  (`enabled: !!user`, även efter SPA-inloggning); utloggad och vid fel gäller `FALLBACK_LEVEL_REQUIREMENTS`. Onboarding-prefetchen gör INGET nätverksanrop utan
  token (onboardingApi kastar utan token och prefetchen sväljer felet). [RÄTTAT efter RUN-110/111: tidigare stod här att appskalet gjorde ETT Supabase-anrop för `level_requirements` även för
  utloggade — frontend har ingen Supabase-klient längre, och gating på `user` är gjord. Migration 040 (RUN-112) tar bort den sista anon-policyn på `level_requirements`; anon läser därefter ingenting.]
- ~~Inget `<title>`/meta per route och ingen statisk rendering av `/`~~ [Inaktuellt sedan RUN-205 och RUN-260: `index.html` och `landing.html` bär samma statiska metadata (title, description, Open Graph, canonical, ikoner, manifest) och `/` förrenderas vid bygget till `landing.html` (ADR 006, addendum 2026-10-19; Caddy-regeln för `/` är påslagen sedan S6, RUN-333). Metadatan är gemensam för hela sajten, inte per route: övriga adresser är inloggade sidor med `index.html`:s head.]

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
  Regeln i sin helhet: ≥ 3 stormiga timmar (väderkod duggregn/regn/snö/skurar/åska) ELLER ≥ 4 timmar med byar ≥ 15 m/s, dagtimmar 06–21 imorgon. `run_weather` hämtas också i m/s från v0.5.3; äldre rader räknades om av engångsskriptet `convertWindToMs` (gräns = deploytiden, via `fetched_at`; skriptet är borttaget och finns i git-historiken).
- **Kvalificering:** ett deltagarevent kräver att eventet är öppet när rundan loggas/synkas och att rundans datum inte ligger efter eventets slut (inte rundans starttid); bara REDIGERING (PUT, `enforceRunDateWindow`) kräver datum inom eventets dagar — Playbook säger "log or sync a run while the event is open (the run’s date can’t be after the event ends)".
- **Strava:** synken räknar från en vecka före senast Strava-importerade rundan; en aktivitet med distans 0 sparas inte ("any distance above zero"). Intervallet är `STRAVA_POLL_INTERVAL_HOURS` (12) i `packages/shared/src/rules.ts`; väderbackfillen har eget 30-minutersschema i stravaSync.ts.
- **Utmaningstokens:** enligt seeden (006) delas token ut vid nivå 3, 5, 8, 10, 12, 14, 15 och sedan vid varje nivå från 16 (major var 5:e, legendary vid 15/30/45) — inga tokens vid 2, 4, 6, 7, 9, 11, 13. Playbook säger "many level-ups at first and, from level 16, at every level-up".
- **Insatserna per utmaningsnivå är observerade, som Rules-vyn:** verkliga tokens/aktiva/inkomna/historiska utmaningar ur `GET /challenges/my` först (hämtas när
  utmaningskapitlet visas), `DEFAULT_STAKES` (seed, migration 006) bara för nivåer utan exempel. Har man inga tokens eller historik visas alltså seed-värdena.
- **Titellistan i Playbook och Admin är `GET /titles/leaderboard`** (samma rader som Titles, delad cache) — namn, regel och låsgräns ordagrant ur databasen,
  sorterade som Titles-skärmens kategorier. Admins gamla fyra hårdkodade titlar (och texten "hardcoded") är borta.
- **Settings: Notifications-kortet ur Web Prototypen är byggt i v0.7.0** (ADR 011 beslut 9; reglagen lagras i `user_settings`, kortet och panelen på /news är samma komponent). Därmed är anmärkningen i ADR 006 beslut 4 ("byggs INTE nu", tidsbegränsad till den framtida notis-ADR:n) uppfylld.
  Prototypens tre uppskjutna inställningar ("Streak at risk", "Title you can claim", "Strava sync results") är medvetet inte med (ADR 011 B9). **Disconnect** är tillagd i v0.7.0 (ADR 010 beslut 7.4–7.6, ägarbeslut 2026-10-13/14): kortet har "Pause or disconnect" med valen "Pause sync" och "Disconnect…" och därefter en SEPARAT bekräftelse (`alertdialog`) som säger att Disconnect raderar de importerade Stravarundorna (och hur många), att det inte går att ångra och att återkallandet hos Strava är ett försök, inte en garanti; en pausad koppling har "Turn sync back on" och "Disconnect". Därmed finns det ägarbeslut om bekräftelse som saknades. **Sync log** blir "Latest sync":
  backend har ingen historik; Settings visar senaste import (`last_import_at` i `/strava/status`; `/strava/last-sync` borttagen i v0.7.1). Mobilprototypen saknar Settings och Admin — mobil är härledd (en kolumn).
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
- **Borttaget som dött:** filen streakConstants (Playbook var sista användaren), komponenten PageTabs (shadcn-flikar, Playbook var sista
  användaren) och de gamla `XPSettings/UserManagement/TitleConfig/AdminSecurity`, `StravaSettings/PasswordSettings`.

## Skal & delat
- RÄTTAT 2026-10-04: Toastern ÄR monterad (AppProviders) och gamla `toast()`-
  anrop visas. Nya features använder ändå permanenta `role=status`-ytor —
  motivet är konsekvens och pålitlig uppläsning, inte att Toastern saknas.
- Feature-CSS i huvudbunten laddas före index.css (main.tsx-importordningen); de lazy-laddade sidornas CSS (Playbook, Settings, Admin, Features) laddas EFTER. Tailwind 3:s `@layer` blir vanlig CSS i bygget, så ordningen avgör vid lika specificitet — overrides av
  delade klasser kräver sammansatta selektorer (dokumenterat i
  features/challenges/README.md).
- `toLocaleDateString('en-GB', {month:'short'})` kan ge "Sept" i nyare ICU — datumformat använder egna månadsnamn (`MONTHS_SHORT`/`formatDayMonth` i
  `shared/utils/format`). Sedan formatmodulen samlades finns inget `Intl`/`toLocale*`-anrop kvar i frontendens features; lint (`rq/design-syntax`) och
  en regel för `format.ts` håller det så.
- Formatmodulen (`shared/utils/format.ts`): tusentalsavgränsaren är det svenska "1 240" (U+00A0) överallt, även i Events och Duels (ägarbeslut). Antagande: samma
  mellanrum gäller heltalsdelen av km (`formatKm(1240.5)` = "1 240.5", punkt kvar som decimaltecken), så att XP och km på samma skärm skrivs likadant; det syns
  först vid 1 000 km eller mer (Runner/Board totalsiffror, Titles). Dagens skilda "tid sedan"- och nedräkningstexter är oförändrade men namngivna stilar
  (`formatAgo`: spelled, compact, feed, feed-long; `formatCountdown`: hms, hm, coarse, pill). Vill ägaren ha en enhetlig stil är det en separat designfråga.
- `formatKm` avrundar halv uppåt på talets kortaste decimalskrivning, räknat på siffrorna som text (`toFixedHalfUp`, med minnessiffra genom heltalsdelen), utan Intl.
  Det är samma regel som den gamla Intl en-GB i Events och Duels följde, också för flyttalssummor strax under en halvgräns (104.94999999999999 blir "104.9",
  3.4499999999999997 blir "3.4"). Differentialprovat mot Intl en-GB med 1 och 2 decimaler över 3 320 001 tal (2 020 001 rena tvådecimalstal, 1 000 000 summor av
  2–9 slumpade tvådecimalstal och 300 000 fyrdecimalstal): 0 avvikelser utöver tusentalsavgränsaren. `toFixed` avrundar däremot det binära värdet, så Log, Board, Runner, Profile, Playbook och Titles ger nu
  ny text för ungefär 4 % av tvådecimalstal: 0.95 skrivs "1.0" (förut "0.9"), 12.35 "12.4" (förut "12.3"), 1.15 "1.2" (förut "1.1"), 9.95 "10.0" (förut "9.9").
  Ytorna är alla som visar km via `formatKm`: rundans distans och XP-förhandsvisningen (Log), veckans och säsongens km (Board), Runner card och Profile,
  Playbook och titelvärden för km (Titles). Multiplikatorn (`formatMultiplier`/`formatTimes`) behåller `toFixed(1)`: halv uppåt skulle ändra text för 36 av 900
  tvådecimalsvärden mellan 1.00 och 9.99 (1.15, 1.45, 1.65 …), och standardtrappan (ett decimal) är oberörd.
- Titles skriver "Sep" för september i "senaste söndagsrundan" (`lastRunOfWeek`); den gamla `toLocaleDateString('en-GB')` gav "Sept" i nyare ICU. Godtaget: egna
  månadsnamn överallt. Ett värde som inte är ett datum (NaN, oändligt, utanför datumintervallet) visas som "—" i stället för att kasta i render.
- Stadion-ovalens löparprickar (`TrackLoader`) har ingen negativ marginal, till skillnad från designfilen (`RunQuest Loaders.dc.html`, `marginLeft/marginTop: -dotR`).
  Avvikelse från designen, medveten: `offset-path` placerar redan prickens mitt på banan (offset-anchor = rutans mitt), så designens marginal räknar av radien en
  gång för mycket och prickarna hamnar 2-14 px vid sidan om banlinjen vid 192 px (mätt i fyra faser av varvet). Designfilen har samma fel och är orörd. Bevis:
  `tests/loader-runners.spec.ts` (e2e). Blir fel om designen en dag byter till ett ankare som inte är rutans mitt (`offset-anchor`).
- Utloggningen (`AvatarMenu.logOutToLanding`) förutsätter att `navigate()` och `logout()` renderas i SAMMA batch: sker adressbytet i en övergång ritas användaren borta först med den skyddade adressen kvar, och `RequireAuth` skickar till `/login?next=` i stället för till Landing. Därför har webbläsarroutern `useTransitions={false}` (`AppBrowserRouter`, ADR 006 addendum 2026-10-25), lint förbjuder en direkt `BrowserRouter`, och testernas `renderWithApp` gör samma val. Gäller även den lean landningen (`hydrateLanding`), vars egen in-/utloggning inte har något eget skydd utöver routern. Blir fel om någon byter tillbaka till standardvärdet eller om utloggningen flyttas till en asynkron väg (`App.logout.test.tsx`, `AppBrowserRouter.test.tsx`, `login.spec.ts` fäller).

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
  inte ett säljargument), och nya funktioner (Duels, Runner card, Pack News, Log runs) tillagda. Working on = Seasons and trophies och Group settings sedan v0.7.0 (ägarbeslut 2026-10-15); Badges flyttades till Features när de släpptes i v0.6.0 och Notifications när de släpptes i v0.7.0.
- **Popupen har ingen prototyp** — härledd ur skalets delade modal (`.rq-modal`/`.rq-scrim`), Bebas-rubrik, hårlinjegrid för punkterna, en guldknapp. Fokus startar på "Got it".
- **Prototypens textsteg snappade till tokens**: kortrubrik 18 px → `--rq-fs-name` (20 på desktop), beskrivningar 16 px → `--rq-fs-body` (17 på desktop), release-datum 15 → `--rq-fs-meta`.
- **Alla som redan sett de gamla patchnotes (`patch_2026_04_02_*`) får 0.5.0-popupen en gång** — slugen `patch_v0.5.0` är ny. De gamla slugarna ligger kvar i tabellen, ofarliga.

## Badges (v2)

- **News-radens ikonkolumn är 30 px på mobil men övriga rader har 26 px** (spec §5: `--rq-badge-news-icon-w`, "när den bär ett sm-emblem"), så texten på badge-rader börjar 4 px längre in än på övriga rader. Tokenen heter `--rq-news-row-icon-badge-w` (news-vakten läser `--rq-news-*`; badges-vakten läser bara `badges.css`). Desktop 34 px = som övriga rader. Vill ägaren ha utlinjering bör `--rq-news-row-cols` (26 px) höjas till 30 px för alla rader.
- **Flavor-storleken är `--rq-fs-body`** (15 px mobil, 17 desktop): första `--rq-fs-*`-steget ≥ 14 px som inte är en knappstorlek (`--rq-fs-btn-sm` = 14 px finns men är en knappkonstant).
- **Skelettet är en loop (`infinite`)** — F8 anger `rqSkel` 1.6 s och det är en laddare som pulserar tills datan kommer. Vakttestet "inget infinite i badges.css" gäller bara emblemreglerna (undantag för `.rq-badge-skel`).
- **Badge-minis på Board (RUN-373, v0.8.2): mellanrummet är `--rq-sp-8`, men `--rq-sp-4` under 360 px.** Mobilens rest-rad har en mittkolumn på ca 135 px vid 320 px; "N km" och tre badges ryms inte med det större steget på en rad och raden skulle växa. Gäller `.rq-board .rq-badge-minis` i `board.css` (media query `max-width: 359px`). Fel om en smal telefon ska få mer luft (då får raden brytas eller km-texten kortas), eller om kolumnbredden ändras.
- **Mobilens topp 3: badgepyramiden bredvid namnblocket, layoutförskjutningen när badge-frågan landar är nu 0 till 8 px (RUN-410, v0.8.3).** Gruppen ligger i huvudraden som syskon till namnblocket (en överst och två under för tre badges, en centrerad rad för en eller två, ingen yta för noll) när kortets innanbredd är minst 293 px (telefoner från 360 px), annars som en rad under namnblocket. Uppmätt kortets höjd 0 → 1/2/3 badges på 375 px (och lika på 390, 402 och 430): tvåordsnamn 272,8 → 272,8 → 272,8 → 275,0 px (+2,2 px för tre), enordsnamn 266,9 → 266,9 → 266,9 → 275,0 px (+8,1 px för tre). Förut (RUN-373 i produktion, v0.8.2) växte kortet 23,4 px vid tre badges på 375 px, och reservraden under 360 px (raden under namnblocket, samma som RUN-409:s läge) växer 35,0 px (272,8 → 307,8; enordsnamn 266,9 → 301,9) när frågan landar. Pyramiden gör alltså hoppet 15-21 px mindre på 375 px och uppåt, men inte noll: pyramiden är 62 px hög och namnblocket med två namnrader och titelraden ca 60 px (enordsnamn ca 54 px). Följd av att pyramiden hamnar utanför namnraden: på telefoner under 360 px (innanbredd under 293 px, t.ex. 320 px) ligger raden under titelraden, inte mellan namn och titel. Fel om designen vill att hoppet ska vara noll (då reserveras 62 px i varje kort, även utan badges) eller att pyramiden också ska bredvid namnet på 320 px (kräver att namnet får bryta mitt i ordet, vilket RUN-373 och RUN-409 förbjuder).
- **Podiekortens namnrad bryter badgegruppen till en egen rad (RUN-373, v0.8.2; gäller på mobilen bara under 360 px sedan RUN-410, och på desktop som förut).** Namnknappen krymper inte under sitt längsta ord och badgesen ritas aldrig över namnet; rymmer inte namnet på en rad och tre badges bredvid varandra (`flex-wrap` på `.rq-board-podium__nameline[data-minis]`, `--rq-sp-4` mellan raderna) ligger gruppen på en rad under namnet, högerställd. Då växer kortet med en badgerad (uppmätt 23,4 px på 320-375 px och 26 px från 1024 px). Om raden bryter avgörs per kort av namnlängd och kortbredd, så podiets trappsteg kan rubbas (t.ex. 1440 px: plats 2 lika hög som plats 1), och vid klientnavigering till Board med kall badge-cache hoppar korten ner när badgefrågan landar (CLS upp till ca 0,06 på 360 px). Ägaren valde 2026-10-25 att släppa det så (alternativen var en alltid reserverad badgerad eller högst två badges i podiet). Fel om designen hellre vill ha namnet radbrutet bredvid badgesen (kräver att namn och delta byter markup).
## Grupper och titlar per grupp (v0.8.0, ADR 012)

- **`onGroupSettingsChanged` loggar bara.** Sömmen i `PUT /api/groups/settings` anropas en gång per effektiv ändring men gör inget utöver att logga. Utskicket till
  gruppen (Pack News och notis, ägarbeslut F4) kopplas av en senare story, som ska deduplicera på innehåll (groupId + nyckel + från→till), eftersom två
  samtidiga PUT kan ge meddelanden i omvänd ordning. Blir fel om den storyn dedupar på tid eller på anrop.
- **Inga gruppnycklar är registrerade i `SETTING_DEFINITIONS`** (ägarbeslut F1: infrastrukturen byggs nu, inte nycklarna). Varje PUT med en nyckel ger 400 och
  `group_settings` är tom i prod. Blir fel om något räknar med att en gruppinställning har effekt innan första nyckeln är registrerad.
- **Eventtypen `group_setting_changed` är reserverad men inte i `ACTIVITY_TYPES` eller CHECK-constrainten.** Den story som registrerar första nyckeln lägger typ,
  CHECK-migration (efter deploy, som 050), klassificering, newsModel och notisslag; ett vakttest fäller bygget om en gruppnyckel registreras utan typen.
- **Att gå med i en grupp har ingen UI.** `POST /api/groups/join` finns och ger 409 vid aktivt medlemskap, men ingen skärm anropar den (ADR 012 N3). Flera medlemskap,
  lämna grupp och gruppbyte hör till RUN-95.
- **JWT:s `group_id` är inaktuell efter join.** Titelrutterna och `GET /api/groups/my` tar gruppen ur token tills ny inloggning (`/groups/my` kontrollerar dessutom
  färskt att medlemskapet finns i just den gruppen och ger annars 404). Skrivvägarna (`resolveActingGroupForWrite`, gruppinställningar) läser medlemskapet
  färskt. Blir fel om en användare går med utan att logga in igen: hen ser tomt tills dess.
- **Låtsasgruppens admin har rollen `admin` i `group_members` men inte `users.is_admin`** (N6, ADR 012 beslut 2.6). `requireAdmin`-rutterna och admin-UI:t visas därför inte för
  det kontot; `PUT /api/groups/settings` fungerar. Ägaren sätter `is_admin` i staging om en test behöver det. Löses när gruppnära rutter flyttas till rollen (RUN-267/RUN-95).
- **`activity_log.dedupe_key` saknar grupp.** Nyckeln för `title_taken`, `title_unlocked` och `title_revoked` bär användare, titel, värde och dag men inte gruppen. Med flera
  medlemskap (RUN-95) kan samma användare, titel, värde och dag i två grupper kollidera och den andra raden tappas. Ofarligt med ett medlemskap per användare i v0.8.0.

## Säkerhetshuvuden och CSP (RUN-344, v0.8.1)
- Sentrys host matchar `https://*.ingest.de.sentry.io` (`connect-src`). DSN-värdet läses aldrig; EU-regionen antas ur `docs/release.md`. Fel host = inga felrapporter från det inloggade skalet. Prövas i prod-röken.
- Umamis tracker skickar till `https://gateway.umami.is` (`data-host-url`, trackerns eget standardvärde i `public/vendor/umami.v1.js`). Flyttar Umami endpointen slutar statistiken tyst tills filen och `connect-src` uppdateras (`docs/release.md`, Umami).
- Inga användarstyrda inline-stilar eller HTML finns i appen; därför är `style-src 'unsafe-inline'` godtaget. Blir fel om användarskriven HTML eller CSS någonsin renderas.

## Integritetstexten /legal (RUN-345, v0.8.1, `DATA_POLICY_VERSION` 2026-10-22)
- **Umamis lagringsregion "EU, Frankfurt" vilar på ägarens uppgift** (`UMAMI_DATA_LOCATION` i `packages/shared/src/legal/dataPolicy.ts`; ägaren bekräftade senast 2026-10-22). Umami publicerar ingen region, så texten kan inte beläggas mot en offentlig källa. Blir fel om kontot flyttas eller Umami byter lagringsplats: då ändras texten, versionen höjs och snapshotpinnen byts (`docs/release.md`, steg 1.5).
- **Sentrys överföringsgrund är belagd mot Sentrys offentliga DPA-sidor** (https://sentry.io/legal/dpa/, version 5.1.0; ägaren accepterade den 2026-10-21 och bekräftade versionen 2026-10-22): EU-US Data Privacy Framework som huvudväg och standardavtalsklausulerna (SCC) som reserv. Blir fel om DPF upphävs eller ändras, eller om Sentry byter DPA-version: kontrollera då formuleringen mot DPA:n och ändra texten med höjd version.
- **Invändningar (art. 21.1) hanteras manuellt per e-post** till den personuppgiftsansvariga (ägaren 2026-10-22). Det finns ingen knapp eller automatik; blir fel om volymen växer så att manuell hantering inte hinner.

## Övergångar i v0.8.1
- Samtyckesversionen jämförs med exakt likhet i Strava-callbacken (`apps/backend/src/routes/strava.ts`). Under deployfönstret, eller i en gammal flik, får en ny koppling 400 `consent_required` tills båda tjänsterna kör samma version. Antaget ofarligt (bara nya kopplingar, övergående); blir fel om versionen byts ofta eller kopplingar sker mitt i en deploy.
- `groupTimeZone` ger Stockholm för alla grupper tills RUN-21 (`apps/backend/src/utils/groupTimeZone.ts`). Blir fel den dag en grupp i en annan tidszon finns före RUN-21.
- Svarskuvertet går med dubbelsvar (gamla toppnivånycklar bredvid `data`) tills steg 2 (RUN-364, ADR 007 Addendum 2026-10-20). Blir fel om steg 2 tas innan alla klienter läser `data`.

## Löpband i titlar och badges (bugg 2026-10-24)
- **`titles.outdoor_only` är oanvänd.** Ingen kod bestämmer något utifrån kolumnen (den väljs bara ut och följer med i katalogkontraktet). Löpbandsregeln (en löpbandsrunda ger 0 höjdmeter i The Mountain Goat, The Vertical Runner och badgen The Climber; ägarbeslut 2026-10-23) ligger i `countedElevationGain` i `packages/shared/src/runElevation.ts`. Kolumnen lämnades orörd och kan tas bort i en framtida migration. Blir fel om någon börjar läsa kolumnen som om den styrde löpbandsregeln.
- Eventet Weekly elevation använder inte `countedElevationGain`: det filtrerar i databasen (`is_treadmill = false`), vilket också utesluter rader där `is_treadmill` är null. Titlarna och badgen räknar null som utomhus. Att låta eventet gå genom hjälparen vore en beteendeändring för null-rader.

## Board: smal desktop och långa namn (buggar 2026-10-26)
- **Designen anger bara 1440 px; 1024–1279 px har egna mått för rest-tabellen och podiets statruta.** Med sidofältet (250 px) blir innehållet ca 710 px på 1024 px, och tabellens sju kolumner (`--rq-board-rest-cols`, byggda för 1440) behövde ca 870 px och gav 126 px sidled scroll. I intervallet delar nu namn och nivåframsteg på det som blir över (`36px 1.4fr 1fr 72px 76px 64px 92px`, i båda temafilerna) och sifferkolumnerna är smalare; från 1280 px gäller kolumnerna oförändrade. Podiekortens statruta (km total, longest, runs) använder i samma intervall etikettens mobilstorlek (`--rq-fs-eyebrow`, `--rq-ls-chip`) och smalare cellpadding, eftersom cellerna bara är 58-75 px och "LONGEST" annars löpte in i "RUNS". Fel om designen vill ha en annan lösning på smal desktop (t.ex. tabell som scrollar i sidled i sin ram, eller en dold kolumn).
- **Rest-radens sub-rad i desktoptabellen bryter minis till en egen rad när namnkolumnen inte rymmer "Lvl N · X km" och badgesen** (`flex-wrap` på `.rq-board-sub--table`, texten bryts aldrig). På 1024 px blir en rad med tre badges ca 129 px hög (mot 104 px utan badges förut); från 1280 px ryms allt på en rad och raderna är oförändrade (84 px). Följd: på 1024–1100 px växer en rad ca 25 px när badgefrågan landar efter raderna (layoutförskjutning vid kall cache), samma slags hopp som podiet har sedan RUN-373; mellan 1024 och 1279 px gäller tabellens egna kolumner, så på 1279 px bryts "Next level" till två rader och rubrikraden är ca 20 px högre än på 1280 px. Rest-radernas namnkolumn är ca 123 px på 1024 px (mot 300 px från 1280 px), så RUN-384:s brytregel (`overflow-wrap: anywhere`) bryter där efternamn från ca 12 tecken mitt i ordet (t.ex. "Featherstone", "Christoffersen") och raden blir ca 22 px högre; på 1100 px först ord på ca 17 tecken, från 1180 px inget. Förut scrollade sidan 126 px i sidled i stället (integrationskritiken 2026-10-26).
- **Ett ord i ett podienamn som är bredare än kortet bryts mitt i ordet (bugg 2026-10-26).** Namn har ingen längdgräns. Podiets namnknapp har `overflow-wrap: break-word` och `min-width: 0` (`board.css`): ett ord som ryms i kortet ligger som förut, men ett längre ord får krympa namnet under sitt längsta ord och bryts i kortets bredd i stället för att ligga utanför kortet och ge sidled scroll. Ellips valdes bort (ett namn är en identitet, och det klippta syns inte någonstans) och `anywhere` valdes bort (RUN-384:s skäl: det bryter vanliga namn mitt i ordet i den smala namnkolumnen). Följd: ett ord som förut sprängde namnkolumnen men låg inom kortet bryts nu också mitt i ordet, och kortet blir en rad högre (ca 22 px) i det fallet. Kritikern mätte 13 av 320 kombinationer (40 namn × 8 bredder): på 1024 px efternamn på 13–14 tecken som "Alexandersson", "Papadopoulos" och "Kristoffersson" (namnkolumnen är ca 125 px), på 1100–1180 px längre ord som "Featherstonehaugh"; namn med ord på högst 12 tecken påverkas inte på någon bredd. Provet "the podium with ordinary names" körs på 320, 375 och 1280 px och täcker inte 1024–1180 px. Fel om ägaren hellre vill ha ellips med fullt namn i en tooltip.

- **Vald popup-flik har tint .14, kant .50 och guldlinje under (RUN-417).** Prototypen har bara .05-tint och guldlinje; Leads krav är `--rq-tint-selected` och `--rq-edge-selected`. Linjen under behölls (underline-varianten), så fliken har både kant och linje. Panelytans höjd (`--rq-runner-popup-panel-h`) är vald så att dialogen ryms på 768 px höjd: 338 px sedan den nya bannern (162,7 px mot 200,9 px före) är lägre, så att dialogen är kvar på 669 px; ett högre banner (t.ex. långt namn) kan ge scroll i dialogen som förut.
- **Head to head i bannern är tre rutor med en mening för skärmläsaren, inte den synliga meningen (RUN-418).** Den godkända prototypens popup (`web-14-popup.png`, `godkand-2026-10-27`) visar panelen "HEAD TO HEAD" med meningen "2–0–1 to you" i Bebas och en underrad "Won–drawn–lost between you two"; Leads manifest (kriterium 2 och 3) och bilden `web-popup-head-to-head.png` anger i stället rubriken "Head to head with you", en svärdikon och tre rutor (You won, Drawn, You lost) med meningen som skärmläsartext. Manifestet följdes: rubrik, ikon och siffror är `aria-hidden` och meningen ("Head to head: 2–0–1 to you", "to <förnamn>", "level", "no duels against <förnamn> yet") är den enda läsningen. Vill ägaren ha den synliga meningen är det en ändring av `HeadToHeadBanner` (rutorna byts mot meningen), inte av data eller hook.
- **Panelen har ingen egen bakgrund, och felläget är komprimerat (RUN-418).** Prototypens panel har en svag bakgrund och rutor med egen bakgrund ovanpå; det ger 4,45:1 för etiketterna i mörkt tema (kravet är 4,5:1), så panelen har bara kant och rutorna samma lager som statraden (4,61:1 mörkt, 4,56:1 ljust). Felkortet (`ErrorState` med Retry) ryms i panelens fasta innehållshöjd (`--rq-runner-h2h-body-h`, 76 px) med den korta raden "Your data is safe." i stället för standardtexten, och "No duels against Karl yet" står utan punkt (sidans kort har punkten).
- **Rutornas värden i ljust tema ligger på 4,10:1 ("you won") och 3,95:1 ("you lost") (RUN-418).** Värdena är 24 px Bebas (large text, så 3:1 gäller) i tokens `--rq-up`, `--rq-down` och `--rq-text-2` (samma som sidans rekordrutor och hjältekortets celler); etiketterna, som kravet gäller, håller 4,5:1. "Drawn" använder `--rq-text-2` i panelen (inte `--rq-text-3` som på sidan) så att siffran håller kontrasten.
- **Overview ritar profilens rader och karta, inte prototypens rutor (RUN-419).** Den godkända prototypens Overview (`web-popup-overview-*.png`) visar Distance, Streak och Fun facts som statrutor ("Marathons worth", "Marathons 2026", "Average per run" under Fun facts). Leads beslut (integrationskritiken inkrement 9) är att popupen delar profilens statistikinnehåll (`StatsContent`): raderna i Distance, Streak och Fun facts är profilens (Fun facts: Marathon equivalents total och för året, Longest gap between runs, Favourite day to run) och Activity är profilens Consistency-karta med sin "today"-rad och förklaring. Utmaningsrekordet ("Challenges won–lost") är den femte raden i Fun facts. Vill ägaren ha prototypens rutor är det en ändring av `StatsContent` som också ändrar profilen, inte av popupen.
- **Utmaningsrekordet i Fun facts har neutral ton, inte grönt/rött (RUN-419).** Bannerns CHALLENGES-ruta var grön när vinsterna var minst lika många som förlusterna och röd annars (24 px, large text). Som rad i Fun facts är texten 17 px och går inte som large text; `--rq-up` ger 4,15:1 mot radens yta i ljust tema (`--rq-down` mättes inte på raden; på bannerns rutor är den 3,95:1), och kravet för ny text är 4,5:1. Raden har därför `tone: 'default'` (12,9:1 ljust, 11,5:1 mörkt).
- **Overview har egna textfärger i popupen, bara där de behövs (RUN-419).** Kravet är 4,5:1 för läsbar text i båda teman. Överstyrningarna ligger i `runner.css`, scopade till `.rq-runner-overview`; `profile.css`, profilsidans rader och det delade receptet är oförändrade. Stylelint tillåter inga egna custom properties, så ingen ny token införs: ersättningen är den befintliga `--rq-text-4` (AA mot kortets yta i båda teman).
  - Veckodagsbokstäverna M/W/F/S (`.rq-profile-heat__day`, `--rq-text-5` i profilen) är läsbar text: 2,53:1 mörkt och 1,79:1 ljust före, `--rq-text-4` i båda teman efter (5,21:1 mörkt, 4,94:1 ljust).
  - Bara ljust tema: rader med ton muted ("Longest gap", "Next tier at"; profilens `--rq-text-3`, 3,95:1) och radetiketterna `dt` (3,95:1) är `--rq-text-4` (4,56:1); den delade vilande knappen (`--rq-text-3`, 4,22:1) är `--rq-text-2` (15,6:1). Mörkt tema är identiskt med profilen och det delade receptet (muted och `dt` 5,87:1, vilande knapp 7,24:1; en tidigare version gav dem `--rq-text-4`/`--rq-text-2` också i mörkt och var där svagare respektive starkare än profilen).
  - Titelfiltret (RUN-420) och profilens egna etiketter har kvar 4,22:1 respektive 3,95:1 i ljust tema (RUN-432). Den som vill rätta det i grunden ändrar `.rq-filter` och profilens `dt`/`muted`.
- **Fokusringen på en vilande Overview-knapp (RUN-419; RUN-432 gäller tonade ytor).** Ringen är `--rq-gold-text`, 2 px, offset -2 px (inåt): 13,7:1 mot ytan i mörkt tema och 6,2:1 i ljust. Den valda knappen har ringen i `--rq-text-1` (på guldtinten .14).

## Board: fliken Position (RUN-408, v0.8.3)

- **Kantfadens hook och regeln `showPositionTab` bor i delade lägen, inte i profilen.** Profilens flik (RUN-402) hade inte mergats i integrationen när Board-fliken byggdes. För att inte ge två kopior bor kantfadens räkneregel och hook i `shared/components/tabRowFade.ts` och `shared/hooks/useTabRowFade.ts` (samma kod som RUN-402:s tabRowFade och useTabRowFade i profilmappen, med ett tillägg: `tabCount`, så att raden mäts om när en flik tillkommer), och regeln `showPositionTab` i `features/leaderboard/positionTab.ts` (profilen importerar redan positionshooken därifrån). När RUN-402 mergas: byt profilens importer mot dessa och ta bort profilens egna kopior.
- **Position-fliken fyller flikraden lika (flex: 1), inte chipbredd som prototypens mobil.** Lead krävde RUN-387-mönstret (`flex: 1`, `overflow-x: auto`); fyra chip ryms inte på 320 px och raden scrollar då i sidled med kantfade. Prototypens chip är innehållsbredda och vänsterställda.
- **Ovala flikar i det ljusa temat har 4,04:1 mot ytan (`.rq-filter`, `--rq-text-3`).** Samma chip-recept som Season, Week och Streaks hade före Position; storyn ändrar inte receptet, men proven vaktar att värdet inte blir sämre (golv 4:1) och att den valda fliken (4,85:1 ljust, 10,44:1 mörkt) och fokusringen (≥ 5,5:1) når sina nivåer. Att höja `--rq-text-3` i ljust tema är en designfråga.
- **`?view=position` med en grupp på en och en `FirstBoardGate` som redan släppt:** gaten kollar bara adressens vy (Position väntar inte på titlar, pilar och minis), så Season som sidan faller tillbaka på hämtar dem själv och visar sin vanliga laddning. Gaten ändrades inte (kriterium 7).
- **Prototypens mobil har "Current order · tap to show a line" i en eyebrow; implementationen har rubriken och hintet "Pick a runner to lift their line." (som prototypens webb).** Det är RUN-407:s val och rörs inte här.

## Runner card: tillbakalänken (RUN-425, v0.8.3)

- **Etiketten ändras medvetet från "‹ Back" till "← Standings".** Manifestet och ADR 006 punkt 1 utgår från att sidan redan har `← STANDINGS`; på basen var kontrollen en `<button class="rq-back">` med `‹` och texten "Back". Jira-kriteriet gäller bokstavligt (synlig text "← Standings", pilen `aria-hidden`, tillgängligt namn "Standings", `<a href>` till `/board`). Etiketten är densamma oavsett varifrån sidan nåtts (Board, Duels, Log). Beteendet är oförändrat: vanligt klick = ett steg bakåt (`useCloseRunner`), direktladdning går till `/board`.
- **Länken är en react-router `Link` (renderar `<a href>`), inte en bar `<a>`.** Basnamnsregler och klientnavigering vid modifierarklick lämnas åt routern; vanligt vänsterklick förhindras av kortets egen hanterare.
- **Länkens färg är `--rq-text-4` (scopat i `runner.css`), inte `.rq-back`s `--rq-text-3`.** `--rq-text-3` ger 4,04:1 i det ljusa temat; `--rq-text-4` ger 4,69:1 ljust och 5,33:1 mörkt (mörkt var 7,27:1). Delade `.rq-back` (badges-sidan) är orörd.
- **Länkens tryckyta är minst 44 px (`--rq-control-hit`) på mobil, och toppraden blir därmed ca 9,7 px högre, uppmätt 34,3 → 44 px (Challenge-knappen satte höjden förut).** Hjältekortet och allt under flyttas lika mycket nedåt på mobil; på desktop är måttet 0 och inget flyttas.
- **Rubrikens fokusring syns vid direktladdning och tangentbordsnavigering.** Skalet döljer inte fokus för programmatisk fokus och Duels-rubriken har samma beteende; webbläsarens `:focus-visible`-regel döljer ringen efter ett musklick (klientnavigering från en rad), men inte utan föregående mus.

## Avbryt i send-flödet och fokus till löparens rad (RUN-424, v0.8.3)

- **Fokusåtergången bor i `AppRoutes` (`useRestoreRunnerFocus`), inte i `ShellOutlet`.** `<Routes location={background}>` ger skalets `useLocation` bakgrundssidan medan popupen är öppen, så `ShellOutlet` ser aldrig popupen stängas. `AppRoutes` ser den riktiga platsen. Beteendet som manifestet beskriver (skalet fokuserar `[data-runner-id]` ur route-state och tömmer tillståndet) är detsamma.
- **Avbryt går ett steg bakåt (`navigate(-1)`) när sidan under popupen är posten före; annars ersätts send-flödets post med sidan (`replace`).** Popupen öppnades med en post, Challenge ersatte den med send-flödet, så sidan ligger en post bakåt. Popupen skickar därför `returnIdx` (`history.state.idx` minus ett) i `sendOrigin`, och Avbryt går bakåt bara när indexet stämmer. Ett `replace` hade lämnat en extra Board-post per varv (tre varv: längd 2 → 5, Back kräver två tryck). Fokusavsikten bärs av en kortlivad avsikt i minnet (`shared/utils/runnerFocusIntent.ts`, förfaller efter 2 s) som `useRestoreRunnerFocus` tar, eftersom `navigate(-1)` inte kan bära route-state. Går det inte att avgöra (djuplänk, ny flik, ändrad historik, ingen `returnIdx`) gäller `replace` med `state: { focusRunnerId }`, som töms efteråt. Webbläsarens stack behåller send-flödets post som en post framåt tills nästa nya post skriver över den, så `history.length` är en över läget före popupen men växer inte med antalet varv. Mätt i e2e (`send-cancel-focus.spec.ts`).
- **Steg bakåt skiljs från en ny post med `history.state.idx`, inte `useNavigationType`.** Hooken jämför indexet mellan platsbyten (`shared/utils/historyIdx.ts`); `useNavigationType` drog med mer av react-router i `router`-chunken som landningen laddar. Proven med MemoryRouter, som saknar indexet, skriver det med `HistoryIdx` (`test/HistoryIdx.tsx`, `renderWithApp({ history: true })`).
- **`sendOrigin` töms ur route-state vid ett skick (`closeSend`, `withoutSendOrigin`).** Ett skydd i `openSend` var överflödigt (arket kan inte öppnas på en post som bär ursprunget) och är borttaget. Annars hade "popup → Challenge → skicka → rubrikens Send → Cancel" hoppat till den gamla bakgrundssidan.
- **Väntläget `PopupPending` heter "Loading <namn>'s runner card" när löparen är känd (annars "Runner card") och har inget skrollås.** Namnet skiljer väntläget från den riktiga dialogens ("Runner card: <namn>"), så att den som väntar på den riktiga inte fångar väntläget. Skrollåset kräver en effekt i ingångs-chunken och väntar. Fokus tillbaka till raden vid Esc/skrim ingår (samma mekanism som mobilens Back).
- **`duelsSendPath(opponentId?, view?)`:** `view` följer med från Live-tomläget (`view=live`) och från popupen när den ligger över `/duels` (bakgrundens `?view=`). Utan `view` gäller flikens standardval (Live), som förut. Manifestets formulering ("landar man på Standings i stället för Live") stämmer inte med standardvalet `live` på basen; åtgärden är ändå att fliken skrivs i adressen där den är känd.
- **Raden väntar högst 1 s (`ROW_WAIT_MS`) på att sidan ritas; därefter får sidans första synliga `h1` fokus** (utan `tabindex` sätts `-1` från skriptet, eftersom Board-rubriken inte har det och Board-vyerna inte ändras här). Står en modal dialog fortfarande öppen vid tidsgränsen flyttas inget.

## Webbläsarens Back under ett skick, och mobilens Cancel (RUN-443, v0.8.3)

- **Rotorsaken var två fel, inte ett.** (1) Back avmonterade arket under skicket (RUN-430 låser Cancel, ✕, Esc och skrim, inte Back): inget fokusmål fanns och fokus hamnade på `<body>`. (2) Skickets svar hanterades av `DuelsScreen.sendChallenge`, vars `closeSend()` kördes efter svaret på en skärm som inte längre var öppen: `setParams` på en avmonterad `/duels` navigerar ändå (routerns `navigate` släpps aldrig), så ett 201 som kom efter Back flyttade användaren från Board till `/duels` (mätt före fixen: `/board` → `/duels` med `replace`, utan någon bekräftelse). Låset (skrollås, `aria-hidden`, `inert`) lämnades redan rent av Radix vid avmontering; det mäts nu i både vitest och e2e.
- **Fokus efter Back är samma mål som Cancel: löparens rad när popupen öppnade flödet.** Arket fokuserar själv raden (`focusRunnerRowWhenRendered`, samma som skalet) när det stängs medan skicket är `pending`; det går inte via skalets fokusavsikt (`requestRunnerFocus`), eftersom den måste sättas före platsbytet och arket vet då inte om Back eller ett lyckat svar stängde det (svaret kommer först senare). Utan popupens ursprung (rubrikens Send, tokenkortens Send, mobilens Challenge, djuplänk) gäller `returnFocus` som förut (öppnaren, rubrikens Send, sidans rubrik); på mobil står Back på löparens sida, vars rubrik tar fokus när sidan monteras (samma som före).
- **Sökningen efter raden efter Back släpps när användaren går vidare.** `focusRunnerRowWhenRendered` väntar upp till 1 s (`ROW_WAIT_MS`) på att sidan ritar raden, och arket som startade den är avmonterat. Skalet avbryter därför sökningen vid nästa platsbyte (`dropRowSearchAfterBack` i `useRestoreRunnerFocus`, samma ställe som skalets egen sökning städas), och en fokusflytt till något annat än raden eller rubriken avbryter den också. Utan det kunde en annan sida med samma löpare ta fokus. Ett avvisat skick följt av Back (arket är då inte i skick, `idle`) ger ingen radfokus, som en vanlig Back från arket före 0.8.3 (fokus på `<body>`): det är inte ändrat här och är en möjlig uppföljning.
- **Utfallet visas där användaren står, utan ny global yta.** Står hen kvar på `/duels` (Back från `?send=1` till samma sida, eller popupen över Duels) visar sidan utfallet i sin bekräftelseregion: "Challenge sent to …", serverns eget fel (t.ex. 400 "Opponent already has …") eller den ärliga texten efter tidsgränsen (RUN-437), som fel-notis. Har Back tagit hen från `/duels` (Board, Log, löparens sida) visas ingenting nytt: ett toast eller en notis på en annan skärm hade krävt en global yta, och skicket är redan sparat i listorna. Omhämtningen (`useChallengeActions`: `refresh` vid lyckat svar och vid tidsgränsen) körs oavsett, så en skapad utmaning syns i Sent och tokenet är borta nästa gång hen öppnar Challenges, utan omladdning. Valet är medvetet och prövat: svaret flyttar aldrig användaren och tar aldrig fokus.
- **Ett svar hanteras en gång.** `DuelsScreen` håller identiteten på arket som är öppet (`openSheet`, en per öppning). Bara arket som skickade får sitt fel visat i sig och stängs efter ett lyckat skick; ett annat läge ger en notis på sidan i stället. Ett ark som öppnats på nytt (Back, sedan rubrikens Send) medan det första skicket är på väg får därmed varken stängas av det gamla svaret eller visa dess fel. Skicket går dock inte att stoppa från det nya arket: ett andra skick med samma token avvisas av servern (tokenet är förbrukat) och visas som vanligt. Att låsa Send medan ett tidigare skick är på väg är inte gjort (ingen manifestpunkt); det är en uppföljning om det visar sig hända.
- **Mobilens Cancel från `/runner/:id` Challenge ger `/duels` två poster efter Board (indexet N+2), och det är avsett enligt ADR 006 punkt 5.** Punkten gäller route-state bara för popupen (desktop) och säger uttryckligen att flöden utan `sendOrigin` (rubrikens Send, tokenkortens Send, "mobilsidans Challenge") är "oförändrade", och addendumet säger att mobilens Runner card är oförändrad i 0.8.3 (mobilparitet är en uppföljning). Mätt i e2e (`send-back-during-send.spec.ts`): Board (idx N) → löparens sida (N+1) → Challenge (N+2, `/duels?send=1&opponent=…`) → Cancel ersätter den posten med `/duels` (N+2, ingen extra post), fokus på rubrikens Send, och Back därifrån går till löparens sida (N+1), aldrig in i arket igen. Att rätta det (Cancel tillbaka till `/runner/:id` med fokus på Challenge) kräver ett ursprung också på mobilen (`SendOriginState` från `RunnerCard`, en `returnIdx` och ett fokusmål för länken), alltså en ändring av mobilens Runner card som ADR:n uttryckligen lämnar utanför; beteendet är därför fastställt av ett prov i stället för ändrat. Vill ägaren att mobilen ska gå tillbaka till löparens sida är det en egen story (samma mekanism som popupens, med länken som fokusmål).

## Titles held: typfilter och topplistans fel (RUN-421 och RUN-439, v0.8.3)

- **Filtrets kategorier räknas ur både innehavda titlar och Runner-up (`titleFilterOptions`).** Båda listorna visas och båda filtreras, så en kategori som bara har en Runner-up-titel får ändå en knapp (Pace i testdatan). Ordningen är `TITLE_CATEGORIES`, inte datans.
- **Filtret döljs vid noll eller en kategori (`options.length > 2`: "All" plus minst två).** Med en enda kategori ger "All" och kategorin samma lista, så det finns inget att välja. Ligger ett val kvar när datan ändrats under en öppen popup (`filter !== ALL_TITLES`) står filtret kvar, så att vägen tillbaka till "All" finns.
- **Panelens lista behåller `tabIndex=0`, men bara när den scrollar (`useScrollsVertically`).** En region som scrollar måste nås med tangentbordet; en lista som ryms är inget att tabba till. Måttet tas om vid storleksändring och när filtret ändrar innehållet.
- **Den ljusa overridern i `runner.css` lyfter tre färger till AA i det ljusa temat:** den vilande filterknappen (`--rq-text-2`, `--rq-text-3` ger 4,22:1), Runner-up-namnet (`--rq-text-2`) och den dämpade tonen på värdet (`--rq-text-4`, 4,14:1 med text-3). Samma scopade mönster som Overview och Journey; det mörka temat är oförändrat.
- **Topplistan som ger typ och enhet läses med `useTitleBoard`, som kastar vid fel (RUN-439).** `useTitleLeaderboard` sväljer fel och svarar `[]`, och då fick varje titel typen "Other" med råa värden och utan "held by". Nu gäller `failed` ett fel i antingen löparens titlar eller topplistan, panelen visar felkortet med Retry i både popupen och på `/runner/:id`, och Retry hämtar om båda. `useTitleLeaderboard` är orörd (profilen använder den). `useTitleBoard` ligger under `['titles']`, så invalideringen efter en runda når den.

## Historik (avgjort, kort)
Punkter som stod som öppna och sedan avgjorts. Detaljerna finns i CHANGELOG.md och ADR:erna.
- **Profilbildernas host i prod (`img-src`, RUN-344)** — verifierad av ägaren 2026-10-21: alla 6 profilbilder ligger på `yrrqaxdngayakcivfrck.supabase.co`, så skarp CSP blockerar ingen befintlig bild. Prod-röken kontrollerar fortfarande Sentrys host (`docs/release.md`, steg 4).
- **`['events']` invalideras när en runda loggas** — löst i inkrement 7 (`useCreateRun` invaliderar direkt och en gång till efter 4 s).
- **Edit-datumets max mot serverns UTC-"idag"** — löst i i9-dataspåret (servern validerar Stockholm-dagen och avvisar ogiltiga kalenderdagar).
- **`/login` som den gamla inloggningssidan** — omritad i inkrement 11, sedan en popup över Landing (RUN-145, ADR 006 addendum).
- **Backend-kontraktsfrågor löstes i i9-dataspåret 2026-10-05:** `source` i users-with-runs (Strava-rundor kan inte raderas; null = manuell), PUT kvalificerar event med dagsfönster (DELETE medvetet utan anrop, svarar 409 för kvalificerande rundor), Stockholm-datumvalidering.
- **Utgången eller ogiltig JWT gav 403** — nu 401 (`middleware/auth.ts`), så klienten loggar ut.
- **Init-loggen skrev service-nyckelns prefix** — loggar nu bara "set"/"missing" (`config/database.ts`).
- **Logout rensade inte användarspecifika query-cachar** — löst i RUN-143 (v0.6.0): `AuthProvider` kör `qc.clear()` vid login, logout och 401 (`AuthProvider.test.tsx`).
