# Runbook: tokennyckeln (`TOKEN_ENCRYPTION_KEY`)

Intern förvaltningsdokumentation (svenska, för ägaren och Lead). Beslutet och hotbilden står i
[`docs/adr/013-strava-tokenkryptering.md`](adr/013-strava-tokenkryptering.md); det här är handboken för nyckeln i drift: skapa,
sätta, rotera, förlora, läcka. Releasekedjan står i [`docs/release.md`](release.md), backup av data i
[`docs/runbook-backup.md`](runbook-backup.md).

## Vem gör vad

- **Ägaren** skapar nyckeln, sparar kopian i sin lösenordshanterare och sätter variabeln i Railway-UI:t. En Railway-variabel är en
  `ask`-åtgärd (`docs/permissions.md`): ingen agent sätter eller ändrar den.
- **Nyckelns värde visas aldrig i chatten**, i kod, i en commit, i ett Jira-ärende eller i en logg. Systemet loggar bara nyckel-id
  (`prod-1`), aldrig nyckelmaterial. Skicka aldrig värdet till Lead eller en agent, inte ens för att "kolla att det stämmer": kolla i
  stället hälsoblocket (avsnitt 4), som visar nyckel-id och antal rader.
- **Lead och agenterna** läser hälsoblocket och loggraderna. **Backfillskriptet kör ägaren** (eller Lead på ägarens uttryckliga ja), i en
  egen terminal med `railway run`, som ger skriptet tjänstens miljö utan att nyckeln passerar chatten (avsnitt 5). Ingen agent kör det
  mot prod eller staging, inte ens som dry-run, och rapporten klistras in i chatten först när ägaren sett att den bara har antal,
  användar-id, nyckel-id och felkoder (den har aldrig annat).

## 1. Vad nyckeln är

| Variabel | Innehåll | Obligatorisk |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | Aktiva nyckeln: `<kid>:<base64 av 32 byte>`. Används för all kryptering och dekryptering. | Ja, annars är Strava-synken avstängd |
| `TOKEN_ENCRYPTION_KEYS_RETIRED` | Pensionerade nycklar, bara för dekryptering: `<kid>:<base64>[,<kid>:<base64>]`. | Nej, bara under rotation |

- **`kid`** (nyckel-id) matchar `^[a-z0-9][a-z0-9-]{0,15}$` och har miljöprefix: **`prod-1`, `prod-2`, … i produktion och `stg-1` i staging.**
  Backend i `NODE_ENV=production` godtar bara `prod-` (eller `stg-` när `SENTRY_ENVIRONMENT=staging`, vilket staging redan har, se
  [`docs/staging.md`](staging.md)). Det gäller även pensionerade nycklar. Den öppna testnyckeln (`test-1`, bara i testerna) och en nyckel
  från fel miljö avvisas alltså, med larm.
- Samma `kid` får inte stå två gånger, och ett `kid` ska aldrig återanvändas för ett nytt nyckelvärde.
- Värdet skrivs utan citattecken. Inledande och avslutande blanksteg och radbrytning trimmas bort.
- **Fail-closed.** Saknas nyckeln eller är den ogiltig läser och skriver backend inga Strava-tokens alls, och anropar inte Strava.
  Resten av appen (inloggning, rundor, XP, tävlingar) fungerar som vanligt. Webhook-händelser väntar och försöker igen i 48 timmar.

## 2. Skapa en nyckel (ägaren, lokalt)

Kör i en egen terminal på den egna datorn, inte i en delad session:

```
node -e "console.log('prod-1:' + require('crypto').randomBytes(32).toString('base64'))"
```

Raden som skrivs ut är hela värdet (`prod-1:` följt av 44 tecken base64). För staging: byt `prod-1` mot `stg-1` och skapa ett **eget**
värde; staging och prod delar aldrig nyckel (ADR 013 beslut 12). Hela raden kopieras direkt till lösenordshanteraren (avsnitt 3) och
Railway (avsnitt 4). Rensa terminalens historik och scrollback efteråt. Klistra aldrig in värdet i en chatt eller ett ärende.

