# Runbook: backup och återställning

Intern förvaltningsdokumentation (svenska, för ägaren och Lead). Releasekedjan och rollback av kod står i
[`docs/release.md`](release.md); det här dokumentet gäller **data**: vad som finns kvar om databasen eller något annat går
förlorat, hur länge, och hur vi vet att en återställning fungerar innan vi behöver den på riktigt.

## Hur dokumentet ska läsas: tre sorters påståenden

Repot innehåller ingen kopia av Supabases dokumentation, och ingen agent har läst ägarens dashboard. Därför är varje faktapåstående
märkt:

- **[REPOT]** kontrollerat mot koden, migrationerna eller andra dokument i repot.
- **[SUPABASE-DOKUMENTATIONEN]** hur Supabase beskriver sin produkt, återgivet från kännedom och **inte läst i repot**. Siffror och
  funktionsnamn här kan ha ändrats; bekräfta mot <https://supabase.com/docs/guides/platform/backups> innan du litar på dem.
- **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]** något bara ägaren kan se (plan, inställningar, tider). Tills rutan i avsnitt 9 är ifylld är det
  *okänt*, och planeringen utgår från det sämre alternativet.

Inga siffror här är uppmätta förrän övningen i avsnitt 5 är gjord. Antaganden är märkta som antaganden.

## 1. Läget i en mening

Databasen (Supabase Postgres, prod `yrrqaxdngayakcivfrck` i Pro-organisationen) har den backup som Pro ger. **Allt annat som
RunQuest består av saknar backup**: profilbildsfilerna, Railway-variablerna, Strava-appens inställningar och
webhook-prenumerationen, Sentry- och Umami-konfigurationen och GitHub-secrets. Schemalagd export utöver Pro är inte beslutad (RUN-288,
avsnitt 4).

## 2. Vad Pro ger för databasen

| Fråga | Svar | Källa |
|---|---|---|
| Dagliga backuper | Ja, på Pro | [SUPABASE-DOKUMENTATIONEN] |
| Hur länge de sparas | Pro: de senaste **7 dagarna**. (Team: 14, Enterprise: upp till 30.) | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: Database → Backups → Scheduled backups ska lista sju dagar |
| Klockslag för den dagliga backupen | Okänt här | **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: skriv in klockslaget i avsnitt 9 (sätter RPO:ns värsta fall) |
| PITR (point-in-time recovery) | Är ett **betalt tillägg** på Pro, inte inkluderat. Med PITR ersätter kontinuerlig arkivering de dagliga backuperna | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: Database → Backups → fliken "Point in time". Står där inget om PITR är den **av** |
| Återställning i det befintliga projektet | Ja, från Backups-sidan. Projektet är otillgängligt under återställningen och **all data efter backupens tidpunkt skrivs över** | [SUPABASE-DOKUMENTATIONEN] |
| Återställning till ett NYTT projekt ("Restore to new project") | Finns för Pro och uppåt enligt dokumentationen; villkor (t.ex. vilken sorts backup som krävs) och kostnad kan ha ändrats | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: knappen finns på Backups-sidan, och dialogen visar vad det nya projektet kostar *innan* du bekräftar |
| Nedladdning av en backup | Daglig backup kan laddas ner som fil (en logisk dump, `.backup`/`.gz`). Finns inte alltid för projekt som använder fysiska backuper eller PITR | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]** |
| Staging (`aormctqrmguvncxrigwy`, gratis-organisation) | Gratisplanen har **inga** dagliga backuper som går att återställa från. Staging byggs i stället om från noll (`docs/staging.md`) och har ingen skyddsvärd data | [SUPABASE-DOKUMENTATIONEN] + [REPOT] (`docs/staging.md`) |

Det som ligger i databasbackupen: alla tabeller i `public` (användare, löpningar, titlar, `activity_log`, `strava_tokens`, event,
inställningar m.m.), schemat, migrationsloggen (`supabase_migrations.schema_migrations`) och raderna som beskriver storage-filerna
(`storage.objects`, bara metadata). [REPOT] för tabellerna: `apps/backend/migrations/` och `STATE.md`.

Om Strava-tokens: i äldre backuper ligger `strava_tokens` i **klartext** tills ADR 013 är införd och backfyllt; nyare rader är
krypterade (`enc:v1:…`). En återställd kopia innehåller alltså riktiga användaruppgifter och lösenordshashar och ska skyddas och raderas
som prod (se övningens städsteg). [REPOT] (`docs/adr/013-strava-tokenkryptering.md`, risk 6).

## 3. Vad som INTE täcks av backupen

