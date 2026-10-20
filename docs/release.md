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
5. **Releasegrind för integritetstexten (från v0.8.0):** `/legal` får inte gå ut med en ofylld ägarplatshållare (`[REGION: …]` eller liknande) i `packages/shared/src/legal/dataPolicy.ts`. I v0.8.0 är Umami-regionen ifylld (ägaren 2026-10-19: EU, Frankfurt; `UMAMI_DATA_LOCATION`, `DATA_POLICY_VERSION` 2026-10-19). Kör `RUNQUEST_RELEASE_CHECK=1 npm test --workspace=@runquest/shared -- dataPolicy` före varje release som rör texten: testet `the policy text has no unfilled owner placeholder left` hoppas över i vanlig CI men ska vara grönt här (CI kör det också på PR:ar från `integration/*` och `release/*`). Sentrys "Prevent Storing of IP Addresses" är påslaget i organisationen (ägaren 2026-10-19), och texten säger "Sentry is set not to store it." (`DATA_POLICY_VERSION` 2026-10-19.1). Stängs inställningen av ska meningen ändras, versionen höjas och snapshotpinnen i `dataPolicy.test.ts` bytas.
6. **Releasegrind för Strava-webhooks (v0.7.0, integrationskritikern F2):** testet `every Strava webhook event kind has a registered handler` (`apps/backend/src/services/stravaWebhook/__tests__/webhookHandlersRegistered.test.ts`) ska vara grönt FÖRE deploy. Workern kör i produktion från `server.ts`, och en händelsetyp utan registrerad handler slutar som `done`/`noop` med bara en varning, alltså en radering som aldrig skedde. Kör det explicit: `npm test --workspace=@runquest/backend -- webhookHandlersRegistered`; det ingår också i hela backend-sviten.

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
  - `<meta name="robots" content="noindex, nofollow">` i `index.html` och `landing.html` (båda HTML-ingångarna, ADR 006 addendum 2026-10-19) och en `robots.txt` som blockerar alla
    sökrobotar (`User-agent: *`, `Disallow: /`). Sitemapen tas bort. Allt sker vid bygget (`apps/frontend/stagingGuard.ts`),
    eftersom Railpack serverar `apps/frontend/dist` som statiska filer; `public/robots.txt` och `public/sitemap.xml`
    ändras inte och prodbygget får dem som förut.
    Två följder är kända och ofarliga: `noindex` och `Disallow: /` samtidigt betyder att en blockerad sökrobot aldrig
    hämtar sidan och därför inte ser metan (blockeringen räcker då; metan fångar robotar som ändå kommer in, till
    exempel via en länk), och `canonical` och `og:url` i `index.html` och `landing.html` pekar fortfarande mot prod (`www.runquest.dev`),
    vilket inte skadar eftersom staging är noindex.
  - Remsan är en vanlig rad överst som scrollar bort med sidan (den ligger aldrig över sidhuvudenas knappar). Dess
    höjd läggs på `<html>` som `--rq-staging-banner-h` (0 i prod), och sidans 100dvh-ytor räknar bort den. Remsan står
    förrenderad i `#root` i både `index.html` (över laddningsvyn) och `landing.html`, och dess stilmall länkas i båda
    filerna bara i stagingbygget (`apps/frontend/stagingBannerStyle.ts`). `staging-banner.css` räknar ut höjden för en rad
    (`html:root { --rq-staging-banner-h: calc(...) }`), så laddningsvyn ligger rätt redan före all JS; `StagingBanner.tsx`
    mäter sedan den verkliga höjden (en smal skärm kan bryta över två rader). Laddarens rektangel är därför densamma
    (±1 px) i `index.html` och efter monteringen; prodbygget har varken bannerns markup, stil eller kod.
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