## 3. Spara en kopia i lösenordshanteraren (före Railway)

Posten heter t.ex. "RunQuest prod TOKEN_ENCRYPTION_KEY" och innehåller hela värdet inklusive `kid`. Spara den **innan** variabeln sätts:
en nyckel som bara finns i Railway är borta om projektet försvinner (avsnitt 7). Vid rotation sparas även den gamla nyckeln kvar
tills den pensionerade nyckeln är borttagen och verifierad (avsnitt 5).

## 4. Sätta nyckeln i Railway (ägaren) och kontrollera

**Ordning vid release: nyckeln ska vara satt i Railway FÖRE deployen av S1–S4 (ADR 013), som en enhet.** Koden som krypterar (S1–S2),
larmet och hälsoblocket (S3) och backfillskriptet (S4) deployas tillsammans. Deployas de utan nyckel startar appen men Strava-synken står
still (KRITISKT-larm vid start, webhook-händelser väntar i högst 48 timmar), och en användare som kopplar bort under tiden får ingen
återkallelse hos Strava (avsnitt 8). Backfill `--apply` körs först när hälsoblocket visar `configured: true` och några dygn utan
`token_unreadable`.

1. Railway → projektet → tjänsten `runQuest-backend` (staging: `runquest-backend-staging`) → Variables → `TOKEN_ENCRYPTION_KEY` →
   klistra in värdet → Deploy. Ändringen av en Railway-variabel är `ask`.
2. Backend kontrollerar nyckeln när den startar. I loggen (Railway) står en av två saker:
   - Bra: `🔐 Strava token encryption on: active key prod-1, 0 retired key(s)`.
   - Fel: en rad som börjar `🚨 KRITISKT: Strava-tokenkryptering` (saknar nyckel, ogiltig nyckelkonfiguration, eller nyckel-id som
     miljön inte godtar). Den blir en `fatal`-händelse i Sentry med taggarna `alert:critical` och `source:token_key`. Strava-synken är
     avstängd tills det är rättat; resten av appen går.
3. Hälsoendpointen (admin): `GET /api/strava/webhook/health` har ett block `token_encryption`:

| Fält | Betyder |
|---|---|
| `configured` | Nyckeln är giltig och godtagen i den här miljön. Ska vara `true`. |
| `config_error` | `null`, eller `key_missing`, `key_invalid`, `kid_not_allowed` när `configured` är `false`. |
| `active_kid` / `retired_kids` | Nyckel-id (aldrig nyckelmaterial). `active_kid` är `null` om ingen nyckel kunde läsas. |
| `encrypted_rows` | Rader där alla lagrade tokenkolumner är `enc:v1`-värden. |
| `plaintext_rows` | Rader med klartext (legacy) kvar. Ska vara 0 när backfillen körts. |
| `unrecognised_rows` | Rader med ett värde av okänd form eller en trasig `enc:`-sträng. Ska vara 0. |
| `rows_on_other_kid` | Krypterade rader på ett annat nyckel-id än det aktiva (pensionerad nyckel, eller en som saknas). `null` utan nyckel. Ska vara 0 efter en rotation. |
| `unreadable_since_start` | Antal token-läsningar sedan processen startade som slutade i `token_unreadable`. Ska vara 0; ett tal som växer betyder att något är fel. |

   Blocket räknar bara; det dekrypterar inget. Att en rad står som krypterad bevisar därför inte att den går att öppna. Det bevisar en
   lyckad synk, och `unreadable_since_start` som står still.
4. Rök efter första satta nyckeln: `configured: true`, en manuell synk lyckas, `unreadable_since_start: 0`.

## 5. Planerad rotation (aktiv nyckel byts, ingen driftstopp)

Görs enligt ADR 013 beslut 3. Varje steg som ändrar Railway är `ask`.

