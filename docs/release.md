# Release — stegen från release-PR till live

Intern förvaltningsdokumentation (svenska, för Lead och ägaren). Versionsreglerna står i `docs/dokumentation.md`,
rollerna och grindarna i `docs/permissions.md`, nuläget och de kritiska flödena i `STATE.md`. Det här dokumentet är
ordningen: vad som görs, i vilken följd, och vem som säger ja.

Produktionen är den enda skarpa databasmiljön (STATE.md, "Verifieringsnivå"); sedan 2026-10-17 finns även staging
(avsnittet "Preview på staging" nedan). Previewn kan köras mot prod, och varje steg som skriver till prod kräver
ägarens uttryckliga ja, ett ja per åtgärd. "Ja" betyder ett meddelande
från ägaren i chatten; ett agentmeddelande räknas aldrig som ja.

## Stegen

| # | Steg | Vem gör | Vem säger ja |
|---|---|---|---|
| 1 | Release-PR och versionsbump | Lead (builders levererar) | – |
| 2 | Preview på staging (migrationerna först), eller mot prod med loggning före och återställning efter | Lead | Ägaren: "kör vidare" |
| 3 | PR mot `main`, grön CI, merge (= deploy) | Lead utför mekaniskt | Ägaren (samma "kör vidare") |
| 4 | Rök mot de kritiska flödena | Lead | – |
| 5 | Migrationer | Lead via MCP `apply_migration` | Ägaren, ett ja per migration |
| 6 | `announce:release` (dry-run, sedan `--apply`) | Lead | Ägaren för `--apply` |
| 7 | Tagg på merge-commiten | Lead | – (notify) |
| 8 | Docs-PR "live" | Lead | – |
| 9 | Rollback, om det behövs | Lead utför | Ägaren beslutar |

### 1. Release-PR och versionsbump

1. Arbetet ligger på en `release/vX.Y.Z`-gren med de godkända byggbitarna (kritiker- och integrationsgodkända).
2. Versionsbump enligt releasechecklistan i `docs/dokumentation.md`: `version` i rotens `package.json` och
   `apps/frontend/package.json` till användarversionens tre delar, ny överst-post i `CHANGELOG.md`
   (med avsnittet "Prod-steg" i den ordning som steg 5 nedan följer, och "Rollback"), och en post i
   `apps/frontend/src/data/changelog.json` om gruppen märker något (`"announce": true` om den ska ge popupen och
   Pack News-raden). `STATE.md` och ADR-addendum uppdateras om arkitekturen eller ett beslut ändras.
3. Lokal verifiering före push till `main`: minst backend-tester och frontend-bygge (`docs/permissions.md`); hela sviten grön enligt `STATE.md`, "Verifieringsnivå".
4. CI-vakterna fångar de vanliga felen: `scripts/check-versions.mjs` (versionerna hänger ihop),
   `scripts/ci-guards.mjs` (tom testsvit, TODO utan RUN-nyckel, Jira-ID i testnamn).
5. **Releasegrind för Strava-webhooks (v0.7.0, integrationskritikern F2):** testet `every Strava webhook event kind has a registered handler` (`apps/backend/src/services/stravaWebhook/__tests__/webhookHandlersRegistered.test.ts`) ska vara grönt FÖRE deploy. Workern kör i produktion från `server.ts`, och en händelsetyp utan registrerad handler slutar som `done`/`noop` med bara en varning, alltså en radering som aldrig skedde. Kör det explicit: `npm test --workspace=@runquest/backend -- webhookHandlersRegistered`; det ingår också i hela backend-sviten.

### 2. Preview mot prod

Kör releasens additiva migrationer (de som ska ligga "före deploy") FÖRE previewn: previewn kör den nya koden mot
prod-databasen och faller annars på tabeller som saknas (v0.7.0: 045–049; utan 048/049 svarar `/news` 500).

Previewn kör lokal backend och frontend mot produktionsdatabasen. Ingen `.env` finns lokalt; Railway-CLI:n
injicerar tjänstens miljö, så nyckeln passerar aldrig chatten:

```bash
railway run --service runQuest-backend -- bash -c 'NODE_ENV=development PORT=3001 CORS_ORIGIN=http://localhost:8080 npx tsx src/server.ts'
```

`NODE_ENV=development` stänger av schedulers (de startas bara i `production`), så prod-cronen inte dubbleras.
Frontend körs med `npm run dev:frontend` (port 8080) och `VITE_API_URL=http://localhost:3001`. Långlivade
servrar startas av ägaren i ett eget terminalfönster, inte som bakgrundsjobb.

**Fälla: previewn förbrukar ägarens popuper.** Allt ägaren stänger i previewn skrivs till prod: What's new-popupen
(raden `patch_vX.Y.Z` i `user_seen_items`), turer och badge-popupen (`user_badges.seen_tier`). Det hände vid v0.6.0,
då ägaren inte fick någon release-popup när versionen gick live. Därför:

1. **Före previewn** loggar Lead ägarens läge (skriver ut och sparar resultatet):
   ```sql
   select item_slug, seen_at from user_seen_items where user_id = '<ägarens user_id>' order by item_slug;
   select series, tier, seen_tier from user_badges where user_id = '<ägarens user_id>' order by series;
   ```
2. **Efter previewn** jämförs läget mot loggen och återställs, med ägar-ja eftersom det är en skrivning i prod:
   ```sql
   -- rader som inte fanns före previewn (t.ex. patch_vX.Y.Z) tas bort
   delete from user_seen_items where user_id = '<ägarens user_id>' and item_slug in ('<nya slugs>');
   -- seen_tier tillbaka till loggat värde, per serie (får inte överstiga tier)
   update user_badges set seen_tier = <loggat värde> where user_id = '<ägarens user_id>' and series = '<serie>';
   ```
3. Pack News-raden för releasen (`release_published`) kan en preview inte förbruka: den skrivs aldrig av appen eller
   servern, bara av `announce:release` (steg 6).

När ägaren har provat och säger **"kör vidare"** går kedjan vidare. Utan det stannar den här.

#### Preview på staging (möjlig från v0.7.1)

Sedan 2026-10-17 finns en stagingmiljö: Railway-miljön `staging` med egna tjänster och ett eget Supabase-projekt
(gratisorganisationen; MCP-servern `supabase-staging` i `.mcp.json`). Previewn för en release kan därför göras där i
stället för mot prod-databasen:

- Backend: `https://runquest-backend-staging-staging.up.railway.app`
- Frontend: `https://runquest-frontend-staging-staging.up.railway.app`
- **Staging följer integrationsbranchen `integration/<version>`.** Båda stagingtjänsterna deployar den automatiskt vid
  push (v0.8.0: `integration/v0.8.0`), så previewn är alltid integrationsbranchens senaste commit. Prod berörs inte:
  produktionstjänsterna deployar bara `main`. När versionen släpps pekar Lead om stagingtjänsterna till nästa
  `integration/<version>`-gren.
- **Staging delar ingen hemlighet med prod.** Varje variabel i stagingmiljön har ett eget värde (egen
  `JWT_SECRET`, eget Supabase-projekt och egna nycklar, egen `TOKEN_ENCRYPTION_KEY` med nyckel-id `stg-1` (backend godtar `stg-` bara när `SENTRY_ENVIRONMENT=staging`, annars `prod-`; se
  [`runbook-token-key.md`](runbook-token-key.md)), egen Sentry-miljö), och ingen
  hemlighet kopieras från prod. Lead jämför de två variabellistorna före första previewn.
- **Skydd mot förväxling och utspridning** (RUN-273). Stagingfrontenden byggs med `VITE_APP_ENV=staging`
  (variabeln sätts bara på stagingtjänsten, aldrig i prod; saknas den, eller har den något annat värde, är bygget ett
  prodbygge):
  - En smal röd remsa "STAGING / Test environment" överst på varje sida, även landningen och login. Den är en egen
    lazy-chunk som bara finns i stagingbygget: prodbygget innehåller varken kod eller CSS för den, så landningens
    Lighthouse-budget rörs inte.
  - `<meta name="robots" content="noindex, nofollow">` i `index.html` och en `robots.txt` som blockerar alla
    sökrobotar (`User-agent: *`, `Disallow: /`). Sitemapen tas bort. Allt sker vid bygget (`apps/frontend/stagingGuard.ts`),
    eftersom Railpack serverar `apps/frontend/dist` som statiska filer; `public/robots.txt` och `public/sitemap.xml`
    ändras inte och prodbygget får dem som förut.
    Två följder är kända och ofarliga: `noindex` och `Disallow: /` samtidigt betyder att en blockerad sökrobot aldrig
    hämtar sidan och därför inte ser metan (blockeringen räcker då; metan fångar robotar som ändå kommer in, till
    exempel via en länk), och `canonical` och `og:url` i `index.html` pekar fortfarande mot prod (`www.runquest.dev`),
    vilket inte skadar eftersom staging är noindex.
  - Remsan är en vanlig rad överst som scrollar bort med sidan (den ligger aldrig över sidhuvudenas knappar). Dess
    uppmätta höjd läggs på `<html>` som `--rq-staging-banner-h` (0 i prod), och sidans 100dvh-ytor räknar bort den.
  - Inga utskick når riktiga människor: appen skickar varken mejl, SMS eller push (bara notiser i appen och
    Pack News-rader i databasen), och Strava är avstängt i staging. Väntelistan sparar en adress men skickar ingen
    bekräftelse. En riktig e-postadress som skrivs in i stagingformuläret hamnar bara i stagingdatabasen. Skulle ett
    utskick byggas senare ska det stängas av i staging med en miljöflagga innan det går live (kontrolleras vid
    previewn).
  - Kontroll vid previewn: öppna stagingadressen och bekräfta att remsan syns, och att
    `curl https://runquest-frontend-staging-staging.up.railway.app/robots.txt` ger `Disallow: /`.
