# Lasttest mot staging (RUN-289)

Intern förvaltningsdokumentation (svenska, för Lead och ägaren). Lasttestet visar hur backend beter sig när många använder appen
samtidigt, och var det första som tar slut. Det körs mot staging, aldrig mot prod, och av Lead eller ägaren, aldrig av en byggare
och aldrig av CI. Verktyget bor i `scripts/loadtest/`; det här dokumentet är målen (nedskrivna före första körningen), hur man kör det,
rapportmallen och listan över fynd.

Status: verktyget är byggt och provat mot en lokal fejkserver. **Ingen körning mot staging är gjord**; resultatdelen nedan är tom
tills Lead eller ägaren har kört.

## Mål

Nedskrivna 2026-10-18, **före första körningen**. De är källan för vad "godkänd" betyder och ligger i kod i
`scripts/loadtest/targets.mjs` (ändra dem bara med en motivering här och i commit-meddelandet, aldrig för att få en körning grön).

| Mål | Värde | Varför |
|---|---|---|
| Samtidiga användare | 20 | Dagens grupper har drygt tio medlemmar; 20 är ungefär dubbelt så många som en riktig topptimme (alla öppnar topplistan efter en tävling). |
| Belastningstid | 120 s | Tillräckligt för att kalla cacher, anslutningar och Supabase-gränser ska visa sig; kort nog för att inte fylla staging med data. |
| Felkvot | högst 1 % | Fel = 5xx, andra 4xx än 429, nätverksfel, timeout (15 s) och omdirigeringar, av alla anrop. |
| 429-svar | 0 | Ett 429 betyder att provet drog på sig en gräns som är till för att skydda appen. Det är ett fynd, inte brus (se Rate-limits). |
| p95 inloggning | 1 500 ms | bcrypt (`bcryptjs`, ren JavaScript) kostar CPU på en enda Railway-instans. |
| p95 topplista (`GET /api/leaderboard/week`) | 800 ms | Vyn man ser först; läser hela gruppens rundhistorik vid kall cache. |
| p95 news (`GET /api/news?limit=20`) | 800 ms | Läses av alla inloggade. |
| p95 logga runda (`POST /api/runs`) | 3 000 ms | Skrivande flöde: insert, omräkning av XP, totaler, titlar, badges och eventkontroll i ett anrop. |

Latenserna mäts hos klienten och inkluderar nätet mellan provkörarens dator och Railway. De är alltså högre än serverns egen tid
(Sentry visar den, `docs/performance.md`). Kör från en vanlig bredbandsuppkoppling; en mobil hotspot ger bruset i p95.

Det finns inget mål för genomströmning (förfrågningar per sekund): appen har inget krav på det, och blandningen nedan är
användarlik, inte en maxbelastning. Det här är ett kapacitetsprov för den grupp appen har, inte ett uthållighetsprov.

Bara en körning med minst 20 användare i minst 120 s räknas som mätningen. Rapporten märker mindre körningar "avgränsad körning".

## Scenarier

Varje virtuell användare går i en sluten slinga: välj ett scenario ur blandningen, gör anropet, vänta ungefär 0,8 s (slumpat
0,4–1,2 s), igen tills tiden är slut. Virtuella användare delar testkontona jämnt.

| Scenario | Anrop | Vikt | Budget | Skriver data |
|---|---|---|---|---|
| Topplista | `GET /api/leaderboard/week` | 45 | – | nej |
| News | `GET /api/news?limit=20` | 40 | – | nej |
| Logga runda | `POST /api/runs` | 10 | 30 rundor per körning | **ja**, se Data och städning |
| Inloggning | `POST /api/auth/login` | 5 | 10 inloggningar per körning (utöver en per konto i förberedelsen) | nej |

Före belastningen loggar varje konto in en gång (förberedelsen); misslyckas något konto avbryts allt innan last läggs på.
Efter belastningen raderas de skapade rundorna (`DELETE /api/runs/:id`, en i taget). Städningen mäts men räknas inte in i målen.

## Skyddsräcken

- **Aldrig prod.** `scripts/loadtest/guard.mjs` är en tillåtelselista på värden: bara `runquest-backend-staging-staging.up.railway.app`
  (https, standardport) samt `localhost`, `127.0.0.1` och `[::1]` släpps igenom. Allt annat vägras innan något anrop görs: prod-domänerna,
  Supabase-värdar, en prod-lik Railway-adress, värdar som bara *innehåller* ett tillåtet namn (`localhost.evil.example`),
  `user@host`-knep, bassökväg och inloggningsuppgifter i URL:en. Värden tolkas med URL-parsern, inte med textsökning.
  Klienten prövar dessutom att varje anrops slutliga URL ligger på samma origin, och följer aldrig omdirigeringar (ett 3xx räknas som fel).
  Vakten har egna tester (`guard.test.mjs`) och klienten bygger inte ens utan en godkänd bas-URL.
