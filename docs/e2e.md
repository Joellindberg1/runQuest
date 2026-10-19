# E2E-rök med Playwright (mot staging)

Intern förvaltningsdokumentation (svenska, för Lead och ägaren). ADR 001 sköt Playwright tills en miljö skild från prod fanns; sedan
2026-10-17 finns staging ([`docs/release.md`](release.md), "Preview på staging"), och sviten bor i `apps/e2e`. Den är en rök, inte en
regressionssvit: åtta specfiler, kortaste kedjan som bevisar att flödena i `STATE.md` ("Kritiska flöden") lever.

## Det viktigaste: sviten körs aldrig mot prod

Sviten loggar in, loggar en runda och raderar den. Mot prod vore det verkliga användare och verkliga totaler. Skyddet har tre lager och
bor i `scripts/e2e-guard.mjs` (testat i `scripts/e2e-guard.test.mjs`, körs i CI):

1. **Adresserna.** `E2E_BASE_URL` och `E2E_API_URL` måste vara exakt stagingtjänsterna (en tillåtelselista, inte en spärrlista över prod) eller
   localhost. Allt annat vägrar startet, också en adress som bara liknar staging (`...up.railway.app.evil.example`, inloggning i adressen,
   `http` mot staging, en port). Konfigurationen (`apps/e2e/playwright.config.ts`) anropar vakten när den läses, så varken `playwright test`
   eller `playwright test --list` startar mot fel miljö. Byter stagingtjänsterna adress ändras konstanterna överst i `e2e-guard.mjs`, i en PR.
2. **Stagingbygget.** Före första testet läser `support/global-setup.ts` `robots.txt` från frontenden: ett stagingbygge svarar `Disallow: /`
   (`apps/frontend/stagingGuard.ts`), ett prodbygge släpper in sökrobotar. Det fångar en stagingadress som i själva verket serverar prod.
3. **Förfrågningarna.** Varje test avbryter alla förfrågningar till `runquest.dev` (med subdomäner) och till **varje** `*.up.railway.app` utom de två
   stagingvärdarna, och fäller sig självt om någon gjordes (`support/test.ts`, `isBlockedRequestUrl`). Det är en tillåtelselista för Railway: prodens värdnamn
   (`runquest-production-1866…`, `spectacular-rebirth-production-186c…`) går inte att gissa, och en ny prodvärd är blockerad redan innan någon listat den.
   Pekar stagingfrontenden av misstag på prodens API når ingen skrivning fram. Backendens stagingadress delas med lasttestets vakt
   (`scripts/loadtest/guard.mjs`, `STAGING_BACKEND_URL`; ett test låser att de är samma).

Workflowen bevisar dessutom i varje körning att konfigurationen vägrar prod (steget "The guard refuses production").

## Vad specerna bevisar

