# Changelog

## Buggfixar 2026-10-24 (buggrelease utan versionsnummer)

**Live 2026-10-24** via PR #57, main `9c346bc1` (rollbackreferens: 69506fed). Prod-katalogen lästes före deploy: 23 titlar, ingen med `lowestPaceStdDev`. Röken efter deploy grön (hälsa, säkerhetshuvuden, CSP med den nya popup-hashen och utan den gamla, 0 `console.` i popupen, 401 på skyddade rutter, `.map` 404). Tyst titelomräkning (`reprocess:titles`, 6 av 6 användare): inga innehavare bytta och 0 nyhetsrader; badgeomräkningens dry-run hade inget att skriva.

Buggrelease mellan versionerna, från `integration/bugfix-2026-10-24` (ägarbeslut 2026-10-24: buggar går direkt till Todo, prioriteras före stories och släpps separat från versionen som byggs, utan versionstagg). Ingen versionshöjning och ingen post i `changelog.json`; appen visar fortfarande v0.8.1.

### Titlar och badges
- The Double Trouble räknar bara dagar som uppfyller regeln: minst två rundor på minst 5 km var, med giltig starttid och minst 4 timmar mellan starterna. Det tidigare reservvärdet (summan av alla rundor en dag med två eller fler rundor) är borta, så en titel som byggde på det blir vakant eller byter innehavare vid nästa omräkning (RUN-382).
- Löpbandsrundor ger inga höjdmeter i The Mountain Goat, The Vertical Runner och badgen The Climber (ägarbeslut 2026-10-23). Regeln finns på ett ställe, `countedElevationGain` i shared; `is_treadmill: null` räknas som utomhus. Eventet Weekly elevation filtrerar som förut i databasen (RUN-381, se `docs/open-assumptions.md`).
- Den döda titelmotorn `lowestPaceStdDev`, som ingen titel i katalogen använde, är borttagen: 23 motorer (RUN-383).

### Gränssnitt
- Strava-popupen skriver inte längre ut OAuth-koden i webbläsarkonsolen; CSP-hashen för popupens skript är uppdaterad (RUN-367).
- Playbook: svaren i rutan "The basics" ryms i rutan på mobil och dator (RUN-374).
- Landningen: luft mellan funktionskorten och "Join the waitlist" på dator, samma avstånd som mellan övriga sektioner (RUN-375).
- Utmaningsarket: kortet "The bet" har samma padding och vänsterställda kolumner som övriga kort (RUN-376).

### Prod-steg
1. Före deploy: läs prod-katalogen `titles` (bara `metric_key`, med ägarens ja) och bekräfta att ingen titel använder `lowestPaceStdDev`. En okänd nyckel hoppas annars tyst över (`enhancedTitleService`, logger.warn).
2. Release-PR mot `main` (squash, inga admin-undantag) när alla required checks, Lighthouse och "Static serving (Caddy)" är gröna.
3. Efter deploy: rök enligt `docs/release.md` steg 4, plus CSP-hashen för `strava-popup.html` mot det som serveras och 0 `console.` i popupen. Titlarna räknas om enligt ägarens val (tyst med `emitNews: false`, eller vid nästa rundändring eller nattsynk).

### Rollback
Ingen migration, ingen miljövariabel och inget kontrakt ändras: redeploya 69506fed i Railway (frontend och backend), sedan en revert-PR på `main`. Titlar och badges räknas om till det gamla resultatet vid nästa omräkning.

## v0.8.1 — Städvarvet (2026-10-23)

Underhållsversion (patch), live 2026-10-23 via release-PR #54 från `release/v0.8.1`. Tyst: posten i `changelog.json` (Feature & Version) har ingen `announce`, alltså ingen popup och ingen Pack News-rad. Posten lades till i efterhand (#56): ägarbeslut 2026-10-23, varje användarversion får en post och patchar är tysta om ägaren inte säger annat; versionsvakten kräver det sedan dess. Flyttat till v0.8.2 (ägarbeslut 2026-10-22): uppföljningarna RUN-366–372, RUN-317 (rotationsövningen för tokennyckeln) och RUN-270 (Strava-rök del B). react-router v7 blir en egen story efter v0.8.1 (ägarbeslut 2026-10-20).

### Spelregler
- Duellen startar vid gruppens nästa midnatt efter accept, aldrig i samma ögonblick, och en duell på N dagar räknar exakt N dagar (slutdag = startdag + N − 1, avgörande 03:00 dagen efter). Legendariska autostarten följer samma regel. Regeln finns på ett ställe i `packages/shared` (`groupNextMidnight`, `challengeWindow`); pågående dueller behåller sitt slutdatum (RUN-228, ägarbeslut 2026-10-19).
- Boosten gäller exakt n kalenderdagar i gruppens tidszon från 00:00 dagen efter duellens sista dag. Fönstret sparas på raden (migration 059, `user_boosts.start_date`/`end_date`); gamla boostar behåller sina dagar och sin XP (backfyllet ger bitidentisk XP), och deras kort visar nu sina riktiga n + 1 dagar (RUN-355, ägarbeslut 2026-10-20).
- Dygnsgränser för dueller, boostfönster, events och "idag" räknas i gruppens tidszon via resolvern `groupTimeZone`, som ger Europe/Stockholm för alla grupper tills RUN-21 (RUN-355). Stravas rundag är undantagen.
- En tävling med läsfel avräknas i nästa timtick i stället för nästa måndag, ett läsfel ger aldrig en utbetalning på halva data, och tävlingspoängen räknas med en algoritm i shared (`scoreCompetition`, `prizeForRank`) med riktigt namn och `isMe` i tabellen (RUN-357).

### Städning och DRY
- Contract-migration 058 (RUN-309, ADR 012 S16): gruppens titelranking byggs om en gång per gruppomräkning (`processGroupTitles`) i stället för tre gånger per skriven rad; 058 släpper triggern, omslagsfunktionerna, shim-triggern och `titles.current_holder_id`/`current_value`.
- En källa för: spelregler och gränser (RUN-351), titelmåttens kodning (`titleMetrics`, RUN-356), rankning, nivåprogress och initialer (RUN-359), formatering i frontend med svenskt tusentalsmellanrum och decimalkorrekt km (RUN-360), gruppens id ur token (`utils/groupScope.ts`, ci-guards regel 22) och ur databasen (`readUserGroupId`, RUN-358), delade API-kontrakt för alla rutter (RUN-352, regel 18) och en API-klient i frontend (RUN-353).
- Död kod bort (RUN-350): oanvänd kod i backend och frontend, stubben `POST /api/auth/refresh`, tre engångsskript (bland dem `backfill:strava-athlete`), Tooltip och shadcn-alias utan användare, sharedpaketets bygg-skript. `reprocess:titles` ligger nu i `src/scripts`.
- Rester efter v0.7.1 och v0.8.0 (RUN-321, RUN-347, RUN-348, RUN-349, RUN-362, RUN-363): strömbrytare i nattavstämningen, timerstädning i `stravaFetch`, schemadiffens tillfälliga 056-regel borta, vakt mot Supabase i frontend (regel 17), e2e-stubben och mätverktygen, skrubbern begränsad i tid och storlek.
- Laddningsvyn: ingen tom bildruta vid inloggning, omdirigering och gamla `/challenges` (RUN-341), prickarna följer klockan genom överlämningen (RUN-340) och stagingbannern förrenderas så laddaren står stilla i staging (RUN-342).
- Dokumentationen ikapp v0.8.0 och v0.8.1, och dokumentens filhänvisningar vaktas (RUN-361, regel 21).

### Svarskuvertet, steg 1 (RUN-354, ADR 007 addendum 2026-10-20)
- Ett svarskuvert och ett felformat med maskinläsbar `code` (felkodskatalogen i shared, svarshjälparna `ok`/`fail`, regel 20), 404 och JSON-felhanterare sist i `createApp`. Steg 1 är dubbelsvar: de gamla nycklarna finns kvar, så frontend kan deployas före eller efter. Frontend läser data först och koden; fel nuvarande lösenord i Settings loggar inte längre ut. Steg 2 (gamla nycklarna bort) kommer i en senare version.

### Säkerhet
- Säkerhetshuvuden på alla svar från frontendens Caddy, även fel: HSTS ett år (utan `includeSubDomains`/`preload`), `Referrer-Policy`, `X-Frame-Options: DENY` och en skarp `Content-Security-Policy` efter ett Report-Only-steg på staging med 0 överträdelser (RUN-344). CSP-hasharna prövas mot bygget i CI (`scripts/csp-hashes.mjs`, steget "CSP guard" och "Static serving").
- Umamis tracker serveras som versionerad kopia från eget ursprung (`public/vendor/umami.v1.js`) i stället för från `cloud.umami.is` (RUN-344).
- Beroenden: node-cron 3.0.3 → 4.6.0, som tar bort den sårbara uuid 8, med appens logger (fast text och `errorCode`), TZ-varning vid start och pinnade scheman (RUN-346, regel 23); `@types/node-cron` borta. Två kända moderate-sårbarheter i react-router-dom 6 finns kvar och stoppas redan av `resolveNextPath`.
- Tokenkrypteringen klar (ADR 013, RUN-314–316): backfillens dry-run i prod visade 6 rader, alla krypterade på `prod-1`, 0 klartext och 0 fel (staging 0 rader), så `--apply` behövdes inte och ägaren avstod från `--refresh-tokens`. Migration 060 (CHECK, bara `enc:v1:`) är applicerad i staging och prod 2026-10-22. Läsvägen har ingen klartextgren längre: ett värde utan `enc:` är `token_unreadable`.
- Inloggningen gör lika mycket arbete för okänt och känt konto: jämförelse mot en dummy-hash som värms upp vid start, och båda uppslagen görs alltid (RUN-365, regel 19).

### Prestanda
- Landningens JS laddas efter första ritning och Barlow 400 förladdas: LCP på `/` 2,86 → 1,96 s i CI (RUN-343). Hydreringen kommer ca 0,6 s senare på långsam mobil, vilket ägaren godtog 2026-10-20.
- Lighthouse-budgeten är skärpt per sida efter CI-mätningen: `/` LCP ≤ 2 500 ms, FCP ≤ 1 950 ms, prestanda ≥ 0,90, CLS ≤ 0,02, TBT ≤ 150 ms; `/legal` LCP ≤ 3 600 ms (RUN-334). Jobbet är fortfarande icke-blockerande.

### /legal (RUN-345, `DATA_POLICY_VERSION` 2026-10-22)
- Integritetstexten anger berättigat intresse för statistiken (Umami) och felrapporterna (Sentry), rätten att invända (art. 21.1, per e-post), överföringsgrunden (Sentry: Data Privacy Framework med SCC som reserv enligt DPA 5.1.0; Umami: SCC) och att man kan be om en kopia av skyddsåtgärderna. Ägaren bekräftade 2026-10-22 att Sentrys DPA 5.1.0 är accepterad, att Umami-datan ligger i EU (Frankfurt) och att invändningar hanteras manuellt per e-post.

### Prod-steg
1. **KÖRT 2026-10-22.** Backfillens dry-run i prod (ägaren) och migration 060 i staging och prod (ägar-ja), `docs/release.md` avsnitt 5 punkt 6.
2. **KÖRT 2026-10-22 21:44.** Migration 059 i prod FÖRE deployen (ägar-ja): Q1 kolumnerna date och NULL-bara, Q2 8 rader, 0 utan fönster, 0 avvikande, Q3 RLS oförändrad, `get_advisors security` utan nya fynd. `docs/release.md` avsnitt 5 punkt 7.
3. **KÖRT 2026-10-23 10:25.** Release-PR #54 mot `main`, grön CI (alla fyra jobben, Lighthouse-budgeten hålls), squash-merge 12971285 (= deploy, båda tjänsterna SUCCESS 10:30). Rök enligt `docs/release.md` steg 4, med Sentrys host under skarp CSP och hälsoblocket (`plaintext_rows` och `unrecognised_rows` 0).
4. **KÖRT 2026-10-23.** Migration 058 i prod efter grön rök (ägar-ja, backup 05:30 samma dag): A1 8→0, A3 0/0, A4 och A5 identiska före och efter, B1–B4 OK. C1 efter nästa rundloggning.
5. **KÖRT 2026-10-23.** Tagg `v0.8.1` på 12971285, stagingtjänsterna pekade om till `integration/v0.8.2`, den här docs-PR:en. Ingen `announce:release`.

### Utfall (2026-10-23)
Röken efter deploy: startloggen (`prod-1`, Sentry på, schedulers startade, ingen KRITISKT, ingen TZ-varning), skarp CSP, HSTS, Referrer-Policy och X-Frame-Options på `/`, `/board` och 404, CSP-hasharna matchar inline-skripten i den riktiga prod-HTML:en (`/`, `/board`, `/legal`, `/strava-popup.html`), apex 308, `/health` OK, skyddade rutter 401, `/auth/refresh` 404, `.map` 404. Riktiga användare inloggade direkt efter deploy.

Under deployfönstret (frontend och backend byts var för sig) kan en NY Strava-koppling få 400 `consent_required`: samtyckesversionen går från `2026-10-19.1` till `2026-10-22` och callbacken kräver exakt likhet. Redan kopplade berörs inte. Koppla inte Strava förrän båda tjänsterna är deployade.

### Rollback
- Koden tillbaka till v0.8.0 (revert av merge-PR:en; `docs/release.md` avsnitt 9) fungerar mot 058, 059 och 060: v0.8.0 läser inte boostfönstrets kolumner (fallback på det gamla UTC-fönstret), anropar inget som 058 släpper och skriver bara `enc:v1:`-tokens.
- Migrationerna rullas inte tillbaka vid en kodrollback. Rollback-SQL finns i varje filhuvud och kräver ägar-ja.
- Nödutgången `--decrypt --apply` är spärrad av 060 tills constrainten släpps (`docs/release.md` avsnitt 5 punkt 6).
- Bryter skarp CSP något i prod (vit sida, blockerad popup, avatarer eller Sentry/Umami): byt rubriken tillbaka till `Content-Security-Policy-Report-Only` på en rad i `Caddyfile` (och `CSP_HEADER` i `scripts/verify-static-serving.sh`), push, deploy. Resten av releasen står kvar.
- Senaste friska deploy före v0.8.1: v0.8.0 på `main` @ 45184576 (båda tjänsterna; Railway Redeploy är snabbvägen, revert-PR:en den varaktiga).

## v0.8.0 — Titlar per grupp, förrenderad landning, Sentry och Umami (2026-10-19)

Användarversion (minor). What's new-posten i `changelog.json` har ingen `announce` (ägarbeslut 2026-10-19: ingen popup och ingen Pack News-rad). Releasedatumet sätts till deploydagen om den inte är 2026-10-19. Grundversionen för flera grupper: epic RUN-229 (ADR 012), tokenkrypteringens kod (epic RUN-96, ADR 013; utrullningen RUN-314–316 görs efter deploy), Sentry, Umami, staging med e2e och lasttest, förrendering av landningen (RUN-260, ADR 006 addendum 2026-10-19), säkerhetsfixar och felhygien. Migrationerna 052–057 är redan applicerade och verifierade i prod (Prod-steg 1). RUN-334 (skärpt Lighthouse-budget, S7) är flyttad till v0.8.1.

