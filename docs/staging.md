# Staging — bygga om databasen från noll

Intern förvaltningsdokumentation (svenska, för Lead). Stagingmiljön och hur previewn går mot den står i
[`docs/release.md`](release.md) ("Preview på staging"). Det här dokumentet är det som behövs för att bygga om
stagingdatabasen: fyra skript, i ordning, alla säkra att köra om. Ett femte skript, `create:group` (avsnitt 5), skapar en andra
låtsasgrupp och följer egna regler.

Staging-databasen är Supabase-projektet `aormctqrmguvncxrigwy`. Produktionen är `yrrqaxdngayakcivfrck` och skrivs aldrig av de fyra
staging-skripten: de skriver bara till staging, och prod läses bara av `staging:seed-reference` och `staging:schema-diff`, och bara
med `--read-prod`. **Undantaget är `create:group`**: det går mot den databas som `SUPABASE_URL` pekar på och kan skriva till prod med
`--allow-prod` plus en bekräftelsesträng (avsnitt 5).

## Säkerhetsreglerna (samma i de fyra staging-skripten; `create:group` har egna, i avsnitt 5)

- Målprojektet är hårdkodat till staging-ref. Skripten vägrar köra mot prod-ref, och en klient för något annat projekt än
  staging går inte att bygga (`apps/backend/src/scripts/staging/stagingTarget.ts`).