- **Vad som mäts:** `/` och `/legal` i det byggda `apps/frontend/dist`. Sedan v0.8.0 (RUN-333) är `/` den förrenderade landningen
  (`landing.html`, Caddyfilens regel för exakt `/`) och `/legal` fullappens `index.html` med laddningsvyn i `#root`. `run.sh` vägrar mäta om
  `landing.html` saknas i `dist` eller om `/` inte ger `landing-title` via Caddy (annars hade `/` fallit tillbaka på `index.html` och mätningen gällt
  laddningsvyn). Serverat av samma Caddy och Caddyfile som
  `scripts/verify-static-serving.sh` (samma Caddy-version, hämtad med kontrollsumma). Lighthouse mobil (mobilemulering, simulerad
  långsam 4G och 4x CPU-bromsning), 3 körningar per sida, **medianen** prövas. Mätningen går bara mot `127.0.0.1`: ingen prod, ingen
  Railway, ingen extern rapporttjänst (inte `temporary-public-storage`). Bygget saknar `VITE_API_URL` och pekar då på
  `localhost:3001`; jobbet mäter därför två lägen efter varandra och sidan ska klara båda: *API ger fel* (inget lyssnar, sifferraden
  döljs) och *falskt API* (`scripts/lighthouse/mock-api.mjs` svarar med tre tal). Samma budget gäller i båda.
- **Rapporten:** artefakten `lighthouse-reports` (14 dygn) innehåller `error/` och `mock/` med HTML- och JSON-rapport per körning.
  Jobbets sammanfattning (Summary-fliken) visar medianen per sida i en tabell, också när budgeten hålls, så att man ser hur långt
  under taket sidorna ligger.