1. Skapa en ny nyckel med nästa nyckel-id (`prod-2`) enligt avsnitt 2 och spara den i lösenordshanteraren. Behåll den gamla posten.
2. I Railway: `TOKEN_ENCRYPTION_KEYS_RETIRED` = den gamla nyckeln (`prod-1:<värde>`), `TOKEN_ENCRYPTION_KEY` = den nya (`prod-2:<värde>`).
   Deploy. Båda ändras i samma deploy. Ändras bara den aktiva går de gamla raderna inte att läsa.
3. Kontrollera hälsoblocket: `active_kid: prod-2`, `retired_kids: ["prod-1"]`, `configured: true`. Allt nytt skrivs nu med `prod-2`, och varje
   tokenförnyelse (minst var sjätte timme per aktiv användare) omkrypterar sin rad. `rows_on_other_kid` sjunker av sig själv för aktiva.
4. Omkryptera resten med backfillskriptet (ADR 013 beslut 7, S4): dry-run först, ägaren ser rapporten, sedan `--apply` (`ask`), alltid via
   `railway run` så nyckeln inte passerar chatten. Exakta kommandon i avsnitt 5a. Skriptet flyttar rader från en pensionerad nyckel till
   den aktiva på samma sätt som klartext till krypterat.
5. När `rows_on_other_kid` är 0 (och backfillens dry-run visar noll rader på det gamla nyckel-id:t): ta bort `TOKEN_ENCRYPTION_KEYS_RETIRED`
   i Railway, deploya, och kontrollera `retired_kids: []`, `unreadable_since_start: 0` och att en manuell synk lyckas.
6. Behåll den gamla nyckeln i lösenordshanteraren, märkt "pensionerad", tills en rad i en gammal databasbackup inte längre behöver
   öppnas (backuper kan innehålla värden på det gamla nyckel-id:t); radera den sedan.

## 5a. Backfill: kryptera befintliga rader (utrullning, rotation, nödutgång)

Skriptet `apps/backend/src/scripts/backfillStravaTokenEncryption.ts` (ADR 013 beslut 7, npm-skript `backfill:strava-token-encryption`) flyttar
varje rad i `strava_tokens` till den aktiva nyckeln: klartext (legacy) blir `enc:v1`, och en rad på en pensionerad nyckel omkrypteras till
den aktiva. **Ägaren kör det, i en egen terminal.** Varje kommando nedan körs via `railway run`, som ger skriptet tjänstens miljö (nyckeln
och databasen) utan att något värde passerar chatten eller skrivs till disk. Basen är densamma i alla kommandon:

```
railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend --
```

(Staging: `--service runquest-backend-staging`, med stagings egen nyckel; staging har inga riktiga Strava-kopplingar, så `--refresh-tokens`
hör inte hemma där.) Flaggorna skrivs efter det sista `--`. Skriptet skriver ut **måldatabasens host** på rad två: kontrollera att det är
rätt databas innan du fortsätter.

**Ordning (ADR 013 beslut 13), fast:** nyckeln i Railway → deploy av S1–S4 → hälsoblocket visar `configured: true` och några dygn utan
`token_unreadable` → dry-run → ägaren läser rapporten → `--apply` → verifiering → (migrationen med CHECK-constraint, S7).

1. **Dry-run (skriver ingenting, anropar inte Strava).** Ingen flagga:

   ```
   railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend --
   ```

   Rapporten har host, aktivt och pensionerade nyckel-id, antal rader per klass (`empty`, krypterade på aktiv nyckel, krypterade på annan
   nyckel, `legacy plaintext`, `unrecognised`), en rad per användare (`user_id`, form per kolumn, vad `--apply` skulle göra) och en
   sammanfattning med felkoder. **Aldrig** token, chiffertext eller nyckel. Dry-run bevisar i minnet att varje rad som ska skrivas går att
   kryptera och läsa tillbaka, och att nyckeln är giltig (annars stoppar den direkt med skälet). Utgångskod 1 betyder att något är fel
   (en rad som inte går att läsa, tom tabell = troligen fel databas); en dry-run som bara hittar klartext att kryptera är 0.
   Läs särskilt: `unrecognised` och felkoderna ska vara 0 före `--apply`. `auth_failed`, `unknown_key_id` och `unrecognised` betyder en rad som
   skriptet inte rör och som behöver ägarens blick (avsnitt 7 och 9).