- **Aldrig Strava.** Klienten har en tillåtelselista på metod + exakt sökväg med fem rutter (`/api/auth/login`, `/api/leaderboard/week`,
  `/api/news`, `POST /api/runs`, `DELETE /api/runs/:uuid`). Allt annat, `/api/strava/*` särskilt, kastar innan ett anrop görs
  (test: `client.test.mjs`). Utöver det importerar de fyra backendrutterna (`auth`, `leaderboard`, `news`, `runs`) ingen Strava-kod, och
  en runda som lasttestet loggar har `source: 'manual'`, så den väcker varken Strava-importen eller webhook-arbetaren. Strava är dessutom
  avstängt i staging. Rutterna för inloggning, topplista, news och rundor gör ingen extern HTTP-förfrågan (bara Supabase): väder-API:t anropas bara av
  Strava-flödena och av schemaläggarens Storm Chaser-kontroll, och backend skickar varken e-post eller push.
- **Aldrig i CI.** `run.mjs` vägrar när `CI` är satt.
- **Inloggningsuppgifter bara ur miljön.** `LOADTEST_USERS`; inget hårdkodas, inget loggas, inget skrivs i rapportfilen
  (felmeddelanden om en felaktig `LOADTEST_USERS` citerar aldrig innehållet, eftersom ett JSON-fel annars kan visa ett utdrag).
- **Budgetar före anrop.** Inloggnings- och rundbudgeten dras ner innan anropet, så samtidiga användare aldrig tillsammans överskrider dem.

## Rate-limits

| Gräns | Var | Berör lasttestet |
|---|---|---|
| Inloggning: **20 försök per 15 minuter och IP**, alla försök räknas (även lyckade) | `middleware/rateLimit.ts`, delad in-memory-karta | **Ja.** Därför får en körning högst 15 inloggningar sammanlagt (konton + `LOADTEST_LOGIN_BUDGET`, kontrollerat i `config.mjs`). |
| News `POST /api/news/read`: 240 per minut och IP | `routes/news.ts` | Nej (lasttestet läser bara). |
| Settings PUT, väntelista (5 per 15 min), Strava (synk pausad, koppla bort) | respektive route | Nej. |

Hur lasttestet förhåller sig till dem:

- Alla virtuella användare kommer från **samma IP** (provkörarens), så de delar en räknare. 20 per 15 minuter är medvetet snålt och
  räcker inte för att "logga in 20 användare samtidigt" varje gång, därför loggar lasttestet in varje konto en gång och återanvänder
  token (en riktig app gör likadant: token gäller i sju dagar).
- Slår ändå ett 429 till på inloggningen slutar lasttestet logga in resten av körningen i stället för att hamra på gränsen, och
  rapporten visar 429-antalet. Målet är noll.
- **Vänta 15 minuter mellan körningar**, eller sätt `LOADTEST_LOGIN_BUDGET=0` för en körning till. Ägarens egna inloggningar i appen från
  samma IP delar räknaren. En omstart/deploy av backend nollställer den (in-memory).
- Gränsen är en uppgiven kandidat till fynd: in-memory-räknare gäller bara en instans (appen kör en replika, kommentaren i `rateLimit.ts`),
  nollställs vid varje deploy och kan låsa ut en hel grupp om `trust proxy` inte stämmer så att alla delar proxyns IP. Lasttestet
  *bevisar* inget av det; det är något att titta efter om ett 429 dyker upp (se Att titta efter).

## Data och städning

Att logga runda skapar riktig data i stagingdatabasen. Lasttestet gör det på tre sätt synligt och återställbart:

1. **Märkning.** Varje runda skickas med en `Idempotency-Key` (uuid v4) vars första grupp är `10ad7e57`, och med den fasta distansen
   **1,01 km** (backendens minimum är 1,0). Rundtabellen har inget anteckningsfält, så märket sitter i `runs.client_request_id`.
   Rundan loggas på dagens datum (Stockholm).
2. **Automatisk städning.** När belastningen är slut raderas varje skapad runda med `DELETE /api/runs/:id`, den vanliga vägen, som även räknar
   om användarens XP, streak och totaler. Det är därför städningen går via API:t och inte via SQL.
3. **Rapport över det som blev kvar.** Rapporten och rapportfilen (`scripts/loadtest/out/loadtest-*.json`, ignorerad av git) listar skapade
   rundors id och nycklar, vilka som inte gick att radera, och nycklarna till anrop som inte gav något id tillbaka (ett 500 med
   `written: true` kan ha lämnat en runda).

Det som städningen **inte** tar bort (kontrollera i staging efter första körningen och komplettera listan här):

