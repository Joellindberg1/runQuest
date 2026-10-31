# E2E-rök med Playwright (mot staging)

Intern förvaltningsdokumentation (svenska, för Lead och ägaren). ADR 001 sköt Playwright tills en miljö skild från prod fanns; sedan
2026-10-17 finns staging ([`docs/release.md`](release.md), "Preview på staging"), och sviten bor i `apps/e2e`. Den är en rök, inte en
regressionssvit: specfilerna i `apps/e2e/tests`, kortaste kedjan som bevisar att flödena i `STATE.md` ("Kritiska flöden") lever.

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
| `tests/change-password.spec.ts` | 1 Login | Fel nuvarande lösenord i Settings (Password-kortet) ger felet "Current password is incorrect" kvar i kortet och loggar inte ut: svaret är 401 med koden `current_password_incorrect` (ADR 007 Addendum 2026-10-20 punkt 7: bara `unauthorized` och `token_invalid` avslutar sessionen), sidan står kvar på `/settings`, token finns kvar och en omladdning leder inte till `/login`. Provet ändrar inget lösenord (det skickar ett fel nuvarande). Mot det fejkade API:et svarar stubben med samma kod; mot staging krävs en backend med koden (en backend från före RUN-354 ger ett kodlöst 401 som klienten tolkar som en utgången session) |
| `tests/access.spec.ts` | 1 Login | Ett vanligt konto som öppnar `/admin` skickas till Board; stagingbannern syns (hoppas över mot localhost) |
| `tests/board.spec.ts` | 4 Leaderboard | Board visar hela gruppen i den ordning servern rankar (podiet och tabellen "Rest of the pack" mot `GET /auth/users-with-runs`), antalet löpare i rubriken stämmer, flikarna Week/Streaks/All-time öppnas |
| `tests/log-run.spec.ts` | 2 Logga runda | 1,5 km i formuläret ger bekräftelsen, ökar XP och distans (mätt mot API:t), syns i Group history med "mine"-markering; radering återställer totalerna exakt; under minimidistans skickas ingenting |
| `tests/board-after-run.spec.ts` | 2 Logga runda, 4 Leaderboard | Efter en loggad runda (klientsidig navigering Leaderboard → Log Runs → Leaderboard, ingen omladdning) hämtar Board om gruppen och löparens kort eller rad visar de nya totala kilometerna. Mot staging skriver provet en riktig runda om 1,5 km och städar före och efter på samma sätt som `log-run.spec.ts`; mot det fejkade API:et har stubben ett eget tillstånd per test (`POST /runs`), så inget behöver städas |
| `tests/board-long-name.spec.ts` | layout (inget eget flöde) | Rest-raderna ("Rest of the pack") på 320, 360 och 375 px med ett namn som har ett ord på 28 tecken utan brytpunkt ("Montgomery-Featherstonehaugh 1"): varje rad ligger inom ramen, namnet inom sin rad och sidan scrollar inte sidledes; raderna med vanliga namn har lika hög rad. Före fixen sprängde namnet raden 19 px på 320 px (mittkolumnens min-content). Gruppen sätts i webbläsaren (ersätter svaret på users-with-runs, så provet gäller lika mot staging och stubben och inget når ett riktigt API). Podiet (320, 375 och 1280 px, med och utan badge-minis): ett namn med ett ord på 45 tecken på plats 3 ligger inom kortet (textens `Range` mot kortets kant), badgegruppen ligger kvar inom kortet och sidan scrollar inte sidledes; före fixen låg namnet 83 px (375 px), 138 px (320 px) och 224 px (1280 px) utanför kortet. Vanliga namn i podiet bryts som förut (kortens höjd och namnens radantal mot samma kort med `overflow-wrap: normal`). Måtten tas efter `waitForStylesApplied` |
| `tests/news.spec.ts` | 8 Pack News | Sju chips i rätt ordning som slås av och på via `?type=` (ADR 011 B7); läst-vid-hover med riktig pekare: fokus ensam markerar inget, en pekare som rör sig in över raden gör den läst (`POST /news/read`) och det består efter omladdning (ADR 011 addendum 2026-10-14) |
| `tests/landing.spec.ts` | 1 Login | Den förrenderade `/` och laddningsvyn (ADR 006 addendum 2026-10-19): utan JavaScript syns landningens h1; animationernas starttid är oförändrad efter hydrering; `/login` ger landning med dialogen öppen; en inloggad besökare på `/` hamnar på `/board` (exakt två dokumentbegäranden) utan att landningen någonsin fanns i DOM; landningen står kvar när lagringen är blockerad; stilmallarna på `/` och `/legal` ligger under 50 000 överförda bytes (loggas); tourens stängknapp har fokusring vid sex Tab-tryck; sidvisningarna (utloggad med utm = 1 visning med bara vitlistade värden, inloggad = bara `/board`, inloggning från landningen = `/`, `/login`, `/board` utan dubbel; **hoppas över mot staging**, se nedan). Med fullappens JS fördröjd 2 s (`support/loadingView.ts`) visar inloggning från `/`, en inloggad besökare på `/` och direktladdning av `/board` och `/legal` laddaren (`role="status"`, texten "Loading") inom 500 ms och loggen över bildrutor och DOM-ändringar har aldrig en tom ruta. Med topplistans svar (`GET /auth/users-with-runs`) hållet (`holdStandings`) står laddaren kvar efter inloggning från `/`, för en inloggad besökare på `/` och vid direktladdning av `/board` tills svaret släpps, skalet ritas inte före det, podiet är ifyllt när Board syns och ingen bildruta visar Board utan podium. Med titlarna hållna (`holdTitles`, stubbat API) står laddaren kvar också efter att gruppen svarat, ingen bildruta visar ett podiekort med "No titles held yet", en platt rank-pil eller utan badge-mini (stubben ger alla tre: `titles/user`, `leaderboard/rank-delta`, `badges/group`), och varje fråga går en gång. Klientsidig navigering visar ingen laddare igen; ett misslyckat första svar (`failStandings`) ger skalet inom 5 s (laddaren ger vika vid första försöket, långt före omförsökens slut efter ca 7 s; 5 s ger marginal för en långsam runner mot staging) och Boards felvy när omförsöken är slut, och ett svar som aldrig kommer släpper laddaren efter 8 s. Geometriprovet (320, 390 och 1440 px) mäter laddarens rektangel i `index.html` före JS och i gaten efter React: ca 217 x 167 px (tre gånger förra storleken), identisk inom 1 px (också mot ett stagingbygge: stagingbannern står förrenderad över laddaren i `index.html`, så provet räknar inget avdrag för bannerns höjd), inom fönstret och utan sidled scroll. Måtten tas först när sidans stil är tillämpad (se "Stilmallar och mått" nedan), och ett eget prov loggar laddarens rektangel i varje ritad bildruta (sidans rAF) med fördröjda stilmallar och kräver att ingen avviker från slutläget |
| `tests/landing-waitlist.spec.ts` | 1 Login | Väntelistan i den förrenderade `/` (RUN-336): med landningens JS hållen går formuläret inte att fylla i (`inert`) och det ifyllda finns kvar efter hydrering; Enter före hydrering skickar inget och laddar inte om sidan; efter hydrering (formuläret inte längre `inert`) kan det fyllas i och skickas och tackrutan visas (POST fångad, inget skrivs) |
| `tests/legal.spec.ts` | innehåll (inget eget flöde) | `/legal` visar "Version <DATA_POLICY_VERSION>" (värdet importeras ur `packages/shared/src/legal/dataPolicy.ts`, inte hårdkodat) och texten "legitimate interest" (rättslig grund för Umami och Sentry); `/legal` ger noll CSP-överträdelser, också rapporterade (Report-Only), via `cspGuard`-fixturens logg; samtyckeslänken i väntelistans formulär på `/` (texten `WAITLIST_CONSENT_LINK_TEXT` ur samma källa) leder till `/legal`. Provet kör utan session och skriver ingenting, så det går att köra mot staging utan testkontots uppgifter (`E2E_STUB_API` behövs inte) |
| `tests/landing-spacing.spec.ts` | layout (inget eget flöde) | Väntelistan på `/` (375 och 1280 px): avståndet från funktionskorten (Events, Strava sync, The journey) till väntelistan är större än noll och lika stort som sektionsavståndet mellan How it works och korten (±1 px). Före fixen var det 0 px på datorbredd (`padding-block: 0 76px 76px` är tre värden och föll bort). Måtten tas efter `waitForStylesApplied` |
| `tests/send-sheet-bet.spec.ts` | 5 Utmaningar (layout) | Kortet "The bet" i send-arket på `/duels` (375 och 1280 px): samma vänster- och högerkant som tokenkorten, samma inre luft (padding) som övriga kort, och rubriken och de tre insatskolumnerna (If you win, If you lose, Starts) vänsterställda mot samma kant. Arket fylls av API-svar som provet lägger över det fejkade API:et (`/challenges/my`, `group-stats`, `head-to-head`), så provet **hoppas över mot staging**. Måtten tas efter `waitForStylesApplied` |
| `tests/board-badge-spacing.spec.ts` | 4 Leaderboard (layout) | Badge-minis i Season-raderna (podiekort och rest-rader, 320, 360, 375 och 1280 px) med tre visade badges och långa namn: mellanrummet mellan två badges är minst ett steg ur spacing-skalan (`--rq-sp-8`, samma som badge-rutnäten; under 360 px ligger `--rq-sp-4` kvar eftersom rest-raden annars inte rymmer "N km" och tre badges på en rad), badgesen ligger på en rad inom sin rad, en rest-rad med tre badges är lika hög som en utan, och sidan scrollar inte sidledes. Podiekorten (tvåordsnamn och långa namn med tre badges, 340, 360, 375, 1024, 1180, 1280, 1366 och 1440 px): namnets textrektanglar (`Range`) skär aldrig badgegruppens rektangel, namnknappen har aldrig `scrollWidth > clientWidth` och badgegruppen ligger inom kortet; rymmer inte namn och tre badges bredvid varandra ligger gruppen på en egen rad under namnet. Gruppen och badge-svaren (`/auth/users-with-runs`, `/badges/group`) läggs över det fejkade API:et av provet, så det **hoppas över mot staging**. Måtten tas efter `waitForStylesApplied` |
| `tests/profile-overflow.spec.ts` | layout (inget eget flöde) | Profilen (`/profile`) på 320, 360 och 375 px: sidan scrollar inte sidledes (`scrollWidth` högst `clientWidth`), och var och en av de fyra statflikarna (Distance, Streak, Fun facts, Consistency) går att nå med piltangenterna och ligger helt inom flikraden när den är vald. Före fixen låg fliken Consistency 32 px utanför fönstret på 320 px (flikraden är `nowrap` med ikoner och rymmer inte fyra flikar i kortets 282 px) och stack ut ur kortet också på 360 px. Flikraden scrollar nu i sidled i kortet (`.rq-profile-tabs`, som chip-raderna) och `ViewTabs` för den valda fliken i bild. Flikarna behåller `flex: 1` (lika breda på datorbredd; på 375 px samma bredder som förut, jämförda med `flex: 1` satt direkt på flikarna), och fokusringen ritas inåt (`--rq-focus-inset`) eftersom `overflow-x: auto` också klipper en yttre ring uppåt och nedåt: på 320, 375 och 1440 px ligger ringen vid tangentbordsfokus inom radens rektangel. Den dekorativa banan (`.rq-track-bg__track`) bidrar inte: lagret är `position: fixed` med `overflow: hidden`. Sidan fylls av det fejkade API:et, så provet gäller lika mot staging. Måtten tas efter `waitForStylesApplied` |
| `tests/board-overflow.spec.ts` | 4 Leaderboard (layout) | Board med sex löpare (podium + tre rest-rader, alla med tre badges) på 768, 1024, 1100, 1180 och 1280 px: sidan scrollar inte sidledes (`scrollWidth` mot `clientWidth` på `<html>`), varje rad i "Rest of the pack" slutar inom tabellens ram och ingen cell har innehåll bredare än sig själv. Före fixen scrollade sidan 126 px på 1024 px och 50 px på 1100 px (rest-tabellens sju kolumner behövde ca 870 px av de ca 710 px som finns med sidofältet). Podiekortens statruta (1024, 1100, 1180 och 1280 px): varje etikett (km total, longest, runs; texten mätt med ett `Range`) ligger inom sin cell och två etiketter ligger minst ett steg (`--rq-sp-8`) isär; före fixen löpte "LONGEST" in i "RUNS" på 1024 och 1100 px. Gruppen och badge-svaren läggs över API:et i webbläsaren, så provet gäller lika mot staging och stubben. Måtten tas efter `waitForStylesApplied` |
| `tests/duels-overflow.spec.ts` | 5 Utmaningar (layout) | Duels (`/duels`) med långa namn (ett ord på 45 tecken, ett namn av tre ord och ett med bindestreck; ett av dem är mitt eget) på 320, 375, 1024, 1100, 1280 och 1440 px i båda temana, för Standings, Live (live-korten och erbjudandekorten "Waiting on you" och "Sent") och History: inga två texter i en rad skär varandra (varje lövelements synliga ruta, texten mätt med ett `Range` eller, för ett element som klipps med ellips, elementets egen ruta), ingen text sticker ut ur sin egen ruta eller sin rad, ett musklick mitt på varje namn träffar namnknappen (`elementFromPoint`) och sidan scrollar inte sidledes. Flikraden (Standings, Live, Rules, History): alla fyra flikar ligger på en rad, den valda ligger helt inom raden, raden går inte in i Send-knappen, sidan scrollar inte sidledes och på mobil är varje flik minst 44 px hög. Före fixen överlappade namn och W-cellen (Standings), namn och meta (History) och namn och insatsceller (erbjudandekorten) på alla bredder, Standings var ~375 px bred bredvid sidokolumnen på 1024 px med 342 px fasta kolumner, korten gav 159 px (320 px) och 104 px (375 px) sidled scroll och flikraden bröts till två rader. Svaren (`/challenges/my`, `group-stats`, `group-history`, `:id/progress`) läggs över det fejkade API:et av provet, så det **hoppas över mot staging**. Måtten tas efter `waitForStylesApplied`. Ett prov per bredd och tema (12) som går igenom flikarna med klick. Dessutom (RUN-442, utökat i RUN-446): vanliga namn ("Maria Johansson", "Christopher Gustafsson" m.fl.) vid 320, 340, 360, 368, 375, 390, 414, 430 och 480 px i båda teman bryts bara vid mellanslag (18 prov; "Maria Johansson", "Christopher Gustafsson", "Sebastian Andersson", "Jonathan Söderström" m.fl.; före RUN-446 bröts "Christopher" och "Gustafsson" mitt i ordet på 360 och 368 px), och Standings namnkolumn blir aldrig smalare när skärmen blir bredare (mätt vid 320, 340, 359, 360, 374, 375, 390, 414, 430, 480, 600, 768 och 1023 px; 1 prov) och rang, siffror och procent behåller de smalaste spårens bredd (före fixen krympte namnkolumnen från 146 px vid 374 px till 95 px vid 375 px), Live-kortens längd och tid ligger var för sig på en rad vid 1024, 1050 och 1100 px (3 prov), och insatsradens längd ("/ 14 d") bryts inte inom sig vid 1024 och 1050 px (2 prov). Längden ("7 d") i titeln på erbjudandekorten (Waiting on you och Sent: 39 inkommande med olika förnamn, mått och längder samt ett skickat) och i historikraderna (48 rader) bryts aldrig mellan talet och "d" vid 320 och 375 px (4 prov, RUN-446); före fixen bröts den på 320 px (erbjudandekorten och historiken) och på 375 px (erbjudandekorten, t.ex. "Christopherson · Most runs · 10 d"), medan historiken är hel på 375 px både före och efter. Rules-fliken (RUN-444) mäts på hela Duels-ytan vid 320, 375, 1024, 1050, 1100, 1140, 1180, 1220, 1280 och 1440 px i båda teman (20 prov): varje nivåtitel ligger inom sitt korts innerruta (utan padding), inga två texter bland nivåkorten och sidokolumnen skär varandra och sidan scrollar inte i sidled. Före fixen gick "Legendary" ut ur sitt kort och ritades över "Your tokens" på 1024-1140 px (korten 118-157 px breda) och in i kortets padding på 1180 px |
| `tests/rightnow-overflow.spec.ts` | layout (inget eget flöde) | Right now-panelen i sidnavet (`/board` på 1024, 1280 och 1440 px, mörkt och ljust tema) med en live eller väntande duell mot en motståndare vars namn har ett ord på 45 tecken och ett event vars namn har ett ord på 34 tecken: varje rad ligger inom panelens ram, texten i etiketten, noteringen och värdet (mätt med ett `Range`) ligger inom ramen, noteringen och etiketten går inte in i värdet, och varken sidnavet eller sidan scrollar sidledes. Före fixen var raderna 329 px breda i en panel på 223 px (106 px utanför) och sidnavet scrollade sidledes (`scrollWidth` 342 mot 249 px): textkolumnen är ett `1fr`-spår vars min-content var det längsta ordet. Med vanliga namn har varje ruta (panelen, raderna, etiketten, noteringen och värdet) samma mått som när brytreglerna (`min-width: auto`, `overflow-wrap: normal` på textkolumnen) tas bort. Duellen och eventet läggs över det fejkade API:et av provet (`/challenges/my`, `/events`), så det **hoppas över mot staging**. Måtten tas efter `waitForStylesApplied` |
| `tests/transitions.spec.ts` | 1 Login | Övergångarna inuti fullappen har aldrig en tom `#root` (ADR 006 addendum 2026-10-19, punkt 11): inloggning från `/login?next=/titles` och utloggad direktladdning av `/titles` (som skickas till `/login?next=%2Ftitles`). Loggen över bildrutor och DOM-ändringar (`logFrames`) fångar också en commit som tömmer `#root` utan att hinna ritas; en ritad bildruta ska dessutom visa en laddare med storlek, landningen eller skalet (Suspense gömmer det gamla innehållet med `display: none` medan fallbacken laddar, och det gömda räknas som text i `isBlankFrame`). Laddarens rektangel i varje ritad bildruta har sin storlek (ca 217 x 167 px) och står still. Omdirigeringarna (`RequireAuth`, `Index`) går genom `PendingNavigate`, som ritar laddningsvyn bredvid `<Navigate>` |
| `tests/loader-runners.spec.ts` | 4 Leaderboard | Stadion-ovalens löparprickar ligger på sina banlinjer (±1 px, i fyra faser av varvet): i laddningsvyns 192 px (fullappens JS fördröjd) och i Week-flikens 64 px (veckosvaret hållet, `holdWeek`). Prickens mitt mäts mot banans `path` med `getPointAtLength` och `getScreenCTM()` (`support/loaderGeometry.ts`), så lutningen på -16° räknas in. Animationerna pausas i varje fas |
| `tests/loader-continuity.spec.ts` | 1 Login | Laddningsvyns löparprickar står kvar där de var när vyn byter nod eller dokument: index.html -> React -> gaten, en omladdning (ett nytt dokument) och inloggning från landningen. Varje ritad bildruta loggar prickarnas andel av varvet (`getComputedTiming().progress`, `support/runnerPhase.ts`) och varje prick jämförs med föregående bildruta på sin bana: avvikelsen från "förra andelen plus tiden som gått" i px längs banan ska vara högst 2 px (utan fasen från klockan 76-184 px, med den 0). Dolda prickar och dolda laddare (0 x 0) räknas inte. Fasen sätts av `TrackLoader` (ref) och av ett inline-skript i `<head>` i index.html (`runnerPhase.ts`) |
| `tests/loader-chunked-delivery.spec.ts` | 1 Login | index.html som kommer i flera bitar: dokumentet levereras med ett parserblockerande skript (hållet 600 ms) mellan första och andra pricken, så att parsern står still mitt i laddaren medan bildrutor ritas. Varje ritad prick ska ligga på sin plats på klockan (`((väggklocka - fördröjning) / varvtid) mod 1`, högst 2 px; utan fix 103 px för de prickar som parsades efter den första) |
| `tests/loader-reduced-motion.spec.ts` | 1 Login | Med minskad rörelse (`reducedMotion: 'reduce'`) och fullappens JS hållen syns alla tre prickarna i index.html i varje ritad bildruta och `<html>` har aldrig klassen `rq-phase-pending` (skriptet i head väntar bara på prickarnas fas när de rör sig; deras animationer har annars redan tagit slut) |
| `tests/news-chips.mobile.spec.ts` | 8 Pack News | Playwright-kandidaten ur ADR 011 och `features/news/README.md`: på 412 px scrollar de sju chipsen sidledes i sin rad (`scrollWidth > clientWidth`) utan att göra sidan bredare, och sista chipet nås med tangentbordet |
| `tests/playbook-basics.spec.ts` | layout (inget eget flöde) | Tabellen "The basics" (/playbook?view=run): varje rad och varje svar (texten mätt med ett `Range`) ligger inom rutans kant, listan med raderna, på 375 och 1280 px, och sidan scrollar inte sidledes. Det långa svaret "As you save, backup every 12 hours" fick förut raden att växa ur rutan (hårlinjegridens spår tog radens min-content). Måtten tas efter `waitForStylesApplied` |
| `tests/security-headers.spec.ts` | alla | Säkerhetshuvudena på `/`, `/login` och en saknad fil (404): HSTS `max-age=31536000` utan `includeSubDomains`/`preload`, `Referrer-Policy: strict-origin-when-cross-origin`, `nosniff`, `X-Frame-Options: DENY` och en CSP (skarp eller Report-Only; provet noterar vilken) med `frame-ancestors 'none'` och utan `unsafe-inline`/`unsafe-eval`/`strict-dynamic` i `script-src`. Svaren hämtas utan webbläsare och utan inloggning |