2. **`--apply` (`ask`, ägarens ja med dry-run-rapporten som underlag):**

   ```
   railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend -- --apply
   ```

   Per rad: kryptera, bevisa i minnet, skriv med villkor på **båda** lagrade strängar (en tokenförnyelse som hann emellan skrivs aldrig över;
   raden visas som `CONFLICT` och tas vid omkörning), läs tillbaka och öppna. Raden räknas som klar först då. Ett fel på en rad stoppar
   inte de andra. Ctrl-C avslutar raden i händerna och stoppar; omkörning tar resten (skriptet är idempotent, en rad på aktiv nyckel
   skrivs inte). **Tryck bara Ctrl-C en gång.** Ett andra Ctrl-C dödar processen direkt; sker det mitt i en förnyelse (efter att Strava
   svarat, före att den nya token sparats) kan användarens token vara ersatt hos Strava utan att vi har den nya, och användaren måste
   koppla om. En enskild rads skrivning är atomär och en avbruten `--apply` är därför alltid säker att köra om. Efter körningen läser skriptet om tabellen och skriver `After: ...` och `Plaintext rows left: N`. Sista raden är
   `Done: every token row is encrypted under key <kid>` när allt är rent, annars `Not done: ...` och utgångskod 1: kör om tills det står
   `Done`. En rad märkt `replaced by a newer save` är inget fel (en förnyelse sparade nya tokens strax efter skrivningen).

3. **`--refresh-tokens` (valfri, Ö4; roterar användarnas tokens hos Strava, `ask`).** Görs i samma körning som `--apply`, efter krypteringen:

   ```
   railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend -- --apply --refresh-tokens
   ```

   Ett anrop till Stravas token-endpoint per kopplad användare (sex i dag), genom samma tokenväg som övrig Strava-kod. De nya tokens sparas
   krypterade, och de gamla (i äldre databasbackuper och Postgres-historik) blir värdelösa hos Strava. Används vid misstänkt läcka (avsnitt 6)
   och när klartexten funnits i en backup som ska göras ofarlig. `STRAVA_CLIENT_ID` och `STRAVA_CLIENT_SECRET` måste finnas i tjänstens
   miljö. Utan `--apply` anropas ingen Strava: dry-run skriver bara ut hur många anrop som skulle göras.

   **Ratebudgeten är delad i kodvägen, inte mellan processer.** Skriptet frågar samma budget som resten av backend (`isOverSoftLimit()` före
   varje anrop; en 429 stoppar det), men budgeten är minne i den process som kör: skriptet är en egen process och ser inte hur mycket den
   körande servern har använt, och servern ser inte skriptets anrop. Sex anrop är försumbart mot gränsen; kör ändå inte `--refresh-tokens`
   mitt i en tung synk eller en bakgrundskörning, och kör om senare om skriptet säger att budgeten är slut (det listar vilka som återstår).

   Utfall per användare i rapporten:
   - `refresh_rejected`: Strava avvisade refresh-token. Det kan betyda att användaren återkallat behörigheten (då måste de koppla om), men
     också att backendens egen förnyelse (webhook-worker, reservpolling, användarens synk) hann förnya samma token strax före skriptet.
     **Kör om innan du drar slutsatsen att användaren återkallat**: ger omkörningen `refresh_rejected` igen är det på riktigt.
     (Förnyelsevägen kontrollerar att raden fortfarande håller den avvisade token innan den räknar det som en avvisning, men en förnyelse
     i samma ögonblick kan ändå ge ett falskt utslag.) Krockar skriptets omkryptering med en pågående förnyelse i backend följer
     backenden raden till dess nya sträng och sparar de nya tokens där; lyckas inte det loggas `🚨 KRITISKT` och användaren kan behöva
     koppla om.
   - `refresh_failed`: Strava eller nätverket svarade inte som väntat. **Det är inte alltid "kör om".** Svarade Strava med ett fel (5xx, 429)
     har inget ersatts hos Strava och det är säkert att köra om. Men har Strava kanske redan ersatt refresh-token utan att vi fick eller kunde
     spara den nya (svaret förlorades, var oanvändbart, eller sparandet misslyckades) skriver skriptet `STRAVA MAY HAVE REPLACED THIS USER'S
     REFRESH TOKEN WITHOUT IT BEING SAVED`: den användaren har kanske tappat kopplingen och måste koppla om Strava (avsnitt 7 punkt 3).
     Leta i loggen efter `🚨 KRITISKT: kunde inte spara roterad Strava-token` för användaren (den blir en `fatal`-händelse i Sentry med
     `source:token_write`; skriptet startar Sentry om `SENTRY_DSN` finns i miljön) eller en `Token refresh`-felrad.
   - **Skriptet stannar** vid första sådana användare (samma orsak, till exempel en databas som inte tar emot skrivningar, skulle annars
     förlora nästa användares token också) och efter två misslyckade förnyelser i rad (då är det Strava eller nätverket). De som inte hann
     frågas listas under `Not asked because the run stopped early`; åtgärda orsaken och kör om.
   - `no_refresh_token`: raden har ingen refresh-token, alltså inget att förnya. Redovisas som `Nothing to renew` och är inget fel.
   - `token_unreadable`: raden går inte att läsa (avsnitt 7 och 9).
   - Rader som fick ett fel i krypteringssteget (`Not renewed because of an error in the row`) frågas inte hos Strava. Deras gamla
     refresh-token lever kvar tills raden är lagad och förnyelsen körd (avsnitt 6).