- **Migrationer provas i staging före prod.** Release-PR:ens nya migrationer appliceras först på staging-databasen
  (`supabase-staging`), koden provas mot dem, och först därefter söker Lead ägarens ja per migration för prod (steg 5).
  Prod-regeln om ett ja per migration ändras inte, och staging kräver inget ägar-ja. Skripten för att läsa, återställa
  och seeda stagingdatabasen (`staging:*`, RUN-272) hör till samma kedja; de finns i repot först när RUN-272 är
  integrerad, och tills dess görs stagingstegen via MCP-servern `supabase-staging`.
- **Låtsasgruppen för flergruppstestet** (ADR 012 S12/S14, ägarbeslut F5: aldrig en testgrupp i prod) skapas i staging med
  `npm run create:group` (`apps/backend/src/scripts/createGroup.ts`): dry-run som standard, `--apply` skapar gruppen via
  `create_group_with_admin` och skriver ut måldatabasens host. Skaparen är ett testkonto utan medlemskap som ägaren skapar i staging; Lead kör skriptet därefter.
  Skriptet avgör målet ur `SUPABASE_URL`. Mot prod vägras även en dry-run utan `--allow-prod`, och `--apply` kräver dessutom
  bekräftelsesträngen; Lead använder dem bara efter ägarens uttryckliga ja. Kommandon, vakter och hur kontot görs:
  [`docs/staging.md`](staging.md), avsnitt 5 (`create:group`).
- Fällan om förbrukade popuper ovan gäller inte staging: det är en annan databas, så ägarens `user_seen_items` och
  `user_badges` i prod rörs inte och ingen loggning eller återställning behövs.
- **Strava är avstängt i staging** (Stravas prenumerationskrav; ägarbeslut 2026-10-17): ingen koppling, ingen
  webhook, och avstämningen har inga kopplade användare att gå igenom. Strava-flöden provas med fejkad Strava i
  tester, och rök mot riktig Strava görs bara i prod.

Hur stagingdatabasen byggs om från noll (migrationer, spelregler, testgrupp, schemajämförelse mot prod) står i
[`docs/staging.md`](staging.md).

Playwright-röken mot staging (inloggning, logga runda, topplista, Pack News; körs manuellt och nattligt i CI, aldrig mot prod, och blockerar inte
PR:ar) beskrivs i [`docs/e2e.md`](e2e.md), med de secrets ägaren ska skapa. Lead kör den gärna efter previewn av en release.

Den gamla vägen med `railway run` mot prod-databasen (ovan) finns kvar som alternativ, till exempel när något bara
går att visa med prod-data.

### 3. PR, grön CI och merge (= deploy)

1. Öppna PR mot `main`. CI körs på PR: jobben Backend, Shared och Frontend ska vara gröna (branch protection kräver
   dem; ett admin-undantag finns, se `STATE.md`). Jobbet Lighthouse körs också men fäller inte PR:en förrän det slagits om
   till blockerande (se Lighthouse-budget nedan); titta på dess sammanfattning före merge.
2. Merge. **Merge till `main` är deployen:** Railway bygger och deployar båda tjänsterna (runQuest-frontend och
   runQuest-backend) vid push, oberoende av CI. Byggena går med Railpack och Node-versionen styrs av `.nvmrc`.
   Frontend serveras av Caddy med repo-rotens `Caddyfile`. Det är därför CI ska vara grön *före* merge.
3. Vänta tills båda deployerna är klara i Railway innan rök och migrationer.

#### Lighthouse-budget (RUN-259)

CI-jobbet `Lighthouse — prestandabudget` (`.github/workflows/ci.yml`) mäter de publika sidorna på varje PR mot `main` och på varje
push till `main`. Ägarbeslut 2026-10-13: Lighthouse ska in i CI.

- **Vad som mäts:** `/` och `/legal` i det byggda `apps/frontend/dist`, serverat av samma Caddy och Caddyfile som
  `scripts/verify-static-serving.sh` (samma Caddy-version, hämtad med kontrollsumma). Lighthouse mobil (mobilemulering, simulerad
  långsam 4G och 4x CPU-bromsning), 3 körningar per sida, **medianen** prövas. Mätningen går bara mot `127.0.0.1`: ingen prod, ingen
  Railway, ingen extern rapporttjänst (inte `temporary-public-storage`). Bygget saknar `VITE_API_URL` och pekar då på
  `localhost:3001`; jobbet mäter därför två lägen efter varandra och sidan ska klara båda: *API ger fel* (inget lyssnar, sifferraden
  döljs) och *falskt API* (`scripts/lighthouse/mock-api.mjs` svarar med tre tal). Samma budget gäller i båda.