- **Budgeten** står i `scripts/lighthouse/lighthouserc.json` som `assertMatrix` med en regelrad per sida (RUN-334, S7): `/` har egna, skarpa rader och
  `/legal` egna rader. lhci prövar medianen av de tre körningarna per sida (`aggregationMethod: median` i varje rad). En sida som ingen rad
  matchar prövas inte alls, så `scripts/lighthouse-ci.test.mjs` kräver exakt en regelrad per mätt URL. Felraderna (`::warning::`/`::error::`)
  anger sida, rad, uppmätt värde och gräns, också per sida (`summarize.mjs --failures` läser `assertion-results.json`).

  **`/` (den förrenderade landningen).** Taken sattes 2026-10-20 enligt ADR 006, punkt 10, ur CI-körningarna efter RUN-343 (Linux, Chrome, jobbet
  `Lighthouse — prestandabudget`, 6 körningar per sida och läge, båda lägena: API ger fel / falskt API). "CI-median" är den högsta av de två lägenas
  medianer, "sämsta körning" den sämsta enskilda körningen av alla 12 (en jobbmedian är det lhci prövar, se anmärkningarna under tabellen).

  | Rad | Förut | Nu | CI-median | Sämsta körning | Marginal mot sämsta körning |
  |---|---|---|---|---|---|
  | Prestanda (poäng) | minst 0,75 | **minst 0,90** | 0,99 | 0,78 (ensam körning, TBT 839 ms) | 0,09 mot sämsta jobbmedian (0,99); under 0,90 i den ensamma körningen |
  | Tillgänglighet / SEO | minst 0,95 | minst 0,95 (oförändrat) | 1 | 1 | 0,05 |
  | Best practices | minst 0,90 | minst 0,90 (oförändrat) | 0,96 (API ger fel) / 1 | 0,96 | 0,06 |
  | LCP | högst 5 000 ms | **högst 2 500 ms** | 1 959 / 1 960 ms | 2 106 ms | 394 ms (15,8 %) |
  | FCP (ny rad) | saknades | **högst 1 950 ms** | 1 507 / 1 511 ms | 1 656 ms | 294 ms (15,1 %) |
  | CLS | högst 0,05 | **högst 0,02** | 0,0002 | 0,0002 | 0,0198 |
  | TBT | högst 200 ms | **högst 150 ms** | 29 / 26 ms | 839 ms (ensam körning); sämsta jobbmedian 30 ms | 120 ms mot sämsta jobbmedian |
  | JS (överförd storlek) | högst 275 kB | **högst 150 kB** | 127 553 B | 127 553 B | 22 447 B (15,0 %) |
  | CSS (överförd storlek) | högst 50 kB | **högst 30 kB** | 23 338 B | 23 338 B | 6 662 B (22,2 %) |
  | Totalvikt | högst 500 kB | **högst 355 kB** | 304 866 / 305 135 B | 305 135 B | 49 865 B (14,0 %) |

  Hur taken räknades (ADR 006, punkt 10): LCP-taket blev målet 2 500 ms eftersom medianen (1 960 ms) ligger under 2 250 ms; prestanda
  `min(0,90; median − 0,03)`; JS uppmätt × 1,15 uppåt till 5 kB; TBT 150 ms eftersom medianen är under 100 ms; CLS 0,02 eftersom medianen är
  under 0,01; FCP uppmätt × 1,15 uppåt till 50 ms, räknat på den högsta jobbmedianen (1 655 ms, FCP hoppar i steg om ca 150 ms mellan 1 505
  och 1 655 ms), inte på medianen av alla körningar, som annars hade gett för liten marginal. CSS och totalvikt följer samma regel som JS
  (× 1,15 uppåt till 5 kB): ADR:n nämner dem inte, men 50 kB för en sida på 23 kB hade låtit stilmallarna fördubblas obemärkt.

  Anmärkningar: (1) *Sämsta körning* räknar den ensamma körningen. lhci prövar medianen av tre, så en enstaka avvikare (prestanda 0,78 och TBT
  839 ms förekom en gång i 12 körningar efter RUN-343; före RUN-343 sågs TBT 1 748 ms i en av 36) fäller inget; två avvikare i samma jobb
  hade gjort det. Den sämsta *jobbmedianen* (en jobbmedian är medianen av ett jobbs tre körningar) är det taken prövas mot, och marginalerna
  mot den är minst de ovan. (2) Tillgänglighet och SEO är 1 och best practices 0,96 respektive 1; ADR:n lämnar dem oförändrade.
  (3) Uppspelning: CI-körningarnas rapporter kördes mot den nya `lighthouserc.json` med lhci:s egen `assert`. De fyra jobb och lägen efter
  RUN-343 klarar alla rader; de tolv före RUN-343 (landningen utan uppskjuten ingång) fäller `/` på LCP, FCP och CLS, och `/legal`-raderna klaras i alla sexton.

  **`/legal`** (fullappens `index.html` med laddningsvyn; delar inte landningens vikt) behåller dagens rader, utom LCP som skärps:

  | Rad | Förut | Nu | CI-median | Sämsta körning | Marginal mot sämsta körning |
  |---|---|---|---|---|---|
  | Prestanda (poäng) | minst 0,75 | minst 0,75 (oförändrat) | 0,89 | 0,89 | 0,14 |
  | Tillgänglighet / SEO / best practices | minst 0,95 / 0,95 / 0,90 | oförändrat | 1 | 1 | 0,05 / 0,05 / 0,10 |
  | LCP | högst 5 000 ms | **högst 3 600 ms** | 3 208 / 3 210 ms | 3 225 ms (före RUN-343: 3 225; efter: 3 215) | 375 ms (10,4 %) |
  | CLS | högst 0,05 | högst 0,05 (oförändrat) | 0 | 0 | 0,05 |
  | TBT | högst 200 ms | högst 200 ms (oförändrat) | 1 / 3 ms | 46 ms | 154 ms |
  | JS | högst 275 kB | högst 275 kB (oförändrat) | 232 577 B | 232 664 B | 42 336 B |
  | CSS | högst 50 kB | högst 50 kB (oförändrat) | 41 101 B | 41 101 B | 8 899 B |
  | Totalvikt | högst 500 kB | högst 500 kB (oförändrat) | 312 964 B | 313 052 B | 186 948 B |

  `/legal`-LCP-taket är uppmätt × 1,1 uppåt till 100 ms (3 210 × 1,1 = 3 531 → 3 600 ms), alltså lägre än 5 000 och därmed en skärpning. Målet
  2 500 ms gäller inte `/legal`: LCP ca 3,2 s ligger över det och är en öppen rad i `docs/performance.md`. Att dela raderna per URL lättar
  ingenting för `/legal`: alla dess rader är lika med eller strängare än förut.

  **Hur nivåerna kom till.** Första budgeten (RUN-259) mättes lokalt på Windows/Edge: prestanda 0,75 (RUN-212, prod: 85; lokalt `/` 0,80–0,81),
  tillgänglighet/SEO 0,95 och best practices 0,90 (RUN-212, prod: 100), LCP 5 000 ms (lokalt `/` ca 4,36 s; prod i RUN-212: 3,5 s), CLS 0,05,
  TBT 200 ms (Googles gräns för "bra") och vikterna 275/50/500 kB (lokalt 237/42/428 kB). Den lokala baslinjen är inte CI-runnerns
  (Linux, Chrome): poäng och tider skiljer, överförda vikter i princip inte. Kalibreringen mot CI-körningarna gjordes i S7 (RUN-334, ovan);
  omslaget till blockerande (nedan) är ett eget steg som inte ingår i S7.
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
  Stagingremsan (`VITE_APP_ENV=staging`) finns inte i prodbygget (varken kod, markup eller stil) och påverkar inte budgeten.
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
- **Vad som skickas:** sidvisningar och de åtta egna händelserna i avsnittet "Egna händelser och trattar" nedan, och bara med en normaliserad adress: routens mönster (`/runner/:id`, `/board`, `/login`), aldrig
  den riktiga adressen. Query och fragment tas bort; på landningen behålls `utm_source`, `utm_medium`, `utm_campaign` och
  `utm_content` (Umami läser kampanjerna ur adressen, annars blir kampanjvyn tom), men bara värden som står på **vitlistan**
  (`apps/frontend/src/shared/analytics/utmAllowlist.ts`). Jämförelsen ignorerar skiftläge och det som skickas är listans eget värde,
  aldrig besökarens sträng; okända värden och `utm_term` tas bort. Ett fritt värde kunde annars bära ett id eller ett namn. Okända adresser skickas som `/(not-found)`. Sidans titel ersätts av samma adress och hänvisningen skickas bara som
  ursprung (`https://www.google.com`) eller, inne i appen, som föregående sidas normaliserade adress. Ingen
  rundata, inga distanser, inga tider, inga namn, ingen e-post, inga id:n och inget användar-id (Stravas API-policy 5.4 förbjuder analys på Strava-data).
