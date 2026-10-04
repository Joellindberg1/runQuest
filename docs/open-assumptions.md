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
- Edit-datumets max är Stockholm-dagen men servern validerar UTC-"idag" —
  samma gap som backend-fråga 0.
- En runda kan bara ändras på datum och distans (servern tar inget annat).

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
  "Miss a day and it starts over" är prototypens påstående och verifierades inte mot streak-motorn (grace-regler?).
- **"+50 XP"-poppen ligger i banans mitt (text-anchor middle), inte där prototypen har den** (x 770 → 700): med den ursprungliga platsen klipptes
  texten av den klippta banrutan på desktop.
- **Banans löpare går med CSS offset-path på SVG-cirklar** (samma `rqOrbit` som stadion-laddaren) i stället för prototypens SMIL `<animateMotion>`, så
  `prefers-reduced-motion` stoppar dem. Silver- och bronsprickarna är heltäckande rankfärger (prototypen hade .75/.8 i alfa).
- **/login är fortfarande den gamla inloggningssidan** (inte omritad; ingen inkrement-rad i planen). Landingens knapp leder dit.
- **`App.tsx` kör `useAppInit` (nivåtjänst + onboarding-prefetch) på alla routes, även `/` för utloggade.** Landingen anropar inget själv, men
  nätverksfliken visar dessa två anrop (nivåtjänsten loggar ett konsolfel om den inte når servern; onboarding-prefetchen sväljer sitt). Gating på `user` hör hemma i App-skalet, inte här.
- Inget `<title>`/meta per route och ingen statisk rendering av `/` (ADR 006 revisit-trigger om SEO) — sidan är en klientrenderad SPA-route.

## Skal & delat
- RÄTTAT 2026-10-04: Toastern ÄR monterad (AppProviders) och gamla `toast()`-
  anrop visas. Nya features använder ändå permanenta `role=status`-ytor —
  motivet är konsekvens och pålitlig uppläsning, inte att Toastern saknas.
- Feature-CSS laddas före index.css (main.tsx-importordningen) — overrides av
  delade klasser kräver sammansatta selektorer (dokumenterat i
  features/challenges/README.md).
- `toLocaleDateString('en-GB', {month:'short'})` kan ge "Sept" i nyare ICU —
  nya datumformat använder egna månadsnamn (eventsFormat gör rätt; titleFormat
  använder en-GB och är stabil i test men kan skilja mellan miljöer).

## Backend-kontraktsfrågor (samlas till nästa data-inkrement)
0. **Datumvalideringen i `POST /runs` jämför mot serverns UTC-"idag"** —
   mellan 00:00 och ~02:00 svensk tid nekas dagens datum som framtid (klienten
   räknar Stockholm, serverfelet visas graciöst). Backend bör validera mot
   Stockholm-dagen (dateUtils).
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
6. **Raderade Strava-rundor återuppstår:** DELETE /runs/:id saknar gravsten och
   synken återimporterar inom 7-dagarsfönstret. BESLUT (Lead): users-with-runs
   får ett source-fält och Profile blockerar Delete för Strava-rundor med
   förklaring ("radera i Strava i stället"). Tas i i9:s data-spår.
7. **PUT/DELETE /runs kvalificerar inte event:** bara POST anropar
   checkEventQualification — en redigering som når eventgränsen (eller radering
   som borde avkvalificera) missas. Frontendens 4s-uppföljning efter edit/delete
   är verkningslös tills detta fixas. Tas i i9:s data-spår.