| Fil | Flöde i STATE.md | Bevisar |
|---|---|---|
| `tests/auth.setup.ts` | 1 Login | Testkontot loggar in genom dialogen och sessionen sparas för övriga specer |
| `tests/login.spec.ts` | 1 Login | Fel lösenord lämnar dialogen öppen med felet; utloggad på en skyddad sida → `/login?next=…` och tillbaka efter inloggning, och inloggningsanropet går till stagingbackenden; sessionen överlever omladdning; Log out → `/` och token borta |
| `tests/access.spec.ts` | 1 Login | Ett vanligt konto som öppnar `/admin` skickas till Board; stagingbannern syns (hoppas över mot localhost) |
| `tests/board.spec.ts` | 4 Leaderboard | Board visar hela gruppen i den ordning servern rankar (podiet och tabellen "Rest of the pack" mot `GET /auth/users-with-runs`), antalet löpare i rubriken stämmer, flikarna Week/Streaks/All-time öppnas |
| `tests/log-run.spec.ts` | 2 Logga runda | 1,5 km i formuläret ger bekräftelsen, ökar XP och distans (mätt mot API:t), syns i Group history med "mine"-markering; radering återställer totalerna exakt; under minimidistans skickas ingenting |
| `tests/news.spec.ts` | 8 Pack News | Sju chips i rätt ordning som slås av och på via `?type=` (ADR 011 B7); läst-vid-hover med riktig pekare: fokus ensam markerar inget, en pekare som rör sig in över raden gör den läst (`POST /news/read`) och det består efter omladdning (ADR 011 addendum 2026-10-14) |
| `tests/landing.spec.ts` | 1 Login | Den förrenderade `/` och laddningsvyn (ADR 006 addendum 2026-10-19): utan JavaScript syns landningens h1; animationernas starttid är oförändrad efter hydrering; `/login` ger landning med dialogen öppen; en inloggad besökare på `/` hamnar på `/board` (exakt två dokumentbegäranden) utan att landningen någonsin fanns i DOM; landningen står kvar när lagringen är blockerad; stilmallarna på `/` och `/legal` ligger under 50 000 överförda bytes (loggas); tourens stängknapp har fokusring vid sex Tab-tryck; sidvisningarna (utloggad med utm = 1 visning med bara vitlistade värden, inloggad = bara `/board`, inloggning från landningen = `/`, `/login`, `/board` utan dubbel; **hoppas över mot staging**, se nedan). Med fullappens JS fördröjd 2 s (`support/loadingView.ts`) visar inloggning från `/`, en inloggad besökare på `/` och direktladdning av `/board` och `/legal` laddaren (`role="status"`, texten "Loading") inom 500 ms och loggen över bildrutor och DOM-ändringar har aldrig en tom ruta. Med topplistans svar (`GET /auth/users-with-runs`) hållet (`holdStandings`) står laddaren kvar efter inloggning från `/`, för en inloggad besökare på `/` och vid direktladdning av `/board` tills svaret släpps, skalet ritas inte före det, podiet är ifyllt när Board syns och ingen bildruta visar Board utan podium. Med titlarna hållna (`holdTitles`, stubbat API) står laddaren kvar också efter att gruppen svarat, ingen bildruta visar ett podiekort med "No titles held yet", en platt rank-pil eller utan badge-mini (stubben ger alla tre: `titles/user`, `leaderboard/rank-delta`, `badges/group`), och varje fråga går en gång. Klientsidig navigering visar ingen laddare igen; ett misslyckat första svar (`failStandings`) ger skalet inom 5 s (laddaren ger vika vid första försöket, långt före omförsökens slut efter ca 7 s; 5 s ger marginal för en långsam runner mot staging) och Boards felvy när omförsöken är slut, och ett svar som aldrig kommer släpper laddaren efter 8 s. Geometriprovet (320, 390 och 1440 px) mäter laddarens rektangel i `index.html` före JS och i gaten efter React: ca 217 x 167 px (tre gånger förra storleken), identisk inom 1 px, inom fönstret och utan sidled scroll |
| `tests/landing-waitlist.spec.ts` | 1 Login | Väntelistan i den förrenderade `/` (RUN-336): med landningens JS hållen går formuläret inte att fylla i (`inert`) och det ifyllda finns kvar efter hydrering; Enter före hydrering skickar inget och laddar inte om sidan; efter hydrering (formuläret inte längre `inert`) kan det fyllas i och skickas och tackrutan visas (POST fångad, inget skrivs) |
| `tests/news-chips.mobile.spec.ts` | 8 Pack News | Playwright-kandidaten ur ADR 011 och `features/news/README.md`: på 412 px scrollar de sju chipsen sidledes i sin rad (`scrollWidth > clientWidth`) utan att göra sidan bredare, och sista chipet nås med tangentbordet |

Flöde 5 (utmaningar), 6 (events), 7 (profilbild), Strava (3, 10) och badges (9) ingår inte: Strava är avstängt i staging, och resten är inte en del av
första röken (AC: inloggning, logga runda, topplista, Pack News).

Spåren är verifierade mot den riktiga frontenden på localhost med en fejkad backend (se "Hur sviten provades" nedan); mot staging har de inte körts av byggaren.