- **Rapporten:** artefakten `lighthouse-reports` (14 dygn) innehåller `error/` och `mock/` med HTML- och JSON-rapport per körning.
  Jobbets sammanfattning (Summary-fliken) visar medianen per sida i en tabell, också när budgeten hålls, så att man ser hur långt
  under taket sidorna ligger.
- **Budgeten** står i `scripts/lighthouse/lighthouserc.json` (gäller båda sidorna):

  | Mått | Gräns | Utgångsvärde kommer från |
  |---|---|---|
  | Prestanda (poäng) | minst 0,75 | RUN-212, prod: 85. Lokalt `/` 0,80–0,81 (knappt 5 poängs marginal) och `/legal` 0,91–0,92 (ca 16 poäng) |
  | Tillgänglighet / SEO | minst 0,95 | RUN-212, prod: 100 |
  | Best practices | minst 0,90 | RUN-212, prod: 100; lokalt 96 när API:et ger fel (konsolfelet från anslutningen) |
  | LCP | högst 5 000 ms | lokalt `/` ca 4,36 s (4,32–4,44), alltså ca 0,64 s (ca 13 %) under taket; `/legal` ca 2,9 s. Prod i RUN-212: 3,5 s (lokalt mäts ca 0,9 s högre) |
  | CLS | högst 0,05 | RUN-212, prod: 0 (lokalt högst 0,018 när API:et ger fel) |
  | TBT | högst 200 ms | RUN-212, prod: 0 ms; 200 ms är Googles gräns för "bra" |
  | JS (överförd storlek) | högst 275 kB | lokal körning: 237 kB, ca 15 % marginal (RUN-212 mätte inte vikt) |
  | CSS (överförd storlek) | högst 50 kB | lokal körning: 42 kB, ca 18 % marginal |
  | Totalvikt | högst 500 kB | lokal körning: 428 kB (`/`), 303 kB (`/legal`), ca 17 % marginal |

  **Baslinjen är mätt på en Windows-dator med Microsoft Edge** (Lighthouse 12.6.1, medianen av 3), inte på GitHub-runnern
  (Linux, Chrome): RUN-212 noterade bara prod-poäng, FCP, LCP, TBT och CLS, inte vikter, och en körning på prod ger andra
  tider än en lokal. Överförda vikter är i princip oberoende av maskinen, men poäng och tider är det inte. **Kalibreringen mot
  CI-körningarnas siffror måste göras under den icke-blockerande veckan, före omslaget till blockerande** (nedan): ligger en ren
  `main` nära eller över ett tak på runnern justeras det först då, med ägarens ok om det lättas.
- **Budgeten får aldrig sänkas utan ägarens ok.** "Sänkas" betyder att kravet lättas: en lägre minpoäng, ett högre tak för
  LCP/CLS/TBT/vikt, en borttagen rad eller en sida som tas ur mätningen. Att skärpa budgeten (högre minpoäng, lägre tak) kräver
  inget ok och är önskvärt när CI-värdena visar utrymme. Budgeten är dessutom fäst i `scripts/lighthouse-ci.test.mjs` (golv och
  tak, körs i frontend-jobbet): ett lättat värde i `lighthouserc.json` fäller det testet, och testet får bara ändras vid skärpning.
  En PR som lättar en rad ska ange ägarens ja i beskrivningen. En ny funktion
  som kostar vikt eller tid löses genom att optimera (kodsplittring, bildmått, lat laddning), inte genom att höja taket.
- **Icke-blockerande första veckan.** `LIGHTHOUSE_BLOCKING: 'false'` överst i jobbet gör att ett budgetbrott märker steget orange (och
  syns i loggen, sammanfattningen och artefakten) utan att fälla PR:en. Raden som föll skrivs också som en `::warning::`-anteckning
  (i blockerande läge `::error::`), så att den syns på PR:ens sida med sida, rad, uppmätt värde och gräns. Anteckningarna kommer ur
  lhci:s `assertion-results.json` (`scripts/lighthouse/summarize.mjs --failures`). **Slå om till blockerande:** tidigast sju dygn efter att
  jobbet första gången körts på `main` och efter att Lead jämfört veckans siffror med taken (en ren `main` ska ligga under taken med
  marginal), ändra värdet till `'true'` i en liten PR och lägg `Lighthouse — prestandabudget` bland required checks i branch
  protection. Därefter fäller ett budgetbrott PR:en. **Tillbaka till icke-blockerande** är samma rad (kräver ägarens ja, eftersom det
  lättar kontrollen).
