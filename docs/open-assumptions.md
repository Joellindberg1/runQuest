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

## Skal & delat
- Toastern är inte monterad i appen — gamla `toast()`-anrop i äldre features
  visar ingenting. Nya features bekräftar via permanenta `role=status`-ytor.
  Åtgärd: ta bort de döda anropen eller montera Toaster (eget litet ärende).
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