## Testkonto och secrets

Sviten använder ETT dedikerat staging-testkonto (gruppmedlem, inte admin). Uppgifterna finns bara i miljön, aldrig i repot:

| GitHub-secret (Settings → Secrets and variables → Actions) | Innehåll |
|---|---|
| `E2E_USER_LOGIN` | Det man skriver i Username-fältet: användarnamn eller e-post |
| `E2E_USER_PASSWORD` | Lösenordet |

Stagingadresserna är inga secrets: de står i `.github/workflows/e2e-staging.yml`. Kontot skapas av Lead i stagingdatabasen (inte i prod) och ska:

- vara medlem i en grupp (annars har det ingen Board, ingen Group history och inga nyheter: ADR 012),
- inte vara admin,
- ha **olästa Pack News-rader** (se nästa avsnitt).

Ett andra konto behövs inte.

### Fylla på olästa rader (Lead)

Läst-vid-hover-testet (`tests/news.spec.ts`) behöver en oläst rad i testkontots flöde och **förbrukar en per körning**. Finns ingen **fäller testet**, med
meddelandet "staging needs new unread Pack News rows for the test account"; det hoppar inte över sig, eftersom ett tyst grönt test vore ett test som slutat
bevisa något. Nattkörningen blir alltså röd tills Lead fyllt på. En rad räknas som oläst för kontot bara om den:

- kommer från en annan löpare i gruppen (kontots egna handlingar räknas aldrig),
- skapades efter att kontot skapades och inte är backfill,
- är av ett slag som är påslaget för kontot (standard: alla utom "Rank changes between others"), och
- ligger över kontots golv och inte i `news_read` (golvet höjs av "Mark all read", så tryck aldrig det med testkontot).

Praktiskt: låt staging-gruppens seedlöpare (testgruppen "Staging Pack", `staging:seed-group`) få händelser efter kontots skapande, till exempel nivåhöjningar,
milstolpar (100 km), badges eller titelbyten (`level_up_others`, `run_milestone_others`, `badge_earned_others`, `title_others`), några per vecka. Mät med
`GET /api/news` som testkontot: `meta.unread_count`. Räcker det med tio rader klarar sviten tio nätter.

## Städning och idempotens

Bara `log-run.spec.ts` skriver data. Testrundan har distansen **1,5 km** (`E2E_RUN_KM` i `support/api.ts`) på testkontot:

- Före testet raderas alla manuella rundor med exakt den distansen på kontot, och kontots totaler räknas om (`POST /auth/recalculate-totals`), så en gammal
  avvikelse i seeddatan inte ser ut som ett fel i jämförelsen före/efter.
- Testet raderar rundan själv (`DELETE /runs/:id`) och jämför totalerna med före-läget.
- `afterEach` raderar igen om testet föll på vägen. En körning som dör mitt i städas av nästa körning.
- Använd aldrig 1,5 km för riktiga rundor på testkontot. Kvalificerar en 1,5 km-runda ett event raderas den inte (409: en kvalificerande runda kan inte raderas, se
  `routes/runs.ts`); ett stagingevent med så låg distansgräns får då inte vara öppet, annars faller testet med det felet och rundan måste tas bort för hand.

Strava är avstängt i staging, så rundan loggas manuellt i appen.

## Köra mot staging

### I CI

Workflowen `.github/workflows/e2e-staging.yml`: manuellt (Actions → "E2E (staging)" → Run workflow) och varje natt 03:20 UTC. Den

1. kontrollerar att secrets finns (saknas de fäller en manuell körning tydligt; en nattlig hoppar över med en notis, så schemat inte blir rött innan de skapats),
2. kör `npm ci`, typkontrollerar sviten, bevisar att vakten vägrar prod,
3. kör `npx playwright install --with-deps chromium`,
4. kör sviten (egen gräns 4,5 min, jobbet 15 min) och laddar vid fel upp **bara skärmbilderna** (PNG, 7 dagar).