- **Köra lokalt:** `npm ci` i `scripts/lighthouse`, bygg frontend, och kör sedan `bash scripts/lighthouse/run.sh` från repo-roten
  (`STATS_MODE=error|mock`, `DIST_DIR`, `CADDY_BIN`, `CHROME_PATH`, `API_PORT`, se skriptets huvud). Är port 3001 upptagen: bygg
  frontend med `VITE_API_URL=http://localhost:<port>/api` och kör med `API_PORT=<port>`. Rapporterna hamnar i `lighthouse-reports/`.
  Skriptet vägrar köra om något redan svarar på port 3001 (ett riktigt lokalt backend ska aldrig mätas).
- **Fäller budgeten:** öppna HTML-rapporten i artefakten för sidan och körningen som avviker. Vanliga orsaker: ny blockerande
  resurs i `<head>`, bild utan `width`/`height` (CLS), en stor ny beroende i entry-chunken (JS-vikt, LCP) eller ett nytt typsnitt.
  Stagingremsan (`VITE_APP_ENV=staging`) är en egen chunk som inte finns i prodbygget och påverkar inte budgeten.
- **Verktyget** har ett eget beroendeträd (`scripts/lighthouse/package.json` och egen lockfil, utanför workspaces) så att de andra
  jobbens `npm ci` och cache inte växer. Uppgradera `@lhci/cli` medvetet: en ny Lighthouse-version kan flytta poängen, så läs
  tabellen före och efter och justera inte budgeten för att dölja det.

#### Webbanalys: Umami Cloud (RUN-291, epic RUN-19)

Sidvisningar på landningen och i appen räknas av Umami Cloud (Hobby). Ägarbeslut 2026-10-16. Koden ligger i
`apps/frontend/src/shared/analytics/`.

- **Variabeln:** `VITE_UMAMI_WEBSITE_ID` (webbplatsens id, inte hemligt) är en **byggvariabel** på frontend-tjänsten i **prod**
  (`runquest-frontend`); den bakas in vid bygget, så efter att den satts krävs en ny build. Värdet står i Umami-panelen (webbplatsens
  inställningar). **Staging får den inte**, och saknas den laddas inget skript: staging, lokal utveckling och CI:s byggen
  skickar ingenting. Som extra skydd är skriptet låst till `www.runquest.dev` och `runquest.dev` (`data-domains`), och ett bygge
  med `VITE_APP_ENV=staging` ignorerar variabeln även om den satts av misstag. Lead sätter variabeln efter ägarens ja (Railway-variabler
  ändras bara så); ingen Railway-variabel är satt av koden eller av den här PR:en.
- **Vad som skickas:** bara sidvisningar, och bara en normaliserad adress: routens mönster (`/runner/:id`, `/board`, `/login`), aldrig
  den riktiga adressen. Query och fragment tas bort; på landningen behålls `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`
  och `utm_term` (Umami läser kampanjerna ur adressen, annars blir kampanjvyn tom) om värdet är en enkel tagg (högst 64 tecken, inga
  id-former). Okända adresser skickas som `/(not-found)`. Sidans titel ersätts av samma adress och hänvisningen skickas bara som
  ursprung (`https://www.google.com`) eller, inne i appen, som föregående sidas normaliserade adress. Inga händelser, ingen
  rundata, inga distanser, inga namn och inget användar-id (Stravas API-policy 5.4 förbjuder analys på Strava-data).
- **Cookiefritt:** Umami sätter inga cookies och koden skriver varken till cookies eller localStorage/sessionStorage (testat i
  `umamiPageviews.test.ts`). `data-do-not-track="true"` är påslaget: besökare som skickar Do Not Track räknas inte. Valet kostar
  några procent av sidvisningarna och stämmer med att tjänsten ska vara integritetsvänlig; det stör inte målet (trender, inte exakta tal).
- **Laddningen:** skriptet läggs in från koden (inte från `index.html`) som `<script async defer>` först när dokumentet laddats klart,
  med automatisk spårning avstängd (`data-auto-track="false"`); koden skickar själv en sidvisning per ny sida efter att adressen legat
  still en kort stund (så att en omdirigering inte räknas som en sidvisning). En blockerad eller misslyckad laddning tystas.
- **Lighthouse:** CI:s Lighthouse-jobb bygger frontend utan `VITE_UMAMI_WEBSITE_ID` (jobbet sätter ingen) och mäter mot 127.0.0.1, så
  skriptet laddas aldrig där och budgeten (RUN-259) påverkas bara av den lilla koden i huvudbunten (ca 0,9 kB gzip). Bygg inte med
  variabeln när budgeten mäts lokalt (`scripts/lighthouse/run.sh`): skriptet hämtas då utifrån och mätningen slutar vara hermetisk.