4. **Verifiera via hälsoblocket** (avsnitt 4, `GET /api/strava/webhook/health`, admin): `configured: true`, `plaintext_rows: 0`,
   `unrecognised_rows: 0`, `rows_on_other_kid: 0` (efter en rotation), `unreadable_since_start` står still. Blocket klassar efter form och
   dekrypterar inget, så bevisa också att det går att öppna: en manuell synk lyckas och en webhook-händelse bearbetas. Först då är det
   dags för migrationen (CHECK-constraint, egen `ask`) och sedan S7 (legacy-läsningen bort).

5. **Nödutgång `--decrypt`** (bara om en release måste backas till kod före S2 efter att `--apply` körts; ADR 013 beslut 13.5). Den
   **skriver klartext-tokens till databasen** och kräver därför två saker: `--apply` och den uttryckliga bekräftelsen
   `--confirm-write-plaintext`. Utan dem är `--decrypt` en dry-run:

   ```
   railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend -- --decrypt
   railway run --service runQuest-backend -- npm run backfill:strava-token-encryption --workspace=@runquest/backend -- --decrypt --apply --confirm-write-plaintext
   ```

   Samma villkorade skrivning på båda strängarna och samma tillbakaläsning som `--apply`; det skriver bara ett värde som läsaren själv
   godtar som klartext (annars `plaintext_shape` och raden lämnas), och går inte att kombinera med `--refresh-tokens`. Kör den **före**
   kod-rollbacken. Därefter innehåller databasen klartext igen (som före backfillen): kryptera om med `--apply` när releasen är på plats
   igen, och räkna klartexten som exponerad (avsnitt 6) om den legat där längre än rollbacken krävde.

**Det skriptet aldrig gör:** skriva en token, en chiffertext eller en nyckel till terminal, fil eller logg; spara en klartextkopia; radera
en rad; röra en annan kolumn än de två tokenkolumnerna (`expires_at` med flera lämnas orörda, bara `--refresh-tokens` sätter nytt
`expires_at`, via den vanliga tokenvägen); skriva en rad som hålls av en annan skrivare än den det läste.

## 6. Läckt nyckel (eller misstanke om det)

Gör i den här ordningen. Nyckeln ensam räcker inte för en angripare (chiffertexten ligger i Supabase, nyckeln i Railway), men en läckt
nyckel tillsammans med en läckt databas, dump eller backup ger tokens i klartext. Räkna därför som värsta fall att båda är nådda.