| Vad | Varför det inte täcks | Vad som händer om det går förlorat | Var sanningen finns idag |
|---|---|---|---|
| **Filerna i storage-bucketen `profile-pictures`** | Databasbackupen bär bara raderna i `storage.objects` (metadata), inte filerna. Det gäller även att en återställning inte hämtar tillbaka filer som raderats efter backupen. [SUPABASE-DOKUMENTATIONEN] | Raderna finns kvar men filerna är borta: `users.profile_picture` pekar på en URL som ger 404. Användarna får ladda upp sina bilder igen (`POST /api/users/profile-picture`). Bilderna är små (max 5 MB per fil [REPOT] `docs/permissions.md`) och kan inte återskapas från något annat ställe | Bara i Supabase Storage. **Ingen kopia någon annanstans** |
| **Railway-variablerna** (prod och staging) | Railway sparar dem i sina tjänster; repot har bara *namnen* (`STATE.md`, stack) och aldrig värden | Hemligheter som inte finns i ägarens lösenordshanterare är borta. Värst: `TOKEN_ENCRYPTION_KEY` (utan den går de krypterade Strava-tokens inte att läsa; ADR 013 räknar det som högst sex återanslutningar), `JWT_SECRET` (alla loggas ut), `SUPABASE_SERVICE_ROLE_KEY` (hämtas på nytt i Supabase), `STRAVA_CLIENT_SECRET` (hämtas på nytt hos Strava) | Railway; ägarens lösenordshanterare ska ha en kopia av varje hemlighet som inte kan hämtas på nytt. **[ÄGAREN BEKRÄFTAR]** att den har det (avsnitt 9) |
| **Strava-appens inställningar** | Ligger hos Strava (<https://www.strava.com/settings/api>): klient-id och -hemlighet, callback-domän, namn och bild | Appen måste ställas in på nytt; ny klienthemlighet kräver ny `STRAVA_CLIENT_SECRET` i Railway | Hos Strava. Skriv ner callback-domänen i avsnitt 9 |
| **Webhook-prenumerationen hos Strava** | Prenumerationen är en per app och gemensam för alla miljöer, och ligger hos Strava, inte i vår databas (`strava_webhook_events` är bara inkorgen) | Inga raderingar slår igenom. Återskapas med `npm run strava:webhook --workspace=@runquest/backend -- create --apply` (ägar-ja, ADR 010); det nya id:t läggs i `STRAVA_WEBHOOK_SUBSCRIPTION_ID`. `... -- view` är läsning och visar läget | Hos Strava |
| **Sentry-konfigurationen** (org `joel-lindberg`, projekten `runquest-backend` och `runquest-frontend`, larmregler, DSN:er) | Ligger hos Sentry | Fel och larm uteblir tills det är ställt igen. DSN:erna står i Jira RUN-281 och Railway-variablerna; `SENTRY_AUTH_TOKEN` skapas på nytt | Hos Sentry; Jira RUN-281 |
| **Umami-konfigurationen** (webbplats-id, skript-URL, dashboard) | Ligger i Umami-tjänsten, utanför repot | Statistiken tappar sin konfiguration; historiken ligger i Umamis egen databas, som inte omfattas av Supabase-backupen | Umami-tjänsten. **[ÄGAREN BEKRÄFTAR]** var den körs och om den har egen backup |
| **GitHub-secrets** (Actions) | Ligger hos GitHub och går inte att läsa ut igen | Bygge och deploy som behöver dem stannar tills de läggs in på nytt | GitHub (Settings → Secrets). Ägarens lösenordshanterare ska ha värdena. Namnen: kontrolleras av ägaren i dashboarden, repot listar dem inte |
| **Supabase-projektets egna inställningar** (API-nycklar, e-post-/Auth-inställningar, extensions, nätverksregler) | Ingår inte i en databasåterställning | Ett återställt projekt får nya nycklar; Auth används inte av appen ([REPOT] `docs/permissions.md`) och signup ska vara stängt, kontrollera det i det nya projektet | Supabase-dashboarden |
| **Koden och migrationerna** | Inte ett backupproblem: ligger i git på GitHub, och `000_baseline.sql` plus migrationerna bygger ett tomt schema (`docs/staging.md`) | – | [REPOT] |

**Gapet i en mening:** vi kan återskapa schemat och, inom Pros fönster, raderna; vi kan inte återskapa bilderna, och vi har ingen kopia
som överlever att Supabase-projektet i sig försvinner eller att kontot spärras.

## 4. Backup utöver Pro: RUN-288

Det som Pro inte ger, enligt avsnitt 2 och 3, är en **schemalagd export** av databasen och profilbilderna till en plats utanför
Supabase-projektet, med längre historik än sju dagar. Det är uppdraget i **RUN-288** (Jira, epic RUN-13). Det väntar på ett
**ägarbeslut** (lagringsplats, kostnad, hur länge exporterna sparas, och att en export innehåller personuppgifter och lösenordshashar
och därför måste krypteras). Tills RUN-288 är beslutad och byggd gäller:

- Databasen: bara Pros fönster (och PITR om ägaren har slagit på det).
- Profilbilder: ingen backup alls.
- Hemligheter: bara ägarens lösenordshanterare.

Den här runbooken ändrar inte på det. Övningen i avsnitt 5 visar att Pros backup går att återställa; den ersätter inte RUN-288.

## 5. Återställningsövning

**Syfte:** bevisa att den senaste backupen går att återställa, mäta hur lång tid det tar (RTO) och se att datan är hel, **innan** vi
behöver det i en verklig incident. Övningen är utformad så att prod aldrig skrivs och aldrig ersätts.

**Regler (bindande, ur `docs/permissions.md` och agentpolicyn):**
- Återställningen sker **bara till ett TILLFÄLLIGT projekt**, aldrig över prod. "Restore" på prodprojektets egen Backups-sida får inte
  tryckas under övningen.
- **Ägaren kör**, Lead hjälper i chatten. Skapa projekt och kostnad är ägarens val (att skapa molnresurser är ett ägarbeslut).
- Anslutningssträngar, lösenord och nycklar klistras **aldrig** i chatten. Lead ser bara resultaten av frågorna.
- Backendens produktions- eller stagingmiljö pekas **aldrig** mot kopian. Kopian används bara via SQL-editorn.
- Kopian innehåller riktig användardata. Radera projektet i steg 7. Det är det enda raderingssteget i övningen och det gäller det
  tillfälliga projektet, aldrig prod.

### Förberedelse (ca 10 minuter)

1. Öppna loggen i avsnitt 8 och skriv starttid.
2. Prod: Dashboard → projekt `yrrqaxdngayakcivfrck` → Database → Backups. Anteckna tidpunkten för den **senaste dagliga backupen**
   och vilka dagar som listas (bekräftar retentionen, avsnitt 9).
3. Kör BLOCK A i [`docs/runbook-backup-compare.sql`](runbook-backup-compare.sql) i **prod** (SQL Editor) och skriv av resultatet i
   loggen, kolumnen "prod före". Filen är skrivskyddad (`begin read only` och `rollback`; en vakt i CI,
   `scripts/runbook-backup-sql.test.mjs`, fäller bygget om något annat än SELECT hamnar där).

### Väg 1: "Restore to new project" (föredragen, om knappen finns)

4. På prodprojektets Backups-sida: välj den senaste backupen → **Restore to new project**. Välj namn `runquest-restore-test`,
   organisation och region. **Läs kostnaden i dialogen och bekräfta den först då**: ett nytt projekt i Pro-organisationen kostar
   [ÄGAREN BEKRÄFTAR kostnaden i dialogen] och är billigast om det raderas direkt efter övningen. Gratis-organisationen (staging) har en
   gräns på aktiva projekt; pausa inget annat projekt för det här (det är ett eget ägarbeslut).
5. Skriv starttid för återställningen i loggen. Vänta tills dashboarden visar projektet som friskt. Skriv sluttid.

### Väg 2: nedladdad backup (om "Restore to new project" saknas för projektet)

4. Backups-sidan → senaste dagliga backupen → **Download**. Filen är en dump av hela klustret och innehåller användardata: spara den på
   ägarens egen dator, inte i OneDrive-mappen som repot ligger i, och radera den i steg 7.
5. Skapa ett tomt tillfälligt projekt `runquest-restore-test` (gratis-organisationen om en plats är ledig, annars Pro-organisationen;
   kostnaden är ägarens val). Återställ dumpen till det med `psql` mot projektets anslutningssträng
   (Dashboard → Connect), enligt Supabases anvisning för att återställa en nedladdad backup [SUPABASE-DOKUMENTATIONEN]. Kommandot
   ägaren och Lead går igenom tillsammans; lösenordet skrivs bara i ägarens eget skal. Felmeddelanden om roller och objekt som Supabase
   redan har skapat i ett nytt projekt är väntade; alla andra fel skrivs i loggen.

### Kontrollera (gäller båda vägarna)

6. Kör BLOCK A i det **tillfälliga projektet** (SQL Editor) och skriv av resultatet i loggen, kolumnen "kopia".
7. Kör BLOCK B i **prod** med backupens tidpunkt ifylld och skriv av kolumnen `forvantat_i_kopian`.
8. Bedöm:
   - Kopians antal (steg 6) är **lika** med `forvantat_i_kopian` (steg 7) för users, runs, user_titles, activity_log, strava_tokens
     (bara antal), events och event_entries. Avviker en tabell: skriv vilken och med hur mycket, och stäm av mot rader som raderats i
     prod sedan backupen (de finns kvar i kopian).
   - Antalet migrationer och den senaste versionen är lika i prod och kopia.
   - `storage.objects (profile-pictures)` har rader i kopian, men **filerna** gör det inte nödvändigtvis: öppna en profilbilds-URL från
     kopian om du vill se det med egna ögon. Det är gapet från avsnitt 3.
   - "Senaste" per tabell i kopian ligger inte senare än backupens tidpunkt.
9. Skriv sluttid för hela övningen (för RTO) och resultatet: **lyckades / lyckades med anmärkning / misslyckades**.

### Städning

10. Radera `runquest-restore-test` (Dashboard → Settings → General → Delete project) och radera den nedladdade filen om väg 2
    användes. Bekräfta i organisationens Billing-vy att inget extra projekt ligger kvar. Skriv i loggen att det är gjort.

### Efter övningen

Lead för in utfallet i `STATE.md` (en rad: datum, väg, lyckades/inte, uppmätt RTO) och i `CHANGELOG.md`. Avvikelser blir egna ärenden
i Jira; "Restore to new project" saknas eller backupen är äldre än väntat är ett fynd, inte ett fel i övningen.

## 6. RPO och RTO

Båda är **antaganden** tills övningen och rutan i avsnitt 9 är gjorda. De här värdena är inte uppmätta.

**RPO (högsta tid vi kan förlora)**

| Del | RPO | Antagande |
|---|---|---|
| Databas, om PITR är av (förväntat läge) | Upp till **ca ett dygn** plus tiden mellan backupens klockslag och dess slutförande: vi förlorar allt som skrivits sedan den senaste dagliga backupen | Backuperna tas dagligen [SUPABASE-DOKUMENTATIONEN]. Det värsta fallet är precis före nästa backup. **[ÄGAREN BEKRÄFTAR]** klockslaget och att PITR är av |
| Databas, om ägaren slagit på PITR | Minuter | Supabase anger att WAL arkiveras kontinuerligt med en fördröjning på några minuter [SUPABASE-DOKUMENTATIONEN]; siffran är inte kontrollerad. **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]** |
| Profilbilder | **Obegränsad**: det finns ingen backup | Förlust av bucketen eller en bild kan inte återställas; mildring är att användarna laddar upp igen. Stängs först av RUN-288 |
| Löpningar från Strava som skapats under förlustfönstret | Kan till stor del hämtas på nytt vid nästa synk eller nattliga avstämning | **Antagande, inte verifierat**: att synken och avstämningen återskapar missade aktiviteter (ADR 010); manuellt loggade löpningar, XP-historik, utmaningar och event i fönstret återskapas inte |