**Vad som aldrig laddas upp, och varför (repot är publikt).** Playwright skriver vid varje fel `test-results/**/error-context.md` med en ARIA-ögonblicksbild av
sidan, och ett ifyllt lösenordsfälts värde står där i klartext (det sker vid varje misslyckat `expect`, oavsett trace/screenshot/video; `PLAYWRIGHT_NO_COPY_PROMPT`
stänger bara av den variant som inte kommer från en matcher). `fill("<värde>")` skriver dessutom värdet i anropsloggen i varje timeoutfel. Ett spår (`trace.zip`) bär
sessionens JWT i `Authorization`-huvudena. Därför:

- `error-context.md` och `trace.zip` laddas aldrig upp. Steget "Keep screenshots only" kopierar bara `*.png` till en egen mapp; lösenordsfältet visas som prickar.
- Steget "Verify the artifact carries no credentials" söker igenom mappen efter `E2E_USER_PASSWORD` och `E2E_USER_LOGIN`; träff = inget laddas upp och körningen fäller.
  (Ett mycket kort användarnamn kan teoretiskt matcha slumpmässiga bytes i en PNG; då fäller steget i onödan, vilket är den säkra riktningen.)
- Inloggningen sätter fältvärdena med `evaluate` (`support/signIn.ts`), så värdena inte hamnar i Playwrights anropslogg, och tömmer lösenordsfältet direkt efter klicket.
- Specerna som skriver in lösenordet (`auth.setup.ts`, `login.spec.ts`) spelar dessutom inte in något spår, skärmbild eller video.
- Hemligheterna maskas i körningsloggen av GitHub.

För felsökning räcker felmeddelandet i loggen och skärmbilden; vill man ha ett spår kör man lokalt (`npx playwright show-trace`).

`workflow_dispatch` kan bara startas när workflowfilen finns på standardbranchen (`main`); före merge provas den inte på en gren. PR-flödet (`ci.yml`) kör bara
den delen som inte behöver staging: vaktens test, typkontroll och `playwright test --list` av sviten (ingen webbläsare, inget nätverk).

### Lokalt mot staging

Installera webbläsaren en gång (`npx playwright install chromium`; i CI görs det av workflowen) och kör från repo-roten:

```bash
export E2E_BASE_URL=https://runquest-frontend-staging-staging.up.railway.app
export E2E_API_URL=https://runquest-backend-staging-staging.up.railway.app
export E2E_USER_LOGIN=...      # sätts i skalet, aldrig i en fil i repot
export E2E_USER_PASSWORD=...
npm run test:e2e --workspace=@runquest/e2e
```

Bara lista specerna (ingen webbläsare, inga uppgifter): `E2E_BASE_URL=http://localhost:8080 E2E_API_URL=http://localhost:3001 npm run test:e2e:list --workspace=@runquest/e2e`.
Adresser till localhost går också att köra mot, till exempel en lokal frontend med `VITE_API_URL` mot stagingbackenden; vakten tillåter localhost för
frontenden och backenden var för sig. `apps/e2e/.auth/` (sparad session, en giltig JWT) och `test-results/` är gitignorerade.

### Köra mot ett lokalt bygge med fejkat API (valfritt)

För att bevisa landningens och laddningsvyns specer utan staging: bygg frontend (`VITE_APP_ENV=staging npm run build --workspace=@runquest/frontend` ger ett stagingbygge, ett vanligt bygge går också), servera `apps/frontend/dist` med repo-rotens `Caddyfile` (så att regeln för `/` gäller; rendera `{{.DIST_DIR}}` som `scripts/verify-static-serving.sh` gör) och kör sviten med `E2E_STUB_API=1`:

```bash
export E2E_BASE_URL=http://localhost:18100 E2E_API_URL=http://localhost:3001 E2E_STUB_API=1
export E2E_USER_LOGIN=stub-login E2E_USER_PASSWORD=any-made-up-value   # fejkkontot; inget riktigt konto
cd apps/e2e && npx playwright test tests/landing.spec.ts tests/login.spec.ts --project=desktop
```

