# Öppna antaganden — redesignen

Lead underhåller. En rad per antagande: vad som antagits, var det bor, och vad som
skulle göra det fel. Antaganden som blivit beslut flyttas till STATE.md/ADR;
backend-kontraktsfrågor samlas längst ned inför nästa data-inkrement.

## Events (inkrement 6)
- "Your record" aggregeras i klienten: historiken läses i sidor om 50 (max 10
  sidor, trunkering loggas med console.warn). Blir fel den dag en grupp passerar
  500 avslutade event — ett aggregat-endpoint är rätt lösning på sikt.
- Event som avslutades innan en medlem gick med räknas som "missade" i facit
  (datan saknar inträdesdatum). Överdriver "left on the table" för sena medlemmar.
- Nedräkningsringens fyllnad = andel av fönstret som återstår (prototypens 62 %
  är hårdkodad och har ingen semantik).
- "Up next" = det event som öppnar först, oavsett typ; resten hamnar i This week.
- ~~Ingen invalidering av `['events']` när en runda loggas~~ LÖST i inkrement 7:
  `useCreateRun` invaliderar `['events']` direkt + en gång till efter 4 s
  (backend kör checkEventQualification fire-and-forget, första omhämtningen kan
  hinna före).
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
- ~~Edit-datumets max vs serverns UTC-"idag"~~ LÖST i i9-dataspåret: servern
  validerar nu Stockholm-dagen (todayStockholm).
- En runda kan bara ändras på datum och distans (servern tar inget annat).
- Strava-rundor: Delete är avstängd (title + sr-only enligt Titles valknapp) och en synlig rad med samma text
  (`aria-hidden`) lades till i redigeringsrutan så att touch-användare ser förklaringen — det ligger utanför det
  Lead bad om. Ägaren kan ta bort raden. `source` null/saknas behandlas som manuell.

## Pack News (inkrement 9)
- **"Mark all read" är den enda kvitteringen** (prototypen: knappen finns i både popover och skärm, inget i designen kvitterar vid
  besök/öppning). Att öppna popovern eller besöka /news markerar alltså INTE som läst — olästa rader förblir tintade tills knappen
  trycks. Vill ägaren ha "besök = läst" är det en rad i NewsScreen (kvittera vid mount/unmount).