**RTO (tid till att appen fungerar igen)**

Databasen är liten (ADR 013 räknar med högst sex Strava-kopplade användare) och återställningen i sig förväntas därför gå på minuter. Det som tar tid är människorna
och bytet av projekt. Antagen total tid för en verklig incident, **inte uppmätt**:

| Moment | Antagen tid | Mäts i övningen? |
|---|---|---|
| Beslut och ägar-ja | Beror på ägarens tillgänglighet | Nej |
| Återställning till nytt projekt (Väg 1) eller i befintligt projekt | Minuter till någon timme [SUPABASE-DOKUMENTATIONEN: tiden beror på databasens storlek] | **Ja** (steg 5) |
| Peka backend på det nya projektet: `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` i Railway, redeploy (ägar-ja per variabel) | Ca 15 minuter | Nej, ej prövat |
| Rök mot de kritiska flödena (`STATE.md`, `docs/release.md` steg 4) | Ca 30 minuter | Nej |
| **Totalt (antagande)** | **Några timmar, inom ett arbetspass**, om ägaren är tillgänglig. Ersätts av det uppmätta värdet efter övningen | – |

Återställning **i befintligt projekt** (Backups-sidan, "Restore") kräver ingen ändring av Railway-variabler men gör projektet otillgängligt
under tiden och skriver över allt efter backupens tidpunkt. Återställning till **nytt projekt** lämnar prod orört tills man själv byter,
kräver ändrade variabler men ger möjlighet att jämföra först. Vilken väg som gäller i en verklig incident är ägarens beslut.