- Pack News-rader (`activity_log`) som rundorna gav upphov till: `level_up`, `run_milestone`, `rank_passed` (en minskning retractar dagens
  `rank_passed`, men inte övriga).
- Badges och titlar som `evaluateBadges` och titelomräkningen kan ha delat ut medan rundorna fanns; challenge-tokens från `reconcileTokensForLevel`.
- Lässtatus för news (`news_last_seen_id`) påverkas inte av lasttestet (det skriver aldrig `/seen` eller `/read`).

**Innan körning:** kontrollera att staging inte har ett aktivt eller schemalagt event i testgruppen. Ett event kan kvalificera en av
lasttestets rundor, dela ut XP och skapa en `event_entries`-rad; rundan går då inte att radera (409, "kvalificerade ett event") och utdelad XP
dras inte tillbaka. Städningen redovisar sådana rundor som "kvar" i stället för att fela.

**Städa efteråt**, i den här ordningen:

1. Normalfallet är klart: städningen körs i slutet av varje körning. Kontrollera raden "Städning: N borttagna, 0 kvar, 0 misslyckades".
2. Blev något kvar, eller kördes provet med `LOADTEST_KEEP_RUNS=1`:
   `npm run loadtest:cleanup -- scripts/loadtest/out/<rapportfil>.json` (samma `LOADTEST_USERS` och `LOADTEST_BASE_URL` som körningen).
3. Reserv om API-städningen inte går (Lead, mot `supabase-staging`). Läs först:
   ```sql
   select id, user_id, date, distance, client_request_id
   from runs
   where client_request_id::text like '10ad7e57-%';
   ```
   Radera sedan raderna, och räkna om användarnas totaler genom att anropa `POST /api/auth/recalculate-totals` som varje testkonto
   (en SQL-radering ensam lämnar `users.total_xp` och streak på gamla värden).
4. Är stagingdatabasen ändå förorenad (badges, news) och det spelar roll: bygg om testgruppen enligt `docs/staging.md` (`staging:seed-group`).

## Så kör du

Förutsättningar:

- Du kör från en dator vars IP du kan avvara 15 minuter i taget för inloggning mot staging (se Rate-limits).
- Stagingtjänsterna är uppe på den branch som ska provas, och Strava är avstängt (så är det i staging).
- Testkonton i staging (gruppen "Staging Pack", `docs/staging.md`). Uppgifterna ligger i ägarens lokala, gitignorerade seed-fil och
  **aldrig i repot**. Använd gärna 3–5 konton: fler konton sprider rundorna, men varje konto kostar en inloggning av de 15.
- Ingen aktiv eller schemalagd event i testgruppen.

Kommandon från repo-roten (Node 20+, inga beroenden att installera):

```bash
# 0. Rökprov mot fejkserver på 127.0.0.1 (ingen riktig tjänst, påhittade konton): visar utskriften och bevisar verktyget
npm run loadtest:local

# 1. Rökprov mot staging: 3 användare, 20 s (ger inte mätningen, men bekräftar att kontona och vakten fungerar)
LOADTEST_USERS='[{"login":"<konto1>","password":"<lösen1>"},{"login":"<konto2>","password":"<lösen2>"}]' \
LOADTEST_VUS=3 LOADTEST_DURATION_S=20 npm run loadtest:staging

# 2. Mätningen: 20 användare, 120 s (standardvärdena)
LOADTEST_USERS='[...]' npm run loadtest:staging
```

PowerShell:

```powershell
$env:LOADTEST_USERS = '[{"login":"<konto1>","password":"<lösen1>"},{"login":"<konto2>","password":"<lösen2>"}]'
npm run loadtest:staging
Remove-Item Env:LOADTEST_USERS
```

Sätt variablerna bara i det skal du kör i och ta bort dem efteråt. `LOADTEST_BASE_URL` behövs inte (standard är stagingbackenden) och
accepterar bara de värden vakten tillåter.

| Variabel | Standard | Betydelse |
|---|---|---|
| `LOADTEST_USERS` | – (krävs) | JSON-lista `[{"login": "...", "password": "..."}]`. `login` är namn eller e-post. Högst 15 konton. |
| `LOADTEST_BASE_URL` | stagingbackenden | Bara stagingbackenden eller localhost/127.0.0.1 godtas. |
| `LOADTEST_VUS` | 20 | Samtidiga användare (1–50). |
| `LOADTEST_DURATION_S` | 120 | Belastningstid i sekunder (5–1800). |
| `LOADTEST_THINK_MS` | 800 | Medeltid mellan en användares anrop. |
| `LOADTEST_TIMEOUT_MS` | 15000 | Tidsgräns per anrop; ett anrop som drar över räknas som fel. |
| `LOADTEST_LOGIN_BUDGET` | 10 | Inloggningar under belastningen (konton + budget högst 15). |
| `LOADTEST_RUN_BUDGET` | 30 | Rundor som får loggas under körningen (0–200). `0` stänger av det skrivande scenariot. |
| `LOADTEST_KEEP_RUNS` | – | `1` lämnar rundorna kvar (för att granska dem), städa sedan med `loadtest:cleanup`. |
| `LOADTEST_OUT_DIR` | `scripts/loadtest/out` | Var rapportfilen skrivs. |