- **Kontroll efter att variabeln satts i prod (Lead och ägaren):** öppna `https://www.runquest.dev` i ett privat fönster med DevTools →
  Application: *Cookies* ska vara tomma och *Local/Session storage* utan Umami-nycklar; Network ska visa `script.js` från
  `cloud.umami.is` och en POST till Umamis `/api/send` vars payload har `url` som routemönster (till exempel `/login`, inte en adress
  med id). Gå sedan in i appen och öppna en löpare: payloaden ska visa `/runner/:id`. Ägaren bekräftar att sidvisningarna syns i
  Umami-panelen. Integritetstexten på `/legal` uppdateras i en egen story i samma epic (S3), inte här.

### 4. Rök mot de kritiska flödena

Kör rök-raden för varje kritiskt flöde i `STATE.md` ("Kritiska flöden", nio stycken) som releasen rör, och alltid
flöde 1 (login → JWT → skyddade anrop). Minst: frontend laddar utan vit sida (inklusive en direktladdad djup länk som
`/board`), `GET /health` svarar, nya endpoints svarar 401 utan token, och den nya funktionen syns. Muterande rök i prod
(loggad runda, utmaning) görs bara om ägaren säger ja, eftersom det är den riktiga gruppens data.

**Sentry-alertregeln för kritiska larm** (en gång per Sentry-projekt, `runquest-backend`): villkor `alert:critical` (tagg, `level:fatal`), åtgärd "mejla ägaren", och **notifiera för varje händelse** (inte bara nya issues). Frekvensen begränsas av spärren i koden (högst en händelse per källa och fingeravtryck per 10 minuter, `extra.suppressed_since_last` visar hur många som hölls tillbaka), så regeln behöver ingen egen throttle. Källor och Strava-id-regeln: ADR 010, Addendum 2026-10-17 (RUN-283).

**Prestandaalerts** (p95 per route i backend, Web Vitals i frontend): trösklar, filter och hur de verifieras i staging står i [`docs/performance.md`](performance.md) (RUN-287).

**Källkartor till Sentry** (RUN-285). Både frontend- och backendbygget laddar upp sin källkarta till Sentry (org `joel-lindberg`,
EU, `https://de.sentry.io`; projekten `runquest-frontend` och `runquest-backend`), så stackar i Sentry visar `src/`-rader.
- **Token:** `SENTRY_AUTH_TOKEN` sätts som byggvariabel på varje Railway-tjänst som bygger (prod och staging, frontend och
  backend). Utan den hoppas uppladdningen över med en rad i byggloggen och bygget går igenom (lokalt, i CI, i en
  förhandsbyggd preview). Ett uppladdningsfel stoppar aldrig en deploy: det syns som en varning i byggloggen.
- **Release:** `runquest@<version i rotens package.json>+<RAILWAY_GIT_COMMIT_SHA, 7 tecken>` (utan sha: `runquest@<version>`).
  Namnet byggs i `scripts/sentry-build.mjs` och bakas in i båda apparna (`VITE_SENTRY_RELEASE` i frontend, `__SENTRY_RELEASE__` i
  backend), så SDK:t och uppladdningen alltid har samma namn. Frontend- och backendtjänsten byggs av samma commit och får samma namn.
- **Aldrig publika:** frontend byggs med dolda kartor (ingen `sourceMappingURL`) som `stripSourceMaps` tar bort ur `dist/` efter
  uppladdningen, med eller utan token. Caddyfilen svarar dessutom 404 på alla `*.map`, på varje sökväg och även om filen
  finns på disk (regeln står först i ett `route`-block; utan det hade `/assets/*`, `/media/*` och `/fonts/*` prövats före den).
  `scripts/verify-static-serving.sh` kontrollerar i CI mot planterade `.map`-filer i en kopia av `dist` att så är fallet, och
  att det riktiga `dist` saknar `.map`. Backendens kartor
  ligger kvar bredvid `dist/server.js`, som aldrig serveras.
- **Node utan `--enable-source-maps`:** startkommandot är `node dist/server.js` och ska förbli det. SDK:t skickar byggfilens rader
  med ett debug-id och Sentry översätter dem med den uppladdade kartan. Flaggan skulle skriva om stacken i processen före SDK:t läser den.
- **Provet efter en deploy med token:** `npm run sentry:test:built --workspace=@runquest/backend` (kör `dist/sentryTest.js`, kräver
  `SENTRY_DSN` och en byggd `dist/` från samma bygge som laddade upp kartan) skickar en testhändelse; i Sentry ska stacken visa
  `src/observability/sentry.ts`, inte `dist/sentryTest.js`.

### 5. Migrationer

1. **Ett ägar-ja per migration**, aldrig ett samlat ja för flera (`docs/permissions.md`). Lead visar exakt filen.
2. Ordningen och tidpunkten (före eller efter deployen) står i releasens "Prod-steg" i `CHANGELOG.md`. Regeln är
   expand/contract (ADR 002): en additiv migration som koden kräver körs *före* deployen och måste vara bakåtkompatibel
   med koden som kör nu; en som stänger eller tar bort något körs *efter*, när ingen kod längre använder det. Var det
   gäller inleder migrationsfilens huvud med körordningen.