- **Lägga till en kampanjtagg:** när ägaren ska dela en länk, välj en kort etikett (ett ord, små bokstäver, inget som pekar ut en person),
  lägg den i `utm_campaign` (kampanjen) eller `utm_content` (varianten) i `utmAllowlist.ts`, och använd exakt den i länken
  (`https://www.runquest.dev/?utm_source=instagram&utm_medium=social&utm_campaign=<tagg>`). Ändringen är en liten PR med ett
  tillägg i listan och släpps som vanligt; en tagg som inte står på listan visas som ingen kampanj alls. Källor och medier som redan
  finns: `utm_source` instagram, facebook, messenger, whatsapp, sms, email, linkedin, x, reddit, strava, qr; `utm_medium` social,
  referral, email, sms, qr, organic. Listorna för `utm_campaign` och `utm_content` börjar tomma.
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
- **Två ingångar (v0.8.0, RUN-335):** den förrenderade `landing.html` räknar sina egna sidvisningar (`/`, `/legal`, `/login` via lean routern) med samma sändare och normalisering som appen; `/landing` och `/landing.html` rapporteras som `/`. Vid överlämningen till appen (inloggning, sessionstipset, okänd adress) skickar landningen ingen visning, så samma besök räknas inte två gånger. Kontrollen ovan görs därför på både `/` och `/board`.

#### Egna händelser och trattar (RUN-292, epic RUN-19)

**Händelserna.** Listan är fast och bor i `packages/shared/src/analytics.ts` (`ANALYTICS_EVENTS`); appen skickar med
`track(händelse, props)` (`apps/frontend/src/shared/analytics/track.ts`). Ett okänt namn eller en okänd prop är ett kompileringsfel, och
en vakt (`sanitizeAnalyticsEvent`) avvisar hela händelsen vid körning om något avviker från listan (okänt namn, okänd nyckel, ett värde
utanför de uppräknade, en prop som saknas). Namnen är kebab-case, som i Umamis egen dokumentation (`signup-button`); propnycklar är
enstaka gemena ord. En ny händelse eller ett nytt värde kräver en ändring i `analytics.ts`, alltså en granskad diff.