### CSP-överträdelser fäller varje prov

Den automatiska fixturen `cspGuard` (`support/test.ts`, `support/cspViolations.ts`) lyssnar efter `securitypolicyviolation` i varje dokument och ram i testets kontext. Det finns ingen `report-uri` (den skulle kräva Sentrys DSN-nyckel), så sviten är det enda stället där överträdelser syns.
Skarp CSP (`disposition: enforce`, rubriken `Content-Security-Policy`) som blockerar något fäller provet med en rad per överträdelse (`[enforce] script-src-elem blocked inline on <sida> (<fil>:<rad>)`). Medan CSP går som Report-Only (`Content-Security-Policy-Report-Only`) fäller inget, men varje prov skriver ut
`CSP report-only: N violation(s) in "<provets titel>"` med raderna och lägger dem som anteckning `csp-report-only` på provet; läs dem efter en körning mot staging. Fixturen ger också loggen till provet som ber om den (`async ({ page, cspGuard }) => … cspGuard.all()`), så ett prov kan kräva noll överträdelser även medan CSP:n är Report-Only (`legal.spec.ts`). En ny sida, ett nytt bibliotek eller en ny extern adress som CSP:n inte täcker syns alltså i den ordinarie nattkörningen utan särskilt prov.

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

Bara `log-run.spec.ts` och `board-after-run.spec.ts` skriver data (båda med samma rund och samma städning; de körs en i taget). Testrundan har distansen **1,5 km** (`E2E_RUN_KM` i `support/api.ts`) på testkontot:

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