- **Dry-run är standard** för allt som skriver. `--apply` skriver. Dry-run skriver varken rader eller filer.
- **Prod läses i tre lager, och bara med `--read-prod`:**
  1. En exakt tillåtelselista: prod-läsaren skickar bara satser som skriptet byggt själv av sina konstanter (ett fast
     `SELECT` per konfigurationstabell, och katalogfrågorna för schemajämförelsen). Allt annat nekas innan ett anrop görs.
     Det är det här lagret som håller.
  2. Ett lexikalt filter (`assertReadOnlySql`): en sats, bara `SELECT`, inga skriv- eller adminord. Det är ett extra lager,
     inte en parser, och kan luras av ovanlig citering; därför är det aldrig det enda.
  3. Management-API:ts skrivskyddade endpoint, `POST /v1/projects/{ref}/database/query/read-only` ("Run a sql query as
     supabase_read_only_user", Beta; källa: OpenAPI-dokumentet `https://api.supabase.com/api/v1-json`, läst 2026-10-17).
     Prod-läsaren har ingen annan väg, så databasen själv vägrar en skrivning.
- Utan `--read-prod` skriver `staging:seed-reference` och `staging:schema-diff` ut sin plan och gör **noll anrop**, mot
  varken prod eller staging. `--apply` utan `--read-prod` vägras.
- `main()` vägrar köra om `CI` eller `VITEST` är satt, och skriver en rad om skriptets sökväg inte matchar den som node
  startades med (annars hade ett skript kunnat avsluta tyst utan att göra något).
- Varje körning skriver ut målets host (`db.<ref>.supabase.co`). Tokens läses ur miljön och skrivs aldrig ut (varje rad och
  varje felmeddelande rensas från dem). Skripten läser ingen `.env`.
- Miljövariabler (sätts i skalet, aldrig i en spårad fil):
  - `SUPABASE_STAGING_ACCESS_TOKEN`: personlig åtkomsttoken för staging-organisationen. Krävs av alla fyra.
  - `RUNQUEST_PROD_READ_TOKEN`: prod-läsning, med flit en egen variabel. Skripten läser **aldrig** `SUPABASE_ACCESS_TOKEN`,
    som en editor eller MCP-server kan ha i samma skal. Krävs av `staging:seed-reference` och `staging:schema-diff` när
    `--read-prod` ges.
    **Var tydlig med vad den är:** den är en vanlig Supabase personlig åtkomsttoken, alltså med samma behörighet som kontot
    har mot prod. Den är inte skrivskyddad i sig. Att läsningen är skrivskyddad garanteras av två saker i skriptet:
    management-API:ts read-only-endpoint (databasen kör satsen som `supabase_read_only_user`) och tillåtelselistan med exakta
    satser. **Endpointen är Beta** och kan ändras eller tas bort av Supabase; skulle den försvinna lämnar skripten inte över
    till den vanliga skrivbara endpointen, de slutar fungera. Förvara tokenen därefter: sätt den bara i det skal du kör
    skriptet i, och ta bort den efteråt.
- Backendens Railway-variabler i stagingmiljön (tjänsten `runquest-backend-staging`) som styr tokenkrypteringen (ADR 013,
  [`runbook-token-key.md`](runbook-token-key.md)):
  - `NODE_ENV=production` och `SENTRY_ENVIRONMENT=staging` (Lead har verifierat båda i Railway 2026-10-18). Backend väljer nyckel-id-prefix
    ur dem: i `NODE_ENV=production` krävs `stg-` när `SENTRY_ENVIRONMENT=staging`, annars `prod-`. Saknas `SENTRY_ENVIRONMENT=staging`
    avvisas en `stg-`-nyckel med ett `🚨 KRITISKT`-larm (källa `token_key`) och Strava-synken står still.
  - `TOKEN_ENCRYPTION_KEY=stg-1:<base64 av 32 byte>`: ett eget värde för staging, aldrig prodnyckeln, och aldrig `test-1` (avvisas i
    produktionsläge). Ägaren skapar och sätter den i Railway-UI:t; värdet står aldrig i chatten, i en fil eller i ett ärende.
    `TOKEN_ENCRYPTION_KEYS_RETIRED` används bara under en rotation.

## Bygga om från noll

Kommandona körs från repo-roten. Lägg `-- --apply` sist för att skriva; utan det är det en dry-run (eller bara en plan).

```bash
# 1. Schemat: 000_baseline.sql + alla migrationer från 032, i filnamnsordning. Redan körda hoppas över.
npm run staging:migrate --workspace=@runquest/backend              # dry-run: visar vad som skulle köras
npm run staging:migrate --workspace=@runquest/backend -- --apply

# 2. Spelregler och konfiguration från prod (läser prod, skriver staging)
npm run staging:seed-reference --workspace=@runquest/backend                          # bara planen, inga anrop
npm run staging:seed-reference --workspace=@runquest/backend -- --read-prod           # dry-run: läser prod och staging
npm run staging:seed-reference --workspace=@runquest/backend -- --read-prod --apply

# 3. Testgruppen "Staging Pack" med fyra fiktiva användare
npm run staging:seed-group --workspace=@runquest/backend
npm run staging:seed-group --workspace=@runquest/backend -- --apply

# 4. Jämför schemat i prod och staging (skriver aldrig)
npm run staging:schema-diff --workspace=@runquest/backend                  # bara planen, inga anrop
npm run staging:schema-diff --workspace=@runquest/backend -- --read-prod
```

Därefter `get_advisors` (security) mot `supabase-staging`: inga fynd som prod saknar.

### 1. `staging:migrate`

Kör `000_baseline.sql` och migrationerna med nummer 032 eller högre via management-API:t
(`POST /v1/projects/{ref}/database/migrations`), med 1,5 s paus mellan. 001–031 är fryst historik och körs aldrig mot en
ny databas (huvudet i `000_baseline.sql`, ADR 002). Skriptet frågar staging vilka migrationer som redan är registrerade och
hoppar över dem; kan listan inte läsas stannar skriptet i stället för att gissa. Vid första felet stoppas körningen och
senare migrationer körs inte; åtgärda orsaken och kör igen.

Skyddsregler: en `.sql`-fil i migrationsmappen som inte heter `NNN_namn.sql` fäller körningen (annars hoppas den över
tyst). Med `--apply` vägras en väntande migration som är äldre än den senaste staging redan har (den hade körts i fel
ordning). Migrationer som staging har registrerat men repot saknar listas som varning. Prod rörs aldrig.

En ny migration i repot kommer med automatiskt vid nästa körning. Lead provar den i staging före prod
(`docs/release.md`, "Migrationer provas i staging före prod").

### 2. `staging:seed-reference`

Kopierar de här tabellerna från prod (och inget annat):

`challenge_durations`, `challenge_metrics`, `challenge_rewards`, `event_templates`, `event_pools`, `event_pool_members`,
`level_challenge_rewards`, `level_requirements`, `streak_multipliers`, `titles` (innehavare och aktuellt värde läses inte alls; staging ger dem sina standardvärden, NULL och 0)
och `admin_settings` (lösenordshashen byts mot en platshållare inne i prod-frågan, så den riktiga hashen lämnar aldrig
prod).

Varje insert är `on conflict do nothing`, så en omkörning ger inga dubbletter. Efter `--apply` kontrollerar skriptet att
varje prod-nyckel finns i staging (primärnyckeln per tabell) och skriver ut avvikelser; avvikelser ger exit 1. Raderna
skrivs inte till någon fil. Ger prod noll rader för en tabell varnar skriptet: den skrivskyddade rollen kan filtreras av
RLS, och kopian ska då inte litas på. Får en av tabellerna en ny kolumn i en migration: kontrollera att `REFERENCE_TABLES`
i `apps/backend/src/scripts/staging/stagingSeedReference.ts` fortfarande bara läser konfiguration.

### 3. `staging:seed-group`

Skapar gruppen "Staging Pack" med fyra användare (`admin@`, `sixten@`, `lova@`, `kim@staging.runquest.test`); admin är
gruppens skapare. Gruppen och medlemskapen görs av databasfunktionerna `create_group_with_admin` och `join_group` (migration 053;
skriptet skriver aldrig `users.group_id` själv), så migrationen måste vara körd först (steg 1). Lösenordet genereras slumpmässigt vid `--apply` och skrivs **bara** till `staging-testkonton.seed` i
repo-roten (gitignorerad via `*.seed`), aldrig till terminalen; varken lösenordet eller dess hash kan dyka upp i en
utskrift. Finns gruppen redan görs inget och den gamla filen lämnas orörd. Finns någon av e-postadresserna utanför gruppen
vägrar skriptet. Misslyckas inserten tas seed-filen bort bara om en ny kontroll visar att gruppen inte finns; annars (svaret
gick förlorat men raderna kan ha skapats, eller kontrollen misslyckas) behålls filen, eftersom den då är enda kopian av
lösenordet. Vill du ha ett nytt lösenord: radera gruppen och dess användare i staging och kör om.

### 4. `staging:schema-diff`

Jämför fingeravtryck mellan prod och staging: relationer (art, ägare, alternativ, RLS och tvingad RLS), kolumner,
constraints (inte på domäntyper), index, triggers, policyer, tabell- och kolumn-grants, funktioner (ägare och hela definitionen),
funktionsgrants (standard-PUBLIC-execute gjord explicit), vyer och enum-typer. Båda projekten läses som samma roll via den
skrivskyddade endpointen, så att definitionstexterna inte skiljer sig för att två sessioner har olika `search_path`.
Funktionskroppar normaliseras för radbrytningar (CRLF), blanka rader och blanksteg sist på raden, och normaliserade
skillnader listas som "normaliserade bort" men räknas inte som skillnad.

**Jämförs inte** (skrivs ut vid varje körning): storage- och auth-scheman (bucketen `profile-pictures` och dess policyer),
default-privilegier (`pg_default_acl`), extensions, event-triggers, constraints på domäntyper, data och sekvensvärden, roller.

Utskriften visar "Unexplained differences" och "Known differences". Exit 0 betyder att inget oförklarat finns. En känd
skillnad har en regel med förklaring i `KNOWN_DIFFERENCES` (`schemaFingerprint.ts`):

- Prod saknar PUBLIC-execute på exakt fyra funktioner (drift utanför repot, RUN-226, verifierade av Lead 2026-10-17):
  `increment_event_xp(p_user_id uuid, p_xp integer)`, `trigger_update_title_leaderboard()`,
  `update_all_title_leaderboards()` och `update_title_leaderboard(p_title_id uuid)`. Regeln gäller bara om mängden poster
  är exakt de fyra; en femte, en saknad, eller fyra andra gör att ingen av dem räknas som känd.

Hittar diffen något nytt: antingen är det drift i prod (ticket), eller ett fel i migrationerna (ny migration), eller en
känd skillnad som ska in i listan med förklaring.

Skriptet är inte körd mot riktiga databaser av byggaren. Den skrivskyddade rollen kan sakna rättigheter till någon katalogvy
eller filtreras av RLS; då stannar körningen med ett felmeddelande (den gissar aldrig "inga rader").

### 5. `create:group` (en andra låtsasgrupp för flergruppstestet)

Det här skriptet är inte ett av de fyra staging-skripten och följer inte deras regler. De fyra har målet hårdkodat till staging och kan
inte skriva till prod. `create:group` (`apps/backend/src/scripts/createGroup.ts`, ADR 012 S12/S14) är ett vanligt backendskript som går mot
den databas `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` i skalet pekar på, och det **kan därför skriva till prod med flaggparet nedan**.
Det som håller prod borta är vakterna i skriptet, inte ett hårdkodat mål.

`staging:seed-group` ger gruppen "Staging Pack". Flergruppstestet (ägarbeslut F5: flergrupp testas i staging med en låtsasgrupp, aldrig en
testgrupp i prod) behöver en andra grupp. `create:group` anropar databasfunktionen `create_group_with_admin` (migration 053): gruppen,
adminrollen och pekaren `users.group_id` skrivs i en transaktion. Skriptet skapar inget konto och läser eller skriver aldrig
`staging-testkonton.seed`.

**Steg 1: ett testkonto utan medlemskap.** Skaparen måste vara en befintlig användare utan aktivt medlemskap (ett aktivt medlemskap per
användare i v0.8.0). Adminvägen i appen (`POST /auth/users`) lägger alltid kontot i adminens grupp, så den går inte. **Ägaren skapar
låtsasgruppens adminkonto i staging**, till exempel i Supabase-dashboardens SQL-editor för stagingprojektet `aormctqrmguvncxrigwy`
(aldrig i prod), med en insert utan `group_id`:

```sql
insert into public.users (name, email, password_hash)
values ('Andra Admin', 'andra-admin@staging.runquest.test', '<bcrypt-hash>');
```

Ägaren väljer lösenordet och hashar det själv med bcrypt (10 rundor, samma som `staging:seed-group`); lösenordet och hashen skrivs inte
i chatten, i ett ärende eller i en spårad fil. Lead (agenten) skapar inga konton och sätter inga lösenord i en icke-lokal miljö, utöver
de testkonton som `staging:seed-group` skapar (avsnitt 3); Lead får bara e-postadressen eller id:t. Kolumnerna har standardvärden för
resten (poäng, nivå, streak). Om en sida i flergruppstestet än så länge kräver den globala flaggan `users.is_admin` (kvar för
systemrutter, ADR 012), sätter ägaren den i samma sats; gruppens adminroll kommer av medlemskapet, inte av flaggan.

**Steg 2: dry-run, sedan `--apply`** (Lead, efter steg 1). Miljön kommer från skalet; ingen `.env` läses, så en kvarglömd lokal fil kan
inte välja mål. Lead kör med stagingtjänstens miljövariabler:

```bash
railway run --environment staging --service runquest-backend-staging -- \
  npm run create:group --workspace=@runquest/backend -- --owner-email=andra-admin@staging.runquest.test --name="Andra gruppen"
# dry-run: skriver ut måldatabasens host, läser kontot, skapar ingenting. Lägg till --apply för att skapa gruppen.
```

Flaggor: `--owner-email=` eller `--owner-id=<uuid>` (exakt en), `--name=` (1 till 60 tecken, standard "Staging Second Pack"),
`--invite-code=` (`A-Z0-9`, 6 till 32 tecken; annars slumpas en med `crypto.randomBytes`), `--show-invite-code`, `--apply`.

**Inbjudningskoden** ger tillträde till gruppen och skrivs inte ut om inte `--show-invite-code` ges (då på en egen rad, en gång). Den
loggas aldrig och går aldrig till Sentry. Adminen ser den i appen (`GET /api/groups/my`); den som ska gå med får den av Lead.

**Vakterna.** Målet avgörs av den anslutnings-URL skriptet faktiskt använder (`SUPABASE_URL`), aldrig av en flagga:

| Mål | dry-run (läser konto och medlemskap) | `--apply` |
|---|---|---|
| staging (`aormctqrmguvncxrigwy`, exakt `https://<ref>.supabase.co`) | tillåten | tillåten |
| prod (`yrrqaxdngayakcivfrck`; en URL som nämner prod-refen var som helst räknas som prod) | **vägras utan `--allow-prod`**: en läsning i prod är en ask | vägras utan BÅDE `--allow-prod` och `--confirm-prod=I-HAVE-THE-OWNERS-YES-FOR-yrrqaxdngayakcivfrck` (exakt sträng) |
| allt annat (annat projekt, lokal stack, eget domännamn, URL som inte går att läsa) | tillåten | vägras, eftersom målet inte går att skilja från prod |

- **Lead använder `--allow-prod`, med eller utan bekräftelsesträngen, bara efter ägarens uttryckliga ja i den aktuella tråden**, och
  aldrig för en testgrupp (F5). Utan flaggorna är standarden vägran, och ingen databasklient byggs ens.
- `--allow-prod` eller `--confirm-prod` mot staging vägras också, i en dry-run med: flaggan på fel URL är ett tecken på att fel miljö
  är vald.
- Raden i `docs/permissions.md` för det här skriptet väntar på ägarens OK; tills dess gäller det som står här.
- Skriptet körs bara av Lead, aldrig av CI eller av en builder (`main()` vägrar om `CI` eller `VITEST` är satt).
- Svarar databasen inte efter `--apply` (nätverksfel, timeout) skriver skriptet att utfallet är okänt, eftersom gruppen kan ha skapats
  innan svaret gick förlorat. Kör då en dry-run: har ägaren redan ett aktivt medlemskap finns gruppen. Kör inte `--apply` igen före det.

## Tester

`apps/backend/src/scripts/staging/__tests__/`: vakten mot prod-ref, att prod bara läses med satser ur tillåtelselistan (och
de två kända kringgåendena av filtret), `--read-prod`, dry-run skriver inget, omkörning ger inga dubbletter,
normaliseringen av funktionskroppar, de fyra kända funktionerna och att seed-reference bara läser de tillåtna tabellerna.
Inga riktiga nätverksanrop: management-API:t är en fejk (`apps/backend/src/test-utils/fakeManagementApi.ts`).

`create:group` har egna tester i `apps/backend/src/scripts/__tests__/createGroup.test.ts` (målklassningen, vakterna mot prod, att
bekräftelsesträngen jämförs exakt, att koden och nyckeln aldrig skrivs ut, utfallet "okänt" vid brutet svar, kommandoraden). Databasen är
en fejk och klienten byggs av en injicerad fabrik, så inget öppnar en anslutning.