| Händelse | När den skickas | Props |
| --- | --- | --- |
| `film-started` | Landningens film börjar spela från postern (inte vid återupptagen paus eller sökning) | inga |
| `waitlist-click` | Klick på "Join the waitlist" i landningens hjälte | inga |
| `waitlist-joined` | Servern har tagit emot anmälan till väntelistan | inga |
| `login-click` | Klick på "Sign in" i landningens header | inga |
| `challenge-accepted` | En utmaning har antagits (servern har svarat ok) | inga |
| `notifications-opened` | Klockan i headern öppnas | inga |
| `setting-changed` | En inställning är sparad (servern har svarat ok); en händelse per nyckel, även vid återställning | `setting`: inställningens nyckel ur registret (`notify.<slag>`) |
| `strava-connected` | Strava-kopplingen har godkänts av servern | inga |

- **Medvetet utelämnad: `run-logged-manual` (runda loggad manuellt).** Förslaget i RUN-292 hade den, men en händelse som räknar loggade
  rundor ligger för nära ägarens gräns "ingen rundata" och Stravas API-policy 5.4 för att tas med utan ett uttryckligt beslut.
  Den kan läggas till i `analytics.ts` (med koppling i `useCreateRun` och test) efter ägarens beslut.
- **Aldrig i händelserna:** rundata, distanser, tider, namn, e-post, id:n, athlete-id, användar-id eller några fria strängar och tal
  (Stravas API-policy 5.4, ägarbeslut i RUN-19). `setting-changed` skickar vilken inställning som ändrades men **aldrig värdet**: värdet
  är användarens personliga val och blir, när gruppinställningar och enumvärden kommer (ADR 012), något som kan peka ut en grupps regler.
  Att räkna vilka inställningar som rörs räcker för att se vad som används. Vill ägaren senare se riktningen (på/av) läggs den till som en
  uppräknad prop i `analytics.ts`, med nytt test.
- **Samma grindar som sidvisningarna:** händelserna delar kö, laddare och skripttagg med sidvisningarna (`umamiPageviews.ts`). Utan
  `VITE_UMAMI_WEBSITE_ID`, eller i ett stagingbygge, laddas inget skript och inget skickas. Händelsens `url` är den normaliserade sidan
  den hände på, titeln ersätts av samma adress och hänvisningen är tom.
- **Ägarens steg i Umami-panelen (Reports → Funnel), efter att variabeln är satt i prod och en första sidvisning syns:**
  1. Skapa en tratt med namnet **Waitlist**, fönster **60 minuter** (hur länge en besökare får ta på sig mellan stegen).
  2. Steg 1: typ **Page (URL)**, värde `/` (landningen).
  3. Steg 2: typ **Event**, värde `waitlist-click`.
  4. Steg 3: typ **Event**, värde `waitlist-joined`.
  Att komma ihåg: steg 2 räknar bara klick på knappen i hjälten. En besökare som scrollar ner till formuläret och anmäler sig utan
  att klicka knappen tappas ur tratten mellan steg 1 och 2 (men syns som `waitlist-joined` i händelsevyn). Vill ägaren ha tratten
  utan det glappet är alternativet att göra steg 2 till "formuläret fokuserat"; det kräver en ny händelse i listan.
  Frivilliga fler: **Film** (Page `/` → Event `film-started` → Event `waitlist-joined`) och **Login** (Page `/` → Event `login-click`).
  Ägaren bekräftar i Umami att trattarna visar siffror; det går inte att bekräfta före första riktiga trafiken i prod.
- **Kontroll i prod (Lead och ägaren):** i DevTools → Network ska en klick på "Join the waitlist" ge en POST till `/api/send` med
  `"name":"waitlist-click"` och en `url` som `/`; en inställningsändring ska ge `"name":"setting-changed"` med `data` som bara har `setting`.
  Ingen payload ska innehålla ett id, ett namn, en e-postadress eller ett tal.

### 4. Rök mot de kritiska flödena