För att bevisa landningens och laddningsvyns specer utan staging: bygg frontend (`VITE_APP_ENV=staging npm run build --workspace=@runquest/frontend` ger ett stagingbygge, ett vanligt bygge går också), servera `apps/frontend/dist` med repo-rotens `Caddyfile` (så att regeln för `/` gäller; rendera `{{.DIST_DIR}}` som `scripts/verify-static-serving.sh` gör, och lägg det falska API:et i `connect-src`, annars blockerar CSP:n anropen: `sed -e "s|{{.DIST_DIR}}|<dist>|g" -e "s|connect-src 'self'|connect-src 'self' http://localhost:3001|" Caddyfile > Caddyfile.local`; det är bara den renderade kopian som ändras) och kör sviten med `E2E_STUB_API=1`:

```bash
export E2E_BASE_URL=http://localhost:18100 E2E_API_URL=http://localhost:3001 E2E_STUB_API=1
export E2E_USER_LOGIN=stub-login E2E_USER_PASSWORD=any-made-up-value   # fejkkontot; inget riktigt konto
cd apps/e2e && npx playwright test tests/landing.spec.ts tests/login.spec.ts --project=desktop
```

Sidvisningsproven (`pageviews`) kräver ett bygge med webbplats-id: ett stagingbygge laddar aldrig Umami-skriptet (`umamiWebsiteIdOf`), så de hoppas över om inte `E2E_UMAMI_BUILD=1` är satt. Bygg då utan `VITE_APP_ENV=staging` men med `VITE_UMAMI_WEBSITE_ID=<ett påhittat uuid>`; trackern `/vendor/umami.v1.js` (appens egen kopia) ersätts i webbläsaren av en stub (`support/analytics.ts`) och ingenting når Umami. Nattkörningen mot staging kör alltså inte dessa prov.