Utgångskod: 0 målen nåddes, 2 målen missades, 1 felaktig konfiguration, nekad bas-URL eller misslyckad förberedelse.

Tips för att se orsaken till ett missat mål: öppna Sentry (`runquest-backend`, miljö `staging`, Performance) för tidsfönstret i
rapporten; transaktionerna heter som rutterna (`POST /api/runs`) och visar vilka Supabase-anrop tiden gick till.

## Rapportmall

Fylls i av Lead eller ägaren efter körningen. Klistra in tabellerna som skriptet skriver ut.

**Körning**

| Fält | Värde |
|---|---|
| Datum och klockslag | |
| Körd av | |
| Branch/commit i staging | |
| Provkörarens nät (hem/kontor/hotspot) | |
| Antal konton | |
| `LOADTEST_VUS` / `LOADTEST_DURATION_S` | |
| Övriga avvikelser från standardvärdena | |
| Rapportfil (sparas utanför git) | |

**Resultat per scenario**

| Scenario | Anrop | Ok | 429 | Fel | p50 ms | p95 ms | p99 ms | Max ms |
|---|---|---|---|---|---|---|---|---|
| Inloggning | | | | | | | | |
| Topplista | | | | | | | | |
| News | | | | | | | | |
| Logga runda | | | | | | | | |

**Mot målen**

| Mål | Gräns | Utfall | Resultat |
|---|---|---|---|
| Felkvot | 1 % | | |
| 429-svar | 0 | | |
| p95 inloggning | 1 500 ms | | |
| p95 topplista | 800 ms | | |
| p95 news | 800 ms | | |
| p95 logga runda | 3 000 ms | | |
| **Sammanlagt** | | | |

**Städning**

| Fält | Värde |
|---|---|
| Rundor skapade | |
| Borttagna av städningen | |
| Kvar (409 event / misslyckade) | |
| Rundor utan id i svaret (nycklar) | |
| Reservstädning med SQL behövdes? | |
| Rester i staging (news, badges, titlar) och vad som gjordes åt dem | |

**Observationer** (CPU/minne i Railway, Supabase-gränser, Sentry-fönster, avvikelser under körningen)

> _(fylls i)_

## Att titta efter

Hypoteser inför första körningen, **inte fynd**. De kommer ur läsning av koden; en körning avgör om de stämmer.

- `POST /api/runs` är det dyraste anropet: insert, omräkning från rundans datum, `calculateUserTotals` (läser alla användarens rundor,
  utvärderar badges, titlar, rank) och eventkontroll, sekventiellt i ett anrop. Titta på p95 och på om tiden växer med antalet rundor per konto.
- `GET /api/leaderboard/week` läser *hela* gruppens rundhistorik sidvis (1 000 rader per sida) för "bästa vecka någonsin", cachat i
  fem minuter per grupp och process. Första anropet efter en deploy är långsammare; titta på max-värdet.
- Inloggningen använder `bcryptjs` (ren JavaScript) på en enda Node-instans. Samtidiga inloggningar kan fördröja alla andra anrop
  under tiden. Jämför p95 för topplistan med och utan inloggningsscenariot (`LOADTEST_LOGIN_BUDGET=0`).
- Inloggningsgränsen (20 per 15 minuter och IP): ett 429 i rapporten betyder att antingen budgeten överskreds av någon annan från samma IP
  eller att räknaren delas av fler än väntat (kontrollera `trust proxy` och IP i Railway-loggen).
- Supabase gratisnivå i staging: titta efter fel som kommer i klungor (anslutningstak) snarare än jämnt fördelade.

## Fynd

Varje fynd blir ett eget Jira-ärende (projekt RUN) och listas här med nyckel. Tom tills första körningen är gjord.

| Ärende | Fynd | Scenario | Allvar | Status |
|---|---|---|---|---|
| | | | | |

## Begränsningar

- Mätningen är en klient på en dator mot en instans; den visar kapacitet för den grupp appen har, inte för tusentals användare.
- Frontend och bilder ingår inte; lasttestet går mot API:t. Sidans laddningstider mäts av Lighthouse och Web Vitals (`docs/performance.md`).
- Staging har mindre data än prod. Svaren från topplistan och news blir större i prod; ett godkänt resultat här är därför inte ett löfte om prod.
- Lasttestet räknar ingen belastning från schemaläggare (Strava-polling, nattlig avstämning) som kan köra samtidigt i en riktig miljö.