## 7. Om det händer på riktigt (kort)

1. Stoppa skadan först (rotorsaken kan vara vår kod): ingen ny migration, ingen radering, och rollback av koden enligt `docs/release.md` avsnitt 9.
2. Ägaren avgör: återställ i befintligt projekt, eller till nytt projekt och byt (avsnitt 6). **Alla steg som skriver mot prod kräver
   ägarens uttryckliga ja**, ett per åtgärd.
3. Efter återställning mot ett nytt projekt: kontrollera att migrationerna är lika (BLOCK A), att `profile-pictures` finns som bucket
   och är publik med 5 MB-gräns (migration 051), att inga policyer för anon/authenticated finns (`docs/permissions.md`) och att signup
   är stängd. `TOKEN_ENCRYPTION_KEY` ska vara oförändrad, annars går tokens inte att läsa. Backendens `JWT_SECRET` är vår egen, så
   användarna förblir inloggade.
4. Efter en återställning till en äldre tidpunkt: Strava-webhook-prenumerationen och `STRAVA_WEBHOOK_SUBSCRIPTION_ID` ligger kvar hos
   Strava och i Railway (`strava:webhook view` bekräftar). Kör en synk och vänta på nattens avstämning.
5. Säg det till gruppen: de har förlorat tiden mellan backupen och incidenten, och bilder kan saknas.