### Nytt — titlar och inställningar per grupp (RUN-229, ADR 012)
- Medlemskap med roll (RUN-294, migration 053): tabellen `group_members` (roll `admin` eller `member`, `starts_on`, ett aktivt medlemskap per användare och en admin per grupp) och funktionerna `join_group` och `create_group_with_admin` (bara `service_role`). `users.group_id` är nu en pekare som bara de två funktionerna skriver; ci-guards regel 14 fäller direkta skrivningar i backend. Backfill: en aktiv rad per användare (`starts_on` null = hela historiken), gruppens skapare som admin.
- Titelscope per grupp (RUN-295, migration 055): `user_titles` och `title_leaderboard` får `group_id` (unika nycklar per grupp, topp 10 per grupp), nya `update_group_title_leaderboard(s)`, omslagsfunktioner med oförändrade signaturer och en BEFORE INSERT-shim så att v0.7.x-koden fungerar mot den nya databasen. Vyn `title_leaderboard_view` får `group_id` och `security_invoker`. Före- och efterbevis i samma transaktion; exakt lika rader (samma titel, värde och `earned_at`) fick byta plats (ägarbeslut 2026-10-19; i prod gällde det The Hamster), innehavare och ordningen mellan olika värden är oförändrade.
- `group_settings` (RUN-296, migration 054): gles tabell per (grupp, nyckel) med `updated_by`, RLS utan policyer. `GET /api/groups/settings` (medlem läser) och `PUT /api/groups/settings` (admin-rollen skriver; gruppen läses färskt ur medlemskapet, aldrig ur JWT, URL eller body), serialiserade per grupp, med sömmen `onGroupSettingsChanged` för utskick till gruppen (RUN-304). Registret har inga gruppnycklar än; eventtypen `group_setting_changed` är reserverad och ett vakttest fäller bygget om en gruppnyckel registreras utan den. ci-guards regel 15 kräver att varje skrivning går via grinden `resolveActingGroupForWrite` (RUN-303, `utils/groupAccess.ts`, fail-closed, sömmen för supportrollen RUN-267).
- Delade kontrakt och regler (RUN-297): `contracts/titles.ts` och `contracts/groups.ts`, `titleWindow`/`runsInWindow` (rundor räknas inom medlemskapets fönster), `groupRoleCan` och `GROUP_ROLES`, titeldiff per grupp; ci-guards regel 13.
- Medlemskapslagret (RUN-298): `POST /groups/join` ger 409 vid aktivt medlemskap, `POST /auth/users` går via `join_group` (kontot tas bort igen om medlemskapet misslyckas), `GET /groups/my` får `my_role`.
- Omräkning per grupp (RUN-299): `processGroupTitles`/`processAllGroupsTitles` ersätter `processAllUsersTitles`; `calculateUserTotals` räknar bara om användarens grupp och grenen för användare utan grupp är borta; efter en lyckad join byggs gruppens ranking om utan titelnyheter. `reprocessTitles` skickar inga nyheter och ger exit-kod 1 vid fel.
- Läsvägarna (RUN-300, RUN-302): `GET /titles/leaderboard` ger katalogen ihop med gruppens rader, `GET /titles/user/:id` ger 404 utanför gruppen, admin `populate`/`refresh` bygger om bara adminens grupp, `group-eligibility` räknar på medlemskapets fönster, och titelomräkningsklockan läser gruppens senaste ombyggnad.
- Titelnyheter per grupp (RUN-301): före- och efterbilden (position 1 och 2) avgränsas till gruppen, så en ändring i en grupp aldrig ger en nyhet i en annan.
- `create:group` (RUN-305): skapar låtsasgruppen i staging för flergruppstestet. Dry-run som standard; mot prod vägras även dry-run utan `--allow-prod`, och `--apply` kräver dessutom bekräftelsesträngen (ägar-ja).
- Frontend (RUN-306): titeltyperna kommer ur `@runquest/shared`, och 404 från `titles/user/:id` blir Runner cards tomläge i stället för ett felkort. Ingen visuell ändring.
- Migration 056 (RUN-326): execute på `update_title_leaderboard`, `update_all_title_leaderboards`, `trigger_update_title_leaderboard` och `increment_event_xp` återkallas för `public`, `anon` och `authenticated`; bara `service_role` behåller det.
- Dokumentation (RUN-308): titles-README, arkitekturdiagrammet (`group_members`, `group_settings`), `docs/release.md` och `docs/staging.md` med ordning och bevis för 053–057, sju antaganden i `docs/open-assumptions.md`. Flergruppstestet i staging och prod-beviset är RUN-307 (prod-delen i Prod-steg 6).
- XP, nivå, Board och utmaningar är oförändrade och globala (säsongs-ADR/RUN-95).

### Nytt — låg tvåa i titelnyheter (RUN-256, ADR 011 beslut 7)
- `title_taken` med `reason` `overtaken` får det additiva fältet `runner_up_user_id` (tvåan i samma grupp och titel, om tvåan inte är den nya innehavaren). Dedupe-nyckel och `payload_version` är oförändrade.
- Nytt notisslag `title_taken_runner_up` (Titles, påslaget), med i Involves me (server och klient) och i radtexten som " — you were runner-up" för tvåan. Paritetstest mot frontendens fejkade news-server.

### Nytt — Strava-tokens krypteras i vila, koden (ADR 013, RUN-310–313)
- `utils/secretBox.ts` (RUN-310): AES-256-GCM, format `enc:v1:<kid>:<iv>:<ct>:<tag>`, AAD = tabell, kolumn och användare, nyckelparser för `TOKEN_ENCRYPTION_KEY` och `TOKEN_ENCRYPTION_KEYS_RETIRED`, felkoder i stället för text.
- `services/stravaTokenStore.ts` (RUN-311): enda läs- och skrivvägen för tokenkolumnerna; skriver alltid krypterat, läser klartext av en strikt form under övergången (dual-read), compare-and-swap på den lagrade strängen och förkontroll av nyckeln före varje Strava-anrop. En token som inte går att läsa ger `token_unreadable`, som aldrig tolkas som återkallad behörighet och aldrig raderar något. ci-guards regel 11.
- Konfiguration och larm (RUN-312): kontroll vid start (`🔐 Strava token encryption on: active key …` eller `🚨 KRITISKT` med `source:token_key`), nyckel-id-prefix per miljö (`prod-`, och `stg-` bara när `SENTRY_ENVIRONMENT=staging`), blocket `token_encryption` i `GET /api/strava/webhook/health`, ci-guards regel 12, `docs/runbook-token-key.md`. Utan giltig nyckel är Strava-synken avstängd och resten av appen går.
- `backfill:strava-token-encryption` (RUN-313): dry-run som standard, `--apply` (CAS och tillbakaläsning per rad), `--refresh-tokens` (med stoppregel) och nödutgången `--decrypt`. En förnyelse följer en rad som krypterats om under tiden i stället för att tappa Stravas nya tokens.

### Nytt — Sentry (RUN-282–285, RUN-287)
- Backend (RUN-282): `@sentry/node` 11.8.0, startas bara med `SENTRY_DSN`. Fel når Sentry via `logger.error` (en kopplingspunkt), `beforeSend` rensar tokens och personuppgifter, klientfel (401/403/404/429, ogiltig JWT) skickas inte, användaren identifieras bara med `user_id`, inga spårningsheaders lämnar processen, flush vid avslut.
- Kritiska larm (RUN-283): rader med `🚨 KRITISKT` blir `fatal` med taggarna `alert=critical` och `source`; högst en händelse per källa och fingeravtryck per 10 minuter, med en sammanfattning av de tillbakahållna. Inga Strava-id i Sentry-kopian.
- Frontend (RUN-284): `@sentry/react` som egen chunk som laddas först när det inloggade skalet monterar, bara med `VITE_SENTRY_DSN`. Förväntade fel (4xx, nätverksfel, omladdning efter deploy) rapporteras inte; id i adresser blir `:id`.
- Källkartor (RUN-285): båda byggena laddar upp sina kartor med `SENTRY_AUTH_TOKEN` (utan den hoppas uppladdningen över), releasen heter `runquest@<version>+<sha7>`. Frontendens kartor tas bort ur `dist/`, och Caddy svarar 404 på alla `*.map`.
- Prestanda (RUN-287): en transaktion per route i backend och Web Vitals efter inloggning i frontend, högst 10 % provtagning, inga id eller trace-headers. Trösklar och föreslagna alerts i `docs/performance.md`.
- RUN-281 (kontot, EU-regionen) är klart av ägaren, utom beslutet om Sentrys "Prevent Storing of IP Addresses" (integritetstexten säger att Sentry kan lagra IP-adressen enligt sina egna regler).

### Nytt — Umami (RUN-291–293)
- Sidvisningar (RUN-291): skriptet laddas från koden efter `load`, bara med `VITE_UMAMI_WEBSITE_ID` och aldrig i ett stagingbygge, låst till `www.runquest.dev` och `runquest.dev`. Cookiefritt, Do Not Track respekteras, adressen skickas som routemönster (`/runner/:id`), och bara vitlistade `utm_`-värden följer med på landningen.
- Egna händelser (RUN-292): en fast lista med åtta händelser i `packages/shared/src/analytics.ts` och en vakt som avvisar allt utanför den. `setting-changed` skickar bara nyckeln, aldrig värdet; `run-logged-manual` är medvetet utelämnad (ingen rundata).
- Integritetstexten (RUN-293): avsnitten `statistics` (Umami, EU/Frankfurt) och `errors` (Sentry), `DATA_POLICY_VERSION` och därmed `STRAVA_CONSENT_VERSION` = `2026-10-19.1` (Sentry är inställt på att inte spara IP-adresser; ägaren slog på det 2026-10-19). Releasegrinden `RUNQUEST_RELEASE_CHECK=1` fäller om en ägarplatshållare finns kvar.

### Nytt — förrenderad landning (RUN-260, ADR 006 addendum 2026-10-19)
- Två HTML-ingångar (RUN-331): `landing.html` med en lean ingång (`landing-main.tsx`, landningen eager, inloggningsdialogen och `/legal` lazy) och `index.html` för hela appen. `npm run build` kör `scripts/prerender-landing.mjs` efter `vite build`: landningen renderas till `landing.html` och laddningsvyn (`RoutePending`, appens enda laddningsvy) till `#root` i `index.html`. Bygget faller om en markör saknas eller en modul rör `window` vid import.
- Caddy (RUN-333): exakt `/` (med valfri fråga) ger `landing.html` med `no-cache`, `/landing` och `/landing.html` ger 307 till `/`, alla andra adresser (även `//`) ger `index.html` med laddningsvyn. Utan `landing.html` faller `/` tillbaka på `index.html`.
- Inloggning från landningen är en full sidladdning till appen, med laddningsvyn i stället för en blank sida (ägarbeslut A). En inloggad besökare på `/` skickas vidare av ett sessionstips i `<head>` innan något ritas (RUN-332).
- Landningen gör inga val på bredd i JS (RUN-329; båda varianterna i HTML, CSS väljer), och sifferraden flyttar inget när talen kommer och behåller sin höjd vid fel (RUN-330, ägarbeslut B).
- Sidvisningar i lean ingången (RUN-335) utan dubbelräkning vid överlämningen till appen. Väntelistformuläret är `inert` tills landningen hydrerats (RUN-336).
- Laddningsvyn står kvar vid första öppningen av Board tills topplistan och podiekortens titlar, rank-pilar och badges finns (RUN-337, ägarens fynd i previewn): ingen bildruta med tomt eller halvfyllt podium. Tak 8 s för hela kedjan, släpper vid första fel och när man lämnar Board; senare navigering visar ingen laddare. `users-with-runs` har `staleTime` 10 s (invalideringarna efter runda, utmaning och profilbild gäller som förut).
- Laddningsvyn är tre gånger så stor (RUN-338, ägarbeslut): ovalen ca 217×167 px i stället för 72×56, banlinjen växer med storleken (6 px vid 192 px); samma plats och storlek i `index.html`, överlämningen och Board-gaten (e2e-geometriprov på 320, 390 och 1440 px). Övriga laddare i appen är oförändrade.
- Laddarnas löparprickar ligger på banlinjerna (RUN-339): prickens mitt kompenserades dubbelt (marginal ovanpå `offset-path`), upp till 14 px fel vid 192 px och ca 4,7 px vid 64 px; nu högst 0,1 px i alla storlekar. Designfilen har samma fel (noterat i `docs/open-assumptions.md`). Nytt e2e-prov `loader-runners.spec.ts`.
- Mätt lokalt (Windows/Edge, `docs/performance.md`): `/` prestanda 0,81 → 0,91, LCP 4 347 → 3 011 ms, JS 237 → 141,6 kB, CSS 42 → 23,7 kB, totalt 428 → 319 kB. Målet 2 500 ms nås inte lokalt; CI-taket sätts i RUN-334 (v0.8.1). Baslinjen är RUN-328.

### Nytt — staging, e2e och lasttest (RUN-272–274, RUN-289, RUN-290)
- Stagingskript (RUN-272): `staging:migrate`, `staging:seed-reference`, `staging:seed-group` och `staging:schema-diff`; skriver bara till staging och läser prod bara med `--read-prod` via den skrivskyddade endpointen. `docs/staging.md`.
- Stagingskydd (RUN-273): `VITE_APP_ENV=staging` ger STAGING-remsan (egen chunk, finns inte i prodbygget), `noindex` i båda HTML-ingångarna och en `robots.txt` som blockerar allt.
- E2E-rök med Playwright (RUN-290): ny workspace `apps/e2e` och workflowen `e2e-staging.yml` (manuell och nattlig, mot staging, aldrig mot prod, blockerar inte PR:ar). Vakten `scripts/e2e-guard.mjs` vägrar allt utom staging och localhost. `docs/e2e.md`.
- Lasttest (RUN-289): `scripts/loadtest/` mot stagingbackenden med vakt mot prod, märkta rundor och städning. `docs/loadtest.md`. Inte kört: ägarbeslut 2026-10-19, körs när det finns två eller fler grupper.

### Nytt — Lighthouse i CI (RUN-259)
- Jobbet `Lighthouse — prestandabudget` mäter `/` och `/legal` (mobil, 3 körningar, median) mot det byggda `dist/` med Caddy på 127.0.0.1, med API:et både felande och falskt. Budgeten i `scripts/lighthouse/lighthouserc.json` är fäst i `scripts/lighthouse-ci.test.mjs`. Icke-blockerande första veckan (`LIGHTHOUSE_BLOCKING: 'false'`); omslaget står i `docs/release.md`.

### Nytt — avstämningen återhämtar omräkningen (RUN-322, migration 057)
- `recalculation_marks` med `mark_recalculation`/`clear_recalculation_mark` (bara `service_role`, version ur en sekvens). Avstämningen och Koppla bort markerar före en radering och rensar först när omräkning och totaler lyckats. Ett återhämtningsjobb kör vid start och 04:05 Europe/Stockholm (högst 20 per körning); ci-guards regel 16.

### Ändrat
- API: `GET /titles/leaderboard` och `GET /titles/user/:id` gruppfiltreras (se ovan); titelsvaren saknar `message`/`details` (RUN-324). `POST /groups/join` ger 409 vid aktivt medlemskap. `GET /groups/my` har `my_role`. Nya `GET`/`PUT /api/groups/settings`. `GET /api/strava/webhook/health` har blocket `token_encryption`. `POST /api/users/profile-picture` svarar 413 som JSON.
- Admin (RUN-263, RUN-264): `PUT /auth/users/:id/password` gäller bara användare i adminens grupp (404 för annan grupp, saknat id och id som inte är uuid), och en admin utan grupp får 403 på den och på `POST /auth/users`.
- `POST /api/challenges/send` (RUN-323): `opponent_id` som inte är uuid ger 400 före databasen.
- `calculateUserTotals` (RUN-327) skriver ingenting och svarar `false` när läsningen av `users` felar; webhook-workern behandlar det som en misslyckad omräkning och försöker igen.
- Pack News: `title_taken` kan bära `runner_up_user_id`; nytt notisslag (se låg tvåa).
- Nya schemalagda jobb: återhämtningen 04:05 Europe/Stockholm och vid start.
- Integritetstexten och samtyckesversionen är `2026-10-19.1`. Redan kopplade användare berörs inte; en ny koppling skickar den nya versionen.
- `engines.node` är `>=20.19.0`. Backendens bygge går via `apps/backend/build.mjs` (samma esbuild-inställningar, releasen inbakad).
- Nya miljövariabler: backend `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEYS_RETIRED` (valfri), `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` (valfri); frontend (bygget) `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_UMAMI_WEBSITE_ID` (bara prod), `VITE_APP_ENV` (bara staging, står därför inte i `.env.example`); båda byggena `SENTRY_AUTH_TOKEN`. Se `.env.example`.

### Borttaget
- `GET /api/strava/debug-activities` och `POST /api/titles/refresh/:titleId` (RUN-278): oanvända, och de gick att anropa med bara inloggning. Båda svarar 404.
- Grenen i `calculateUserTotals` som räknade titlar för en användare utan grupp (ingen spelar utan grupp, ADR 012).

