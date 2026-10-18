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
- **Lead och agenterna** läser hälsoblocket och loggraderna och kör backfillskriptet med `railway run`, som ger skriptet tjänstens
  miljö utan att nyckeln passerar chatten. Skriptet bygger i ADR 013 S4; kommandona nedan som hör till det bekräftas när det finns.

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
   `railway run` så nyckeln inte passerar chatten. Skriptets exakta kommando bekräftas när S4 är byggt.
5. När `rows_on_other_kid` är 0 (och backfillens dry-run visar noll rader på det gamla nyckel-id:t): ta bort `TOKEN_ENCRYPTION_KEYS_RETIRED`
   i Railway, deploya, och kontrollera `retired_kids: []`, `unreadable_since_start: 0` och att en manuell synk lyckas.
6. Behåll den gamla nyckeln i lösenordshanteraren, märkt "pensionerad", tills en rad i en gammal databasbackup inte längre behöver
   öppnas (backuper kan innehålla värden på det gamla nyckel-id:t); radera den sedan.

## 6. Läckt nyckel (eller misstanke om det)

Gör i den här ordningen. Nyckeln ensam räcker inte för en angripare (chiffertexten ligger i Supabase, nyckeln i Railway), men en läckt
nyckel tillsammans med en läckt databas, dump eller backup ger tokens i klartext. Räkna därför som värsta fall att båda är nådda.

1. **Rotera nyckeln direkt** enligt avsnitt 5 (nytt `prod-N`, den läckta som pensionerad, backfill `--apply`). Ta bort den läckta
   pensionerade nyckeln så snart `rows_on_other_kid` är 0.
2. **Gör de gamla tokens värdelösa**: kör backfillen med `--refresh-tokens` (ADR 013 beslut 7 och Ö4). Strava ger då nya tokens och
   den gamla refresh-token slutar gälla, så en läckt nyckel plus gammal chiffertext ger bara döda tokens. Tills S4 är byggt: be de
   anslutna användarna koppla bort och koppla om Strava, vilket också ger nya tokens.
3. **Anmäl till Strava inom 24 timmar** om en API-token kan ha nåtts. Enligt ADR 013 (Ö6, Stravas API Agreement §1.2) ska misstänkt
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
| `plaintext_rows` > 0 efter backfill | En förnyelse hann emellan eller en användare anslöt under körningen | Kör backfillen igen (idempotent) |