`E2E_STUB_API=1` (`support/stubApi.ts`) besvarar alla förfrågningar till API-adressen i webbläsaren med fejkade svar och vägrar köra om inte både frontenden och API:et är localhost (vakten). Utan variabeln är API:et alltid det riktiga, så mot staging händer ingenting nytt. Stuben räcker för inloggning, landningen, laddningsvyn, skalet runt Board, väntelistan (`POST /waitlist`, inget sparas) en loggad runda (`POST /runs`; topplistan svarar sedan med den nya rundan och nya totaler, tillståndet gäller bara det testet) och ett fel nuvarande lösenord (`POST /auth/change-password` ger 401 `current_password_incorrect`, stubben byter aldrig något lösenord). Stubbens svar har kuvertets form (`success`, `data` bredvid de gamla nycklarna, fel med `code`, ADR 007 Addendum 2026-10-20); den har en enda löpare och inga nyheter. Onboarding-slugarna som gör kontot "sett allt" kommer ur shared (`packages/shared/src/onboardingSlugs.ts`, samma källa som frontendens kö), så en ny sidotur eller announce-post väcker ingen popup. Att stubben vägrar icke-lokala adresser prövas i `scripts/e2e-guard.test.mjs` (`assertStubApiAllowed`). Specer som läser data med Node-`fetch` (`support/api.ts`: topplistan i `board.spec.ts`, `log-run.spec.ts`) eller kräver nyhetsflödet (`news.spec.ts`, `news-chips.mobile.spec.ts`) hoppar över sig själva med ett skäl när stuben är påslagen (`apiIsStubbed()`), och körs bara mot staging. Mot staging är variabeln aldrig satt; sätts den ändå fäller stuben körningen (adresserna är inte localhost), så inget prov hoppas över i det läget.