Kör rök-raden för varje kritiskt flöde i `STATE.md` ("Kritiska flöden", nio stycken) som releasen rör, och alltid
flöde 1 (login → JWT → skyddade anrop). Minst: frontend laddar utan vit sida (inklusive en direktladdad djup länk som
`/board`), `GET /health` svarar, nya endpoints svarar 401 utan token, och den nya funktionen syns. Muterande rök i prod
(loggad runda, utmaning) görs bara om ägaren säger ja, eftersom det är den riktiga gruppens data.

**Förrenderad landning och laddningsvy (v0.8.0, RUN-333, ADR 006 addendum 2026-10-19).** `/` serveras av `landing.html` (Caddyfilen, exakt `/` med valfri
fråga; `/landing` och `/landing.html` omdirigeras till `/` med 307; utan `landing.html` faller `/` tillbaka på `index.html`), alla andra adresser av `index.html`
vars `#root` bara har laddningsvyn. Det automatiska beviset:
- `scripts/verify-static-serving.sh` (CI, mot det byggda `dist` med Caddy): `/`, `/?tab=titles` och `/?utm_source=x` ger landningen; `/titles`, `/login`,
  `/runner/x`, `/board` och `/legal` ger bara laddningsvyn; bygge utan `landing.html` ger 200 på `/`. Lokalt utan nätverk: `CADDY_BIN=<sökväg till Caddy 2.11.4>`.
- `apps/e2e/tests/landing.spec.ts` (e2e-staging-jobbet, nattligt eller manuellt, mot staging): utan JavaScript syns landningens h1; animationernas starttid är
  oförändrad efter hydrering; en inloggad besökare på `/` hamnar på `/board` utan att landningen någonsin fanns i DOM; inloggning från `/`, en inloggad besökare på `/`
  och direktladdning av `/board` och `/legal` visar laddaren (`role="status"`, texten "Loading") inom 500 ms medan fullappens JS är fördröjd 2 s, utan en enda blank
  bildruta; landningen står kvar med blockerad lagring; stilmallarna på `/` och `/legal` är under 50 000 överförda bytes; tourens stängknapp har fokusring. Sidvisningsproven
  hoppas över mot staging (stagingbygget skickar ingen webbanalys) och körs bara lokalt mot ett bygge med webbplats-id (`docs/e2e.md`). Provet av `/board` och inloggningen från `/` kräver testkontot; `login.spec.ts` ska vara grön oförändrad.
- Lighthouse-artefakten (`lighthouse-reports`) ska visa `/` som den förrenderade landningen (dokumentet ca 7 kB, `landing-title` i HTML:en).

**Manuell kontroll i Safari och Firefox på staging (ägaren; kan inte automatiseras, risk 10 i ADR 006).** Laddningsvyn målas först när CSS:en laddats, och Chromium
behåller det gamla dokumentet tills det nya kan ritas, men Safari och Firefox kan visa en kort tom ram. Gör för varje webbläsare på
`https://runquest-frontend-staging-staging.up.railway.app`, helst med nätverket strypt till "Slow 4G"/"Fast 3G" i utvecklarverktygen:
1. Utloggad: öppna `/`. Landningen ritas direkt (rubriken syns innan allt annat har hunnit laddas). Klicka Sign in, skriv in testkontot och logga in.
   **Förväntat:** laddaren (guldoval med löpare, texten "Loading" för skärmläsare) står kvar mellan Sign in och Board; ingen blank vit eller svart ram.
2. Inloggad: öppna `/` i en ny flik. **Förväntat:** laddaren, sedan Board; landningen syns aldrig, inte ens som blixt.
3. Direktladda `/board` och `/legal` (Ctrl/Cmd+Shift+R). **Förväntat:** laddaren före allt annat; `/legal` utloggad går sedan till sin sida.
4. Skärmläsare eller tillgänglighetsträdet: laddaren är en `status` med texten "Loading".
5. Notera webbläsare och version. Ser du en blank ram trots allt: skriv ner var (steg 1–3), om den är vit eller har sidans bakgrund, och hur lång den är. Det
   är då ett noterat undantag enligt risk 10, och åtgärden är en liten inline `<style>` med bakgrund per `prefers-color-scheme` (eget beslut).

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
4. Backfill- och omräkningsskript (`backfill:*`, `reveal:badges`): dry-run fritt, `--apply` kräver
   ägar-ja med dry-run-rapporten som underlag. Skripten skriver ut måldatabasens host.