Sidvisningsproven (`pageviews`) kräver ett bygge med webbplats-id: ett stagingbygge laddar aldrig Umami-skriptet (`umamiWebsiteIdOf`), så de hoppas över om inte `E2E_UMAMI_BUILD=1` är satt. Bygg då utan `VITE_APP_ENV=staging` men med `VITE_UMAMI_WEBSITE_ID=<ett påhittat uuid>`; skriptet `https://cloud.umami.is/script.js` ersätts i webbläsaren av en stub (`support/analytics.ts`) och ingenting når Umami. Nattkörningen mot staging kör alltså inte dessa prov.

`E2E_STUB_API=1` (`support/stubApi.ts`) besvarar alla förfrågningar till API-adressen i webbläsaren med fejkade svar och vägrar köra om inte både frontenden och API:et är localhost (vakten). Utan variabeln är API:et alltid det riktiga, så mot staging händer ingenting nytt. Stuben räcker för inloggning, landningen, laddningsvyn och skalet runt Board; den har en enda löpare och inga rundor eller nyheter. Specer som läser data med Node-`fetch` (`support/api.ts`: topplistan i `board.spec.ts`, `log-run.spec.ts`) eller kräver nyhetsflödet (`news.spec.ts`, `news-chips.mobile.spec.ts`) hoppar över sig själva med ett skäl när stuben är påslagen (`apiIsStubbed()`), och körs bara mot staging. Mot staging är variabeln aldrig satt; sätts den ändå fäller stuben körningen (adresserna är inte localhost), så inget prov hoppas över i det läget.

### Hur sviten provades

Byggaren körde aldrig mot staging. Specerna provades mot den riktiga frontenden (Vite på localhost) med en fejkad backend som imiterar svarsformerna ur
`apps/backend/src/routes` (login, `users-with-runs`, `runs`, `news`), i den redan installerade Edge-webbläsaren: alla specer gröna. Två avsiktliga fel i frontendkoden fångades (chip-radens `position: relative` borttagen
gav sidled scroll på hela sidan; hover-gesten avstängd gjorde att raden aldrig blev läst). Ett tredje, borttagen fokus-scroll i `NewsFilters`, fångades
inte, eftersom webbläsaren själv scrollar ett fokuserat element i bild; testet av sista chipet bevisar därför nåbarhet, inte den hanteraren. Det hela bevisar
locatorerna och flödena, inte stagingdatan. `landing.spec.ts` (RUN-333) provades mot ett lokalt stagingbygge serverat av repo-rotens Caddyfile med `E2E_STUB_API=1` (se ovan), tillsammans med planterade regressioner som fällde sina test: en tom `#root` i `index.html`, en bortplockad `landing.html`, ett hydreringsfel (extra element på klienten) och en överlämning som renderar null i stället för laddningsvyn. Mot staging har de inte körts av byggaren.

## Känt och medvetet

- Tourer och popuper (välkomstturen, sidoturerna, "What's new", badge-popupen) lägger sig över sidan för ett konto som inte sett dem. `support/overlays.ts` väntar
  först ut svaret från `/onboarding/status` och stänger sedan det som dyker upp med Escape (och väntar en lugn stund på nästa), vilket markerar dem sedda på servern. Ett nytt testkonto möter dem en gång (första körningen blir något längre); en ny
  release med `announce` ger en "What's new"-popup en gång. Nya slag av popuper som inte är en dialog eller en tur måste läggas till i hjälpen.
- Bell-popovern och flera andra delar av appen ingår inte. Sviten är avsiktligt smal och ska hållas under fem minuter.
- Strava-flödena (3, 10), utmaningar, events, profilbild och badges har ingen E2E ännu; de täcks av enhets- och kontraktstesterna samt Leads rök vid release.
- Sviten körs inte som krav på PR:ar mot main. Ägaren avgör senare om den ska bli det (då behövs en pull_request-trigger och en staging som följer PR:ens kod).
