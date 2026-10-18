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

Databasen (Supabase Postgres, prod `yrrqaxdngayakcivfrck`) har den backup som Pro ger, **om** projektet verkligen ligger i en Pro-organisation
(ägaren har sagt det; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**, avsnitt 9 rad 1, eftersom ingen agent kan se planen). **Allt annat som
RunQuest består av saknar backup**: profilbildsfilerna, Railway-variablerna, Strava-appens inställningar och
webhook-prenumerationen, Sentry- och Umami-konfigurationen och GitHub-secrets. Schemalagd export utöver Pro är inte beslutad (RUN-288,
avsnitt 4).

## 2. Vad Pro ger för databasen

| Fråga | Svar | Källa |
|---|---|---|
| Dagliga backuper | Ja, på Pro | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]** att prodprojektet är på Pro och att Backups-sidan visar dem |
| Hur länge de sparas | Pro: de senaste **7 dagarna**. (Team: 14, Enterprise: upp till 30.) | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: Database → Backups → Scheduled backups ska lista sju dagar |
| Klockslag för den dagliga backupen | Okänt här | **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: skriv in klockslaget i avsnitt 9 (sätter RPO:ns värsta fall) |
| PITR (point-in-time recovery) | Är ett **betalt tillägg** på Pro, inte inkluderat. Med PITR ersätter kontinuerlig arkivering de dagliga backuperna | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: Database → Backups → fliken "Point in time". Står där inget om PITR är den **av** |
| Återställning i det befintliga projektet | Ja, från Backups-sidan. Projektet är otillgängligt under återställningen och **all data efter backupens tidpunkt skrivs över** | [SUPABASE-DOKUMENTATIONEN] |
| Återställning till ett NYTT projekt ("Restore to new project") | Finns för Pro och uppåt enligt dokumentationen; villkor (t.ex. vilken sorts backup som krävs) och kostnad kan ha ändrats | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**: knappen finns på Backups-sidan, och dialogen visar vad det nya projektet kostar *innan* du bekräftar |
| Nedladdning av en backup | Daglig backup kan enligt dokumentationen laddas ner som fil (filformat och innehåll, t.ex. om det är en dump av hela klustret eller bara databasen, är **inte verifierat**; **[ÄGAREN BEKRÄFTAR]**). Finns inte alltid för projekt som använder fysiska backuper eller PITR | [SUPABASE-DOKUMENTATIONEN]; **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]** |
| Staging (`aormctqrmguvncxrigwy`, gratis-organisation) | Gratisplanen har enligt dokumentationen **inga** dagliga backuper som går att återställa från. Staging byggs i stället om från noll (`docs/staging.md`) och har ingen skyddsvärd data | Gratisorganisationen: [REPOT] (`STATE.md`, Läge: "gratisorg"). Att gratisplanen saknar backuper: [SUPABASE-DOKUMENTATIONEN], **[ÄGAREN BEKRÄFTAR I DASHBOARDEN]**. Ombyggnaden: [REPOT] (`docs/staging.md`) |

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
| **Railway-variablerna** (prod och staging) | Railway sparar dem i sina tjänster; repot har bara *namnen* (`STATE.md`, stack) och aldrig värden | Hemligheter som inte finns i ägarens lösenordshanterare är borta. Värst: `TOKEN_ENCRYPTION_KEY` (utan den går de krypterade Strava-tokens inte att läsa; ADR 013 räknar det som högst sex återanslutningar), `JWT_SECRET` (alla loggas ut), `SUPABASE_SERVICE_ROLE_KEY` (hämtas på nytt i Supabase), `STRAVA_CLIENT_SECRET` (hämtas på nytt hos Strava) | Railway. **[ÄGAREN BEKRÄFTAR]**: om Railway sparar variabelhistorik eller egna backuper är okänt här och utgås inte från. Ägarens lösenordshanterare ska ha en kopia av varje hemlighet som inte kan hämtas på nytt, och ägaren bekräftar att den har det (avsnitt 9) |
| **Strava-appens inställningar** | Ligger hos Strava (<https://www.strava.com/settings/api>): klient-id och -hemlighet, callback-domän, namn och bild | Appen måste ställas in på nytt; ny klienthemlighet kräver ny `STRAVA_CLIENT_SECRET` i Railway | Hos Strava. Skriv ner callback-domänen i avsnitt 9 |
| **Webhook-prenumerationen hos Strava** | Prenumerationen är en per app och gemensam för alla miljöer, och ligger hos Strava, inte i vår databas (`strava_webhook_events` är bara inkorgen) | Inga raderingar slår igenom. Återskapas med `npm run strava:webhook --workspace=@runquest/backend -- create --apply` (ägar-ja, ADR 010); det nya id:t läggs i `STRAVA_WEBHOOK_SUBSCRIPTION_ID`. `... -- view` är läsning och visar läget | Hos Strava |
| **Sentry-konfigurationen** (org `joel-lindberg`, projekten `runquest-backend` och `runquest-frontend`, larmregler, DSN:er) | Ligger hos Sentry | Fel och larm uteblir tills det är ställt igen. DSN:erna läses ur miljövariabler (`SENTRY_DSN`, `VITE_SENTRY_DSN`; [REPOT] `apps/frontend/src/shared/observability/errorReporting.ts`, `docs/release.md`) och ska finnas i Railway; att de också står i Jira RUN-281 är **inte verifierat i repot** (**[ÄGAREN BEKRÄFTAR]**). `SENTRY_AUTH_TOKEN` skapas på nytt | Hos Sentry (projekt och organisation enligt `docs/release.md`); DSN-kopia **[ÄGAREN BEKRÄFTAR]** |
| **Umami-konfigurationen** (webbplats-id, skript-URL, dashboard) | Umami ligger i en tjänst utanför repot; repot säger inte var (ingen Umami-kod hittades i `apps/` eller `packages/`, bara en kommentar om sidnamn) | Statistiken kan tappa sin konfiguration. Om Umami har en egen databas omfattas den inte av Supabase-backupen. **Antagande, inte verifierat** | **[ÄGAREN BEKRÄFTAR]**: var Umami körs (egen Railway-tjänst, Umami Cloud eller annat), vilken databas den använder, och om den har egen backup |
| **GitHub-secrets** (Actions) | Ligger hos GitHub och går inte att läsa ut igen | Bygge och deploy som behöver dem stannar tills de läggs in på nytt | GitHub (Settings → Secrets). Ägarens lösenordshanterare ska ha värdena. Namnen: kontrolleras av ägaren i dashboarden, repot listar dem inte |
| **Supabase-projektets egna inställningar** (API-nycklar, e-post-/Auth-inställningar, extensions, nätverksregler) | Ingår inte i en databasåterställning | Gäller **ett nytt projekt** (Restore to new project eller ett tomt projekt + dump): det får egen URL och egna API-nycklar enligt [SUPABASE-DOKUMENTATIONEN] (**[ÄGAREN BEKRÄFTAR]**), och inställningar som extensions, nätverksregler och Auth-konfiguration följer inte säkert med. Auth används inte av appen ([REPOT] `docs/permissions.md`) och signup ska vara stängt: kontrollera det i det nya projektet. En återställning i det befintliga projektet behåller nycklarna | Supabase-dashboarden |
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
- Backendens produktions- eller stagingmiljö pekas **aldrig** mot kopian. Kopian rörs bara på två sätt: frågorna i
  `runbook-backup-compare.sql` i det tillfälliga projektets SQL Editor, och (väg 2) `psql` mot det tillfälliga projektets
  anslutningssträng efter STOPP-kontrollerna nedan. **Dumpen körs aldrig i SQL Editor i något Supabase-projekt, och aldrig mot prod
  eller staging.**
- **STOPP-kontrollerna är blockerande.** Ger en kontroll ett avvikande svar: gå inte vidare, skriv i loggen vad som hände och fråga Lead.
- Kopian innehåller riktig användardata, lösenordshashar och (i en äldre backup) Strava-tokens i klartext som är **giltiga hos Strava
  tills de roteras** (ADR 013, `--refresh-tokens`). Radera därför projektet (Städning) samma dag som kontrollen är klar, och låt ingenting
  använda dessa tokens. Raderingen är det enda raderingssteget i övningen och gäller det tillfälliga projektet, aldrig prod.

### Förberedelse (ca 10 minuter)

1. Öppna loggen i avsnitt 8 och skriv starttid.
2. Prod: Dashboard → projekt `yrrqaxdngayakcivfrck` → Database → Backups. Anteckna tidpunkten för den **senaste dagliga backupen**
   och vilka dagar som listas (bekräftar retentionen, avsnitt 9).
3. Kör BLOCK A i [`docs/runbook-backup-compare.sql`](runbook-backup-compare.sql) i **prod** (SQL Editor) och skriv av resultatet i
   loggen, kolumnen "prod före"; kör också BLOCK C (databasens storlek) och skriv av den. Köra filen i SQL Editor rekommenderas.
   Garantin att filen inte skriver är att den **bara innehåller SELECT** med vitlistade funktioner: vakten
   `scripts/runbook-backup-sql.test.mjs` fäller CI om något annat hamnar där. `begin read only` och `rollback` runt blocken är ett extra
   lager som bara gäller om klienten inte redan öppnat en egen transaktion.

### Väg 1: "Restore to new project" (föredragen, om knappen finns)

V1.1. På prodprojektets Backups-sida: välj den senaste backupen → **Restore to new project**. Dialogen ska ha ett fält för ett *nytt*
projektnamn: saknas det är det inte den här funktionen (det kan vara en återställning över prod) och du avbryter. Välj namn
`runquest-restore-test`, organisation och region. **Läs kostnaden i dialogen och bekräfta den först då** (**[ÄGAREN BEKRÄFTAR]**
kostnaden; ett extra projekt är billigast om det raderas direkt efter övningen). Gratis-organisationen (staging) kan ha en gräns på
aktiva projekt ([SUPABASE-DOKUMENTATIONEN], **[ÄGAREN BEKRÄFTAR]**); pausa inget annat projekt för det här (det är ett eget ägarbeslut).

V1.2. Skriv starttid för återställningen i loggen. När projektet är friskt: öppna det och skriv upp dess **namn och ref** (refen står i
dashboardens adress `…/dashboard/project/<ref>` och under Settings → General) i loggen som `TEMP_REF`. Den ska vara en annan än
`yrrqaxdngayakcivfrck` och `aormctqrmguvncxrigwy`; är den inte det: **STOPP**. Skriv sluttid.

### Väg 2: nedladdad backup (om "Restore to new project" saknas för projektet)

V2.1. Backups-sidan → senaste dagliga backupen → **Download**. Filen innehåller användardata: spara den på ägarens egen dator, inte i
OneDrive-mappen som repot ligger i, och radera den i Städning. Vad filen innehåller och hur den återställs är
[SUPABASE-DOKUMENTATIONEN] (<https://supabase.com/docs/guides/platform/backups>); **[ÄGAREN BEKRÄFTAR]** formatet innan nästa steg.

V2.2. Skapa ett tomt tillfälligt projekt `runquest-restore-test` (gratis-organisationen om en plats är ledig, annars Pro-organisationen;
kostnaden är ägarens val). Skriv upp dess **namn och ref** i loggen som `TEMP_REF` (som i V1.2).

V2.3. **STOPP-kontroll 1: anslutningssträngen.** Hämta det tillfälliga projektets anslutningssträng (Dashboard → Connect) och lägg den i
en variabel i *ditt eget skal* utan att den hamnar i historiken eller chatten (`read -rs TEMP_DB_URL`, klistra, Enter). Kör sedan
raden nedan. Den ska skriva `ok`; skriver den `STOPP`, gå inte vidare:

```bash
TEMP_REF=<ref från loggen>
case "$TEMP_DB_URL" in
  *yrrqaxdngayakcivfrck*|*aormctqrmguvncxrigwy*) echo "STOPP: strängen pekar på prod eller staging" ;;
  *"$TEMP_REF"*) echo "ok: strängen innehåller det tillfälliga projektets ref" ;;
  *) echo "STOPP: strängen innehåller inte det tillfälliga projektets ref" ;;
esac
```

V2.4. **STOPP-kontroll 2: projektet är tomt.** Kör `psql "$TEMP_DB_URL" -c "select count(*) from public.users"`. Svaret ska vara `0`
eller felet `relation "public.users" does not exist`. Är det större än 0 är det inte ett tomt tillfälligt projekt: **STOPP**.

V2.5. **Återställ**, först efter att V2.3 och V2.4 gått igenom, med en enda transaktion så att ett fel inte lämnar ett halvfärdigt
projekt (Lead går igenom exakt kommando i chatten utan att se strängen; formen är):

```bash
gunzip -c <nedladdad-fil>.gz | psql "$TEMP_DB_URL" --single-transaction -v ON_ERROR_STOP=1
```

Med `ON_ERROR_STOP` avbryts allt vid första felet. Ger dumpen fel på roller eller objekt som ett nytt Supabase-projekt redan har
(väntat enligt [SUPABASE-DOKUMENTATIONEN]), stannar återställningen: skriv felet i loggen och be Lead om ett alternativ (till exempel
att ta bort `--single-transaction`/`ON_ERROR_STOP` mot just det **verifierat tomma** tillfälliga projektet). Målet kan inte bytas ut mot
något annat än den kontrollerade variabeln. **Dumpen körs aldrig i en SQL Editor.**

### Kontrollera (gäller båda vägarna)

4. Kör BLOCK A i det **tillfälliga projektet** (SQL Editor) och skriv av resultatet i loggen, kolumnen "kopia".
5. Kör BLOCK B i **prod** med backupens tidpunkt ifylld och skriv av kolumnen `forvantat_i_kopian`.
6. Bedöm varje tabell i en av tre klasser och skriv klassen i loggen:
   - **Lika**: kopians antal (steg 4) är lika med `forvantat_i_kopian` (steg 5). Förväntat för users, runs, events, event_entries,
     strava_tokens (bara antal) och activity_log.
   - **Förklarad avvikelse**: kopian har **fler** rader än `forvantat_i_kopian`. Det förklaras av rader som raderats i prod efter
     backupen (de finns kvar i kopian), till exempel en borttagen löpning eller användare. **`user_titles` förväntas avvika**: titlar
     tilldelas och återkallas hela tiden och en återtagen titel får ett nytt `earned_at`, så `forvantat_i_kopian` är där bara en grov
     indikator, inte ett facit. Skriv ändå upp skillnaden.
   - **Fynd**: kopian har **färre** rader än `forvantat_i_kopian`, eller migrationsantalet/senaste versionen skiljer sig, eller en
     tabell saknas. Data som borde finnas saknas: skriv upp tabell och skillnad, öppna ett Jira-ärende, och resultatet är
     "lyckades med anmärkning" eller "misslyckades".
   - `storage.objects (profile-pictures)` har rader i kopian, men **filerna** finns inte nödvändigtvis: öppna en profilbilds-URL från
     kopian om du vill se det. Det är gapet från avsnitt 3.
   - "Senaste" per tabell i kopian ligger inte senare än backupens tidpunkt.
7. **Raderad persondata kan ha kommit tillbaka.** Kopian innehåller även det som raderats i prod efter backupen: bortkopplade eller
   raderade användare, Strava-raderingar som kom via webhook (`strava_webhook_events`, ADR 010), borttagna löpningar. Skriv i loggen vilka
   sådana raderingar som skett sedan backupens tidpunkt (så långt prods händelselogg och ägarens minne räcker). I övningen raderas kopian i
   Städning och ingenting mer behövs. I en **verklig** återställning (avsnitt 7) ska exakt de raderingarna göras om i den återställda
   databasen *innan* appen tas i bruk, med ägarens ja för omfattningen, och loggas.
8. Skriv sluttid för hela övningen (för RTO) och resultatet: **lyckades / lyckades med anmärkning / misslyckades**.

### Städning

9. **STOPP-kontroll 3: rätt projekt raderas.** Öppna det tillfälliga projektet och gå till Settings → General. **Projektnamnet ska vara
   `runquest-restore-test` och refen ska vara exakt `TEMP_REF` ur loggen.** Är refen `yrrqaxdngayakcivfrck` eller `aormctqrmguvncxrigwy`,
   eller avviker namn eller ref från loggen: **STOPP, radera inget.** Först när båda stämmer: Delete project, och skriv projektnamnet
   som dialogen ber om (det ska vara `runquest-restore-test`; ber dialogen om ett annat namn är det fel projekt). Detta är det enda
   raderingssteget i övningen.
10. Radera den nedladdade filen om väg 2 användes, och rensa `TEMP_DB_URL` ur skalet (`unset TEMP_DB_URL`). Bekräfta i organisationens
    Billing-vy att inget extra projekt ligger kvar. Skriv i loggen att det är gjort och när (kopian ska inte ha funnits längre än samma dag).

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

Databasens storlek är **inte kontrollerad**. Gruppen är liten (ADR 013 räknar med högst sex Strava-kopplade användare), vilket talar för
en liten databas och en återställning på minuter, men det är ett antagande: mät storleken med BLOCK C i `runbook-backup-compare.sql`
(`pg_database_size`) och skriv den i loggen. Det som tar tid är därtill människorna och bytet av projekt. Antagen total tid för en verklig incident, **inte uppmätt**:

| Moment | Antagen tid | Mäts i övningen? |
|---|---|---|
| Beslut och ägar-ja | Beror på ägarens tillgänglighet | Nej |
| Återställning till nytt projekt (Väg 1) eller i befintligt projekt | Minuter till någon timme [SUPABASE-DOKUMENTATIONEN: tiden beror på databasens storlek] | **Ja** (V1.2 resp. V2.5, loggen) |
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
4. **Gör om raderingar.** Den återställda databasen kan innehålla persondata som raderats efter backupens tidpunkt (bortkopplade eller
   raderade användare, Strava-raderingar via webhook, borttagna löpningar). Ta fram vad som raderats sedan backupen (prods händelselogg,
   Stravas webhook-händelser och ägarens egen anteckning) och radera det igen **innan** appen tas i bruk; ägarens ja för exakt omfattning,
   och logga vad som gjordes. Är backupen äldre än ADR 013-krypteringen innehåller `strava_tokens` klartext som är giltig hos Strava tills
   den roteras: kör rotationen (`--refresh-tokens`, ADR 013, ägar-ja) och radera alla kopior av den gamla databasen så fort de inte behövs.
5. Efter en återställning till en äldre tidpunkt: Strava-webhook-prenumerationen och `STRAVA_WEBHOOK_SUBSCRIPTION_ID` ligger kvar hos
   Strava och i Railway (`strava:webhook view` bekräftar). Kör en synk och vänta på nattens avstämning.
6. Säg det till gruppen: de har förlorat tiden mellan backupen och incidenten, och bilder kan saknas.

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
| `TEMP_REF` och namn på det tillfälliga projektet | |
| STOPP-kontroll 1 och 2 (väg 2): ok / STOPP | |
| Databasens storlek i prod (BLOCK C) | |
| Raderingar i prod sedan backupen (steg 7) | |
| STOPP-kontroll 3 före radering: namn och ref stämde | |
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

| Tabell | Prod före övningen | Förväntat i kopian (BLOCK B) | Kopia (BLOCK A) | Klass (Lika / Förklarad avvikelse / Fynd) |
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