- **Filtret:** `?type=` bär chip-nycklar (`titles,levels`), inte rå `ActivityType` — ADR 006 säger bara "kommaseparerat". Flera chips
  kan vara valda; alla fem = inget filter. Mobil har en chip-rad (App Prototype saknar filter; Web Prototype har ett statiskt kort
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
  calculateCurrentStreak ger 0 när senaste dag varken är idag eller igår — ingen grace-regel finns.
- **"+50 XP"-poppen ligger i banans mitt (text-anchor middle), inte där prototypen har den** (x 770 → 700): med den ursprungliga platsen klipptes
  texten av den klippta banrutan på desktop.
- **Banans löpare går med CSS offset-path på SVG-cirklar** (samma `rqOrbit` som stadion-laddaren) i stället för prototypens SMIL `<animateMotion>`, så
  `prefers-reduced-motion` stoppar dem. Silver- och bronsprickarna är heltäckande rankfärger (prototypen hade .75/.8 i alfa).
- **/login är fortfarande den gamla inloggningssidan** (inte omritad; ingen inkrement-rad i planen). Landingens knapp leder dit.
- **`App.tsx` kör `useAppInit` på alla routes, även `/` för utloggade.** Landing-FEATUREN anropar inget själv; App-skalet gör ETT Supabase-anrop
  (level_requirements, konsolfel om servern inte nås). Onboarding-prefetchen gör INGET anrop utan token (returnerar [] direkt). Samma anrop kördes
  redan när `/` var LoginPage. Gating på `user` hör hemma i en egen skaländring (påverkar även /preview-routes), inte i Landing.
- Inget `<title>`/meta per route och ingen statisk rendering av `/` (ADR 006 revisit-trigger om SEO) — sidan är en klientrenderad SPA-route.

## Skal & delat
- **Logout rensar inte användarspecifika query-cachar** (utom onboarding, som
  rensas sedan i10b): users-with-runs m.fl. ligger kvar om en annan användare
  loggar in i samma flik. Låg risk i en vängrupp; åtgärd = qc.clear() vid
  logout/401 — tas i en senare skalrunda.
- RÄTTAT 2026-10-04: Toastern ÄR monterad (AppProviders) och gamla `toast()`-
  anrop visas. Nya features använder ändå permanenta `role=status`-ytor —
  motivet är konsekvens och pålitlig uppläsning, inte att Toastern saknas.
- Feature-CSS laddas före index.css (main.tsx-importordningen) — overrides av
  delade klasser kräver sammansatta selektorer (dokumenterat i
  features/challenges/README.md).
- `toLocaleDateString('en-GB', {month:'short'})` kan ge "Sept" i nyare ICU —
  nya datumformat använder egna månadsnamn (eventsFormat gör rätt; titleFormat
  använder en-GB och är stabil i test men kan skilja mellan miljöer).

## Backend-kontraktsfrågor
LÖSTA i i9-dataspåret 2026-10-05: fråga 0 (Stockholm-datumvalidering + avvisade
ogiltiga kalenderdagar), fråga 6 (`source` i users-with-runs; frontend ska
blockera Delete för `'strava'` och tolka null som manual), fråga 7
(PUT kvalificerar event med dagsfönster; DELETE medvetet utan anrop —
en radering kan inte skapa kvalificering och avkvalificering vore en
regeländring; dessutom svarar DELETE nu 409 för kvalificerande rundor).
NYTT känt (orört): bakdaterad POST kan kvalificera ett pågående event
(POST/Strava saknar dagsfönstret — bedömt som acceptabelt tills vidare).
Backendens init-logger skriver ut service-nyckelns PREFIX i loggen — ta bort
raden (liten städfix, nästa backend-runda).
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
6. ~~Raderade Strava-rundor återuppstår~~ LÖST i i9: source-fält +
   Delete-block i Profile (synlig hint, null = manuell).
7. ~~PUT kvalificerar inte event~~ LÖST i i9 (PUT med dagsfönster; DELETE
   medvetet utan anrop, svarar 409 för kvalificerande rundor).
8. **Utgången/ogiltig JWT ger 403, inte 401** — frontend loggar bara ut vid
   401, så en användare borta >7 dagar fastnar på felkort överallt. BESLUT
   (Lead): backend ändrar jwt.verify-felet till 401 (autentisering, inte
   auktorisering); IDOR-403:orna är oförändrade. Tas i backend-mikrorundan.
9. **Init-loggen skriver service-nyckelns prefix** (config/database.ts:18) —
   raden tas bort i backend-mikrorundan, före release.
10. **Retractade news-rader** (avböjd/återkallad utmaning) försvinner ur
    klientens flöde först vid fokus/omladdning, inte vid poll (catch-up lägger
    bara till). Medvetet val i9c; läker vid window focus.

## Feature & Version + What's new (inkrement 11A)

- **changelog.json har ny form** `{ features, workingOn, releases }` (var en ren lista av releaser) så att sidans Features-/Working on-kort kommer ur samma fil som
  releaserna ("en källa"). Äldre poster är oförändrade. `docs/dokumentation.md` uppdaterad med formen.
- **Ändringstypen heter `bugfix`** (som prototypen och alla äldre poster), inte `fix` som dokumentation.md först skrev. Dokumentet rättat; versionsvakten kräver `bugfix`.
- **Versionsvakten kräver CHANGELOG.md-rubrik bara för versioner från dess äldsta rubrik (v2.0.0) och uppåt** — v0.x finns bara i changelog.json. Vill ägaren ha dem även
  i CHANGELOG.md måste historiken skrivas in där.
- **Datumformatet behålls** ("5 October 2026", som "2 April 2026") — prototypen har "24 aug 2026", men befintliga poster väger tyngre; vakten kräver formen.
- **Features-listan är kuraterad mot dagens app**: "Dark mode" och "Onboarding" från prototypens exempeldata är borta (ljust tema är förberett men inte designat; touren är
  inte ett säljargument), och nya funktioner (Duels, Runner card, Pack News, Log runs) tillagda. Working on = Badges + Notifications som i prototypen (båda finns på roadmapen).
- **Popupen har ingen prototyp** — härledd ur skalets delade modal (`.rq-modal`/`.rq-scrim`), Bebas-rubrik, hårlinjegrid för punkterna, en guldknapp. Fokus startar på "Got it".
- **Prototypens textsteg snappade till tokens**: kortrubrik 18 px → `--rq-fs-name` (20 på desktop), beskrivningar 16 px → `--rq-fs-body` (17 på desktop), release-datum 15 → `--rq-fs-meta`.
- **Alla som redan sett de gamla patchnotes (`patch_2026_04_02_*`) får 2.0.0-popupen en gång** — slugen `patch_v2.0.0` är ny. De gamla slugarna ligger kvar i tabellen, ofarliga.