5. **Migrationerna 053–057 i v0.8.0 (ADR 012; 057 är RUN-322)** körs i den här ordningen, först i staging och sedan i prod med ett ja per migration:
   053 `group_members`, 054 `group_settings`, 055 `title_scope_group`, 056 `revoke_legacy_title_function_execute`, 057 `create_recalculation_marks`.
   053, 054, 055 och 057 är additiva och körs FÖRE backend-deployen (ny kod mot gammal databas fungerar inte); ingen av dem körs efter deployen. 056 kan köras före eller efter
   deployen (backend använder service role, som behåller execute) men alltid efter 055. Bevisfrågorna står i varje filhuvud; kör dem i staging och i prod.
   - **053:** stannar migrationens egna förkontroller (fler än en grupp, användare utan grupp, oklar admin) ändras ingenting; fråga ägaren, ändra ingen
     data för att få den att gå igenom. Efter apply: bevisfrågorna 1–7 i huvudet (aktiva medlemskap = användare med grupp, 0 avvikelser mot `users.group_id`,
     exakt en admin per grupp och det är gruppens skapare, RLS på utan policyer, execute bara för `service_role`, främmande nycklar med cascade) och `get_advisors` (security). Skrev äldre kod
     `users.group_id` mellan apply och deploy är filen idempotent: kör om den.
   - **054:** efter apply bevisfrågorna i huvudet (RLS på, 0 policyer, ingen klientåtkomst, tabellen tom) och `get_advisors` (security).
   - **055** körs när ingen Strava-synk, cron eller titelomräkning pågår (den tar ACCESS EXCLUSIVE på `user_titles`/`title_leaderboard` och alla
     titellås i slutet). Kör före-frågorna A1–A7 i filens huvud först och spara A4/A5; efter apply B1–B4, C1/C2, D1 och E1–E6, och `get_advisors`
     (security). Exakt lika rader (A7) får byta plats (ägarbeslut 2026-10-19); B3 och B4 bevisar att innehavare och ordningen mellan olika värden är
     oförändrade. Får den `40P01` (deadlock) eller `lock_timeout` (55P03) har allt rullats tillbaka: vänta en stund och kör om hela filen. Stannar en av
     migrationens egna kontroller (`migration 055 stopped/failed`) ändras ingenting; fråga ägaren, ändra ingen data för att få den att gå igenom.
   - **056:** kör katalogfrågan (`QUERY-START` i huvudet) FÖRE apply i varje miljö och spara `proacl` per funktion: rollbacken ska ge exakt
     utgångsläget tillbaka, och miljöerna skiljer sig (staging har PUBLIC-execute, prod saknar det). Efter apply samma fråga igen (förväntat: public_execute,
     anon och authenticated false, service_role true), triggerkontrollen i huvudet och `get_advisors` (security). Rök: en runda som bygger om topplistan
     och en event-utbetalning går igenom. Den tillfälliga schemadiff-regeln för 056 är borttagen sedan 056 finns i båda miljöerna (`docs/staging.md`, avsnitt 4).
   - **057 `create_recalculation_marks`** (RUN-322, återhämtning av omräkning efter en radering) är additiv och körs FÖRE backend-deployen, efter 056
     (ny kod anropar `mark_recalculation`; saknas den raderar avstämningen ingenting). Efter apply: katalogfrågorna Q1–Q5 och Q4b i huvudet (RLS på,
     0 policyer, ingen klientåtkomst till tabellen, funktionerna och sekvensen bara för `service_role`, Q5 = 0 rader) och `get_advisors` (security).
     Rollbacken står i huvudet och kräver att koden är tillbakarullad först.
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
   Sätt aldrig `TZ` på backendtjänsten; processen ska köra i UTC. Stockholm-jobben får sin zon av `timezone`-optionen på varje schema, och
   ett `TZ` med sommartid får node-cron att räkna fel under timmen som upprepas när klockan ställs tillbaka (uppmätt: ett jobb utan
   `timezone` körde inget på ungefär en timme). Backend loggar en
   varning vid start (produktionsläge) om `TZ` är satt till något annat än UTC eller tomt.
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