### Säkerhet
- Migration 052 (RUN-226): Supabases säkerhetsråd: fast `search_path` på `increment_event_xp`, det döda pg_cron-jobbet mot Edge Function `strava-sync` avregistrerat, `pg_net` borttagen där det gick och `security_invoker` på `title_leaderboard_view`.
- Migration 051 (RUN-276, i prod sedan 2026-10-17): alla policyer på `storage.objects` borta (backend skriver med service role) och gränser på `profile-pictures` (5 MB; jpeg, png, webp, gif).
- RUN-277: dubblettkontrollen i `POST /auth/users` bygger inget filter av body-strängar (två parametriserade `.eq`); namn, e-post och lösenord typkontrolleras.
- RUN-323: dubbelutmaningskontrollen bygger `.or()` av databasens id, och självutmaning med versaler stoppas.
- RUN-263, RUN-264, RUN-278 och 056 ovan.
- RUN-279: ägarens bekräftelser av reglerna i `docs/permissions.md` (tokennyckeln, grupperna, rollmodellen, `create:group`, 051).

### Kodhälsa
- Felhygien (RUN-324, RUN-325): hela backend loggar `errorCode(error)` i stället för felobjekt och `error.message`; kastade fel bär databasens kod men aldrig dess text (`errorWithCode`); ett fel loggas en gång, på fångstället (`GET /titles` gav tre Sentry-händelser, nu en). `errorCode` ger orsakens kod vid nätverksfel (supabase-js ger `code: ''`). Vakten `logHygiene.test.ts` läser källan som syntaxträd. Id ur URL och body kontrolleras med `isUuid`. Ogiltig JWT loggas som `warn`.
- Nya runbooks: `docs/runbook-backup.md` (RUN-286, med skrivskyddad jämförelse-SQL och CI-vakt; återställningsövningen gjord 2026-10-19: lyckades, ca 5 minuter till ett nytt projekt, dagliga backuper 03:30 UTC i 8 dagar, PITR av), `docs/runbook-token-key.md`, `docs/performance.md`, `docs/e2e.md`, `docs/loadtest.md`, `docs/staging.md`.
- ADR 012 och 013 (godkända 2026-10-17) med noter, ADR 006 addendum 2026-10-19, ADR 010 addendum om Sentry och källkartor, `docs/permissions.md`.
- ci-guards regel 11–16 och CI-steg för Sentry-bygget, backup-SQL:en, lasttestet, Lighthouse-verktyget och e2e-vakten.

### Prod-steg
Ett ägar-ja per migration, per skrivande skript och per Railway-variabel (`docs/permissions.md`). Hemliga värden klistras aldrig i chatten. Läge före start: v0.7.1 i prod, 1 grupp (Wolfpack), 6 användare.
1. **KÖRT FÖRE DEPLOY 2026-10-19.** Migrationerna 052, 053, 054, 055, 056 och 057 är applicerade och verifierade i prod (bevisfrågorna i filhuvudena, `list_migrations`, `get_advisors`), efter staging. 055 med ägarbeslutet att exakt lika rader får byta plats (The Hamster). Alla är bakåtkompatibla med v0.7.1-koden (055:s avsnitt BAKÅTKOMPATIBILITET; 053:s pekare och 057 som gammal kod inte känner till). 051 är i prod sedan 2026-10-17.
2. **KÖRT FÖRE DEPLOY 2026-10-19.** Ägaren har satt `TOKEN_ENCRYPTION_KEY` (nyckel-id `prod-1`), Sentry-DSN och Sentry-miljövariablerna samt `SENTRY_AUTH_TOKEN` i Railway prod. v0.7.1 ignorerar dem.
3. **KÖRT FÖRE MERGE 2026-10-19 (ägar-ja).** `VITE_UMAMI_WEBSITE_ID` = `f69b618e-a134-4cd9-af69-d4479c418de8` (inte hemligt) som byggvariabel på `runquest-frontend` i prod. v0.7.1 ignorerar den; v0.8.0-bygget bakar in den.
4. PR release/v0.8.0 → main, grön CI (Backend, Shared och Frontend; titta på Lighthouse-sammanfattningen), merge (= deploy). Vänta tills båda tjänsterna är klara. Därefter rök:
   - backend `GET /health` 200, och startloggen visar `🔐 Strava token encryption on: active key prod-1, 0 retired key(s)` och `🛰️ Sentry on (environment: production)`, inget `🚨 KRITISKT` med `token_key`;
   - `/` ger den förrenderade landningen (`landing-title` i HTML:en) med `Cache-Control: no-cache`; `//` och `/board` ger laddningsvyn (`rq-shell__pending`); `/landing` ger 307 till `/`; `/legal` laddar;
   - Umami-scriptet (`cloud.umami.is/script.js`) laddas på www, utan cookies och lagring (kontrollen i `docs/release.md`, "Webbanalys");
   - `GET /api/groups/settings` ger 401 utan token och gruppens värden inloggad;
   - titlar per grupp: `/titles` och Runner card visar samma innehavare som före deployen;
   - inloggad: Board visas först när podiet är helt ifyllt (laddaren står kvar till dess, RUN-337);
   - Sentry i frontend: frontendens JS-chunkar innehåller `ingest.de.sentry.io` (byggvariablerna `VITE_SENTRY_DSN` och `VITE_SENTRY_ENVIRONMENT` är satta på `runquest-frontend`; saknas de är frontend-Sentry tyst av). Källkartsprovet `sentry:test:built` (`docs/release.md`, "Källkartor till Sentry") görs mot det bygge som laddade upp kartorna, inte mot en lokal `dist`;
   - Sentry-alertregeln för kritiska larm skapas i projektet `runquest-backend` enligt `docs/release.md` ("Sentry-alertregeln för kritiska larm": `alert:critical`, mejl till ägaren, varje händelse) och provas en gång, så att ett `🚨 KRITISKT` med `source:token_key` når ägaren.
5. Kör workflowen `e2e-staging.yml` (manuellt). Den finns på `main` först nu och kunde därför inte köras före releasen.
6. Prod-delen av RUN-307: konsistenskontrollen från 053 (inga avvikelser mellan `users.group_id` och aktivt medlemskap) och release-röken enligt `docs/release.md` avsnitt 5. Ingen testgrupp i prod.
7. Ingen `announce:release` (ägarbeslut 2026-10-19: ingen popup).
8. Tagg `v0.8.0` på merge-commiten.
9. Peka om stagingtjänsterna till `integration/v0.8.1`.
10. Docs-PR "live" (`docs/release.md` steg 8): STATE och CHANGELOG med deploydatum och utfall per steg.