## 8. Logg (fylls i av ägaren vid övningen)

Kopiera tabellen för varje övning. Skriv klockslag med tidszon.

| Fält | Värde |
|---|---|
| Datum | |
| Utfört av | Ägaren (Lead hjälpte i chatten: ja/nej) |
| Starttid övningen | |
| Backupens tidpunkt (senaste dagliga) | |
| Dagar som listades under Scheduled backups | |
| Väg (1 nytt projekt / 2 nedladdad dump) | |
| Kostnad som dialogen visade | |
| Starttid återställningen | |
| Sluttid återställningen (projektet friskt) | |
| Sluttid hela övningen | |
| **Uppmätt RTO (sluttid hela minus starttid)** | |
| **Faktisk dataålder (övningens start minus backupens tidpunkt)** | |
| Resultat (lyckades / med anmärkning / misslyckades) | |
| Projektet raderat (tid) | |
| Nedladdad fil raderad (om väg 2) | |
| Anmärkningar och eventuella Jira-ärenden | |

Radantal (BLOCK A och B i `docs/runbook-backup-compare.sql`):

| Tabell | Prod före övningen | Förväntat i kopian (BLOCK B) | Kopia (BLOCK A) | Lika? |
|---|---|---|---|---|
| users | | | | |
| runs | | | | |
| user_titles | | | | |
| activity_log | | | | |
| strava_tokens (bara antal) | | | | |
| events | | | | |
| event_entries | | | | |
| migrationer (antal, senaste) | | (ej i B) | | |
| storage.objects (profile-pictures) | | (ej i B) | | |

## 9. Det ägaren måste bekräfta (okänt för oss tills ifyllt)

| # | Att bekräfta | Var | Svar och datum |
|---|---|---|---|
| 1 | Prod är på Supabase Pro och Database → Backups visar dagliga backuper | Dashboard (prod) | |
| 2 | Antal dagar som listas (förväntat sju) | Dashboard → Backups → Scheduled backups | |
| 3 | Klockslaget för den dagliga backupen | samma | |
| 4 | PITR: på eller av (förväntat av), och kostnaden om man väljer att slå på det | Dashboard → Backups → Point in time | |
| 5 | Finns "Restore to new project", och vad det nya projektet kostar | samma, dialogen | |
| 6 | Går backupen att ladda ner | samma | |
| 7 | Lösenordshanteraren har en kopia av varje hemlighet som inte kan hämtas på nytt: `TOKEN_ENCRYPTION_KEY`, `JWT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, GitHub-secrets | Ägarens egen | |
| 8 | Stravas callback-domän och att klient-id/hemlighet går att hämta på strava.com | Strava → Settings → My API Application | |
| 9 | Var Umami körs och om det har en egen backup | Umami-tjänsten | |
| 10 | Beslut om RUN-288 (schemalagd export av databas och profilbilder: plats, kostnad, hur länge, kryptering) | Jira RUN-288 | |
| 11 | Datum för övningen (förslag: före v0.8.0 går live, eftersom den släppet ändrar `user_titles`, `title_leaderboard` och Strava-tokens) | – | |

Lead för in svaren i avsnitt 2 och 6 (byt ut "förväntat" mot det bekräftade) när de finns.