1. **Rotera nyckeln direkt** enligt avsnitt 5 (nytt `prod-N`, den läckta som pensionerad, backfill `--apply`). Ta bort den läckta
   pensionerade nyckeln så snart `rows_on_other_kid` är 0.
2. **Gör de gamla tokens värdelösa**: kör backfillen med `--apply --refresh-tokens` (avsnitt 5a; ADR 013 beslut 7 och Ö4). Strava ger då
   nya tokens och den gamla refresh-token slutar gälla, så en läckt nyckel plus gammal chiffertext ger bara döda tokens. Räcker inte
   Stravas gräns (skriptet stannar och säger vilka som återstår) körs det om senare; alternativet är att de anslutna användarna kopplar
   bort och kopplar om Strava, vilket också ger nya tokens. **Läs slutet av rapporten:** en rad som fick ett fel i krypteringssteget
   (`Not renewed because of an error in the row`, till exempel en oläsbar eller flyttad chiffertext) frågas inte hos Strava, så **den
   användarens gamla refresh-token lever kvar** och är inte gjord värdelös. Lägg dem på att lagas (avsnitt 7) eller be dem koppla om
   Strava; en användare som inte får en ny token är fortfarande exponerad. Det gäller också de som skriptet inte hann fråga innan det
   stoppade (`Not asked because the run stopped early`) och de som budgeten stoppade.
3. **Anmäl till Strava inom 24 timmar** om en API-token kan ha nåtts. Värsta-fallsantagandet ovan gäller här: så länge det inte är
   uteslutet att databasen, en dump eller en backup också har nåtts räknas det som att Stravas tokens kan ha nåtts, och anmälan görs. Den
   kan bara utebli när det är visat att ingen kopia av chiffertexten har lämnat Supabase och Railway. Avtalet säger "snarast"; vänta därför inte på
   att utredningen är klar. Enligt ADR 013 (Ö6, Stravas API Agreement §1.2) ska misstänkt
   obehörig åtkomst till en API-token anmälas till developers@strava.com snarast och senast inom 24 timmar. Runbooken har inte avtalets
   egen lydelse; kontrollera §1.2 i avtalet. E-postmeddelandet skickas av ägaren (extern kommunikation är `ask`) och innehåller vad som
   hände, när det upptäcktes, vilka användare som kan vara berörda (antal, inga id eller tokens) och vad som gjorts. Aldrig nyckel,
   token eller chiffertext i meddelandet.
4. Rotera även de andra hemligheterna som kan ha legat på samma ställe som den läckta (Railway-variabler, `JWT_SECRET`, Supabase-nycklar),
   enligt vad läckan visar, och för in händelsen i `STATE.md`/incidentlistan.
5. Läckan i Sentry eller en logg: scrub-reglerna (`apps/backend/src/observability/scrub.ts`) tar bort nyckelmaterial och krypterade värden
   ur händelser; hittas ändå ett värde i en logg är det en läcka enligt punkt 1.

## 7. Nyckelförlust (nyckeln finns varken i Railway eller i lösenordshanteraren)

Konsekvens (ADR 013 beslut 3, Ö2): **alla anslutna användare måste koppla om Strava.** Inget annat går förlorat: rundor, XP, titlar,
badges och samtycke ligger kvar. Hälsoblocket visar `rows_on_other_kid` eller `unrecognised_rows` > 0 och `unreadable_since_start` som växer.

1. Titta först efter en kopia: lösenordshanteraren, ägarens andra enheter, en äldre Railway-deploy (Railway kan ha variabelhistorik, vilket
   inte är bekräftat, `docs/runbook-backup.md` avsnitt 9). Hittas en kopia: sätt tillbaka den, klart.
2. Annars: skapa en ny nyckel med ett **nytt** nyckel-id (`prod-2`, aldrig `prod-1` igen), spara den i lösenordshanteraren och sätt den i
   Railway (avsnitt 2 till 4). Ingen pensionerad nyckel; den gamla finns inte.