3. Körs via Supabase MCP `apply_migration` med `name` = `NNN_kort_beskrivning`. Därefter `list_migrations` (posten
   finns) och, efter RLS- eller policyändring, `get_advisors` (security). Filen ligger redan i release-PR:en.
4. Backfill- och omräkningsskript (`backfill:*`, `reveal:badges`, `convert:wind-ms`): dry-run fritt, `--apply` kräver
   ägar-ja med dry-run-rapporten som underlag. Skripten skriver ut måldatabasens host.
5. **Migrationerna 053–056 i v0.8.0 (ADR 012)** körs i den här ordningen, först i staging och sedan i prod med ett ja per migration:
   053 `group_members`, 054 `group_settings`, 055 `title_scope_group`, 056 `revoke_legacy_title_function_execute`. 053, 054 och 055 är additiva
   och körs FÖRE backend-deployen (ny kod mot gammal databas fungerar inte); ingen av dem körs efter deployen. 056 kan köras före eller efter
   deployen (backend använder service role, som behåller execute) men alltid efter 055. Bevisfrågorna står i varje filhuvud; kör dem i staging och i prod.
   - **053:** stannar migrationens egna förkontroller (fler än en grupp, användare utan grupp, oklar admin) ändras ingenting; fråga ägaren, ändra ingen
     data för att få den att gå igenom. Efter apply: bevisfrågorna 1–7 i huvudet (aktiva medlemskap = användare med grupp, 0 avvikelser mot `users.group_id`,
     exakt en admin per grupp och det är gruppens skapare, RLS på utan policyer, execute bara för `service_role`, främmande nycklar med cascade) och `get_advisors` (security). Skrev äldre kod
     `users.group_id` mellan apply och deploy är filen idempotent: kör om den.
   - **054:** efter apply bevisfrågorna i huvudet (RLS på, 0 policyer, ingen klientåtkomst, tabellen tom) och `get_advisors` (security).
   - **055** körs när ingen Strava-synk, cron eller titelomräkning pågår (den tar ACCESS EXCLUSIVE på `user_titles`/`title_leaderboard` och alla
     titellås i slutet). Kör före-frågorna A1–A7 i filens huvud först och spara A4/A5; efter apply B1/B2, C1/C2, D1 och E1–E6, och `get_advisors`
     (security). Får den `40P01` (deadlock) eller `lock_timeout` (55P03) har allt rullats tillbaka: vänta en stund och kör om hela filen. Stannar en av
     migrationens egna kontroller (`migration 055 stopped/failed`) ändras ingenting; fråga ägaren, ändra ingen data för att få den att gå igenom.
   - **056:** kör katalogfrågan (`QUERY-START` i huvudet) FÖRE apply i varje miljö och spara `proacl` per funktion: rollbacken ska ge exakt
     utgångsläget tillbaka, och miljöerna skiljer sig (staging har PUBLIC-execute, prod saknar det). Efter apply samma fråga igen (förväntat: public_execute,
     anon och authenticated false, service_role true), triggerkontrollen i huvudet och `get_advisors` (security). Rök: en runda som bygger om topplistan
     och en event-utbetalning går igenom. När 056 är applicerad i båda miljöerna tas den tillfälliga schemadiff-regeln bort (`docs/staging.md`, avsnitt 4).
   - **Release-röken** kör konsistenskontrollen från 053 (inga avvikelser mellan `users.group_id` och aktivt medlemskap) och, efter 055, att en runda i
     en grupp inte ändrar en annan grupps topplista (staging, `create:group`).

### 6. `announce:release`

**Undantag v0.7.0:** Integritetstexten och samtyckesblocket går ut vid deployen och lovar redan webhooks och borttagning inom 48 timmar, innan prenumerationen finns (den kan inte skapas före deployen). Steg 3–8 körs i ett svep direkt efter deployen, med ägaren närvarande, så att fönstret där integritetstexten lovar webhooks men prenumerationen saknas blir minuter, inte dagar. En radering på Strava i fönstret fångas inte, eftersom det inte finns någon avstämning (ADR 010 D12). Det är en medveten risk med 6 användare. What's new-posten och Features-kortet Strava beskriver Strava-webhooks, så de får inte gå ut förrän prenumerationen är skapad och verifierad. Därför har v0.7.0-posten ingen `announce` i den första deployen. RUN-265:s PR (mergas sist i RUN-182, direkt efter godkänd rök och med ägar-ja; ingen sjudygnsvänta, ägarbeslut 2026-10-14) sätter `"announce": true`, byter Features-kortet Strava och sätter in de tre Strava-texterna i posten, allt som står i `CHANGELOG.md` (Prod-steg 10), och slår på 12 h-pollingen i samma deploy. `announce:release --version=0.7.0` (Pack News-raden) körs efter DEN deployen, så att popupen och raden går ut samtidigt.