**Utfall 2026-10-19 (v0.8.0 live, PR #50 = e3dbc015, tagg `v0.8.0`):**
- Steg 4: CI grön (Backend, Shared, Frontend och Lighthouse), squash-merge 16:36 UTC; båda tjänsterna SUCCESS på e3dbc015 16:44 UTC. Rollback-deployer antecknade (v0.7.1: frontend `08f59258`, backend `90715e0a`). Rök godkänd: startloggen `🔐 Strava token encryption on: active key prod-1, 0 retired key(s)` och `🛰️ Sentry on (environment: production)`, inget `🚨 KRITISKT`; `/health` 200; `/` förrenderad med `no-cache`; `//` och `/board` laddningsvyn; `/landing` 307 till `/`; `/legal` 200; `.map` 404; `/api/groups/settings` 401 utan token; `/api/strava/debug-activities` 404; Umami-id i bygget; Sentry-DSN i den lazy chunken efter inloggning. Titelinnehavarna oförändrade (22 innehavare, samma kontrollsumma före och efter), webhookkön tom. Ej gjort av Lead: inloggade kontroller (gruppinställningar, Board-laddaren i prod), Umamis cookiekontroll i webbläsaren och `sentry:test:built`; Sentry-alertregeln väntar på ägarens ja.
- Steg 5: e2e-staging körd (run 39288386517): 32 gröna, 5 överhoppade, 4 röda. De röda var laddarens geometri- och prickprov, som mätte laddaren i `index.html` innan stilmallen hade tillämpats (stilmallar blockerar inte `DOMContentLoaded`; det läget målas aldrig). Rättat i den här PR:en (`waitForStylesApplied`, `delayStylesheets` och ett prov på målade bildrutor); körs om efter merge.
- Steg 6: konsistenskontrollen från 053 i prod före och efter merge: 0 användare utan medlemskap, 0 medlemskap utan pekare, 6 aktiva medlemskap. Ingen testgrupp i prod.
- Steg 7: ingen announce (ägarbeslut).
- Steg 8: tagg `v0.8.0` på e3dbc015.
- Steg 9: `integration/v0.8.1` skapad från e3dbc015; stagingtjänsterna deployar den.
- Steg 10: den här PR:en.

Senare, enligt ägarens beslut (inte en del av deployen):
- Tokenutrullningen RUN-314–316: några dygn utan `token_unreadable`, därefter `backfill:strava-token-encryption` dry-run → ägar-ja → `--apply`, verifiering (`plaintext_rows: 0`), CHECK-migrationen och borttagen klartextläsning (ADR 013 beslut 13, `docs/runbook-token-key.md`).
- Umami-trattarna (ägaren i Umami-panelen, `docs/release.md`).
- RUN-270 (Strava-rök del B mot riktig Strava).
- Valfri Postgres-uppgradering.

### Rollback
- Kod: redeploya v0.7.1 i Railway (frontend och backend) och revert-PR. v0.7.1 fungerar mot den nya databasen (055:s shim och omslagsfunktioner, 053:s pekare `users.group_id`). Caddyfilen följer frontendens deploy, så `/` går tillbaka till `index.html`.
- **Tokens:** från deployen skriver backend varje ny eller förnyad Strava-token krypterat (`stravaTokenStore` har ingen väg som skriver klartext), även innan backfillen körts. v0.7.1 kan inte läsa `enc:v1:`-värden. Har en token förnyats eller en koppling gjorts efter deployen ska `backfill:strava-token-encryption -- --decrypt` köras (dry-run, sedan `--apply --confirm-write-plaintext` med ägar-ja) FÖRE kodrollbacken (ADR 013 beslut 13.5, `docs/runbook-token-key.md` avsnitt 5a, punkt 5); annars får de användarna koppla Strava igen. Kör `--decrypt` som dry-run igen direkt efter kodrollbacken (förväntat 0 rader): en förnyelse mellan körningen och rollbacken skriver `enc:v1:` på nytt. Läget syns i `token_encryption`-blocket i webhook-health.
- Skapar en admin ett konto under rollbacken skriver v0.7.1 `users.group_id` utan medlemskap: kör om 053 (idempotent) före v0.8.0 deployas igen.
- Migrationerna rullas normalt inte tillbaka; rollback-SQL står i varje filhuvud och kräver ägarens ja. 057:s rollback kräver att koden är tillbakarullad först.
- Railway-variablerna (`TOKEN_ENCRYPTION_KEY`, Sentry, `VITE_UMAMI_WEBSITE_ID`) ignoreras av v0.7.1 och kan stå kvar.

## v0.7.1 — Nattlig avstämning mot Strava (2026-10-17)

Användarversion (patch, What's new-posten i `changelog.json` har ingen `announce`: ingen popup och ingen Pack News-rad). Epic RUN-93 (Strava-webhooks, ADR 010 D12). Releasedatumet sätts till deploydagen om den inte är 2026-10-17. Ingen migration, inga nya miljövariabler.

### Nytt — nattlig avstämning mot Strava (RUN-177, ADR 010 beslut 13, D12)
- Schemat: `scheduler/stravaReconcileScheduler.ts` startar avstämningen 04:15 Europe/Stockholm varje natt (fritt mellan streak-jobbet 03:00, nattjobbet 03:30 och väderbackfillen på :00/:30). Bara i produktion; en natt som ännu pågår hoppas över med en varning.
- Vad som jämförs (`services/stravaReconcile.ts`, `services/stravaReconcile/*`): för varje kopplad användare Stravas aktivitetslista för de senaste 30 dagarna mot användarens lagrade Strava-rundor, plus 20 äldre rundor per användare och natt i rotation (en användare med 300 gamla rundor får alla kontrollerade inom 15 nätter). Manuella rundor ses aldrig.
- Budget: 400 Strava-anrop per natt (13 % av dygnsgränsen på 3 000 läsningar), delade rättvist över användarna; rotationen krymper först, och listan och bekräftelsen av det som är i tvivel går före. Avstämningen stannar i förväg om Stravas egen läsbudget passerat mjukgränsen eller svarar 429, och resten väntar till nästa natt.
- Radering sker bara efter verifiering: varje runda i tvivel går genom webhook-workerns egen aktivitetshanterare (`GET /activities/:id` och samma beslutstabell, ADR 010 7.1). Rundan raderas bara vid 404, eller om aktiviteten blivit privat, bytt typ (inte längre löpning) eller fått distans 0. Allt annat (5xx, 403, 429, nätverksfel, trasig kropp) lämnar rundan orörd och loggas med felkod. Högst 10 raderingar per användare och natt; resten får vänta, och det loggas. En lista som misslyckas eller kan vara avkortad lämnar användaren ifred den natten.
- Ändrad distans eller ändrat startdatum på Strava uppdateras (Strava skickar ingen händelse för det, se v0.7.0-fyndet). Därefter ett enda `reprocessRunsFromDate` och ett `calculateUserTotals` per användare (XP, streaks, titlar, badges och Pack News räknas om).
- Pausade användare (ADR 010 7.5.3): bara raderingsdelen. Ingen uppdatering av distans eller datum och ingen import.
- Samma användarlås som pollingen, webhook-batchen och Disconnect, så att en poll aldrig kan återskapa en runda som just raderats.
- CI-vakt regel 10 i `scripts/ci-guards.mjs` håller avstämningen startad och kopplad.
- Loggrad per natt: `🧹 Strava reconcile: N user(s) (… paused, … left alone), … run(s) checked, … removed, … updated, … failed, … of 400 requests`.
- What's new (`changelog.json`): en patch-post utan `announce` om att raderade och ändrade rundor nu fångas även när Strava inte säger till, och om stabilare Strava-anslutning. Inga löften om omedelbar uppdatering.

### Nytt — stabilare Strava-anslutning (RUN-318)
- `stravaFetch` har timeout: 30 sekunder för API-anrop och 10 sekunder för `/oauth/` (kodbyte, förnyelse, deauthorize). Timeouten gäller även läsningen av svarskroppen. Ett timeout ger `StravaTimeoutError`, ett vanligt nätverksfel som inte säger något om behörigheten (en token markeras alltså aldrig som avvisad av ett timeout), i stället för ett anrop som hänger kvar under användarlåset.
- Token-förnyelsen delas: en pågående förnyelse per användare och refresh-token återanvänds av alla som ber om en token samtidigt (webhook-worker, reservpolling, avstämning), så Stravas roterande refresh-token aldrig förbrukas två gånger.

### Borttaget (RUN-319)
- `GET /api/strava/last-sync` och `services/stravaLastWebhook.ts` är borta (endpointen blev oanvänd när "Next sync" och "Latest sync" togs bort i v0.7.0). Settings och Log läser `last_import_at` i `GET /api/strava/status`. Ingen frontend anropar längre endpointen. Rate budget loggar bara felkod.

### Kodhälsa
- RUN-320: paritetstest mellan backendens `GET /api/news` och frontendens fejkade news-server. Tak och sidstorlekar bor i `packages/shared/src/contracts/news.ts` (`UNREAD_CAP` 500, `NEWS_DEFAULT_LIMIT` 30, `NEWS_MAX_LIMIT` 100, `NEWS_ITEM_FIELDS`, `NEWS_META_FIELDS`).
- Staging finns (Railway-miljön `staging` med egna tjänster, eget Supabase-projekt i gratisorganisationen; MCP-servern `supabase-staging` i `.mcp.json`). Strava körs inte i staging (Stravas prenumerationskrav), så ingen användare har en koppling där för avstämningen att gå igenom, och all Strava-verifiering sker med fejkad Strava i tester. Se `docs/release.md`.
- ADR 010 har fått addendum 2026-10-17.

### Ändrat
- API: `GET /api/strava/last-sync` är borttagen. Den hade inget användarflöde kvar; `GET /api/strava/status` bär `last_import_at`.
- Ny scheduler 04:15 Europe/Stockholm (se ovan). Ingen ny miljövariabel.

### Prod-steg
Inga migrationer och inga nya miljövariabler. Ägar-ja för PR release/v0.7.1 → main (= deploy).
1. PR release/v0.7.1 → main, grön CI (inkl. `ci-guards`-regel 10), merge (= deploy). Ingen migration att köra före eller efter.
2. Röktest: backend startade (`/health` 200); i loggen står `🕐 Starting the nightly Strava reconcile (04:15 Europe/Stockholm)...`; `GET /api/strava/last-sync` ger 404 (401 utan token); Settings och Log visar "Last import".
3. Efter första natten (04:15 Stockholm): följ loggraden `🧹 Strava reconcile: ...`. Förväntat: alla kopplade användare räknade, `failed` 0, `requests` under 400, och `removed`/`updated` bara om något faktiskt skilde sig. Inga `❌ Strava reconcile`-rader. En `removed` högre än väntat på första natten är skäl att läsa loggen innan nästa körning (taket är 10 per användare).
4. Tagg `v0.7.1` på merge-commiten.

### Rollback
- Kod: redeploya v0.7.0 i Railway och revert-PR. Inga dataformat ändrade. Avstämningen är bara kod: utan den återgår synken till att raderingar fångas av webhooks (ADR 010 D12 då åter öppen) och ändrad distans eller datum fångas inte.

## v0.7.0 — Notiser du styr, Ranks, Involves me och Strava-webhooks (2026-10-15)

Användarversion (What's new + Pack News-rad via announce:release). v0.7.0 gick i prod 2026-10-15 (PR #45, tagg `v0.7.0`) utan popup: posten i `changelog.json` hade ingen `announce` och Features-kortet Strava hade den gamla texten tills webhooks var verifierade. RUN-265:s PR (Prod-steg 10) slår på popupen, den nya Strava-texten och reservpollingen på 12 timmar, efter godkänd rök. Epic RUN-9 (notiser, ADR 011) och RUN-93 (Strava-webhooks, ADR 010). Prod-stegen 1–9 är KÖRDA 2026-10-15 (utfall per steg nedan).

### Nytt — notiser (ADR 011)
- Inställningar per användare (RUN-184, RUN-186, RUN-187, RUN-244): ett typat register i `packages/shared` (`NOTIFICATION_KINDS`, 19 notisslag i sex sektioner: Titles, Challenges, Ranks, Events, The pack, System) och en gles tabell `user_settings` (migration 048; saknad nyckel = slagets standard). `GET /api/settings` och `PUT /api/settings` (skriver bara anroparens egna rader, högst 40 nycklar per anrop, `null` återställer). Enda slaget som startar avstängt: Rank changes between others.
- Panelen (RUN-194, RUN-249): kortet "Notifications" på Settings (undertexten är nu "Strava, notifications and password") och samma komponent på /news (sidokolumn på desktop, bottenblad på mobil). Reglaget är grönt när det är på (färgundantag, ägarbeslut 2026-10-14).
- Klockan följer inställningarna (RUN-250): popovern visar de fem senaste raderna vars slag är påslaget, utan egna handlingar; är allt bortfiltrerat visas "Nothing new for you" och länken till /news. /news visar fortfarande allt, och bara de rader klockan räknar lyser som olästa.
- Läst per rad (RUN-185, RUN-189, RUN-190, RUN-197, RUN-245): golvet `users.news_last_seen_id` består, och rader ovanför golvet kvitteras en och en i `news_read` (migration 049) via `POST /api/news/read` (1–50 id per anrop). Gesterna: mus över raden efter verklig rörelse, tryck, eller Enter/Space; fokus ensam markerar inget. "Mark all read" finns kvar, höjer golvet och rensar `news_read` under det. Räknaren annonseras artigt (polite live-region). Oläst avgörs av den delade `isNotifiable`; `unread_count` mättas vid 500.
- Involves me (RUN-188, RUN-196): `GET /api/news?involves=me` och en knapp på /news (`?involves=me`): rader där jag är aktör eller mål, samt events jag deltog i.
- Ranks (RUN-191, RUN-192, RUN-195, RUN-246, RUN-248): nya händelsetyper `rank_passed` (mått `xp` och `challenge_points`; högst en rad per par, mått och Stockholm-dygn, bara om passeraren låg bakom vid dygnsskiftet) och `challenge_accepted`, additivt fält `entrant_ids` i `event_closed` (RUN-247) och chipet Ranks i filtret (blå kategori, ägarundantag från designregel 10, sky blue `#38bdf8`/`#7dd3fc` godkänd 2026-10-15). Passeringar sker som observatör efter totalskrivningen (`calculateUserTotals`, event-XP, `settleChallenge`); massomräkningar anropar med `emitRankNews: false`. Migration 050 släpper in de två nya typerna i CHECK:en.
- Touren `tour_news_v2` (RUN-251): fem steg om flödet och läs-gesten, filtret, notisinställningarna, Mark all read och ett avslut. Alla ser den en gång till (ny slug).
- Release-texten (RUN-254, RUN-262) pekar på Settings → Notifications för den som inte besöker /news och beskriver läs-gesten, Involves me och Ranks. Den ligger i `changelog.json` men annonseras inte förrän RUN-265 sätter `announce: true`. Notifications flyttar från Working on till Features, och Working on får ägarens två kort: Seasons and trophies och Group settings.

### Nytt — Strava-webhooks (ADR 010)
- Webhook-rutten (RUN-168, RUN-169, RUN-170, RUN-171, RUN-173, RUN-174): `GET /api/strava/webhook` (prenumerationens verifiering med `hub.verify_token`; 403 vid fel, 503 om `STRAVA_WEBHOOK_VERIFY_TOKEN` saknas) och `POST /api/strava/webhook` (publik, utan JWT; kontrollerar `subscription_id`, formen, ägaren och ett tak per ägare, sparar bara vitlistade `updates` och svarar 200 innan något bearbetas; ingen IP-gräns, Lead-beslut 2026-10-14). En händelse är bara en signal: workern hämtar alltid aktiviteten från Strava med användarens egen token. Handlers för `activity` create, update och delete samt `athlete` deauthorize; ett test (`webhookHandlersRegistered`) kräver att varje händelsetyp har en handler.
- Kön och workern (migration 046): tabellen `strava_webhook_events` och RPC:n `claim_strava_webhook_events` (bara `service_role`); claim med lease, batch per ägare, omförsök efter 1, 5, 15 och 60 minuter och sedan varje timme; en händelse som inte avslutats efter 48 timmar blir `dead` och larmar (`🚨 KRITISKT: Strava-webhook`). Städning 03:30 Europe/Stockholm: `done`-rader efter 30 dygn, `dead`-rader efter 90.
- Raderingar slår igenom (RUN-173, RUN-175, RUN-172): en aktivitet som raderas, görs privat eller slutar vara löpning på Strava tas bort här inom 48 timmar, och XP, streaks, titlar, badges och Pack News räknas om via `calculateUserTotals` (`emitRankNews: false`). Event-XP som redan är intjänad behålls: `event_entries.run_id` blir `NULL` när rundan raderas (migration 047).
- Identitet och samtycke (RUN-164, RUN-165, RUN-179, RUN-180): `strava_tokens` får `strava_athlete_id` (kopplar händelsernas `owner_id` till användaren; ett Strava-konto kan bara höra till en RunQuest-användare), `consent_version`, `consented_at`, `sync_paused` och `paused_at` (migration 045). De sex befintliga kopplingarna får sitt athlete-id med `npm run backfill:strava-athlete` (dry-run som standard, `--apply` skriver). Före "Connect Strava" visar kortet fyra punkter ur integritetstexten och en ruta som måste kryssas; Connect är låst tills den är ikryssad.
- Pausa eller koppla bort (RUN-237, RUN-238, RUN-241): "Pause or disconnect" på Strava-kortet öppnar ett val, "Pause sync" eller "Disconnect…", och Disconnect har en separat bekräftelse som säger hur många rundor som raderas och att det inte går att ångra. En pausad koppling har "Turn sync back on" och "Disconnect"; när synken slås på igen hämtas luckan i bakgrunden. Reconnect anropar inte längre disconnect (RUN-236).
- Integritetstexten och samtyckesversionen (RUN-261): `DATA_POLICY_VERSION` (och därmed `STRAVA_CONSENT_VERSION`) är `2026-10-14.1` och beskriver webhooks, "at least every 12 hours" som reservkontroll, borttagning inom 48 timmar, Disconnect och Pause sync.
- Dygnskontroll av prenumerationen (RUN-240): nattjobbet 03:30 gör ett anrop till Stravas `push_subscriptions` och larmar (samma `🚨 KRITISKT`-prefix) om prenumerationen saknas eller har ett annat id eller en annan callback än `STRAVA_WEBHOOK_SUBSCRIPTION_ID`.
- Hälsa (RUN-239, RUN-266): `GET /api/strava/webhook/health` (admin; `requireAdmin`, flyttas till supportrollen när RUN-267 landar) ger köns räknare och tidsstämplar; `GET /api/strava/last-sync` får `last_webhook_at`. Pollingen hoppar över aktiviteter vars detaljanrop ger 404.
- Skript: `npm run strava:webhook --workspace=@runquest/backend -- [view|create|delete] [--apply]` (prenumerationen; `create` och `delete` är dry-run utan `--apply`) och `backfill:strava-athlete`.
- Pollingen 30 min → 12 h (RUN-182, S29) var ett EGET release-steg direkt efter godkänd rök i prod (ägarbeslut 2026-10-14: ingen sjudygnsvänta) och slås på i samma deploy som annonseringen (RUN-265, se nästa avsnitt). v0.7.0 gick i prod med pollingen på 30 minuter; integritetstexten säger "minst var 12:e timme", vilket stämde både före och efter omkopplingen.
- Fynd i röken 2026-10-15: Strava skickar ingen händelse när bara distans eller datum på en aktivitet ändras, bara vid titel, typ och synlighet (och skapande och radering). Texterna lovar därför inte att en ändrad distans eller ett ändrat datum följer med; meningen "Edits to a run's date or distance are picked up the same way…" är struken ur de sparade texterna.

### Nytt — reservpolling, Last import och städning av Strava-visningen (RUN-265, i RUN-265:s PR)
- Pollingen går var 12:e timme som reserv (`STRAVA_POLL_INTERVAL_HOURS = 12` i `packages/shared`, cron `0 */12 * * *` i Europe/Stockholm, alltså 00:00 och 12:00; bara 3, 4, 6, 8, 12 och 24 timmar godtas). Missar node-cron en sekund (cirka 0,8 % uppmätt) kör 30-minuterstickens catch-up pollen när sloten är mer än 10 minuter försenad; en omstart estimerar nästa slot och triggar ingen catch-up (webhooks bär en slot som missas under deploy). Pollen och catch-upen delar en vakt, så pollen körs aldrig dubbelt; en överhoppad körning loggas som varning.
- Väderbackfillen och titelomräkningen efter väder körs på ett eget schema var 30:e minut, oberoende av pollen (annars hade rundor från webhooks saknat väder i upp till 12 timmar). Open-Meteo-anrop avbryts efter 15 sekunder.
- Texterna säger att rundor kommer när de sparas på Strava, med en reservkontroll var 12:e timme: Playbook (kapitlet Run och tabellraden "Strava import"), Settings och landningens Strava-kort. Intervallet läses ur en delad konstant (`stravaPollIntervalLabel()`).
- "Next sync" tas bort (ägarbeslut 2026-10-15): reservkontrollens tid säger inget om när rundor kommer. Borta är cellen på Strava-kortet i Settings (och "Overdue"), "next in …" på Log-skärmens Strava-rad, och Right now-pillen för kopplade användare (Connect-pillen för icke-kopplade finns kvar). Sidokortet "Latest sync" i Settings är också borta, och frontend hämtar inte längre `GET /api/strava/last-sync` (endpointen finns kvar i backend för catch-up och admin).
- "Last import" ersätter "Last sync" (ägarbeslut 2026-10-15): Settings och Log visar när användarens senaste Strava-runda kom in ("3 h ago", annars "No runs imported yet" respektive den neutrala raden), oavsett om den kom via webhook eller polling. `GET /api/strava/status` får `last_import_at` (största `runs.created_at` för användarens Strava-rundor; ett läsfel ger `null` och en varning, aldrig ett fel). Det gamla globala fältet `last_sync` är borta ur svaret.
- Turens "Connect Strava"-steg tas bort för användare som redan kopplat Strava (turen väntar högst 3 sekunder på statusen och startar annars med alla steg). Tour-copyn för ej kopplade är oförändrad. Rundans raderingsknapp säger nu "Strava runs come back from Strava — delete it in Strava instead".

### Ändrat
- `GET /api/news`: `is_unread` och `meta.unread_count` följer golvet, `news_read` och påslagna slag i stället för de två count-frågorna (kontraktstexten i `contracts/news.ts` uppdaterad). `POST /api/news/seen` rensar också `news_read` under det nya golvet.
- Utmaningstabellen (`GET /api/challenges/group-stats` och Duels-tabellen, RUN-246, RUN-248, RUN-269) sorterar med en delad komparator (poäng, vinster, namn, id), så lika poäng får en bestämd ordning och Rank-detektionen aldrig kan skilja sig från tabellen.
- `POST /api/strava/callback` (ändrad): kräver `consent_version` lika med den aktuella (annars 400 `Consent required`, innan koden byts mot token), byter och sparar under användarlåset, skriver Stravas athlete-id, samtyckesversion och samtyckestid, sätter `sync_paused = false`, och svarar 409 om Strava-kontot redan är kopplat till en annan RunQuest-användare.
- `DELETE /api/strava/disconnect` (ändrad, RUN-237): försöker återkalla åtkomsten hos Strava (misslyckas det fortsätter bortkopplingen), raderar de importerade Stravarundorna och sist token-raden i ett användarlås och räknar om XP, streaks, titlar och badges; begränsad av en rate limit. Manuellt loggade rundor och intjänad event-XP rörs inte.
- `PUT /api/strava/sync-paused` (ny, RUN-238): `{ "paused": boolean }`, bara anroparens egen rad; `POST /api/strava/sync` svarar 409 för en pausad användare, och pollingen hoppar över pausade. Raderingsreglerna gäller även en pausad användare.
- Strava-klienten bröts ut ur `routes/strava.ts` (RUN-167); en avvisad refresh-token skiljs från ett nätverksfel och loggar bara felkod (RUN-268); en per-användar-mutex håller synk, webhook-batch, callback och disconnect isär (RUN-233).

### Kodhälsa
- Designundantagen (grönt reglage, Ranks-blå, turens guldknappar, popoverns tomtläge) är dokumenterade i `docs/design/designsprak-forslag.md` och i temafilens kommentarer; ADR 008 och 011 har fått addendum 2026-10-15; README för news och settings och `docs/open-assumptions.md` är rättade mot koden; `docs/release.md` har en releasegrind för webhook-handlers.
- Flödestest för klockan, panelen och läs-gesten (RUN-252).
- Ny miljö: `STRAVA_WEBHOOK_VERIFY_TOKEN` (hemlig slumpsträng, minst 32 tecken) och `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (id som Strava ger när prenumerationen skapats; inte hemlig).

### Prod-steg (kräver ägar-ja)
Ett ägar-ja per migration, per skrivande skript och per Railway-variabel (`docs/permissions.md`). Hemliga värden klistras aldrig i chatten; ägaren lägger in dem i Railway-UI:t. `railway run` kör skriptet lokalt med tjänstens miljö, så den lokala checkouten ska stå på merge-commiten på `main` med `npm ci` kört. Läge före start (läst 2026-10-15): senaste körda migration 044, 1 grupp, 6 användare, 6 Strava-kopplingar, `api.runquest.dev/health` 200.
1. **KÖRD 2026-10-15** (migrationerna 045–049 applicerade, och release-previewn körd mot prod-databasen före merge; 050 i steg 4). Migrationerna FÖRE release-previewn (`docs/release.md` §2: previewn kör den nya koden mot prod-databasen, och utan 048/049 svarar `/news` 500) och därmed före deploy, i ordning: 045 (`045_strava_athlete_consent_pause`), 046 (`046_strava_webhook_events`), 047 (`047_event_entries_run_id_set_null`), 048 (`048_create_user_settings`), 049 (`049_create_news_read`). Alla är additiva och bakåtkompatibla med dagens kod. 045 är obligatorisk före deploy (den nya callbacken skriver kolumnerna), 046 krävs innan någon händelse tas emot, 047 innan någon radering bearbetas, 048 och 049 för inställningarna och oläst-räkningen. 047 tar ett kort ACCESS EXCLUSIVE-lås på `event_entries` och `runs` (`lock_timeout` 5 s; kör om vid timeout). `list_migrations` och `get_advisors security` efter varje.
2. **KÖRD 2026-10-15** (PR #45 squash-mergades som `8b63f32`). PR release/v0.7.0 → main, grön CI (inkl. releasegrinden `webhookHandlersRegistered`), merge (= deploy). Vänta tills båda tjänsterna är klara. Den här frontend-deployen innehåller ingen What's new-popup och ingen ny Strava-text: v0.7.0-posten har ingen `announce` och Features-kortet Strava säger fortfarande "Your runs are imported automatically", eftersom prenumerationen inte finns än. Verify-variabeln är inte satt än: `GET /api/strava/webhook` svarar 503 och `POST` svarar 200 och kastar händelsen. Frontendens samtyckesflöde och Pause or disconnect-dialogen deployas samtidigt; en gammal frontend mot den nya backenden kan inte ansluta Strava (saknar `consent_version`).
   **Medveten risk (fönstret):** integritetstexten (`DATA_POLICY_VERSION` 2026-10-14.1) och samtyckesblocket går ut med den här deployen och säger redan "removed here within 48 hours" och "New runs arrive through Strava webhooks", vilket inte är sant förrän prenumerationen finns (steg 7). Ordningen går inte att vända, eftersom webhook-rutten måste vara deployad före `create`. Steg 3–8 körs i ett svep direkt efter deployen, med ägaren närvarande, så att fönstret där integritetstexten lovar webhooks men prenumerationen saknas blir minuter, inte dagar. En radering på Strava i fönstret fångas inte, eftersom det inte finns någon avstämning (ADR 010 D12). Det är en medveten risk med 6 användare. Integritetstexten ändras inte.
3. **KÖRD 2026-10-15** (godkänd). Röktest: klockan och /news laddar, Settings visar Notifications, ett slag av/på ändrar räknaren, hovra en oläst rad markerar den läst; `GET /api/settings`, `POST /api/news/read`, `PUT /api/strava/sync-paused` och `GET /api/strava/webhook/health` ger 401 utan token; Strava-kortet visar Pause or disconnect för den som är kopplad. `GET /api/news?involves=me` mot riktig PostgREST (filtret `or(…,and(type.eq.event_closed,payload.cs.…))` är bara testat mot fakeDb): svaret är 200, innehåller bara rader där jag är aktör, mål eller deltagare (`entrant_ids`), och `meta.unread_count` är samma som utan filtret.
4. **KÖRD 2026-10-15** (050 applicerad efter deploy). Migration 050 (`050_activity_log_rank_passed_challenge_accepted`) EFTER deploy och röktest: byter CHECK-listan (15 typer). Mellan deploy och 050 saknas bara `rank_passed`- och `challenge_accepted`-raderna (skrivningen misslyckas tyst, best-effort). Bevis: `pg_get_constraintdef` för `activity_log_type_check` innehåller de två typerna.
5. **KÖRD 2026-10-15** (backfill körd: 6 athlete-id skrivna). `backfill:strava-athlete`: dry-run → ägaren ser rapporten → `--apply` (ask). Körs utan lokala hemligheter: `railway run --service runQuest-backend -- npm run backfill:strava-athlete --workspace=@runquest/backend` (lägg till `-- --apply` för skarp körning). Obs: även dry-run gör ett Strava-anrop per koppling (ca 6) och kan spara en roterad token om en access-token har gått ut; det är ofarligt men inte helt läsande. Kontrollera att alla aktiva kopplingar har athlete-id och att inga dubbletter finns (läsning): `select count(*) filter (where strava_athlete_id is null) as saknas, count(*) - count(distinct strava_athlete_id) - count(*) filter (where strava_athlete_id is null) as dubbletter from public.strava_tokens;` ska ge 0 och 0. Prenumerationen får inte skapas förrän alla har ett id.
6. **KÖRD 2026-10-15** (variabeln satt; se steg 7 för den andra). Ägaren sätter `STRAVA_WEBHOOK_VERIFY_TOKEN` i Railway (redeploy).
7. **KÖRD 2026-10-15** (prenumerationen skapad, id 377144, `callback_url` exakt `https://api.runquest.dev/api/strava/webhook`; `STRAVA_WEBHOOK_SUBSCRIPTION_ID` satt). `strava:webhook create`: dry-run → `--apply` (ask; Stravas prenumeration är en per Strava-app och gemensam för alla miljöer), via `railway run --service runQuest-backend -- npm run strava:webhook --workspace=@runquest/backend -- create` (hemligheterna stannar i Railway). Strava anropar `GET` direkt. Kör sedan `… strava:webhook … -- view` och bekräfta att `callback_url` är bytesexakt `https://api.runquest.dev/api/strava/webhook` (annars larmar nattkontrollen, RUN-240, varje natt). Ägaren sätter `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (redeploy). Gluggen däremellan täcks av pollingen för nya rundor; en radering som kommer då kan missas (ADR 010 beslut 2).
8. **KÖRD 2026-10-15** (del A godkänd mot riktig Strava: create, update, private, public och delete, cirka 5 sekunder från händelse till färdig, 0 `dead`; del B, de tre kontrollerna mot riktig Strava, är parkerad som RUN-270). Röktest av webhooken enligt ADR 010 beslut 17 och `GET /api/strava/webhook/health` (inga `dead`, inga `unmapped_tokens`). Health kräver admin-JWT: ägaren öppnar den inloggad i webbläsaren (DevTools → Network, eller adressfältet via en admin-vy); token klistras aldrig i chatten. Alternativt läser Lead samma räknare direkt i databasen (`select status, count(*) from public.strava_webhook_events group by status;`). Därtill tre kontroller mot riktig Strava, som bara kan göras i prod (läs bara klassificering och status, logga aldrig kroppar): (a) en privat-markerad aktivitet: vilken status detaljanropet ger (förväntat 404 → hoppas över; ger det 401/403 importerar pollingen sammanfattningen och då behövs en privat-koll, RUN-266 K1); (b) Disconnect med ett testkonto: ingen `strava_400`/`strava_401`-varning i loggen och RunQuest försvinner från Stravas "My Apps" (revoke med token som Bearer och i formulärkroppen, RUN-237); (c) testkontot återkallar i Strava, access-token får gå ut, en refresh utlöses: klassas som `refresh_rejected` (förväntat 400/401 med `errors[].resource RefreshToken` eller `field refresh_token`, RUN-268). Ger (c) bara `message` fattar Lead nytt beslut i RUN-270.
9. **KÖRD 2026-10-15** (tagg `v0.7.0` satt). Tagg `v0.7.0` på merge-commiten.
10. **KÖRD 2026-10-15** (ägar-ja: RUN-265:s PR #46 squash-mergad som 29ab02e; deployen verifierad: backend "backup check every 12 hours, weather every 30 minutes", frontend med What's new för v0.7.0). RUN-265:s PR (mergas sist i RUN-182, DIREKT efter godkänd rök i steg 3 och 8 och med ägar-ja; ägarbeslut 2026-10-14 ersätter ADR 010 D6:s sju dygn) slår på allt som kräver verifierade webhooks, i EN deploy: `"announce": true` på v0.7.0-posten i `changelog.json` (popupen), Features-kortet Strava får texten nedan, pollingen går från 30 min till 12 h (RUN-182), och testet `announcedNotes › v0.7.0-posten finns men annonseras inte förrän webhooks är verifierade` döps tillbaka till `announcedNotes › v0.7.0-posten med announce är med och slugen är unik` (posten ska då finnas i `announcedNotes`, en gång), medan testet om Strava-kortet i `changelogModel.test.ts` (nu `toBe('Your runs are imported automatically')`) ändras till att kräva den nya texten. Release-datumet i posten och i rubriken ovan sätts till den dagen. Före RUN-265 har v0.7.0-posten i `changelog.json` (som syns i Releases-fliken) bara det som är sant vid deploy, så RUN-265 sätter också in dessa fyra ändringar, ORDAGRANT:
    (1) Ny punkt 4 i `changes` (efter punkten om Involves me och Ranks, före samtyckespunkten), `type` `improvement`: "Strava now tells RunQuest when you log or delete a run, or change its title, type or visibility, and RunQuest also checks Strava for new runs at least every 12 hours."
    (2) Ny punkt 5 direkt efter den, `type` `improvement`: "Deletions and privacy changes on Strava follow within 48 hours. A run you delete, make private or change so it is no longer a run is removed here, and your XP, streaks, titles and badges are recalculated, so they can go down." (Meningen "Edits to a run's date or distance are picked up the same way…" är struken efter röken 2026-10-15: Strava skickar ingen händelse när bara distans eller datum ändras, bara vid titel, typ och synlighet.)
    (3) Satsen `and runs you delete or make private on Strava are still removed here` läggs in i parentesen i Pause sync-punkten (nu sista punkten), direkt efter `until you turn sync back on` och före semikolonet, så att den lyder "(your connection and runs stay, but no new runs are fetched until you turn sync back on, and runs you delete or make private on Strava are still removed here; the new runs from the pause are fetched when you turn it back on)".
    (4) Samtyckespunkten får tillbaka `the 48 hours` i stället för `what happens when you delete a run on Strava`: "Connecting Strava now starts with a short summary you tick to agree to: what is imported, the 48 hours, that Disconnect deletes your Strava runs, and that you can pause sync. The full text is in Privacy & Terms."
    Testet om Strava-texten i `changelogModel.test.ts` (nu `not.toContain('tells RunQuest')`, `'48 hours'`, `'at least every 12 hours'` och `'still removed here'`) vänds till att kräva dem. Exakt text för Features-kortet "Strava" (`body`): "Strava tells RunQuest about new and deleted runs and about runs you make private, and RunQuest also checks Strava for new runs at least every 12 hours. Pause sync in Settings, or Disconnect to delete the runs imported from Strava".
11. **KÖRD 2026-10-15** (ägar-ja: dry-run, sedan `--apply`; 1 `release_published`-rad för gruppen Wolfpack, activity_log id 74). `announce:release --version=0.7.0` (dry-run, sedan `--apply`) EFTER RUN-265:s deploy, så att Pack News-raden och popupen går ut samtidigt och först när det de säger är sant.

### Rollback
- Webhooks, FÖRST (före kodrollbacken, eftersom gammal kod saknar `/api/strava/webhook` och Strava då får 404): `strava:webhook delete --apply` (ask, via `railway run` som i steg 7) stoppar nya händelser; workern är då tom.
- Därefter kod: redeploya v0.6.2.3 i Railway och revert-PR. Tabellerna och kolumnerna är additiva och ignoreras av den gamla koden; de släpps först i en senare städning efter ägar-ja.
- Efter det bär pollingen synken, med det intervall som gäller i koden: 30 minuter före RUN-265, 12 timmar efter. Rullas något tillbaka efter RUN-265 ska RUN-265 rullas tillbaka samtidigt, annars hämtas nya rundor bara var 12:e timme. Pollingen är insert-only och hittar bara nya rundor, så raderingar och ändringar på Strava slår då inte längre igenom (ADR 010 D12). Rundor som redan raderats kommer inte tillbaka.
- Migration 045: släpp indexet `strava_tokens_athlete_id_key` och kolumnerna `paused_at`, `sync_paused`, `consented_at`, `consent_version`, `strava_athlete_id` (raderar athlete-id, samtycken och pausflaggor). Migration 046: `drop function if exists public.claim_strava_webhook_events(integer, integer); drop table if exists public.strava_webhook_events;` (raderar kön och journalen). Migration 047: lägg tillbaka FK:n utan `ON DELETE` (SQL i filhuvudet).
- Migration 048: `drop table if exists public.user_settings;` (raderar alla sparade inställningar). Migration 049: `drop table if exists public.news_read;` (läst-kvitton ovanför golvet försvinner).
- Migration 050 ångras bara efter att raderna med de nya typerna tagits bort: `delete from public.activity_log where type in ('rank_passed','challenge_accepted');` (ask), därefter den gamla CHECK-listan ur filhuvudet.

## v0.6.2.3 — Gruppfiltret är fail-closed (2026-10-14)

Intern version (ingen versionsbump, ingen What's new, ingen announce). RUN-258. Ägarbeslut 2026-10-14: buggen tas nu som liten intern version vid sidan av v0.7.0 i stället för i v0.8.0.

### Buggfixar
- En token utan `group_id` får tom data i stället för alla gruppers rader i `GET /auth/users` (admin), `GET /auth/users-with-runs` och `GET /challenges/group-stats`, och kan inte utmana någon via `POST /challenges/send` (400). En gemensam helper (`utils/groupScope.ts`) svarar tomt utan databasanrop (ADR 007 A6). Ingen synlig skillnad i dag: alla konton har en grupp.
- `group-stats` läser bara den egna gruppens väntande utmaningar.

### Kodhälsa
- CI-vakt (`ci-guards.mjs`, läget `group-filter`) fäller villkorliga gruppfilter (`if (groupId) … .eq('group_id', …)`) i routes.
- ADR 007:s rad om arvet i `users-with-runs` är uppdaterad.
- Svepet hittade två admin-fall som blir egna buggar i säkerhetsgenomgången (RUN-96): lösenordsbyte över gruppgränser (RUN-263) och användare som skapas utan grupp (RUN-264).

### Prod-steg (kräver ägar-ja)
1. Läskontroll i prod: inga konton (särskilt admins) saknar `group_id` — annars ser de tomma listor efter deploy. KÖRD 2026-10-14 (ägar-ja): 6 konton, alla med grupp; 1 admin, med grupp.
2. PR release/v0.6.2.3 → main, grön CI, merge (= deploy). Ingen migration. KÖRD 2026-10-14 (ägar-ja): PR #43, backend-deploy SUCCESS.
3. Röktest: Board, Duels (group-stats) och Admin-användarlistan visar samma innehåll som före deploy. KÖRD 2026-10-14 (oinloggat): backend startade utan fel, /health 200, /api/public/stats svarar, users-with-runs utan token 401. Inloggad kontroll av Board/Duels/Admin görs av ägaren (inga lösenord i sessionen).
4. Tagg `v0.6.2.3` på merge-commiten. KÖRD (cef81f4).

### Rollback
- Kod: redeploya v0.6.2.2 i Railway och revert-PR. Inga dataformat ändrade, ingen migration.

## v0.6.2.2 — Bakgrundsbanan på alla sidor (2026-10-14)

Intern version (ingen versionsbump, ingen What's new, ingen announce). RUN-144. Ägarbeslut 2026-10-13: designens bakgrund ska finnas på alla sidor i appen och på /legal; Rörelse-undantaget för bakgrundsbanan godkänt; deploy direkt när allt är godkänt.

### Nytt
- Bakgrunden från Claude Designs Web Prototype bakom alla inloggade sidor och /legal: guldrutnätet glider uppåt (40 px, 9 s per varv) och en oval bana nere till höger där tre löpare (guld, silver, brons) går varv (24/31/39 s), maskad och tonad som i designen. Mobilen får en mindre bana (480 px) i hörnet. Landningen är orörd.
- Bakgrunden står still mot fönstret (fixed), ligger under innehållet (`aria-hidden`, `pointer-events: none`, inget z-index) och monteras en gång i skalet, så den hoppar inte vid sidbyte.
- Minskad rörelse: allt står still, löparna utspridda på sina startplatser.
- Prestanda: löparna är transform-animationer och rutnätet en translateY-keyframe (`rqTrackDrift`, `rqTrackLap1–3`) — noll layout per bildruta, inga extra ommålningar (CDP-mätt).

### Kodhälsa
- Vakttester låser geometrin och designvärdena mot designfilerna, lagerordningen (`position: relative` på `.rq-shell__main` och `.rq-legal__inner`), reducerad rörelse och placeringen per route.

### Prod-steg
1. PR release/v0.6.2.2 → main, grön CI, merge (= deploy). Ingen migration. KÖRD 2026-10-14 (ägarens förhandsja): PR #41, grön CI.
2. Röktest: bakgrunden på /legal i prod, inga konsolfel. KÖRD 2026-10-14: /legal har en bakgrund (aria-hidden, 4 körande animationer) vid 390 och 1440 px, landningen ingen, inga konsolfel.
3. Tagg `v0.6.2.2` på merge-commiten. KÖRD (e03b19e).

### Rollback
- Kod: redeploya v0.6.2.1 i Railway och revert-PR. Inga dataformat ändrade, ingen migration.

## v0.6.2.1 — Fast header på landningen, typsnitten från egen server (2026-10-13)

Intern version (ingen versionsbump, ingen What's new, ingen announce). Ägarbeslut 2026-10-13: headern följer med vid scroll, "Free while in beta" bort (inget prisbeslut finns), "snabba vinster" efter Lighthouse-mätningen. RUN-212.

### Ändrat
- Landningens header är fast (sticky) på mobil och desktop, med safe-area-marginal, egen z-index-token (`--rq-z-landing-header`) och höjd-tokens; ankarlänkarna landar under headern (`scroll-padding-top`). En mjuk ton under headern ligger bakom innehållet så att rubriken behåller full styrka. Inloggningsdialogen återställer fokus utan att sidan hoppar.
- "Free while in beta" borttaget ur väntelistan; en vakt fäller om landningen nämner "free".
- Typsnitten (Barlow Condensed, Bebas Neue, Share Tech Mono, Oswald) serveras från egen server under `/fonts/*` (woff2, latin + latin-ext, OFL-licens bredvid); rubrikens typsnitt förladdas. Inga anrop till Google Fonts längre.
- Integritetstexten: Google Fonts-stycket borta (Google får inte längre besökarens IP), `DATA_POLICY_VERSION` 2026-10-13.1.
- Filmens play-knapp: skärmläsarnamnet börjar med den synliga texten (WCAG 2.5.3).
- Caddy: `/fonts/*` immutable med `font/woff2` och 404 för saknade filer; CI-vakt för typsnittsfilernas storlek och format.

### Mätning (Lighthouse 12.1 mobil, lokalt, median av 3)
- Prestanda 80 → 82, LCP 4,56 → 4,16 s. Resten av LCP hänger på JS-kedjan (filmens poster laddas först efter JS) och tas i RUN-260 (v0.8.0).

### Prod-steg (kräver ägar-ja)
1. PR release/v0.6.2.1 → main, grön CI (inkl. verify-static-serving på Linux), merge (= deploy). Ingen migration. KÖRD 2026-10-13 (ägar-ja): PR #39, grön CI.
2. Röktest: `/` sticky header, inga anrop till Google Fonts, `/fonts/*` rätt typ och cache, `/legal` visar version 2026-10-13.1. Lighthouse mobil mot prod. KÖRD 2026-10-13: / och /legal 200, Bebas Neue förladdas, inga Google Fonts-länkar, `/fonts/*` font/woff2 immutable och 404 för saknad fil. Lighthouse 12.1 mobil mot prod, median av 3: prestanda 81 → 85, FCP 2,9 → 2,6 s, LCP 4,2 → 3,5 s, TBT 0 ms, CLS 0; A11y/BP/SEO 100.
3. Tagg `v0.6.2.1` på merge-commiten. KÖRD (ca804e2).

### Rollback
- Kod: redeploya v0.6.2 i Railway och revert-PR. Inga dataformat ändrade, ingen migration.

## v0.6.2 — Landningssidan marknadsföringsklar, väntelista, /legal (2026-10-13)

Användarversion (What's new + Pack News-rad via announce:release). Epic RUN-159. Ägaren godkände design, copy och integritetstext 2026-10-13.

### Nytt
- Landningen ombyggd efter ägarens design (RUN-207–210): header med Sign in som konturknapp och "Join the waitlist" som enda guldknapp, desktopbana (5 banor) och rutnät, sanna siffror från `GET /api/public/stats` (km · runners · challenges, ingen uppräkning), exempelgruppen "Sample pack", How the game works med XP-formeln ur shared, funktionsrutnät (synk var 30:e minut) och footer med Privacy, Legal, officiell "Compatible with Strava"-logga och versionen.
- Filmen (RUN-257): 49 s, komprimerad från 1080p till 720p (3,1 MB) och 480p (1,8 MB), startar vid klick (`preload="none"`, `playsinline`), poster i WebP, kontrollrad under bilden på desktop. Originalet ligger aldrig i git (CI-vakt + .gitignore).
- Väntelistans formulär (RUN-211) mot `POST /api/waitlist` (v0.6.1.4): e-post + samtyckesbock, honeypot och tidsfälla, samma tack för ny och dubblett.
- /legal (RUN-204) med Privacy och Terms ur en gemensam källa i shared (RUN-201, `DATA_POLICY_VERSION` 2026-10-13): personuppgiftsansvarig Joel Lindberg (joellindberg23@gmail.com), rättslig grund (avtal för spelet, samtycke för väntelistan), dagens Strava-beteende (radering på begäran via e-post; automatisk radering kommer med RUN-93). Snapshotvakt kräver versionshöjning vid textändring.
- Metadata (RUN-205, ADR 006-addendum: statisk meta, ingen prerender): titel, description, canonical och Open Graph/Twitter-kort med delningsbild (filmens slutruta), favicon (löparsymbolen), app-ikoner och `site.webmanifest`. robots.txt stänger `/preview` i alla grupper och sitemap listar `/` och `/legal` (RUN-206).
- Caddy: `/media/*` immutable med 404 för saknade filer och Range (206); `/site.webmanifest` som `application/manifest+json`.

### Kodhälsa
- Nya lintvakter: Stravas loggregler (`rq/strava-logo`), honeypotens CSS, lazy-gränsen för LegalPage; sitemap-vakten läser routerns faktiska konfiguration. `.gitattributes` låser Strava-loggornas radslut.

### Prod-steg (kräver ägar-ja)
1. PR release/v0.6.2 → main, grön CI (inkl. verify-static-serving på Linux), merge (= deploy). Ingen migration. KÖRD 2026-10-13 (ägar-ja): PR #37, grön CI inkl. verify-static-serving på Linux.
2. Röktest: `/` utloggad visar siffrorna från prod, filmen spelar, `/legal` öppnas, väntelistan svarar, `/media/*` och `/site.webmanifest` serveras rätt. KÖRD 2026-10-13: / och /legal 200, siffrorna 4 551 km · 6 runners · 4 challenges renderade i prod (390 och 1440 px, inga konsolfel), film video/mp4 immutable, manifest och delningsbild rätt typ, sitemap / och /legal.
3. Tagg `v0.6.2` på merge-commiten. KÖRD (c79927c).
4. `announce:release --version=0.6.2` (dry-run, sedan `--apply`). KÖRD 2026-10-13 (ägar-ja): 1 release_published-rad för Wolfpack.

### Rollback
- Kod: redeploya v0.6.1.4 i Railway och revert-PR. Inga dataformat ändrade, ingen migration.

## v0.6.1.4 — Inga dubbla rundor, datum i svensk tid, väntelista och publika siffror i backend (2026-10-13)

Intern version (ingen What's new, ingen announce). Ägarbeslut 2026-10-13: det som var klart i v0.6.2 släpps nu medan landningens ritningar färdigställs; landningen själv blir v0.6.2.

### Buggfixar
- Inga dubblettrundor när svaret på "Log run" uteblir och man skickar igen: klienten skickar en `Idempotency-Key` per inskick, servern sparar den (`runs.client_request_id`, migration 043) och svarar med samma runda vid upprepning; dubbelklick ger ett anrop. (RUN-225)
- "Förra kalendermånaden" i titelmotorn maxKmRolling30, Strava-synkens tidsfönster och preview-sidornas datum räknas i svensk tid via kalendermodulen; datumvakten fäller nu fler former av datumaritmetik och undantagen gäller exakt antal träffar per fil. (RUN-224)
- Testet för loggformuläret berodde på dagens datum (rött från 2026-10-13); formuläret använder nu skärmens klocka överallt. (RUN-225)

### Nytt (osynligt för gruppen tills landningen släpps)
- `GET /api/public/stats`: publik, ingen persondata — antal löpare, avgjorda utmaningar och total km som tre heltal, cachat 5 min. Underlag för landningens sanna siffror. (RUN-231)
- Väntelista nivå 1: tabellen `waitlist_signups` (migration 044; RLS utan policyer, bara backend), `POST /api/waitlist` (publik; honeypot, tidsfälla, egen rate limit 5/15 min/IP, 1 kB, samma svar för ny och dubblett, e-post loggas aldrig) och `GET /api/admin/waitlist`. Inget mail skickas. (RUN-202, RUN-203)
- Admin: ny flik Waitlist med anmälda och totalen. (RUN-232)
- ADR 006-addendum: den publika landningen förblir klientrenderad med statisk metadata i `index.html`, ingen prerender. (RUN-200)

### Prod-steg (kräver ägar-ja)
1. Migration 044 (`waitlist_signups`) — KÖRD 2026-10-13 (ägar-ja): RLS på, 0 policyer, anon/authenticated utan åtkomst, inga nya advisor-varningar.
2. Migration 043 (`runs.client_request_id` + partiellt unikt index) före deploy — KÖRD 2026-10-13 (ägar-ja): 736 rundor orörda, indexet finns.
3. PR release/v0.6.1.4 → main, grön CI, merge (= deploy). Ingen versionsbump. KÖRD 2026-10-13 (ägar-ja): PR #35, grön CI.
4. Tagg `v0.6.1.4` på merge-commiten. Röktest: `GET /api/public/stats` ger tre tal. KÖRD 2026-10-13: tagg på da2dbd0; röktest i prod: stats 200 (6 löpare, 4 utmaningar, 4 551 km), ogiltig väntelisteanmälan 400, admin-listan 401 utan token, webben 200.

### Rollback
- Kod: redeploya v0.6.1.3 i Railway + revert-PR. Migrationerna är additiva och kan ligga kvar (gammal kod läser dem inte).
- Migration 043: `drop index if exists public.runs_user_client_request_id_key; alter table public.runs drop column if exists client_request_id;`
- Migration 044: `drop table if exists public.waitlist_signups;` (tar bort sparade adresser — ägar-ja).

## v0.6.1.3 — Designreglerna som lint i stället för källtexttester (RUN-223) (2026-10-12)

Intern version (ingen What's new, ingen announce). Ägarbeslut 2026-10-12: RUN-223 delas upp — steg 2 (designregler som lint) nu, steg 4 (RUN-227) i v0.7.0 efter RUN-93, steg 6 löpande.

### Kodhälsa
- Designspråkets regler kontrolleras av lint i stället för av tester som läser CSS och kod som text: Stylelint 16 (`apps/frontend/stylelint.config.js`, `npm run lint:css`) för CSS (px, hex/rgba, radie, transition, z-index, typsnitt, rå line-height, egna custom properties, `:focus` utan `-visible`, kända rester) och ESLint-regeln `rq/design-syntax` per designgrupp (lucide, egen svg, emoji, inline-style, hex, godtyckliga Tailwind-värden, sonner, locale, console m.m.). Täcker mer än förut, bl.a. `app-shell.css` som inte var vaktad.
- `src/test/themeTokens.sync.test.ts` jämför temafilen och `index.css` på värde och sammanhang (media, selektor) och fäller lästa men odeklarerade tokens — ersätter per-feature-kontrollerna.
- `src/test/lintScope.test.ts` fäller när en designgrupps eller ett Stylelint-overrides glob inte matchar någon fil, och när en mapp under `src/features/` saknar designgrupp (ny feature = ny designGroup, ADR 001).
- 28 källtextvakter och `designGuards.ts` borta: frontend 2365 → 2169 tester, ~900 rader mindre. Kritikern planterade 71 överträdelser och byggaren 99 — alla fälldes av rätt regel.
- CI: nytt steg `Stylelint` i frontend-jobbet (blockerande, `--max-warnings 0`).

### Prod-steg (kräver ägar-ja)
1. PR release/v0.6.1.3 → main, grön CI, merge (= deploy). Ingen runtime-kod ändras (lint-konfig, tester, CI och lockfil med nya dev-paket). Ingen migration. KÖRD 2026-10-12 (ägar-ja): PR #33, Railway-deploy SUCCESS, www och api svarar 200.
2. Tagg `v0.6.1.3` på merge-commiten. KÖRD 2026-10-12 (tagg v0.6.1.3 på 176bf38).

### Rollback
- Revert-PR på main. Bygget och runtime påverkas inte.

## v0.6.1.2 — Anonym läsning av nivåtabellen stängd (RUN-112) (2026-10-12)

Intern version (ingen What's new, ingen announce). Ägarbeslut 2026-10-12: stäng den sista anonpolicyn nu, när frontenden sedan v0.6.0 läser nivåtabellen via backenden.

### Säkerhet
- Migration 040 droppar policyn "Anyone can view level requirements" på `level_requirements` (SELECT för anon + authenticated). RLS är på och tabellen får inga policyer, så klientroller nekas; backenden (service role) och `GET /api/config/levels` påverkas inte. Anon läser därefter ingenting i databasen. RLS-baslinjen i `docs/permissions.md` är uppdaterad. Ingen kod- eller frontendändring.

### Prod-steg (kräver ägar-ja)
1. Merge av PR:en till main (docs, migrationsfil och test; ingen runtime-kod ändras).
2. Migration 040 appliceras mot prod med ägar-ja (en rad, idempotent). KÖRD 2026-10-12 (ägar-ja): 0 policyer på level_requirements, service role läser 30 nivåer, inga nya advisor-varningar. Tagg v0.6.1.2 (PR #31).
3. Verifiera: anon-REST mot `/rest/v1/level_requirements?select=*` med publishable key ger tom lista eller 401/403 (inte 30 rader); `GET /api/config/levels` med giltig token ger fortfarande 30 nivåer; Supabase advisors visar inga nya varningar.

### Rollback
- Policyn återskapas exakt som i `000_baseline.sql` rad 652:
  `create policy "Anyone can view level requirements" on public.level_requirements for select to anon, authenticated using (true);`
- Behövs bara vid frontend-rollback till v0.5.3 eller äldre (den läser tabellen direkt med anon-nyckeln); det är den rollback som v0.6.0:s rollbackpunkt "Efter 040" pekar på.

## v0.6.1.1 — Förvaltningsrunda: säkerhet, felhantering, en källa för streak och kalender, död kod, snabbare tester (2026-10-12)

Intern version (ingen What's new, ingen announce). Ägarbeslut 2026-10-12: en städrunda mellan epics, inget användarsynligt utöver buggfixarna nedan.

### Säkerhet och drift
- Beroenden uppdaterade inom semver (express 5.3, jsonwebtoken 9.0.3, react-router 6.30.6, autoprefixer m.fl.): `npm audit` från 43 (2 critical, 30 high) till 11 (6 moderate, 5 high, 0 critical); `npm audit --omit=dev` till 4 moderate. Kvarvarande kräver major (tailwind 4 — de 5 high är tailwinds byggverktygskedja braces/micromatch/fast-glob/chokidar —, node-cron 4, react-router 7). (RUN-213)
- Pinnade versioner med släppvillkor i commit-bodyn: `@supabase/supabase-js` 2.105.1 (senaste som fungerar på Node 20, som prod kör enligt `.nvmrc`; nyare kraschar i `createClient`) — släpps när Node höjs till 22; nytt smoketest fäller om pinnen släpps för tidigt. `tailwindcss` 3.4.17 (3.4.18/19 kraschar bygget), `rollup` 4.64.2 (nyare blockeras lokalt av Windows application control) — släppvillkor för alla tre i commit 0f3bc56. (RUN-213)
- Prod-loggern serialiserar fel (message, stack, Postgrest-koder) — förut blev de `{}`. Känslig loggning bort: e-post, hela user-objektet, tokenprefix, invite-koder; request-loggen utan query. (RUN-214, RUN-215)

### Buggfixar
- Skrivkedjan sväljer inte längre fel: omräkning av rundor, utmaningsavgörande (boosts), event-XP, streak-jobbet (skrev 0/0 vid läsfel), schedulers och utmaningsroutes. Strava-rundor som fått XP 0 vid ett omräkningsfel självläks vid nästa synk. När en runda sparats/ändrats/raderats men XP-omräkningen fallerar svarar POST/PUT/DELETE `/api/runs` 500 `{ error, written: true }`; appen uppdaterar listan och visar "Saved — XP is recalculating; don't submit again" i stället för ett fel som lockar till dubblett. En loggrad som skrev ut topplistedata (namn, värden) är borta. (RUN-215)
- Streak räknas en gång, i shared, med Stockholmsdatum — en runda 00:00–02:00 svensk tid gav förut streak 0 till nattjobbet. (RUN-216)
- Kalendermodul i shared ersätter ~30 kopior av datumaritmetik. Rättar: "idag" i utmaningar och events (UTC → Stockholm), Storm Chaser-prognosen (tittade på dagens i stället för morgondagens väder efter midnatt), eventfönster som startar 00:00 på sommartidsdygnen. (RUN-218)
- Titelomräkning: `reprocess-all` svarar ärligt (200/207/500 + antal), varning vid fel; migration 042 serialiserar topplistebygget per titel (advisory-lås). (RUN-158)
- levelService fastnar inte längre på fallback efter ett DB-fel (nytt försök efter 5 min). (RUN-137)
- Singular för räknemått ("1 run", "1 day") i titlar, Runner card och admin. (RUN-140)
- Badge-popupen väntar tills en sidtour är klar; tourtexten säger att Strava-rundor är skrivskyddade. (RUN-155)
- "Best so far"/eligibility för säsongstitlar använder samma vinter som de lagrade innehavarna. (RUN-141)

### Kodhälsa
- Död kod bort: 49 oanvända shadcn-ui-filer, Radix-toast, ~40 paket, 31 CSS-tokens, 7 klasser (huvud-CSS −43 kB, huvud-JS −17 kB). (RUN-217)
- Bygget: Tailwind läser inte testfiler (tom CSS-regel borta), död animate-plugin bort, landning/preview/onboarding/admin-sidor lazy, manualChunks, `noImplicitAny`. Huvudbunten 700 → ~446 kB. (RUN-219)
- Testsviten: frontend 28 s i stället för ~45 s (rena logiktester utan jsdom, `retryDelay: 0`), arkitekturgränser som ESLint-regler, CSS-/klass-assertions bort där roll-/texttest täcker, Jira-ID bort ur testnamn (CI-vakt). (RUN-154; del 2 = RUN-223)
- CI-vakter: tom testsvit, TODO/FIXME utan RUN-nyckel, Jira-ID i testnamn; concurrency och timeouts. (RUN-221)
- Docs: releasekedjan samlad i `docs/release.md`; ADR 001/002/006, README och open-assumptions i takt med koden. (RUN-220)
- Repohygien: 68 gamla worktrees och 169 mergade lokala brancher bort; `.claude/worktrees/` ignoreras i repot. (RUN-222)

### Prod-steg (kräver ägar-ja var för sig)
1. PR release/v0.6.1.1 → main, grön CI, merge (= deploy). Ingen versionsbump, ingen What's new, ingen announce (intern version).
2. Migration 042 (`update_title_leaderboard` med advisory-lås). Additiv, kan köras före eller efter deploy. KÖRD 2026-10-12 (ägar-ja), verifierad: låset finns, search_path oförändrad, alla innehavare = plats 1.
3. Tagg `v0.6.1.1` på merge-commiten. KLAR (PR #29, 64df02c).

### Rollback
- Kod: redeploya v0.6.1 i Railway och revert-PR på main. Inga dataformat ändrade.
- Migration 042: rollback-SQL står i filhuvudet (funktionen utan lås).

## v0.6.1 — Badges-filter och release-rad i Pack News (2026-10-11)

Patch efter v0.6.0 på ägarens önskan: badges får eget filter i Pack News, och en ny version syns som en rad i Pack News (inte bara som What's new-popupen).

### Ändrat
- Pack News: eget filterchip **Badges** efter Levels (ikon `shield`, Levels-färg). `badge_earned` ligger inte längre under Levels; raderna är oförändrade (grön kant, sm-emblem). ADR 009 beslut 5 addendum. (RUN-160)
- Ny händelsetyp `release_published` — en systemrad per grupp och version ("RunQuest vX is out — titel", ikon `sparkles`, kategori `release` med events ink-token, inget filterchip). Skrivs ALDRIG av appen eller servern, bara av `npm run announce:release` (dry-run default, `--apply`, idempotent, avbryter om CHECK saknar typen). Release-previewn mot prod kan alltså inte förbruka den. 036-proben är extraherad till `scripts/lib/activityTypeProbe.ts` och delas med `reveal:badges`. (RUN-161)
- Migration 041: `release_published` i `activity_log_type_check`.

### Prod-steg (kräver ägar-ja var för sig)
1. Deploy via PR + grön CI.
2. Migration 041 efter deployen — KÖRD 2026-10-12 (ägar-ja). v0.6.0-flikar kraschar inte på den nya typen (okända typer filtreras bort i News); de kan räkna raden som oläst utan att visa den tills de laddas om.
3. `announce:release`: dry-run med `--version=0.6.1` (visar exakt det som skrivs), sedan `--apply --version=0.6.1` (uttrycklig version, så att en saknad changelog-post aldrig annonserar fel version). KÖRD 2026-10-12 (ägar-ja): 1 rad (en grupp), verifierad i databasen, ingen probe-rad kvar.

### Rollback
- Kod: redeploya v0.6.0 i Railway och revert-PR på main. v0.6.0-frontenden tål `release_published`-rader (filtreras bort), så ingen data behöver raderas: raderna är ofarliga och kan ligga kvar (skriptet har ingen retract-väg). 041 kan ligga kvar (additiv).

## v0.6.0 — Badges, väder- och vintertitlar, väggklocka och Strava-lås (2026-10-11)

Rullar ihop epicsen RUN-1 (Badges), RUN-91 (Stormborn, Iceborn, Winter Warrior) och RUN-92 (städning och nivåtabellen via backend), plus
Strava-låset (RUN-139), ägarens badge-omritning v2 (RUN-146–152) och login som popup (RUN-145). Prod-stegen kräver ägar-ja var för sig: 035 och badge-backfillen är redan gjorda, 036, avtäckningen av badges (RUN-156) och 037 körs efter deployen (038/039 applicerades redan som säkerhetshotfix; 040 skrivs separat efter releasen) (se "Prod-steg" nedan).

### Nytt
- **Badges (ADR 009, RUN-1).** Åtta serier × sex nivåer (Common till Legendary) som gruppen samlar över säsonger: Milestoner, Earth Trotter, Climber,
  Streak Keeper, Early Bird, Night Owl, Speedster och Precisionist. Reglerna, trösklarna (v2, en mätning per serie, strikt stigande) och texterna bor i
  `packages/shared/src/badges.ts`. Badges är härledda och återkallbara: `evaluateBadges` körs i `calculateUserTotals`, diffar mot `user_badges` (en rad per
  användare och serie, migration 035) och skriver bara skillnaden; raderas eller ändras en runda så sjunker nivån. Precisionist räknar bara Strava-rundor
  (servern sätter `source`, RUN-136). Lästa via `GET /api/badges/user/:userId` och `/group` (gruppavgränsade), skrivna via `PUT /api/badges/showcase` (max 3 visade,
  `users.displayed_badge_series`) och `POST /api/badges/seen` (popup-vattenmärket `seen_tier`).
  - Badges-sidan `/badges` (v2, se nedan): kort per serie ("Held by X of N in your pack") och valet av visade badges (Show / On display + SAVE DISPLAY). Profile visar en kompakt sammanfattning med "All badges →"; minis i hjältekortet (desktop).
  - Board: de visade badgesen som minis på podiet och i Season-raderna. Runner card: andras badges som en kompakt, skrivskyddad rad emblem (v2).
  - Uppgraderingspopupen visas i skalet när `tier > seen_tier` (en gång per nivå, väntar på onboarding och turer). Pack News: `badge_earned` (migration 036) under
    filtret Levels, med emblem i raden och i klock-popovern; raden dras tillbaka om nivån tappas.
  - `npm run backfill:badges` (dry-run som standard, `--apply`, `--silent`) räknar ut historiska badges utan news och utan popup-flod.
- **Badge-design v2 (RUN-146–152, ägarens omritning 2026-10-11).** Ersätter v1:s profilsamling, väljare och Runner card-panel; facit är `docs/design/badges/spec.md` (avsnittet "v2") och
  designkällan i `docs/design/claude-design/`. Ingen backend, inget API och ingen migration ändras.
  - **Designkälla, färger, storlekar (RUN-146).** De fyra designfilerna ligger i repot (`RunQuest Web Prototype.dc.html` är nu hel, den var avkapad). Dämpade nivåfärger (bl.a. Heroic `#d97070`,
    Legendary `#e3c23e`), svagare glöd och en fjärde emblemstorlek `cp` (44 × 49 px, ikon 20): storlekarna är 28/44/56/96 px. Nivåchippet har en egen bakgrundstint (`--rq-badge-chip-tint`) så att alla sex nivåer klarar 4.5:1.
  - **Vimpeln som utmaningstecken (RUN-147).** Sköldarna för osända challenge-tokens är vimplar (svalstjärt) på Board och i Duels, med delad geometri (`shared/components/challengeMark.ts`).
    Minis står högerställda på podiet (`--rq-board-minis-inset`), och vimpel och minis delar aldrig behållare.
  - **Route och navigering (RUN-148).** `/badges` och "Badges" (ikon `shield`) i sidonavet under YOU. Mobilnaven är oförändrad; mobilens ingång är "All badges →" på profilen.
  - **Byggstenarna (RUN-149).** `buildBadgeSummary`, `useShowcaseDraft` (utkast + spara), liggande `BadgeSeriesCard` med växlare och `BadgeEmblemDetail` (44 px-emblem som öppnar en popover med nivå och krav).
  - **Badges-sidan (RUN-150).** ON DISPLAY-remsa med SAVE DISPLAY / SAVING… / SAVED, ett kort per serie med Show / On display — N / Locked, "3 of 3 on display — remove one first." och tillstånden laddar/tomt/fel.
    Den separata väljaren är borttagen (`ShowcasePicker`, `ShowcaseSlots`, `showcasePickerId`). Ingen global procent någonstans, bara "Held by X of N in your pack".
  - **Profilen (RUN-151).** Kompakt `BadgeSummary` (intjänade som 44 px-emblem på nivå, låsta under en hårlinje) med "All badges →"; `BadgeCollection` är borttagen. Mobilprofilens hjältekort har inga minis; desktop behåller dem.
  - **Runner card (RUN-152).** Kompakt `BadgePanel` (bara emblem, popover för detaljer) bredvid Head to head i det nedre rutnätet (desktop), efter TITLES på mobil.
- **Login som popup (RUN-145).** Inloggningen är en dialog (`LoginDialog`) över Landing på `/login` i stället för en egen sida (`LoginPage`/`LoginScreen` borta); `?next=` bevaras.
  Log out (AvatarMenu) går till startsidan `/` utan dialog. ADR 006, addendum 2026-10-11.
- **Cachen rensas vid inloggning, utloggning och 401 (RUN-143).** `AuthProvider` anropar `queryClient.clear()` vid login, logout och `onUnauthorized`, så att förra användarens data (badges, grupp, users-with-runs, sett-listan, news) aldrig visas för nästa. Ingen loop: `clear()` startar ingen omhämtning.
- **Tre nya titlar i kategorin Weather (RUN-91).** Stormborn (flest rundor med vindbyar på minst 12 m/s, `stormRunCount`), Iceborn (flest rundor vid 5 °C eller kallare,
  `coldRunCount`) och Winter Warrior (flest km under vintern 1 december–28/29 februari; utanför vintern räknas senast avslutade vinter, `winterKm`/`winterWindow`).
  Titelramverket fick väder i `RunData` och `ctx.now`; väder hämtas nu även för användare utan grupp, och titlarna räknas om efter väder-backfill. Migration 037 lägger
  till de tre raderna (prod har 20 titlar före). Playbook förklarar säsongstitlarna.
- **Nivåtabellen via backend (RUN-110, RUN-111).** `GET /api/config/levels` ersätter frontendens direktläsning av `level_requirements`, så att anon-läsningen kan stängas.

### Ändrat
- **Strava-rundor är skrivskyddade (RUN-139).** `PUT` och `DELETE /api/runs/:id` svarar 409 `Strava runs are read-only` för `source = 'strava'` (Strava är sanningskällan för
  distans och datum). Profilens rundrad har en View-knapp i stället för Edit, och arket heter "Run details" och har ingen Save. Delete-spärren satt tidigare bara i UI:t.
- **`start_time` tolkas som lokal väggklocka (RUN-106, RUN-107).** Strava-importen lagrar `start_date_local` med ett falskt Z. Nya `wallClockToInstantMs` i shared ger
  det verkliga ögonblicket (Europe/Stockholm, sommartid hanterad); väderfönstrets ålder räknas därifrån, Board-raden "x h ago" var 1–2 h fel och är rättad, och
  frontendens datumläsning av titelvärdet `lastRunOfWeek` (`titleFormat.ts`, motorn är oförändrad) glider inte längre till nästa dag i zoner öster om UTC. Klockslagsmotorerna (Early Bird, Night Owl, lunch) och badgeserierna läser väggklockan
  oförändrad och konverterar aldrig; kontraktstester vaktar att ingen "fixar" dem. Rundor utomlands får fortfarande en "x h ago" som är fel med tidszonsskillnaden.
- **Titelomräkning är gruppavgränsad och fail-closed (RUN-104):** `processAllUsersTitles` räknar bara om användarens egen grupp.
- **News tål okända händelsetyper (RUN-138):** en rad med en typ klienten inte känner kraschar inte längre News; den filtreras bort men kvitteras av "Mark all read".

### Tekniskt
- Städning (RUN-105): `supabase-js` borttagen ur frontend (inloggningen är backend-JWT), `triggerManualSync` och död kod borta, `createRun` skickar inte `source`.
- Dokumentation (RUN-108): ADR 009 (Godkänd), STATE.md, permissions, README:er för badges, news och claude-design.
- Versionsbump till 0.6.0 (rot och frontend), `changelog.json` med "What's new"-popup.
- Städning efter badge v2 (RUN-153): README:erna för badges, profile och claude-design pekar på det byggda, spec V2.12 markerar alla vyer BYGGD, och "What's new" beskriver badges-sidan, den kompakta profilen och Runner card, vimpeln och login-popupen.
  Tokens och CSS som spec V2.7 listade (`--rq-badge-grid-cols`, `--rq-badge-pick-clear`, väljar- och samlings-CSS) var redan borttagna i RUN-150/151; ingen kvarvarande badge-token eller badge-klass saknar läsare.

### Prod-steg (kräver ägar-ja var för sig, ordning enligt STATE.md)
1. Migration 035 (`user_badges`, `displayed_badge_series`) — redan applicerad 2026-10-11.
2. `backfill:badges`: dry-run, sedan `--apply` med dry-run-rapporten som underlag, FÖRE deployen av backend — KÖRD 2026-10-11 (ägar-ja): 36 rader med seen_tier = tier, inga news-rader, omkörning skriver inget. Efter deployen bara vid tröskeländring: `--apply --silent`.
3. Deploy av release/v0.6.0 (backend med motorerna `stormRunCount`, `coldRunCount`, `winterKm` måste ligga före titelraderna).
4. Migration 036 (`badge_earned` i `activity_log_type_check`) direkt efter deployen — avsiktligt efter, eftersom v0.5.3-frontendens News kraschar på okända händelsetyper; badge-news för nivåhöjningar i fönstret skrivs aldrig. Öppna flikar från v0.5.3 laddas om. Rollback av frontend till v0.5.3 efter att badge_earned-rader finns kräver att de raderas (ägar-ja). KÖRD 2026-10-11 (ägar-ja), direkt efter deployen.
4b. Avtäckning (RUN-156, ägarbeslut): `reveal:badges` dry-run, sedan `--apply` (ägar-ja) DIREKT efter 036 — varje befintlig badge får en "Badge earned"-rad i Pack News och `seen_tier = 0`, så alla ser sina badges som nyförtjänade (popup + News). Idempotent; avbryter utan skrivning om 036 saknas. KÖRD 2026-10-11 (ägar-ja): 36 news-rader, seen_tier = 0 på 36 rader, verifierat i databasen.
5. Migration 037 (titelraderna) efter deployen och DIREKT därefter tyst omräkning (annars kan en vanlig skrivning hinna ge title_unlocked för de nya titlarna): `POST /api/titles/reprocess-all` (`emitNews: false`). KÖRD 2026-10-11 (ägar-ja). Den parallella omräkningen krockade på `title_leaderboard (title_id, position)` (bugg RUN-157), så samma beräkning kördes om en användare i taget med 0 fel. Alla 23 titlar har position 1 = innehavare, och inga title-news skrevs.
6. Migration 040 (stäng anon-läsning av `level_requirements`, RUN-112) först när v0.6.0 är live. Filen ingår inte i release/v0.6.0 och skrivs separat.
7. Redan applicerat 2026-10-11 som säkerhetshotfix (ägar-ja): 038 stänger alla RLS-policyer för Supabase-Auth-sessioner (users-tabellen med email och password_hash var läsbar för en Supabase-session), 039 stänger anon-läsning av `title_leaderboard_view` (namn, kön, titelvärden) och signup-triggern `on_auth_user_created`.

### Rollback (beslutas av ägaren; snabbast först)
1. **Kod:** Railway → respektive tjänst → Deployments → välj den senaste v0.5.3-deployen → Redeploy (frontend och/eller backend). Därefter en PR som revertar merge-commiten på main, så att nästa push inte deployar v0.6.0 igen.
2. **Ordning:** frontend först om felet syns i UI:t, backend först om API:t felar. Backend v0.5.3 tål 035–037 (additiva; okända `metric_key` hoppas över med varning).
3. **Data före frontend-rollback:** finns `badge_earned`-rader (efter 036) måste de raderas innan v0.5.3-frontenden tas tillbaka, annars kraschar News: `delete from activity_log where type = 'badge_earned'` (ägar-ja).
4. **Migrationer:** 036 och 037 kan ligga kvar vid kodrollback. 037 kan tas bort med den kommenterade SQL:en i filhuvudet om titlarna måste bort. 035/038/039 rullas inte tillbaka (additiva respektive stängningar).
5. **Efter 040:** v0.5.3-frontenden läser `level_requirements` direkt — en frontend-rollback efter 040 kräver att policyn öppnas igen (anges i 040:s huvud när filen skrivs).
6. **Hostingvariabler:** ta INTE bort `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` i Railways frontend-tjänst förrän v0.6.0 varit stabil och rollback inte längre är aktuell — en ombyggd v0.5.3-bundle kastar vid start utan dem (vit sida).

## v0.5.3.2 — Alla CSS-overrides som avgjordes av laddningsordningen (2026-10-07)

### Fixat
- Uppföljning av v0.5.3.1 (PR #23). En genomgång av alla `className` i TSX mot alla CSS-regler (specificitet och den faktiska ordningen i bygget)
  hittade fler enkla klasser som skulle åsidosätta delade `.rq-*`-primitiver på samma specificitet och därför förlorade i produktion, eftersom
  feature-CSS i huvudbunten laddas FÖRE `index.css`. De är nu sammansatta selektorer, så specificiteten avgör:
  - app-shell: `.rq-pill` (gap, padding, letter-spacing mot `.rq-chip`) och `.rq-header__avatar`
  - board: stapelhöjderna (`.rq-board-track`, `--thin`, `.rq-board-streak__track`) mot `.rq-track` (6 px)
  - duels: hairgrid-cellerna (`how__item`, `record__cell`) mot `.rq-cell`
  - landing: titelns letter-spacing mot `.rq-display-xl` (desktop-`@media` följer med)
  - runner: ringhålet, Frodo-stapeln och statkortet
  - profile: fotoknappens disabled-färg vid hover mot `.rq-btn--ghost:hover`
  - whatsNew: eyebrow-färgen (samma värde i dag; följer annars eyebrow-experimentet)
  - duels/events: den egna raden — hover vinner fortfarande, nu uttryckligen (`:not(:hover)`)
- Lazy-sidorna (admin, changelog, playbook, settings) vann bara för att de laddas sist; samma sammansatta selektorer, ingen synlig ändring.

### Tekniskt
- Filhuvudena som påstod "ligger utanför @layer så att klasserna vinner" är rättade.

## v0.5.3.1 — Log- och Profile-overrides som förlorade mot primitiverna (2026-10-06)

### Fixat
- Tailwind 3 plattar ut `@layer` i bygget, och Log/Profile ligger i huvudbunten, så `log.css`/`profile.css` laddas FÖRE `index.css`. Enkla klasser
  med samma specificitet som de delade `.rq-*`-primitiverna förlorade därför (PR #21). Nu sammansatta selektorer:
  - Log: padding på väntekortet (`.rq-card.rq-log-pending`); `.rq-log-run__name` dubblerade `.rq-name` (`font: inherit` förlorade) och återställer nu bara knappen
  - Profile: statkortets och historikens padding (`.rq-card.…`), stapelhöjden 9/11 (`.rq-track.rq-profile-track`) och ringhålets inset 7
    (`.rq-ring.rq-profile-ring > .rq-ring-hole`)

### Tekniskt
- READMEs för Log och Profile och filhuvudena beskriver nu den verkliga CSS-ordningen i stället för "utanför @layer".

## v0.5.3 — Storm Chaser kräver riktig blåst, tydligare eyebrows (2026-10-06)

### Ändrat
- **Storm Chaser (issue #19):** prognosanropet i `eventService.checkStormChaserForecast`
  skickar `wind_speed_unit=ms`. Tidigare kom byarna i km/h och jämfördes mot 15, så
  tröskeln var 15 km/h (≈ 4 m/s, en vanlig bris). Nu krävs minst 4 dagtimmar med byar
  ≥ 15 m/s (≈ 54 km/h), som koden alltid menat. Regelvägen (≥ 3 timmar nederbörd) är
  oförändrad. Nytt backendtest `stormChaserForecast.test.ts`; Playbook-texten och
  `playbookFacts` följer med (ägarbeslut 2026-10-06).
- **Eyebrows** (`.rq-eyebrow` och News dagrubrik) läser nya `--rq-text-eyebrow`
  (= `--rq-text-4`, .50) i stället för `--rq-text-5` (.28). Ägarexperiment — backas
  genom att peka token på `--rq-text-5`.

- **Rundornas väderdata i m/s** (ägarbeslut 2026-10-06): `WeatherService` hämtade
  vinden utan enhet, så `run_weather.wind_speed_ms`/`wind_gusts_ms` innehöll km/h.
  Forecast- och archive-anropen skickar nu `wind_speed_unit=ms`, och varje skrivning
  sätter `fetched_at`. De 318 befintliga raderna räknas om en gång efter deploy med
  `npm run convert:wind-ms -- --before=<deploytid> --apply --backup=<fil>`
  (`scripts/convertWindToMs.ts`: torrkörning som standard, säkerhetskopia före skrivning,
  omräknade rader flyttas över gränsen så att ingen rad delas två gånger).

## v0.5.2 — Restsidorna i ny design, Feature & Version och versionsmekanik (2026-10-06)

### Nytt
- **Playbook** omskriven i designspråket (`features/playbook/`) och faktagranskad mot
  koden: XP-tabellen och exemplen räknas ur de regler som gäller (`GET /config/xp`, standard
  som reserv), event- och titelfakta låses av `playbookFacts.test.ts` som läser
  backendens källfiler. Beskriver spelet som det är; regeländringar (issue #19 Storm
  Chaser, minimidistansen) väntar på ägarbeslut.
- **Settings, Admin och inloggningen** omritade (`features/settings/`, `features/admin/`,
  `features/auth/`) med delade formulärdelar i `shared/components/form/` (TextField,
  FormNotices). Admin stoppar ogiltig streaktrappa före Save och behåller spärren mot
  att spara innan inställningarna lästs in. Inloggningen har en permanent alert-region
  och låser fälten med readOnly + aria-disabled medan den skickar.
- Tokensektioner 1.29–1.32 (`--rq-login-*`, `--rq-settings-*`, `--rq-admin-*`,
  `--rq-playbook-*`); `src/test/designGuards.ts` samlar de gemensamma designvakterna.
- **Feature & Version-sidan** omritad i designspråket (flikarna Features · Working on ·
  Releases, `?view=`); versionsnumret och datumet överst kommer ur changelog.json i
  stället för att vara hårdkodade, och mobilvyn är härledd ur Web Prototypens skärm.
- **"What's new"-popupen** omritad (Radix Dialog, en guldknapp "Got it"); ersätter
  den gamla lucide/tailwind-modalen.
- **Versionsvakt i CI:** `scripts/check-versions.mjs` fäller bygget om rotens och
  frontendens `package.json`, översta rubriken i den här filen (dess tre första delar)
  och changelog.json inte stämmer överens (ordning, semver, rubriker, `announce`).
  Användarversioner har tre delar (`0.5.2`), interna fyra (`0.5.0.1`).

### Ändrat
- Settings sa att bara Strava-typen Run importeras (och nya texten att löpband måste loggas
  för hand); koden importerar Run, Trail Run och Virtual Run, löpband inräknat. Texten
  läser nu samma konstanter som Playbook (`playbookFacts.ts`) och låses av faktatestet.
- Admin: det påhittade fältet "Min km for streak" är borttaget (streaken har ingen
  distansgräns); `min_run_distance` heter "Min km for base XP". Playbook nämner att en
  duell-boost är undantaget från "samma distans, samma XP".
- `apps/frontend/src/data/changelog.json` är nu ENDA källan för det gruppen ser:
  `{ features, workingOn, releases }`. Posterna har valfritt `announce: true`;
  onboarding-kön och popupen läser annonserade poster därifrån (slug
  `patch_v<version>`). `features/onboarding/patchNotes.ts` och
  `shared/utils/changelogHelpers.ts` är borttagna. Poster för 0.5.0–0.5.2 ifyllda;
  bara 0.5.0 (redesignen) annonseras.
- Onboarding: ett misslyckat "sedd"-anrop (`/onboarding/mark-seen`) stänger popupen/touren
  ändå och kön går vidare i sessionen (posten visas igen nästa gång); "Got it" kan inte
  dubbelklickas. Versionsvakten stöder inte förreleaser (`-rc.1`) och ignorerar rubriker i kodstaket.
- `package.json` (rot + frontend) hade 0.0.x — satta till 0.5.2 så att de följer
  användarversionen enligt docs/dokumentation.md.

## v0.5.1 — Användarrelease: 0.5.0.1–0.5.0.4 (2026-10-05)

Rullar ihop de interna versionerna 0.5.0.1–0.5.0.4 till en användarversion (changelog.json 0.5.1,
ingen popup): appen behöver inte cache-rensas efter uppdateringar, olästa nyheter har en guldprick och
mobilens Board visar alla titlar och XP-progress. Se de fyra interna posterna nedan för detaljerna.

## v0.5.0.4 — runquest.dev skickas vidare till www (2026-10-05)

### Ändrat
- Apex-domänen `runquest.dev` omdirigeras till `www.runquest.dev` via `Caddyfile` (PR #18).

## v0.5.0.3 — Städrunda + olästmarkör (2026-10-05)

### Fixat
- Admin-sidans XP-inställningar gick inte att läsa eller spara (serverfel):
  backend frågade efter en kolumn som inte finns och letade efter raden med
  fel id-typ (issue #13).
- Streak-trappan kan inte längre bli tom om en sparning avbryts: nya steg
  sparas först, gamla tas bort sist. Ogiltiga trappor (tomma, dubbla dagar,
  multiplikator utanför 1–9.99 eller med fler än två decimaler) avvisas innan
  något ändras. Admin-sidans Save är låst tills inställningarna och trappan
  faktiskt lästs in — annars kunde standardvärden skriva över den riktiga trappan.

### Ändrat
- Olästa nyheter har en guldprick vid tiden, i flödet och i klock-popovern.

### Tekniskt
- Strava-kopplingen loggar inte längre en del av engångskoden.
- TypeScripts byggcache (`tsconfig.tsbuildinfo`) spåras inte längre i git.
- Dokumentationen rättad (inloggning gäller 30 dagar, hosting/Caddy, domäner).

## v0.5.0.2 — Alla titlar på mobilens Board (2026-10-05)

### Ändrat
- Mobilens Board visar nu alla visade titlar (upp till tre) på en egen rad
  under namnet, på alla placeringar. Tidigare syntes bara den första titeln på
  pallen och ingen alls från plats 4.
- Korten från plats 4 visar nivå och XP i nivån mot vad nivån kräver, som
  pallkorten.

## v0.5.0.1 — Ingen gammal cachad app efter deploy (2026-10-05)

### Fixat
- Webbläsare kunde fastna på en gammal cachad startsida efter en deploy och
  visa vit sida tills cachen rensades. Startsidan revalideras nu alltid
  (`Cache-Control: no-cache`), saknade kodfiler ger 404 i stället för startsidan,
  och en flik som var öppen under en deploy laddar om sig själv en gång om en
  sida inte längre går att ladda. Den som redan har en gammal startsida i cachen
  kan behöva ladda om en sista gång.
- Vercel Speed Insights borttaget (sajten ligger på Railway; skriptet gav fel
  på varje sidladdning).

### Tekniskt
- Frontendens statiska server styrs av `Caddyfile` i repo-roten (Railpack);
  beteendet verifieras i CI med samma Caddy-version mot det byggda `dist/`.

## v0.5.0 — Redesignen (2026-10-05)

Hela appen omritad enligt designprojektet (RunQuest App/Web Prototype):
mörk arena, guld som belöningssignal, skarpa hörn, Bebas Neue/Barlow
Condensed/Share Tech Mono. Byggd i 11 kritikergranskade inkrement.

### Nytt
- **App-skal:** bottenbar (Ranks/Titles/+New/Duels/You) på mobil, sidonav på
  desktop; riktiga routes (`/board /titles /duels /events /news /log /profile
  /runner/:id`); "Right now"-pills; ErrorBoundary (ett panelfel ger felkort,
  aldrig vit skärm).
- **Board:** podium med spökrank, veckoflik med dagstaplar och Mover of the
  week, streaks-flik, rank-delta och XP-pace.
- **Runner card:** egen skärm/overlay med nivåring, statflikar, titlar,
  head-to-head och Challenge-knapp.
- **Titles:** kategorigrupper, titelkort med innehavare/värde/runner-ups,
  On display-val, Closest chase.
- **Duels:** Standings/Live/Rules/History, send-sheet med token-val och
  head-to-head-tips, verkliga insatser ur datan.
- **Events:** öppet-kort med nedräkningsring, competition-tabell, Up next,
  This week, facit och historik med pager.
- **Log runs:** Estimated XP-förhandsvisning via shared-formeln, effektrader
  ("streak lever", "Closes on …"), group history, löpbandsflagga.
- **Profile:** hjältekort, Frodo-zoom i tre lägen, Distance/Streak/Fun/
  Consistency-heatmap, edit/delete med full omräkningskedja, profilbild.
- **Pack News:** händelselogg (activity_log, migration 034) med klock-popover,
  oläst-badge, dag-grupperat flöde, filterchips och Mark all read. Titelbyten,
  utmaningar, level-ups, milstolpar, streak-brott och event loggas live;
  historiken backfillad.
- **Landing:** publik startsida med arena-bana, aggregat och produktglimtar.

### Fixat på vägen
- Login visar fel ("Invalid credentials") i stället för att tyst tömma
  formuläret.
- Onboarding-touren spelas inte längre om efter inloggning utan omladdning.
- Utgången session loggar ut (401) i stället för att fastna på felkort.
- Radering av rundor som kvalificerat event ger begripligt besked (409) i
  stället för serverfel; Strava-rundor kan inte längre raderas i appen (synken
  återskapade dem ändå — radera i Strava i stället).
- Datumvalidering räknar svensk tid (midnatt–02 går att logga).
- Redigering/radering av rundor uppdaterar nu leaderboard, events, titlar och
  utmaningar direkt.

### Tekniskt
- Frontend: 1268 tester (från 0), typecheck/lint blockerande i CI.
- Backend: 450 tester; shared: 156 tester med delade API-kontrakt.
- ADR 006 (navigering), 007 (härledningsendpoints), 008 (händelselogg).