3. De gamla raderna får `unknown_key_id` och kan inte läsas. Appen fortsätter, och de berörda användarna kopplar om Strava i
   Settings; OAuth-callbacken skriver nya krypterade tokens över den gamla raden. Berätta för användarna (högst sex i dag).
4. En användare som aldrig kopplar om står kvar med en oläsbar rad. Radering av den raden är en radering av persondata och kräver ägarens
   ja med exakt omfattning. Webhook-händelser för en sådan användare får retry i 48 timmar och larmar sedan (`dead`); det är väntat tills
   användaren kopplat om eller raden är borttagen.

## 8. Om en användare kopplar bort Strava medan tokenet är oläsbart

Vid "Koppla bort" återkallar backend först behörigheten hos Strava (`/oauth/deauthorize` med användarens access-token). Återkallelsen är
tolerant (ADR 010 7.4.2): misslyckas den, tas kopplingen bort ändå, eftersom användaren valt det. Går tokenet inte att
läsa (nyckel saknas, fel nyckel, skadad rad) går återkallelsen inte att göra och Strava anropas inte. Kopplingen tas ändå bort hos oss
(rundorna och token-raden raderas, det är det användaren bad om; det loggas som en varning med koden `strava_token_unreadable`). Användaren
får inget fel.

**Konsekvens: RunQuest står kvar som godkänd app i användarens Strava-konto**, och Strava kan fortsätta skicka händelser för användaren
(de kastas hos oss som "okänd ägare"). **Rekommendation:** be användaren återkalla behörigheten själv hos Strava (strava.com → Settings → My
Apps → RunQuest → Revoke Access), eller laga nyckeln och be användaren koppla om och sedan koppla bort igen. **Var nyckeln trasig under en
period ska ägaren gå igenom loggen för den perioden efter varningsraden nedan och be varje berörd användare återkalla manuellt hos Strava.** Ägaren kan se fallen i loggen:
raden `Strava disconnect: the revoke at Strava failed for user <id> (strava_token_unreadable), carrying on`.

## 9. Felsökning i korthet

| Syns | Orsak | Gör |
|---|---|---|
| `🚨 KRITISKT: Strava-tokenkryptering saknar nyckel` | `TOKEN_ENCRYPTION_KEY` är inte satt i den här miljön | Avsnitt 4 |
| `... ogiltig nyckelkonfiguration` | Fel format, fel längd (inte 32 byte), samma `kid` två gånger, eller värdet har klistrats in med citattecken eller radbrytning mitt i | Skapa värdet på nytt (avsnitt 2); jämför inte med chatten |
| `... godtar inte nyckel-id test-1 i den här miljön` | Testnyckeln eller en nyckel från fel miljö (`stg-` i prod, `prod-` i staging) | Sätt miljöns egen nyckel; i staging ska `SENTRY_ENVIRONMENT=staging` vara satt |
| `❌ Strava sync skipped: the token key is not usable` | Samma problem, nu som påminnelse vid varje schemalagd synk (högst ett larm per körning) | Åtgärda enligt larmet vid start |
| `unreadable_since_start` växer men `configured` är `true` | En enskild rad går inte att öppna (flyttad, skadad, fel nyckel under samma `kid`) | Loggen har `user_id`, kolumn och orsakskod (`Strava token unreadable for user ...`): ett fel (Sentry-händelse) första gången per orsakskod och process, därefter en varning i loggen. Räknaren i hälsoblocket ser alla. En rad på fel nyckel hanteras som avsnitt 7 |
| `plaintext_rows` > 0 efter backfill | En förnyelse hann emellan (`CONFLICT` i rapporten) eller en användare anslöt under körningen | Kör backfillen igen (idempotent, avsnitt 5a) |
| Backfillen slutar med `Not done` och felkod `auth_failed`, `unknown_key_id` eller `unrecognised` | Raden går inte att öppna (flyttad, skadad, nyckel som saknas) och lämnas orörd | Avsnitt 7 för en förlorad nyckel; annars hör raden till en användare som får koppla om Strava |