### Stilmallar och mått

Stilmallar blockerar ritningen men inte `DOMContentLoaded`, och Playwrights `toBeVisible()` väntar inte på dem. Laddaren i `index.html` finns alltså i DOM:en med en storlek innan stilen kommit, men den layouten målas aldrig: webbläsaren ritar inte förrän stilmallarna är laddade. Ett mått taget då mäter ett läge ingen ser (mot staging: laddarens x-läge som "hopp", 56, 91 och 616 px vid 320, 390 och 1440 px, och löparprickar som ligger i flödet i stället för på sina banor). Mäthjälparna (`measureLoader` i `support/loadingView.ts`, `measureRunnerDeviations` i `support/loaderGeometry.ts`) anropar därför `waitForStylesApplied` (`support/stylesApplied.ts`) först: varje `link[rel=stylesheet]` ska ha sin `sheet` och två bildrutor ska ha gått. Mät aldrig laddaren utan den, och mät aldrig på annat sätt än via hjälparna.

Försena stilmallarna lokalt för att få staging-nätets läge: `delayStylesheets(page)` (`support/loadingView.ts`, 800 ms på `**/assets/*.css`) används av geometriproven, och `E2E_STYLESHEET_DELAY_MS=800` fördröjer stilmallarna i hela sviten. Utan variabeln händer ingenting, och mot staging är den aldrig satt.

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