Gäller bara en **användarversion** med `"announce": true` i `changelog.json`. Skriptet skriver en
`release_published`-rad per grupp i Pack News (förkrav: migration 041, som är körd; skriptet kontrollerar det själv
och avbryter utan skrivning annars). Kör från repo-roten, efter deployen och efter eventuella migrationer:

```bash
# dry-run (fritt): visar måldatabas, vald release och vilka grupper som får en rad
railway run --service runQuest-backend -- npm run announce:release --workspace=@runquest/backend -- --version=X.Y.Z
# skriver (ägar-ja)
railway run --service runQuest-backend -- npm run announce:release --workspace=@runquest/backend -- --apply --version=X.Y.Z
```

Ange alltid `--version` uttryckligt, så att en saknad changelog-post aldrig annonserar fel version. Skriptet är
idempotent (en omkörning ger inga nya rader) och avslutar med exit-kod 1 om någon rad saknas vid kontrollläsningen.
Popupen "What's new" visas för poster med `announce: true` vars slug (`patch_vX.Y.Z`) inte finns i
`user_seen_items`, vilket är varför steg 2 återställer ägarens rad.

### 7. Tagg

Tagga `vX.Y.Z` på merge-commiten på `main` efter verifierad deploy (`docs/dokumentation.md`). Samma nummer som
översta rubriken i `CHANGELOG.md`.

### 8. Docs-PR "live"

En kort PR efter att prod-stegen är körda (mönstret: `docs: v0.6.1 live — prod steps done`): `STATE.md` (Läge, vad som
är i prod) och `CHANGELOG.md` (markera varje prod-steg som KÖRD med datum och utfall). Det är Leads dokument.

### 9. Rollback

Beslutas av ägaren; snabbast först. Varje releases egen "Rollback" i `CHANGELOG.md` har det som är specifikt för den.

1. **Kod:** Railway → respektive tjänst → Deployments → välj den senaste friska deployen → Redeploy. Därefter en PR
   som revertar merge-commiten på `main`, så att nästa push inte deployar den dåliga versionen igen.
2. **Ordning:** frontend först om felet syns i UI:t, backend först om API:t felar.
3. **Migrationer** rullas normalt inte tillbaka: de additiva ligger kvar, och en stängande migration (policyer) öppnas
   igen bara om den gamla koden behöver det. Tas en migration bort sker det med en ny migration efter ägar-ja
   (ADR 002: framåt-bara).
4. **Data som den nya koden skrivit** (t.ex. nya händelsetyper i `activity_log`) kan behöva raderas innan den gamla
   frontenden tas tillbaka. Radering i prod kräver ägar-ja med exakt omfattning.
5. Railway-variabler ändras bara efter ägar-ja; hemliga värden klistras aldrig i chatten, ägaren lägger in dem i Railway-UI:t.
   Tokennyckeln (`TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEYS_RETIRED`) har en egen handbok för att skapa, sätta, rotera, förlora och
   läcka den: [`docs/runbook-token-key.md`](runbook-token-key.md). En release som deployar tokenkrypteringen kräver att nyckeln är satt
   i Railway **före** deployen av S1–S4 tillsammans (ADR 013 beslut 13); utan den startar appen men Strava-synken är avstängd och Sentry får ett
   `🚨 KRITISKT`-larm med `source:token_key`.
6. **Data som gått förlorad** (databasen, profilbilder, hemligheter): koden rullas inte tillbaka för det. Vad Pro-backupen täcker och
   inte täcker, återställningsövningen och RPO/RTO står i [`docs/runbook-backup.md`](runbook-backup.md).

## Interna versioner (fyra delar, `0.6.1.1`)

En intern version (`docs/dokumentation.md`) är ett steg som gruppen inte ser och som rullas ihop till nästa
användarversion. Kedjan ovan gäller i övrigt, med dessa skillnader:

- Ingen versionsbump i `package.json` (den håller de tre första delarna av översta rubriken), ingen post i
  `changelog.json`, ingen "What's new"-popup.
- **Steg 6 (`announce:release`) hoppas över.** Skriptet läser `changelog.json`, som bara har tredelade versioner, så
  en intern version kan inte annonseras och ingen `release_published`-rad skrivs.
- `CHANGELOG.md` får en fyrdelad rubrik (`## v0.6.1.1`), och taggen får samma nummer (`v0.6.1.1`).
- Migrationer (steg 5) gäller som vanligt, ett ja per migration; en intern version kan innehålla en.
- Om previewn behövs för ett rent internt steg avgör ägaren; hoppas den över finns inget att logga eller återställa i steg 2.
