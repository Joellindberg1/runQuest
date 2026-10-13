# 010. Strava-webhooks — händelsestyrd synk av nya och ändrade aktiviteter; rundor behålls (Jira RUN-162, epic RUN-93, v0.7.0)

## Status
Godkänd av ägaren 2026-10-13 (reviderad efter ägarbeslut). Utkastet 2026-10-13 föreslog att raderingar, privat-ifiering och typbyte på Strava skulle ta bort rundan här. Ägaren svarade: **"Bygg webhooks, men behåll rundor"** (beslut 7, 8 och 12, Konsekvenser "Känd avvikelse"). Webhooks byggs för nya och ändrade aktiviteter. **Ingen runda raderas automatiskt av något som händer på Strava.** Det kräver ingen FK-ändring, så migration C (`ON DELETE SET NULL`) har utgått. Två migrationer (numreras vid bygget, 044+) kräver ägarens uttryckliga ja var för sig (docs/permissions.md, ADR 002). Att skapa Strava-prenumerationen, sätta de två Railway-variablerna och köra skriptet som fyller i Strava-athlete-id för de sex befintliga kopplingarna är var och en en egen `ask`.

## Kontext
Epic RUN-93 (fixVersion v0.7.0), story RUN-162 "ADR". Idag är Strava-synken **insert-only och pollande**: cron var 30:e minut hämtar nya aktiviteter, en aktivitet som ändras på Strava ändras aldrig här. Ägarens Strava-hållning (2026-10-07) sa att raderingar skulle slå igenom via webhooks. ADR 009 beslut 9.4 kräver att en sådan raderingshandler går genom `calculateUserTotals` → `evaluateBadges`. **Ägarbeslutet 2026-10-13 vänder den delen av hållningen** (se nedan), men beslut 8 behåller raderingskedjan som dokumenterad framtida väg så att 9.4 fortsatt gäller den dag raderingar slås på.

Verifierat i koden 2026-10-13 (branch docs/adr-010-011, HEAD 83c561b):

- **Synken är insert-only och pollande.** `scheduler/stravaSync.ts` (`SYNC_INTERVAL_MINUTES = 30`, node-cron, startas bara i `NODE_ENV=production`, `server.ts` r.74–79) anropar `syncAllStravaUsers()` → `syncUserStravaActivities(userId)` (`routes/strava.ts` r.632–917). Listan hämtas med `after` = senaste importerade runda − 7 dagar (annars `connection_date`, annars 30 dagar), nya `external_id` infogas med platshållar-XP 0, sedan `reprocessRunsFromDate` → väder (`WeatherService.fetchAndSaveWeatherForRuns`) → `calculateUserTotals` → `checkEventQualification` (fire-and-forget). Dubblettskyddet är det unika indexet `(user_id, external_id) where external_id is not null` (migration 033). Inget i flödet uppdaterar eller raderar en importerad runda.
- **`strava_tokens` har ingen Strava-identitet och inget samtycke.** Kolumner (000_baseline.sql r.227–234 + PK `user_id`): `user_id, access_token, refresh_token, expires_at, created_at, connection_date`. `access_token`/`refresh_token` är nullable. `POST /strava/callback` (r.176–248) får `tokenData.athlete` av Strava men sparar den inte (returnerar den bara till klienten) och kräver inget samtycke. En webhook-händelse bär bara `owner_id` (Stravas athlete-id), så **utan ett lagrat athlete-id går ingen händelse att koppla till en användare.** Det är ett nytt krav som RUN-162:s text inte nämner. `GET /strava/status` räknar varje rad i `strava_tokens` som en koppling (r.111–120); `syncAllStravaUsers` filtrerar `access_token is not null` (r.453).
- **OAuth-scope är `activity:read`** (`useStravaActions.ts` r.72, `approval_prompt=force`), alltså ingen `activity:read_all`. Appen ser inte privata aktiviteter, varken i pollingen eller i detaljhämtning.
- **Importerad data** (`extractExtendedFields`, `routes/strava.ts` r.71–85): `start_time` (lokal väggklocka), `moving_time`, `total_elevation_gain`, `sport_type`, `avg_heartrate`, `max_heartrate`, `suffer_score`, `start_lat/lng`, `pace_std_dev`, `is_treadmill`, plus `date` och `distance`. Väder (`run_weather`) härleds ur start och plats. Det är underlaget för samtyckestexten (beslut 12).
- **Skrivvägen.** `calculateUserTotals` (`utils/calculateUserTotals.ts`) är enda skribent till users-totaler (ADR 005). Den läser rundor, skriver totaler (+ `recordLevelUps`/`recordRunMilestones`, ADR 008), anropar `evaluateBadges(userId, { longestStreak })` i egen try/catch (r.88–92) och kör sedan `processAllUsersTitles(groupId)` + `update_all_title_leaderboards` (r.98–138). Alla rundskrivningar slutar där, och det gäller även webhook-vägen.
- **Manuella raderingar och FK:n.** `DELETE /api/runs/:id` svarar 409 för `source='strava'` (RUN-139) och för runda som kvalificerat ett event (`routes/runs.ts` r.551–571, ADR 008 addendum 5). Det senare beror på att `event_entries.run_id` är `REFERENCES runs(id)` utan `ON DELETE` (= NO ACTION; baseline r.382), och koden förkontrollerar det. **Den här ADR:n ändrar inte FK:n, så `DELETE /runs/:id` och dess 409-regler är oförändrade.** (`event_entries.run_id` skrivs bara vid insert, `eventService.ts` r.258, och läses inte någon annanstans i koden. Det gäller om en framtida raderingsväg införs, beslut 8.)
- **Per-titel-låset (migration 042, RUN-158)** serialiserar `update_title_leaderboard` med `pg_advisory_xact_lock(hashtextextended('title_leaderboard:' || id, 0))`. Låset är *transaktionsbundet inne i en SQL-funktion*. Bearbetningen av en webhook-händelse går över HTTP-anrop till Strava och flera separata PostgREST-anrop, och varje supabase-js-anrop är en egen transaktion. Därför går inget advisory-lås att hålla över bearbetningen (se beslut 6 och Avvisade alternativ). 042 skyddar däremot omräkningen av topplistan mot samtidiga webhook- och pollingkörningar.
- **Titelomräkningen per skrivning** (RUN-99, RUN-104, RUN-157): `processAllUsersTitles(groupId)` räknar om alla gruppmedlemmars titlar en i taget, och sent sparat väder räknar om titlar för alla grupper (`stravaSync.ts` `recalculateTitlesAfterWeather`). En webhook-händelse per runda skulle utan åtgärd ge en gruppomräkning per händelse. Det hanteras i beslut 10.
- **En backend-replika antas redan** (login-rate-limitern är in-memory, STATE zon 8). Railway kan under några sekunder köra gammal och ny instans samtidigt vid deploy.
- **Request-loggern** (`app.ts` r.49–56) loggar `req.path`, alltså utan query-strängen. Verifieringsanropet (`hub.verify_token`) hamnar därför inte i loggen. Det måste bevaras (sensitive-logging-testet).
- **Strava-prenumerationen är en per Strava-app (client id).** Samma app används av alla miljöer, så en lokal utvecklingsmiljö kan inte ha en egen prenumeration. Webhooks verifieras i prod (jfr ägarbeslut 2026-10-05: ingen staging).
- **Det finns inget Sentry** (STATE-gap). "Larm" betyder därför i dag en `error`-loggrad med fast prefix (som token-larmet `🚨 KRITISKT` i `refreshStravaToken`) plus en admin-läsbar hälsoendpoint (beslut 11).

**Externa fakta om Stravas webhooks** (enligt Stravas dokumentation; jag har inte testat dem mot Strava här, och de ska verifieras i rök-testet, beslut 17): (a) en prenumeration per app skapas med `POST https://www.strava.com/api/v3/push_subscriptions` (`client_id, client_secret, callback_url, verify_token`) och Strava anropar då `GET callback_url?hub.mode=subscribe&hub.challenge=…&hub.verify_token=…`, som ska svara 200 `{"hub.challenge": "…"}` inom 2 s; (b) händelser levereras som `POST` med `object_type` (`activity`|`athlete`), `object_id`, `aspect_type` (`create`|`update`|`delete`), `updates`, `owner_id`, `subscription_id`, `event_time` (epoch-sekunder); (c) `updates` bär bara ändrade fält (`title`, `type`, `private`), eller `authorized: "false"` på en `athlete`-händelse vid deauthorize; (d) svaret måste vara 200 inom 2 s, annars försöker Strava leverera igen (högst tre försök totalt); (e) **ingen signatur** på händelserna; (f) det finns inget händelse-id, bara `event_time` i sekunder; (g) gränserna är per app, inte per användare. Appens inställningar i Strava, kontrollerat 2026-10-07: totalt 600 anrop per 15 min och 6 000 per dygn, varav läsning 300 per 15 min och 3 000 per dygn; athlete capacity 999. Alla våra anrop utom tokenförnyelsen är läsningar, så **läsgränsen (300/3 000) är den som binder**. (RUN-162:s text angav 100/1 000, vilket var fel.) Fönstren nollställs på hel kvart respektive UTC-midnatt, och användningen anges i svarshuvudena (`X-ReadRateLimit-*` för läsgränsen, `X-RateLimit-*` för totalen).

Relaterade ADR:er: **002** (migrationsflödet, expand/contract), **003** (routern monteras i `createApp()`, ingen separat webhook-tjänst), **005** (`calculateUserTotals` enda skribent), **007** (svarsform för nya endpoints), **008** (händelsemönster: tabell med unik `dedupe_key`, claim-före-arbete; addendum 5 om `event_entries.run_id`), **009** (beslut 9.4; `evaluateBadges` retractar `badge_earned`), **011** (parallell: notiser; `emitRankNews:false` vid massomräkning), **001** (teststrategi, port-mönstret). **Ingen ADR ersätts.** ADR 008 addendum 5 och 409-regeln i `DELETE /runs/:id` är oförändrade.

**Ägarens Strava-hållning (2026-10-07):** ingen AI på Strava-data inklusive härledd data; Strava-data bara inom användarens grupp; raderingar via webhooks; lagring orörd tills kapacitetsansökan. **Raderingspunkten är ändrad av ägaren 2026-10-13:** rundor behålls tills vidare (se nedan). De övriga punkterna gäller. Hur ADR:n följer hållningen är beslut 14.

**Ägarbeslut 2026-10-13 (bindande).** Ägarens ord: "Bygg webhooks, men behåll rundor. Vi låter det vara som det är idag. Men vi förtydligar vad användare går med på när det gäller strava, deras data, gammal data osv. Så tar vi villkor från strava etc längre fram, men med denna lilla appen är de ingen fara än."
1. Webhooks byggs för create och update, så att rundor kommer in direkt och ändringar följer med.
2. **Ingen automatisk radering av rundor** vid delete-händelse, privat-ifiering, typbyte eller deauthorize. Rundan ligger kvar som idag. Händelsen journalförs.
3. Deauthorize: tokens tas bort (de är ogiltiga ändå). Rundorna ligger kvar.
4. Samtycket blir viktigare: texten ska säga vad som importeras, att rundor stannar i RunQuest även om man kopplar bort Strava eller raderar på Strava, och hur man begär borttagning (manuellt via ägaren). Texten skrivs i RUN-201 (Connect Strava) och RUN-180 (/legal i landningsversionen); kravet står i beslut 12.
5. **Känd avvikelse från Strava API Agreement 4.4** (radering av Strava Data) accepteras medvetet tills vidare (Konsekvenser "Känd avvikelse").

**Ägarbeslut 2026-10-12 (bindande; D1, D2 och D7 är ändrade av 2026-10-13):**

| Nr | Beslut |
|---|---|
| D1 | Deauthorize: **AVGJORD 2026-10-13: rundor behålls**, tokens tas bort. Strava developer support behöver inte frågas för att bygga. RUN-175 utgår (beslut 7.4, 8). |
| D2 | Event-runda raderad på Strava → behåll `event_entries`-raden och XP, `run_id` → NULL. **Överflödigt 2026-10-13:** ingen runda raderas av Strava, så FK:n ändras inte. Kvarstår som krav på den framtida raderingsvägen (beslut 8). |
| D3 | Samtyckeslogg: ja (`consent_version` + `consented_at` på `strava_tokens`). |
| D4 | De sex befintliga kopplingarna har godkänt muntligt via ägaren. Ingen omgodkännande-popup, ingen omkoppling; `consent_version` lämnas null för dem. |
| D6 | Reservpollingen stannar på 30 min tills webhooks verifierats i prod; därefter 12 h (RUN-176, utanför v0.7.0). |
| D7 | **Vänd 2026-10-13:** privat-ifiering eller typbyte (Run → Ride) → **behåll** rundan. (Tidigare: ta bort.) Journalförs. |
| D8 | Egen Disconnect-knapp: senare, utanför v0.7.0. |
| D12 | Raderingsavstämning först efter verifierade webhooks (RUN-177). **2026-10-13:** utgår ur planen; hör till det framtida villkorsarbetet (beslut 8, Konsekvenser). |

## Beslut

### 1. Princip: händelsen är en signal, tillståndet hämtas alltid från Strava
En webhook-händelse säger bara *att* något hänt med aktivitet X hos användare Y. **Handlern litar aldrig på händelsens innehåll för att bestämma vad som ska hända.** För `create` och `update` hämtar den aktiviteten med användarens egen token och för sedan databasen till det Strava visar (nivåstyrd, inte kantstyrd bearbetning). Det ger tre egenskaper som resten av ADR:n bygger på:
- **Skydd utan signatur:** en förfalskad händelse kan bara få oss att läsa Stravas verkliga tillstånd för en verklig användare. Den kan inte injicera data (beslut 3).
- **Ordning behöver inte garanteras för att resultatet ska bli rätt.** Två händelser om samma aktivitet i fel ordning ger samma slutläge, eftersom bearbetningen av båda läser samma, senaste Strava-tillstånd (beslut 6).
- **Idempotens:** att bearbeta en händelse två gånger är ofarligt. Efter första gången är databasen redan lika med Strava.

### 2. Rutten och miljövariablerna
Ny router `routes/stravaWebhook.ts`, monterad i `createApp()` på **`/api/strava/webhook`**, *före* `/api/strava`-routern (ADR 003; wiring-testet utökas). Inga JWT-middleware på GET/POST (Strava har ingen token), och `/api`-infolistan i `app.ts` får raden.

| Metod och sökväg | Auth | Beteende |
|---|---|---|
| `GET /api/strava/webhook` | `hub.verify_token` | Om `hub.mode === 'subscribe'` och `hub.verify_token` är lika med `STRAVA_WEBHOOK_VERIFY_TOKEN` (jämförs med `crypto.timingSafeEqual`, längdskillnad = nej) → 200 `{"hub.challenge": <värdet>}`. Annars 403. Variabeln saknas → 503. |
| `POST /api/strava/webhook` | `subscription_id` måste matcha (beslut 3) | Validera form, spara händelsen (beslut 5), svara **200 inom 2 s** och bearbeta *efteråt* (beslut 6). |
| `GET /api/strava/webhook/health` | `authenticateJWT` + `requireAdmin` | Hälsa (beslut 11). Svar `{ success, data }` (ADR 007). |

**Miljövariabler** (backend; båda läggs in av ägaren i Railway-UI:t. Permissions: Railway-variabler = ask, hemliga värden aldrig i chatt eller kod):
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — slumpsträng (minst 32 byte), hemlig, används bara vid prenumerationens verifiering. Roteras genom att ta bort och återskapa prenumerationen.
- `STRAVA_WEBHOOK_SUBSCRIPTION_ID` — id som Strava returnerar när prenumerationen skapats. Inte hemlig, men egen variabel enligt RUN-162.
- Saknas `STRAVA_WEBHOOK_SUBSCRIPTION_ID` svarar POST **200 och kastar händelsen med en `warn`-rad** (Strava ska inte köa omförsök; gluggen är minuter mellan skapad prenumeration och satt variabel, och reservpollingen på 30 min täcker den, D6).

**Prenumerationens livscykel:** ett skript `scripts/stravaWebhookSubscription.ts` med `view` (default, läsning), `create` och `delete` mot Stravas `push_subscriptions`. `create` och `delete` är `ask`, och skriptet skriver ut vad det gör. Skapandet sker först efter att migrationerna är applicerade, backend är deployad med verify-variabeln och athlete-id är ifyllda (beslut 4 och utrullning, beslut 16).

### 3. Skyddsmodell för POST (ingen signatur)
Strava signerar inte händelserna, och `subscription_id` är ett litet heltal som går att gissa. Skyddet är därför flera lager. **Det som bär är beslut 1 och att inget en händelse kan åstadkomma är destruktivt för rundor:** en förfalskad `create`/`update` ger bara en läsning av verkligt Strava-tillstånd, och en förfalskad `delete` ger bara en journalrad.
1. **`subscription_id` måste vara lika med `STRAVA_WEBHOOK_SUBSCRIPTION_ID`**, annars 403 (+ `warn` utan brödtext). Det stoppar slumpmässiga anrop och gamla prenumerationer.
2. **Formkontroll:** `object_type ∈ {activity, athlete}`, `aspect_type ∈ {create, update, delete}`, `object_id`/`owner_id`/`subscription_id`/`event_time` är heltal, brödtexten ≤ 10 kB. Okänd `object_type`/`aspect_type` (Strava kan lägga till nya) → 200 utan rad (ingen omleverans). Felaktig form → 400.
3. **Okänd ägare:** `owner_id` finns inte i `strava_tokens.strava_athlete_id` → 200, **ingen rad**, `warn`. Då kan en främmande person inte fylla tabellen. En Strava-användare som tagit bort kopplingen hos oss men inte hos Strava (D8) hamnar här.
4. **Översvämningsskydd:** har ägaren redan ≥ 200 obearbetade rader (`pending`/`processing`) sparas inga fler (200 + `warn`). Reservpollingen täcker det som utebliver, och batchen i beslut 6 gör att en vanlig burst aldrig närmar sig golvet.
5. **Spara endast vitlistat:** bara nycklarna `private`, `type` och `authorized` ur `updates` lagras. Aktivitetens `title` (fritext = Strava-data) sparas aldrig.
6. **Deauthorize kan inte förfalskas till skada:** en `athlete`-händelse med `authorized:"false"` verifieras med ett anrop till Strava med användarens token (beslut 7.4). Först när Strava avvisar token tas användarens token bort. Rundorna rörs aldrig.
7. **Det som återstår vid en förfalskad händelse** är att förbruka några av appens Strava-anrop (begränsas av mjukgränsen, beslut 9) och fylla tabellen upp till golvet i 4. Det accepteras. Om det börjar hända kan en hemlig sökvägsdel i `callback_url` läggas till (revisit-trigger).
8. Händelsen loggas aldrig med brödtext, titel eller token, bara `object_type`, `aspect_type`, `object_id`, `owner_id`.

### 4. Identitetsmappning: `strava_tokens.strava_athlete_id`
Migration (additiv): `alter table public.strava_tokens add column strava_athlete_id bigint, add column consent_version text, add column consented_at timestamptz;` + `create unique index strava_tokens_athlete_id_key on public.strava_tokens (strava_athlete_id) where strava_athlete_id is not null;`.
- **`POST /strava/callback`** sparar `tokenData.athlete.id` i samma upsert. Saknas id i Stravas svar sparas kopplingen ändå men `error`-loggas (en koppling utan id kan inte ta emot händelser; den syns som `unmapped_tokens` i hälsoendpointen, beslut 11).
- **Samma Strava-konto kan inte kopplas till två RunQuest-användare:** unika indexet ger 23505, och callbacken svarar 409 `{ error: 'This Strava account is already connected to another RunQuest user' }`. (Idag går det, och båda användarna får då samma aktiviteter importerade.)
- **De sex befintliga kopplingarna** får sitt athlete-id via `scripts/backfillStravaAthleteIds.ts`: **default dry-run**, `--apply` skriver. Skriptet anropar `GET /athlete` en gång per kopplad användare med den lagrade (vid behov förnyade) token. Det är sex Strava-anrop, och skrivningen i prod är `ask` med dry-run-rapporten som underlag (permissions). Dry-run rapporterar även dubbletter (samma athlete-id på två användare). **Prenumerationen får inte skapas förrän alla aktiva kopplingar har athlete-id.**
- Ingen lat ifyllnad ur pollingen (aktiviteters `athlete.id`) som enda mekanism: användare utan aktiviteter i fönstret får aldrig sitt id.

### 5. Händelselagret `strava_webhook_events` och idempotensnyckeln
Tabellen är kön, journalen och underlaget för det framtida villkorsarbetet i ett. Samma mönster som `activity_log` (ADR 008: unik `dedupe_key`, `on conflict do nothing`), men med arbetsstatus.

```sql
create table if not exists public.strava_webhook_events (
  id               bigint generated always as identity primary key,
  dedupe_key       text        not null,
  object_type      text        not null check (object_type in ('activity','athlete')),
  object_id        bigint      not null,
  aspect_type      text        not null check (aspect_type in ('create','update','delete')),
  owner_id         bigint      not null,                  -- Strava athlete id
  subscription_id  bigint      not null,
  event_time       timestamptz not null,                  -- Stravas event_time (epoch s)
  updates          jsonb       not null default '{}'::jsonb,   -- ENDAST nycklarna private/type/authorized (aldrig title)
  user_id          uuid        references public.users(id) on delete set null,
  status           text        not null default 'pending'
                   check (status in ('pending','processing','done','dead','ignored_by_policy')),
  outcome          text,                                  -- enum i kod, se nedan
  attempts         smallint    not null default 0,        -- misslyckade försök (inte väntan på rate limit)
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  lease_expires_at timestamptz,
  last_error       text,                                  -- kort, aldrig token eller brödtext
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  constraint strava_webhook_events_dedupe_key_key unique (dedupe_key)
);
create index strava_webhook_events_due_idx   on public.strava_webhook_events (status, next_attempt_at) where status in ('pending','processing');
create index strava_webhook_events_owner_idx on public.strava_webhook_events (owner_id, status);
create index strava_webhook_events_object_idx on public.strava_webhook_events (object_id);   -- avstämning mot runs.external_id
alter table public.strava_webhook_events enable row level security;       -- inga policyer
revoke all on public.strava_webhook_events from anon, authenticated;
```

**Statusar.** `pending` → `processing` (claimad) → `done` (klar) eller `dead` (äldre än 48 h utan att lyckas). **`ignored_by_policy`** är en avslutad status för en händelse som enligt Stravas villkor skulle ha krävt att rundor raderas eller kopplas loss, men som vi medvetet inte agerar på (ägarbeslut 2026-10-13). Den är journalen som framtida avstämning och villkorsarbete utgår från (beslut 8). `outcome` (enum i kod) preciserar: `delete_event` (aktivitet raderad), `kept_private`, `kept_not_running` (typbyte), `kept_not_visible` (404 på en `update` för en känd runda; privat eller raderad, kan inte skiljas med `activity:read`), `deauthorized_tokens_removed_runs_kept`. För `done`: `imported`, `updated`, `noop`, `not_a_run`, `ignored_unknown_owner`, `ignored_not_confirmed` (förfalskad eller föråldrad deauthorize).

**Idempotensnyckel:** `dedupe_key = 'strava:' || object_type || ':' || object_id || ':' || aspect_type || ':' || event_time || ':' || updates_hash`, där `updates_hash` är de första 12 hex-tecknen av sha256 över den vitlistade `updates` som kanonisk JSON (sorterade nycklar). Byggs av en ren, enhetstestad funktion. Skäl:
- Stravas egna omleveranser (samma brödtext) får samma nyckel → `insert … on conflict (dedupe_key) do nothing` → ingen andra rad.
- Två *olika* ändringar av samma aktivitet i samma sekund (`private` och `type`) skiljs åt av `updates_hash`.
- `owner_id` ingår inte: `object_id` är globalt unikt hos Strava.
- Två titeländringar i samma sekund får samma nyckel, men det är ofarligt, eftersom titeln aldrig läses (beslut 1).

Insättningen sker med `upsert(..., { onConflict: 'dedupe_key', ignoreDuplicates: true })`. **`delete`-händelser sätts in direkt med `status='ignored_by_policy'`, `outcome='delete_event'`** (ingen worker, inget Strava-anrop behövs; `user_id` sätts ur mappningen). Övriga sätts in som `pending`. Ett DB-fel vid insättningen ger **500**, så att Strava levererar om. En dubblett ger 200.

### 6. Claim-, retry- och ordningsmodell
**Svar först, arbete sen.** POST-handlern gör bara beslut 3 + insättning och svarar. Bearbetningen sker i en worker i samma process (`services/stravaWebhookWorker.ts`) som (a) väcks direkt efter en insättning av en `pending`-rad (`setImmediate`, med en "kör redan"-flagga så att aldrig två loopar går samtidigt) och (b) körs som svep av en cron varje minut (`startStravaWebhookScheduler()`, startas bara i `NODE_ENV=production` bredvid de andra schedulers i `server.ts`; i andra miljöer lagras händelser men bearbetas inte). Svepet är garantin; väckningen är bara latens.

**Claim = lease i databasen.** En RPC `claim_strava_webhook_events(p_lease_seconds int, p_max int)` (`set search_path to ''`, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`; en funktion i `public` är annars anropbar via PostgREST) gör atomiskt:
1. tar `pg_advisory_xact_lock(hashtextextended('strava_webhook_events:claim', 0))`. **Det är migration 042:s mönster återanvänt för det det duger till:** en kort kritisk sektion inne i en SQL-funktion, där två claim-anrop inte kan välja samma rader;
2. släpper rader med `status='processing'` och utgången `lease_expires_at` tillbaka till `pending` med `attempts + 1` (en krasch räknas som ett misslyckat försök);
3. väljer den *ägare* (`owner_id`) vars äldsta förfallna `pending`-rad (`next_attempt_at <= now()`) är äldst (ordning `event_time, id`) **och som inte redan har en `processing`-rad**, och claimar upp till `p_max` (25) förfallna rader för just den ägaren (`status='processing'`, `claimed_at`, `lease_expires_at = now() + p_lease_seconds`, `LEASE_SECONDS = 300`).

Stegen 1–3 är kontraktet; Buildern skriver SQL:en. Det statiska migrationstestet kräver att `set search_path to ''` och `revoke execute` finns i filen.

**Per användare serialiserat, i batch.** Claimet tar alltid *alla* förfallna händelser för en ägare i ett svep och aldrig händelser för två ägare samtidigt (worker-loopen är sekventiell, concurrency 1). Det ger tre saker: (a) ingen annan worker (t.ex. den gamla instansen under en deploy) kan bearbeta samma ägares händelser samtidigt, eftersom steg 3 utesluter ägare med levande lease; (b) en burst av händelser för en användare (en klocka som laddar upp flera pass) ger **en** omräkning, inte en per händelse (beslut 10); (c) en händelse som fastnar (t.ex. ihållande 5xx för en aktivitet) blockerar inte ägarens övriga, eftersom varje händelse i batchen slutförs eller skjuts upp för sig.

**Pollingen delar samma serialisering.** `syncUserStravaActivities` (inklusive manuell `POST /strava/sync`) och webhook-batchen för en användare omsluts av samma nyckelade in-process-mutex (`utils/keyedMutex.ts`, nyckel = `userId`). Skäl: pollingens läs-och-infoga och workerns upsert av samma aktivitet ska aldrig överlappa (annars kapplöpning om samma `external_id` och dubbla omräkningar). En replika antas (som login-limitern); fler replikor → databaslease även för pollingen (revisit-trigger).

**Ordningsgaranti = konvergens, inte sekvens.** `event_time` används för (a) claim-ordning (äldst först, inom ägare), (b) nyckeln, (c) felsökning. Den avgör **aldrig** vad som händer, eftersom varje bearbetning läser Strava-tillståndet just nu (beslut 1). Konsekvens: `update(private=false)` före `update(private=true)` → båda bearbetas mot samma nuvarande Strava-tillstånd → samma slutläge. En `create` som kommer efter en `delete` hämtar aktiviteten, får 404 och gör ingenting.

**Retry.** Misslyckas en händelse (nätverksfel, 5xx, tokenförnyelse som felar, DB-fel, `reprocessRunsFromDate` som kastar) → `attempts + 1`, `last_error` (kort), `status='pending'`, `next_attempt_at = now() + WEBHOOK_BACKOFF_MINUTES[min(attempts-1, 3)]` med `WEBHOOK_BACKOFF_MINUTES = [1, 5, 15, 60]` (därefter var 60:e minut). **Väntan på rate limit är inte ett misslyckande:** `next_attempt_at` skjuts till nästa kvart eller dygnsgräns och `attempts` rörs inte (beslut 9). Är en händelse äldre än `WEBHOOK_DEAD_AFTER_HOURS = 48` utan att vara avslutad blir den `dead` och larmar (beslut 11). Händelser vars ägare saknar giltig koppling (token borttagen) eller vars användare raderats avslutas som `done`/`ignored_unknown_owner`, aldrig retry.

**Omräkning vid omförsök.** En händelse som ändrar data schemalägger omräkning (beslut 7.1). En händelse med `attempts ≥ 1` schemalägger den **alltid**, även om rundan nu redan stämmer med Strava, eftersom det tidigare försöket kan ha skrivit rundan men dött före omräkningen. Omräkningen är idempotent (RUN-215).

### 7. Bearbetning per händelsetyp
Gemensamt för `activity`: användaren slås upp via `owner_id`; token ur `strava_tokens` förnyas vid behov med den befintliga logiken (retry vid sparfel + KRITISKT-larm; extraheras till ett delat `services/stravaClient.ts` som både pollingen och workern använder); aktiviteten hämtas med **ett** detaljanrop (`GET /activities/:id`, samma som `fetchDetailedActivity`, bär redan `splits_metric`). Gemensam importlogik (`isRunningActivity`, `extractExtendedFields`, radens form) lyfts ur `routes/strava.ts` till en delad modul så att polling och webhook skriver *identiska* rader. **Ingen kod i det här beslutet raderar en runda.**

**7.1 `create` och `update` → synkronisera till Strava-tillståndet.** Detaljsvaret avgör:

| Strava svarar | Resultat |
|---|---|
| 200, löpning (`Run`/`TrailRun`/`VirtualRun`), inte privat, distans > 0 | **Finns ingen runda** med `(user_id, external_id)` → infoga (platshållar-XP 0, som pollingen), schemalägg väder och eventkvalificering. **Finns rundan** → jämför `date, distance` + `extractExtendedFields`; skiljer något → uppdatera dessa kolumner (aldrig XP-kolumnerna), schemalägg omräkning från det tidigaste av gamla och nya `date`. Ändras `start_time` eller `start_lat/lng` raderas rundans `run_weather`-rad så att `backfillMissingWeather` hämtar om. Skiljer inget → `done`/`noop` (en ren titeländring ger alltså ingen omräkning). |
| 200, men inte löpning (typbyte, t.ex. Ride) eller `private: true` | **Rundan lämnas orörd** (beslut 7.3). Finns en runda: `ignored_by_policy` (`kept_not_running` / `kept_private`). Finns ingen: `done`/`not_a_run`. |
| 404 | `create`: aktiviteten är inte synlig för oss (privat eller raderad), inget att importera → `done`/`not_a_run`. `update` på en känd runda: **orörd**, `ignored_by_policy`/`kept_not_visible`. |
| 401 | Förnya token en gång och försök igen; består det → misslyckande med retry (kopplingen kan vara avauktoriserad, se 7.4). |
| 429 | Vänta (beslut 9), ingen `attempts`-ökning. |
| 5xx, nätverk | Misslyckande med retry. |

Race mot pollingen: insättningen kan ge 23505 på `(user_id, external_id)` (index 033); då läses raden om och hanteras som "finns". Eventkvalificering (`checkEventQualification`) görs bara för *nyinfogade* rundor, som i pollingen.

**7.2 `delete` → journal, ingen åtgärd.** Händelsen sparas redan vid mottagandet som `ignored_by_policy`/`delete_event` (beslut 5). Rundan, dess XP, event-poster, badges och titlar ligger kvar. Inget Strava-anrop görs (sparar budget; en förfalskad `delete` kan inte skada). Journalen bär `object_id` (= `runs.external_id`) och `user_id`, så en framtida avstämning kan ta fram exakt vilka rundor som hade raderats på Strava.

**7.3 D7 (vänd): privat-ifiering eller typbyte → behåll rundan.** En `update`-händelse som gör aktiviteten privat eller byter den till en annan sport lämnar rundan som den är (inga kolumner uppdateras, ingen omräkning) och journalförs som `ignored_by_policy` (`kept_private` / `kept_not_running` / `kept_not_visible`). Rundan följer inte längre Strava-tillståndet efter det; en senare `update` som gör aktiviteten synlig och löpning igen synkar den till det aktuella tillståndet (7.1). Eftersom appen ber om `activity:read` ser vi aldrig `private: true` utan får 404 (kan inte skiljas från radering). Ändras scope till `read_all` (ingen plan finns) blir `private`-grenen synlig på riktigt. **Konsekvens som samtyckestexten måste säga (beslut 12):** att göra en aktivitet privat på Strava döljer inte rundan i RunQuest.

**7.4 `athlete` med `updates.authorized = "false"` (deauthorize).**
1. **Verifiering:** hämta giltig access-token (förnya vid behov) och anropa `GET /athlete`. Avvisar Strava (401, eller förnyelsen misslyckas med ogiltig refresh-token) → deauthorize är bekräftad. Svarar Strava 200 → `done`/`ignored_not_confirmed` (förfalskad/föråldrad), inget görs.
2. **Tokens bort (D1/S12):** `access_token`, `refresh_token` och `expires_at` sätts till `null` på användarens `strava_tokens`-rad. **Raden behålls** med `strava_athlete_id`, `consent_version`, `consented_at`, `connection_date`. Det uppfyller "tokens tas bort" (pollingen filtrerar redan `access_token is not null` och hoppar över användaren), och samtyckesbeviset försvinner inte medan rundorna ligger kvar. **`GET /strava/status` ändras så att en koppling kräver `access_token is not null`** (annars visar en frånkopplad rad "connected"). Återanslutning skriver om raden (upsert) som idag. (Mitt antagande, se Öppna frågor.)
3. **Rundorna ligger kvar** (ägarbeslut 2026-10-13). Händelsen avslutas som `ignored_by_policy`/`deauthorized_tokens_removed_runs_kept`, med en `warn`-loggrad (`user_id`, `consent_version`, `consented_at`, aldrig token).
4. Senare händelser för samma athlete-id mappar till en rad utan token och avslutas som `done`/`ignored_unknown_owner` (ingen koppling att agera med).

**7.5 Övrigt.** En `athlete`-händelse utan `authorized:"false"` avslutas som `done`/`noop`.

### 8. Raderingskedjan — dokumenterad framtida väg, INTE byggd i v0.7.0
Ägarbeslutet 2026-10-13 gör att inget i v0.7.0 raderar en runda p.g.a. Strava. Kedjan beskrivs ändå här, så att den dag Stravas villkor tas in (Konsekvenser, "Känd avvikelse") finns ett färdigt, granskat beslut att bygga på, och så att ADR 009 beslut 9.4 fortsatt har ett svar. **När raderingar slås på ska de göras så här och inte annorlunda:**
1. `delete from runs where user_id = ? and external_id = ? and source = 'strava'` (**aldrig** en manuell runda; `source`-vakten är en rad i queryn och har eget test). Före radering ska en `delete`-händelse verifieras mot Strava (404), så att en förfalskad händelse inte kan radera.
2. **Event-poster (D2):** `event_entries` som pekar på rundan behålls med sin XP och `run_id` blir NULL. Det kräver en migration som ändrar `event_entries_run_id_fkey` till `ON DELETE SET NULL` (den utgick ur v0.7.0). `run_weather` försvinner (CASCADE), `user_badges.source_run_id` blir NULL.
3. `reprocessRunsFromDate(userId, rundans datum)`, därefter **`calculateUserTotals(userId)` → `evaluateBadges`** (ADR 009 beslut 9.4: badges räknas om, tier sjunker eller raden försvinner, `badge_earned` retractas, serien rensas ur `displayed_badge_series`; ADR 011: dagens `rank_passed`-rader retractas, massomräkning använder `emitRankNews:false`). Titlar räknas om i samma anrop (ADR 005). Flera raderade rundor för en användare ger **ett** `reprocessRunsFromDate` och **ett** `calculateUserTotals`.
4. Vid deauthorize: radera användarens `source='strava'`-rundor på samma väg (manuella berörs inte). Vid privat-ifiering/typbyte: som i det ursprungliga utkastet (ta bort, importeras igen vid publik/löpning).
5. Journalen med `ignored_by_policy` är arbetslistan för att i efterhand ta bort det som borde ha raderats (`object_id` joinas mot `runs.external_id`), och en full raderingsavstämning (tidigare D12/RUN-177) behövs för att fånga händelser som aldrig levererades.

### 9. Stravas rate limits som konstant
`apps/backend/src/config/stravaLimits.ts` (en modul, en källa). Värdena är appens inställningar i Strava, kontrollerade 2026-10-07. Läsgränsen är den som binder (alla våra anrop utom tokenförnyelsen är läsningar); totalgränsen (läs + skriv) är 600 per 15 min och 6 000 per dygn och binder inte.
```ts
// Appens inställningar i Strava, kontrollerat 2026-10-07. Per app, inte per användare.
// Totalt (läs + skriv): 600 / 15 min, 6 000 / dygn. Athlete capacity: 999.
export const STRAVA_READ_LIMIT_15_MIN = 300;   // läsanrop per 15 min (binder)
export const STRAVA_READ_LIMIT_DAILY  = 3000;  // läsanrop per dygn (binder)
export const WEBHOOK_SOFT_LIMIT_15_MIN = 210;  // ≈ 70 % av läsgränsen: workern pausar vid ≥ 210 använda
export const WEBHOOK_SOFT_LIMIT_DAILY  = 2100; // … eller ≥ 2 100 använda per dygn
```
Gränserna gäller *hela appen*, alltså alla användare, pollingen och workern tillsammans. **Mjukgränsen** (≈ 70 % av läsgränsen) lämnar 90 anrop per kvart och 900 per dygn till pollingen och manuell synk. En liten räknarmodul läser `X-ReadRateLimit-Usage`/`-Limit` ur *varje* Strava-svar (polling, polling-detaljer, worker) och har en lokal glidande räknare som reserv när huvudena saknas, t.ex. direkt efter en omstart. Skiljer sig `-Limit` från konstanterna loggas en `warn` (en höjd gräns efter kapacitetsansökan ska uppdatera konstanterna, revisit-trigger).
- **Kostnad per händelse:** högst ett detaljanrop (`delete`-händelser kostar inget), plus högst ett tokenförnyelseanrop per användare och token-livslängd.
- **Väntan:** nås mjukgränsen skjuts de förfallna händelserna till nästa hela kvart + 30 s (eller UTC-midnatt + 1 min för dygnsgränsen); ett 429 gör detsamma. `attempts` rörs inte.
- **Budgetkoll, 30-minuters polling:** dagens förbrukning är cirka 290 läsanrop per dygn (6 löpare × 48 pollingvarv, plus ett detaljanrop per ny runda), alltså ungefär 10 % av läsgränsen 3 000. Med ett par dussin webhook-händelser per dygn (≈ 50 anrop) ryms båda med god marginal. **Polling var 30:e minut slår i dygnsgränsen vid cirka 60 Strava-löpare** (3 000 / 48 ≈ 62 listanrop per löpare och dygn, utan marginal för detaljanrop och webhook-händelser). **Webhooks ska därför vara klara, verifierade och pollingen sänkt (RUN-176) innan fler grupper bjuds in (RUN-95).** Efter RUN-176 (12 h) är pollingen 2 listanrop per löpare och dygn, alltså 12 för sex löpare och cirka 120 för 60. Det befintliga admin-endpointet `POST /strava/backfill-extended` (ett anrop per Strava-runda) bör inte köras medan en burst bearbetas.

### 10. Lasten från titelomräkning per händelse (RUN-99)
`calculateUserTotals` kör `processAllUsersTitles(groupId)` (alla gruppmedlemmar, sekventiellt, RUN-157) + `update_all_title_leaderboards` vid varje anrop. **Acceptabelt vid 6 användare:** en skrivning är sekunder (tidsloggen `calculateUserTotals:<id> completed in Nms` mäter det), och 042 serialiserar topplistan mot samtidiga körningar. Två åtgärder håller lasten nere utan att ändra reglerna: (1) **batch per användare** (beslut 6): en burst ger ett `calculateUserTotals`, inte ett per händelse; (2) **`noop`-händelser** (t.ex. bara ändrad titel) och journalförda händelser ger *ingen* omräkning. Sent hämtat väder räknar fortsatt om titlar för alla grupper via den befintliga `recalculateTitlesAfterWeather`. Ingen ny titelväg införs. Skulle det synas i praktiken (revisit-trigger) är nästa steg att debounca omräkningen per användare (t.ex. 60 s) eller räkna om titlar asynkront.

### 11. 48 h-larm, hälsa och retention
- **Larm (`error`-rad med prefix `🚨 KRITISKT: Strava-webhook`)**: (a) en händelse blir `dead` (äldre än 48 h utan att avslutas); (b) dygnskontrollen nedan hittar inte prenumerationen. Larmet skrivs en gång, vid övergången till `dead`.
- **Hälsoendpoint** `GET /api/strava/webhook/health` (admin): `{ success, data: { subscription_configured, pending, processing, dead, ignored_by_policy, oldest_pending_age_seconds, last_processed_at, unmapped_tokens } }`. Utan den vore ett larm bara en loggrad som ingen läser. (Första att stryka om v0.7.0 trängs, men larmet i loggen kvarstår.)
- **Retention (nattjobb 03:30 Europe/Stockholm, samma scheduler):** `done`-rader raderas efter **30 dygn**, `dead`-rader efter **90 dygn**. **`ignored_by_policy`-rader raderas inte** av jobbet: de är underlaget för det framtida villkorsarbetet (beslut 8) och är få (bara raderingar, privat-ifieringar, typbyten och frånkopplingar, för sex användare). Tabellen bär Strava-id:n och tidsstämplar, aldrig titel, koordinater eller token.
- **Dygnskontroll av prenumerationen** i samma nattjobb: `GET /push_subscriptions` (ett anrop/dygn) jämförs mot `STRAVA_WEBHOOK_SUBSCRIPTION_ID`. Saknas eller skiljer den → larm (b). Det är det enda som upptäcker att Strava slutat skicka (en tyst prenumeration ger inga `dead`-rader). Första att stryka efter hälsoendpointen.

### 12. Samtyckeslogg och samtyckets innehåll (D3, D4, ägarbeslut 2026-10-13)
- **Kolumner:** `strava_tokens.consent_version text`, `strava_tokens.consented_at timestamptz` (migration A, beslut 15).
- **`POST /strava/callback` kräver `consent_version`** i brödtexten och att den är lika med den aktuella konstanten `STRAVA_CONSENT_VERSION` i `packages/shared` (en källa för backend och frontend; byts varje gång samtyckestexten ändras). Saknas eller skiljer den → 400 `{ error: 'Consent required' }` *innan* koden byts mot token hos Strava. `consented_at` sätts av servern (`now()`), aldrig av klienten. Återanslutning skriver nya värden (upsert).
- **Krav på samtyckestexten.** Eftersom rundor nu stannar kvar blir texten själva grunden för att behålla dem. Texten ska vid "Connect Strava" **och** i /legal i landningsversionen tydligt säga:
  1. **Vad som importeras:** aktivitetens datum, distans, tid i rörelse, höjdmeter, starttid (lokal klocka), sporttyp, puls, startkoordinat, tempovariation och om det var på löpband (listan ovan under "Importerad data"), samt att väder hämtas för platsen. Texten måste hållas i takt med `extractExtendedFields`; en ändring av vad som importeras kräver ny text och ny `consent_version`.
  2. **Att importerade rundor stannar i RunQuest** även om man kopplar bort Strava eller raderar aktiviteten på Strava. *(Tillägg av arkitekten, följer ur beslut 7.3:)* detsamma gäller om man gör aktiviteten privat, och rundorna syns för gruppen.
  3. **Hur man begär borttagning:** manuellt via ägaren (kontaktväg anges i texten, Öppna frågor).
  Själva texten skrivs i **RUN-201** (Connect Strava) och **RUN-180** (/legal). `STRAVA_CONSENT_VERSION` får sitt första värde först när texten finns; backend och frontend byggs mot konstanten, inte mot en text.
- **D4:** de sex befintliga kopplingarna har **godkänt muntligt via ägaren**; ingen omgodkännande-popup och ingen omkoppling. `consent_version` och `consented_at` lämnas `null` för dem. `null` betyder alltså "kopplad före samtyckesloggen, godkänd via ägaren muntligt (2026-10-12)". /legal-texten gäller även dem.
- **Samtyckesbeviset överlever frånkoppling vid deauthorize** (beslut 7.4: raden behålls med null-tokens). Den raderas däremot av den befintliga `DELETE /strava/disconnect` (raden tas bort). Det är acceptabelt tills D8 byggs; ett beständigt bevis oberoende av raden kräver en separat append-only-tabell (revisit-trigger).

### 13. Reservpollingen (D6, D8, D12)
- **D6:** `SYNC_INTERVAL_MINUTES` stannar på **30** i v0.7.0. Webhooks ersätter inte pollingen förrän de är verifierade i prod; då sänks den till 12 h (RUN-176, utanför v0.7.0). *Verifierade* = rök-testet i beslut 17 passerat och sju dygn utan `dead`-rader eller larm (**mitt antagande**, ägaren kan ändra kriteriet).
- **Pollingen ändras inte i sak** utöver: mutexen (beslut 6), den delade importlogiken, att dess Strava-anrop räknas av räknarmodulen (beslut 9) och att `GET /strava/status` kräver en token (beslut 7.4).
- **D8:** en egen Disconnect-knapp (som också återkallar behörigheten hos Strava) byggs senare. Tills dess anropar `DELETE /strava/disconnect` bara databasen och Strava fortsätter skicka händelser för användaren; de ignoreras som okänd ägare (beslut 3.3).
- **D12:** raderingsavstämning (jämförelse mellan Strava och `runs`) utgår ur v0.7.0 och hör till det framtida villkorsarbetet (beslut 8.5). Pollingen fångar aldrig raderingar, och det är avsiktligt.

### 14. Strava-hållningen — hur ADR:n följer den (och var den medvetet inte gör det)
1. **Ingen AI/ML:** all bearbetning är deterministisk (beslut 1, 7). Ingenting av Strava-datan eller härledd data går till någon modell.
2. **Gruppavgränsning:** inga nya läs-endpoints för Strava-data utöver admin-hälsan (som bara har räknare, inga rundor). Rundor syns som förut bara via befintliga gruppavgränsade vägar.
3. **Raderingar via webhooks: följs medvetet INTE, med ägarens vetskap (2026-10-13).** Hållningen från 2026-10-07 sa att raderingar ska slå igenom. Ägaren har ändrat det till "behåll rundor" tills vidare. Webhooken tar emot och journalför raderingar, men agerar inte på dem (beslut 7.2, 8). Det avviker från Strava API Agreement 4.4 (Konsekvenser, "Känd avvikelse"). ADR 009 beslut 9.4 uppfylls villkorligt: kedjan är fastlagd (beslut 8) men inte aktiv.
4. **Lagring orörd:** händelsetabellen lagrar *inget* av det Strava-data som finns i `runs`: ingen titel (vitlistade `updates`), inga koordinater, ingen token, inget aktivitetsinnehåll, bara Strava-id:n, händelsetyp och tidsstämplar, med retention (beslut 11). Nytt per användare är `strava_athlete_id` (Stravas identifierare, krävs för mappningen) och samtyckeskolumnerna. Detta flaggas i Konsekvenser.
5. **Inga analyser över användare:** workern räknar bara egna händelser och Strava-användning per app.

### 15. Migrationer (numreras vid bygget, 044+) och körordning
Senaste migration i repot är 042 (applicerad). RUN-225 (v0.6.2) tar 043. ADR 010:s migrationer numreras därför vid bygget **från 044** enligt ADR 002 beslut 3 ("nästa lediga över repo och ledger"; reserverade nummer räknas som tagna; ADR 011 tar också nummer). En fil per logisk ändring, var och en ett eget ägar-ja, via `apply_migration`, idempotenta (`if not exists`), och med `get_advisors security` efteråt:

| Preliminärt | Innehåll | Typ |
|---|---|---|
| **044+ A** — `strava_tokens` athlete + samtycke | `strava_athlete_id bigint`, `consent_version text`, `consented_at timestamptz`, partiellt unikt index på `strava_athlete_id` (beslut 4, 12). | Additiv (expand) |
| **044+ B** — `strava_webhook_events` + claim-RPC | Tabellen, index, RLS utan policyer, `revoke`, `claim_strava_webhook_events` (beslut 5, 6). | Additiv (expand) |

*(Den tredje migrationen i utkastet, `event_entries.run_id` → `ON DELETE SET NULL`, har utgått: ingen runda raderas av Strava. Den hör till den framtida raderingsvägen, beslut 8.2.)*

**Körordning relativt deploy (expand före kod, ADR 002):** **A och B körs båda FÖRE backend-deployen.** A före deploy är obligatoriskt: den nya callbacken skriver kolumnerna, och en deploy före migrationen gör att *anslutning av Strava* börjar felas. B krävs innan någon händelse tas emot. Båda är bakåtkompatibla med dagens kod (gammal kod ignorerar nya kolumner och tabellen), inbördes oberoende och oberoende av 043. Statiska migrationstester (mönstret från `titleLeaderboardLockMigration.test.ts`): B:s RPC har `set search_path to ''` och `revoke execute`, statuslistan innehåller `ignored_by_policy`, A har det partiella unika indexet. Rollback: kommenterad SQL i varje filhuvud (A: släpp kolumnerna och indexet; B: släpp funktionen och tabellen).

### 16. Utrullning
1. Ägar-ja per migration; applicera A och B (beslut 15). `list_migrations` och `get_advisors security`.
2. Deploya backend (merge release → main, grön CI; Railway deployar). Verify-variabeln är *inte* satt än: `GET` svarar 503, `POST` svarar 200 och kastar. Frontendens samtyckesflöde (RUN-201, med färdig text) deployas samtidigt eller före: en ny backend kräver `consent_version` i callbacken, så **en gammal frontend mot ny backend kan inte ansluta Strava** förrän frontenden är ute. De sex redan anslutna berörs inte.
3. `backfillStravaAthleteIds.ts` dry-run → ägaren ser rapporten → `--apply` (ask). Kontrollera att alla aktiva kopplingar har athlete-id och att inga dubbletter finns.
4. Ägaren sätter `STRAVA_WEBHOOK_VERIFY_TOKEN` i Railway (redeploy). Skapa prenumerationen med skriptet (`create`, ask). Strava anropar `GET`. Ägaren sätter `STRAVA_WEBHOOK_SUBSCRIPTION_ID` (redeploy). **Gluggen mellan skapandet och den sista variabeln täcks av pollingen (beslut 2).**
5. Rök-test (beslut 17). Därefter sju dygn av övervakning innan RUN-176 (D6).
6. **Rollback:** `delete` av prenumerationen med skriptet (ask) stoppar nya händelser; workern är då tom och pollingen (30 min) bär hela synken som förut. Tabellerna och kolumnerna är additiva och lämnas orörda. Frontend- och backend-rollback följer `docs/release.md`.

### 17. Teststrategi (ADR 001, Produkt-läge)
Workern byggs som ren orkestrering över **portar** (`WebhookEventStore`, `StravaApi`, `RunStore`, `Recompute`) så att den kan beteendetestas utan den obyggda fake-Supabase-klienten (ADR 009-mönstret).

| Vad | Nivå | Innehåll |
|---|---|---|
| `buildWebhookDedupeKey`, vitlistning av `updates` | Enhetstest | Samma brödtext → samma nyckel; olika `updates`/`event_time`/`aspect_type` → olika; `title` ingår aldrig i varken nyckel eller lagrad `updates`; kanonisk nyckelordning |
| Beslutsfunktionen "Strava-tillstånd → åtgärd" (ren) | Enhetstest | Tabellen i 7.1: 200-löpning/ny, /ändrad, /oförändrad = `noop`, typbyte, privat, 404 (`create` och `update`), 401, 429, 5xx; `distance <= 0`; **ingen gren returnerar en radering** (kontrakt: åtgärdstypen "delete run" finns inte) |
| Backoff, rate-budget, `next_attempt_at` | Enhetstest | Schema `[1,5,15,60]`, 48 h-gräns → `dead`, 429/mjukgräns skjuter upp utan att öka `attempts`, kvartsgräns och UTC-midnatt, huvudparsning |
| Worker, batch och ordning | Beteendetest mot in-memory-store | `create`→`update` och omvänd ordning ger samma slutläge; en burst ger **ett** `reprocessRunsFromDate` + **ett** `calculateUserTotals`; en fastnad händelse blockerar inte de andra; omförsök (`attempts ≥ 1`) räknar om även vid `noop`; utgången lease återtas som misslyckat försök |
| **Rundor behålls** | Beteendetest (zon 1) | `delete`-händelse → rundan, XP, `event_entries`, badges kvar och inget `calculateUserTotals`-anrop; `update` till privat/Ride/404 → rundan orörd, rad `ignored_by_policy` med rätt `outcome`; deauthorize → tokens `null`, rundor kvar, `status`-endpointen visar inte "connected"; en manuell runda berörs aldrig |
| Skydd | Route-test (supertest mot `createApp()`) | `GET` med rätt/fel/ingen `verify_token` (200/403/503); `POST` med fel `subscription_id` → 403; okänd ägare → 200 utan rad; okänd `aspect_type` → 200 utan rad; dubblett → en rad; DB-fel → 500; `delete` sparas direkt som `ignored_by_policy`; svar utan att bearbetning avvaktas; förfalskad `authorized:"false"` mot en giltig koppling tar inte bort token; ingen loggrad innehåller `verify_token`, titel eller brödtext (utökar sensitive-logging-testet) |
| Callback | Route-test | Saknad/fel `consent_version` → 400 före tokenbytet; `athlete.id` + `consented_at` sparas; samma athlete på två användare → 409; återanslutning skriver om samtycket |
| Mutex | Enhetstest | Polling och worker för samma användare körs aldrig överlappande; olika användare gör det |
| Migrationer A–B | Statiskt test | Se beslut 15 |
| Backfill-skriptet | Enhetstest av byggfunktionerna; dry-run skriver inget | Dubblettrapport |
| Prenumerationsskriptet | Enhetstest av förfrågans form | `view` skriver inget |
| Frontend | RTL/Vitest | Anslutningsflödet skickar `consent_version`; saknad bockruta blockerar popup; samtyckestexten innehåller de tre kraven i beslut 12 (testas mot textkällan i RUN-201) |
| **Rök i prod (efter beslut 16.4)** | Manuell, ägaren + Lead | (1) logga en kort löprunda på Strava → rundan syns inom ~1 min med XP; (2) ändra distansen → uppdaterad, XP omräknad; (3) ändra bara titeln → `noop`; (4) gör rundan privat → **rundan ligger kvar**, rad `ignored_by_policy`; (5) gör den publik igen → synkas; (6) radera aktiviteten på Strava → **rundan ligger kvar**, rad `delete_event`; (7) skicka samma POST två gånger med `curl` → en rad; (8) POST med fel `subscription_id` → 403; (9) `health` visar 0 `dead`. |
| E2E (Playwright) | Ej nu | Villkorat av icke-prod-miljö (ADR 001) |

## Konsekvenser
- **Känd avvikelse från Strava API Agreement 4.4 — accepterad av ägaren 2026-10-13.** Avtalet kräver att Strava Data raderas (när användaren raderar på Strava, kopplar bort appen eller begär det). Den här lösningen behåller importerade rundor i alla tre fallen. Ägaren accepterar det medvetet tills vidare, med motiveringen att det är en liten privat app med sex användare och att villkoren tas in längre fram; samtycket förtydligas så att användarna vet vad de går med på (beslut 12). Det här är en medveten risk och inte en lösning av problemet: **(a)** en Strava-granskning, t.ex. i samband med den kapacitetsansökan som ägarens hållning redan väntar på, kan upptäcka avvikelsen och i värsta fall leda till att API-åtkomsten ändras eller dras in; **(b)** en användare som gör en aktivitet privat eller raderar den på Strava kan förvänta sig att den försvinner, vilket den inte gör (texten måste säga det); **(c)** varje dag som går ökar mängden data som ligger kvar och som i så fall måste rensas i efterhand.
  **Det som måste göras när villkoren tas in (checklista):** (1) bygg den raderingsväg som står i beslut 8, inklusive migrationen `event_entries.run_id` → `ON DELETE SET NULL` (D2); (2) låt deauthorize radera användarens `source='strava'`-rundor; (3) låt privat-ifiering, typbyte och radering på Strava ta bort rundan (D7 som i utkastet); (4) rensa i efterhand med `ignored_by_policy`-journalen som arbetslista; (5) bygg raderingsavstämningen (tidigare RUN-177) för händelser som aldrig levererades; (6) revidera samtyckestexten och höj `STRAVA_CONSENT_VERSION`, och ta ställning till om de sex äldre kopplingarna ska godkänna den nya texten; (7) ompröva hur länge `ignored_by_policy`-raderna sparas; (8) se över hela Strava-datahanteringen mot avtalet som helhet, inte bara 4.4 (lagring, visning, härledd data). Triggers för att göra detta står under Revisit-triggers.
- **Ny datalagring — flaggad (hård gräns, extern datalagring/persondata):** (1) en ny tabell `strava_webhook_events` (Strava athlete-id, aktivitets-id, händelsetyp, tidsstämplar och vitlistade flaggor, **ingen titel, inga koordinater, ingen token**; retention 30/90 dygn, `ignored_by_policy` behålls), (2) tre nya kolumner på `strava_tokens` (`strava_athlete_id`, `consent_version`, `consented_at`). `strava_athlete_id` är en Strava-identifierare som kopplas till en användare, och samtyckesloggen är personuppgifter om samtycke. Båda migrationerna kräver ägarens uttryckliga ja var för sig, körs via `apply_migration` och är additiva och bakåtkompatibla. **Skrivningen i prod som skriptet för athlete-id gör är `ask`.** Ingen anon-åtkomst (RLS på, inga policyer, `revoke`). Ingen FK ändras och ingen data raderas.
- **Appen raderar inga rundor** på grund av Strava. Den enda nya skrivningen mot `strava_tokens` utöver anslutningen är att null-ställa token vid deauthorize (beslut 7.4).
- **Inga nya externa tjänster och ingen kostnad** (ingen 15c-flagga). Strava-API:t och prenumerationen är gratis, tabellen är några tiotal rader per dygn, och workern lånar den befintliga backend-processen. Höjda Strava-gränser kräver kapacitetsansökan (ägarens spår, utanför ADR:n).
- **Positivt:** nya och ändrade aktiviteter kommer in direkt och ändringar följer med (pollingen kan senare sänkas från 30 min till 12 h, vilket minskar Strava-trafiken ungefär 24 gånger, RUN-176); händelsernas livscykel är spårbar och larmbar; inget kan radera data (förfalskade händelser är ofarliga); det framtida villkorsarbetet har både en journal och en granskad raderingsväg att utgå från; ingen FK-ändring och därmed en migration mindre och ingen ändrad raderingssemantik för manuella rundor.
- **Negativt/risker:**
  1. **Inga signaturer.** Skyddet vilar på beslut 1 och på att inget en händelse kan göra är destruktivt. Förfalskade händelser kan förbruka anropsbudget och fylla tabellen upp till golvet (beslut 3.7).
  2. **En replika.** Mutex är in-process; claim-RPC:n skyddar ändå mot samtidiga workers (deploy-överlapp), men pollingen skyddas bara i processen (revisit-trigger).
  3. **Stravas webhook-beteende** (retry, 2 s, deauthorize-händelsen, 404 för privata aktiviteter, när access-token blir ogiltig) är hämtat ur dokumentation, inte testat. Rök-testet är den första verkliga verifieringen; delar av beslut 7 kan behöva justeras.
  4. **`activity:read` ger inte `private`-flaggan.** En privat-ifiering ser vi som 404 och kan inte skilja den från en radering (`kept_not_visible`).
  5. **En privat-ifierad aktivitet förblir synlig för gruppen här** och följer inte längre Strava-tillståndet (rundan fryses vid sin senaste synkade version). Det är konsekvensen av "behåll rundor" och måste stå i samtyckestexten (beslut 12).
  6. **Mellan prenumerationens skapande och att `STRAVA_WEBHOOK_SUBSCRIPTION_ID` sätts** kastas händelser (täcks av pollingen).
  7. **Tokens ligger fortfarande i klartext** (STATE zon 2); webhooks försämrar inte det men löser det inte.
  8. **De sex befintliga har bara ett muntligt godkännande via ägaren** (D4). /legal-texten täcker dem framåt.
  9. **Titelomräkning per batch** är fortfarande tung på större grupper (beslut 10; acceptabelt vid 6).
  10. **Samtyckesrad efter `DELETE /strava/disconnect`:** den befintliga disconnect raderar raden, och därmed samtyckesbeviset, men inte rundorna. Följer av D8 (knappen byggs senare).
  11. **Pollingens läsbudget tar slut vid cirka 60 löpare** (beslut 9). Webhooks och RUN-176 måste vara klara före fler grupper (RUN-95).
- **Produktionsrisk (zon 1/5/6):** ny sidoväg in i skrivvägen (zon 1) via en ny worker. Mildras av att den bara anropar de befintliga `reprocessRunsFromDate`/`calculateUserTotals` (ingen ny XP-logik, ingen radering), batchar per användare, delar mutex med pollingen och är idempotent. `routes/strava.ts` (zon 5/10, ~984 rader) får en refaktorering (delad importlogik, `stravaClient`) och en ändrad `/status`, vilket kräver att pollingens befintliga tester är gröna före och efter. Ny kod läggs i egna filer och inte i `strava.ts`.
- **Skrivrättigheter:** bara backend (service role) rör `strava_webhook_events`, och bara workern och routern; bara `calculateUserTotals`-kedjan skriver totaler (ADR 005 oförändrad).
- **Arkitekturdiagram (uppdaterat i samma commit som ADR:n, ägarens instruktion):** `docs/architecture/runquest-architecture.json` har en ny komponent "Strava-webhook" (router + worker, i backend-processen) med pil Strava → webhook, rader i Data-kortet (ADR 010 och ADR 011 enligt dess Konsekvenser), Schemalagt-kortet och Förtroendegränser-kortet, och ett nytt sekvensdiagram `docs/architecture/rq-7-strava-webhook.json`. Tabellräknaren i `db` och `rq-2-rundans-vag.json` (ägarens fil, `rankNews` som tredje observatör enligt ADR 011) rörs inte här. HTML genereras om (archify) av Lead. Under bygget rörs diagrammet inte.
- **STATE.md-ändringar att föreslå (Lead skriver):** (1) ADR-index: rad 010 (nedan). (2) Stack: miljövariablerna `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_WEBHOOK_SUBSCRIPTION_ID`; Databas: +1 tabell (`strava_webhook_events`) efter migration B (29 tabeller om även ADR 011:s två tabeller körts). (3) Zon 5: "synken är insert-only" ersätts av "webhooks (ADR 010) för nya och ändrade aktiviteter; pollingen kvar som reserv (30 min → 12 h efter RUN-176); **Strava-rundor behålls vid radering, privat-ifiering och deauthorize på Strava (ägarbeslut 2026-10-13) — känd avvikelse från Strava API Agreement 4.4, se ADR 010**". (4) Kritiska flöden: nytt flöde 10 "Strava-webhook (ADR 010) — Strava POST → `strava_webhook_events` (200 inom 2 s) → worker → detaljanrop → runda infogas/uppdateras → `reprocessRunsFromDate` → `calculateUserTotals` → `evaluateBadges`. Rök: ändra distansen på en Strava-aktivitet → rundan uppdateras; radera den på Strava → rundan ligger kvar och en `ignored_by_policy`-rad skrivs; samma POST två gånger ger en rad". (5) Konventioner: "Strava-händelser är signaler: tillståndet hämtas alltid från Strava; ordning avgörs aldrig av `event_time`; ingen kod raderar en runda p.g.a. Strava" och "`strava_tokens.strava_athlete_id` = mappningen från Stravas `owner_id` till användare; samtycke loggas i `consent_version`/`consented_at` (null = kopplad före loggen, godkänd muntligt via ägaren); en frånkopplad rad har null-tokens". (6) Behörigheter (docs/permissions.md): prenumerationsskriptet `create`/`delete` = ask, backfill av athlete-id `--apply` = ask. (7) Zon 6: webhook-workern startas som en scheduler bara i `NODE_ENV=production`. (8) Läge/Nästa: villkorsarbetet (Konsekvenser, checklistan) som öppet framtida spår.
- **Jira (inget skrivet här):** epic RUN-93 (v0.7.0) finns. RUN-175 (deauthorize-rundor) och RUN-177 (raderingsavstämning) utgår ur v0.7.0 (rundor behålls); RUN-176 (12 h-polling) ligger utanför v0.7.0 och beror på verifierade webhooks. RUN-201 (Connect Strava) och RUN-180 (/legal) bär samtyckestexten (beslut 12). RUN-225 (migration 043, v0.6.2) är oberoende.

## Avvisade alternativ
- **Radera rundor automatiskt vid delete/privat/typbyte/deauthorize (utkastets beslut 7–8).** Avvisat av ägaren 2026-10-13: "behåll rundor", med motiveringen att appen är liten och privat och att villkoren tas in längre fram. Raderingskedjan är kvar som dokumenterad framtida väg (beslut 8). Den är den lösning som följer Strava API Agreement 4.4.
- **Migration C (`event_entries.run_id` → `ON DELETE SET NULL`) nu.** Avvisat: behövs bara om en runda raderas av Strava.
- **Bearbeta händelsen i POST-handlern innan svaret.** Avvisat: Strava kräver 200 inom 2 s, och en bearbetning med Strava-anrop, omräkning av totaler och titlar tar längre. Strava skulle leverera om, och vi skulle bearbeta dubbelt.
- **Lita på händelsens innehåll** (`updates.private`, `updates.type`). Avvisat: ingen signatur → en förfalskad händelse kunde ändra data; dessutom kan händelser komma i fel ordning. Pris för att hämta alltid: ett Strava-anrop per `create`/`update`, väl inom budgeten (beslut 9).
- **Kö i minnet utan tabell.** Avvisat: Railway deployar vid varje push till `main`, och en omstart tappar köade händelser (och Strava levererar bara tre gånger). Tabellen ger också 48 h-larmet och journalen.
- **Extern kö/tjänst** (Redis/BullMQ, pgmq, Inngest, Supabase Queues). Avvisat enligt build-vs-buy: ny infrastruktur, kostnad och ett nytt driftställe för ett par dussin händelser per dygn; en Postgres-tabell med lease räcker och följer redan etablerade mönster (ADR 008, claim-före-arbete i zon 6).
- **Advisory-lås per användare över hela bearbetningen** (042-mönstret). Avvisat: `pg_advisory_xact_lock` är transaktionsbundet inne i en SQL-funktion, och bearbetningen går över HTTP och flera PostgREST-anrop (varje en egen transaktion). Ett sessionslås skulle hålla en poolad anslutning under Strava-anrop. 042-mönstret återanvänds därför bara för claim-steget (en kort kritisk sektion) och kompletteras med lease i tabellen och en in-process-mutex.
- **En omräkning per händelse.** Avvisat: en burst skulle ge en gruppomräkning av titlar per händelse (RUN-99). Batch per användare ger samma slutläge med en omräkning.
- **Dedupe på `(object_id, aspect_type, event_time)` utan `updates_hash`.** Avvisat: två olika ändringar av samma aktivitet i samma sekund skulle slås ihop (den ena försvinner).
- **Athlete-id enbart via pollingen** (`activity.athlete.id` ur listan). Avvisat som enda mekanism: en användare utan aktiviteter i fönstret får aldrig sitt id. Skriptet är deterministiskt och verifierbart före prenumerationen.
- **Radera hela `strava_tokens`-raden vid deauthorize.** Avvisat: samtyckesbeviset skulle försvinna medan rundorna ligger kvar. Null-ställda tokens ger "tokens bort" och bevarar beviset.
- **Spara hela händelsen inklusive `title`.** Avvisat: titeln är fritext = Strava-data utan nytta för oss (hållningen "lagring orörd").
- **Hemlig sökvägsdel i `callback_url` redan nu.** Inte nu: osäkert hur Strava hanterar sökvägen vid verifieringen, och beslut 1 gör förfalskade händelser ofarliga. Läggs till om förfalskningar börjar synas.
- **Separat webhook-tjänst** (ADR 003 revisit-trigger). Avvisat: samma app, samma DB-åtkomst, en replika; en andra tjänst vore driftkostnad utan vinst.
- **Sänka pollingen till 12 h redan i v0.7.0.** Avvisat av D6.

## Öppna frågor
Genuint öppna för ägaren:
1. **Villkorsarbetet.** Vad ska få oss att ta in Stravas villkor och göra checklistan i Konsekvenser (t.ex. kapacitetsansökan, fler användare, att Strava hör av sig, en användare som ber om borttagning)? Tills dess behåller vi allt och journalför.
2. **Kontaktväg i samtyckestexten.** Texten ska säga att man begär borttagning manuellt via dig. Vilken kontaktväg ska stå där (e-post, annat)? Och ska den finnas på svenska, engelska eller båda?
3. **Privat-ifierade aktiviteter.** Ska texten uttryckligen säga att en aktivitet man gör privat på Strava ändå ligger kvar och syns för gruppen i RunQuest? (Rekommenderat: ja, eftersom det är det som faktiskt händer.)

Antaganden som ägaren kan ändra (ADR:n har valt):
4. **Frånkopplad rad.** Vid deauthorize nollställer vi bara token och behåller raden (så att samtyckesbeviset finns kvar). Okej?
5. **När är webhooks "verifierade"** (för att sänka pollingen till 12 h)? Förslag: rök-testet i prod har passerat och det gått sju dygn utan fel eller larm.
6. **Hur länge sparas händelserna?** Förslag: 30 dygn för avklarade, 90 dygn för felande, och raderings-/privat-/frånkopplingsjournalen (`ignored_by_policy`) tills villkorsarbetet är gjort.
7. **Strava-id för de sex.** Okej att ett engångsskript frågar Strava en gång per person (sex anrop) för att fylla i deras Strava-id? Du ser rapporten före skrivningen.
8. **Samma Strava-konto på två RunQuest-användare** blockeras nu (det går i dag). Okej?

*(Utgått sedan utkastet: D1 deauthorize är avgjord ("behåll rundor"); frågan om att appen själv raderar rundor är borta.)*

## Revisit-triggers
- Kapacitetsansökan till Strava, fler användare, kontakt från Strava eller en användare som ber om borttagning → gör villkorsarbetet (Konsekvenser, checklistan): bygg beslut 8, inklusive migrationen `ON DELETE SET NULL`, och rensa med `ignored_by_policy`-journalen.
- Webhooks verifierade → RUN-176 (12 h).
- Förfalskade händelser syns i `warn`-loggen → hemlig sökvägsdel i `callback_url`.
- Fler än en backend-replika → databaslease även för pollingen i stället för in-process-mutex.
- Kapacitetsansökan höjer gränserna eller `X-ReadRateLimit-Limit` skiljer sig → uppdatera konstanterna i beslut 9.
- Fler än ~20 användare eller `calculateUserTotals` > ~5 s → debounca eller asynkronisera titelomräkningen (beslut 10).
- Scope ändras till `activity:read_all` → `private`-flaggan blir synlig; utfallsnamnen skärps.
- D8 (Disconnect-knapp) byggs → återkalla behörigheten hos Strava, ompröva "okänd ägare" (beslut 3.3) och vad som händer med samtyckesraden.
- Tokens flyttas ur klartext (datasäkerhets-ADR) → ompröva `strava_tokens`-kolumnerna.
- Samtyckestexten ändras eller importen utökas → ny `STRAVA_CONSENT_VERSION` (beslut 12).
- Notiser/realtid byggs (ADR 011) → webhooken kan bli en källa för notiser (ADR 008 beslut 11).
- Multi-grupp → gruppavgränsad titelomräkning per händelse (beslut 10); staging krävs då enligt STATE.
- Stravas verkliga beteende i rök-testet avviker från de externa fakta i Kontext → revidera ADR:n.

---

## Beslutsöversikt

| Rad | Fråga | Beslut | Av |
|---|---|---|---|
| Ö1 (D1) | Deauthorize: radera rundor? | **Behåll rundor**, tokens null-ställs (raden behålls) | Ägaren 2026-10-13 |
| Ö2 (D2) | Event-runda raderad på Strava | Överflödigt (ingen radering); `SET NULL` hör till framtida raderingsväg | Ägaren 2026-10-12, överflödigt 2026-10-13 |
| Ö3 (D3) | Samtyckeslogg | Ja, `consent_version` + `consented_at` på `strava_tokens`; callbacken kräver `consent_version`; texten ska säga tre saker (beslut 12) | Ägaren |
| Ö4 (D4) | De sex befintliga | Muntligt godkända via ägaren, `consent_version` null | Ägaren |
| Ö5 (D6) | Reservpolling | 30 min tills verifierat i prod, sedan 12 h (RUN-176) | Ägaren |
| Ö6 (D7) | Privat/typbyte | **Behåll rundan**, journalför (vänd 2026-10-13) | Ägaren 2026-10-13 |
| Ö7 (D8) | Disconnect-knapp | Senare, utanför v0.7.0 | Ägaren |
| Ö8 (D12) | Raderingsavstämning | Utgår ur v0.7.0; hör till villkorsarbetet | Ägaren 2026-10-13 |
| Ö9 | Radera rundor p.g.a. Strava | Nej tills vidare; **känd avvikelse från Strava API Agreement 4.4** | Ägaren 2026-10-13 |
| – | Händelsen är en signal; tillståndet hämtas alltid från Strava | Ja (skydd utan signatur, ordning, idempotens) | Arkitekten (förslag) |
| – | Idempotensnyckel | `strava:<type>:<id>:<aspect>:<event_time>:<updates_hash>` | Arkitekten (förslag) |
| – | Kö, claim, retry | Tabell + lease-RPC (042-mönster för claim), batch per ägare, backoff `[1,5,15,60]` min, `dead` efter 48 h | Arkitekten (förslag) |
| – | Mappning Strava → användare | `strava_tokens.strava_athlete_id` (unikt) + engångsskript för de sex | Arkitekten (förslag) |
| – | Rate limits | Läsgräns 300/15 min och 3 000/dygn (totalt 600/6 000) som konstanter; mjukgräns 210/2 100 (≈ 70 %) för workern | Appens inställningar i Strava, kontrollerat 2026-10-07; mjukgränsen är arkitektens förslag |
| – | Retention | 30 dygn avklarade, 90 dygn felande, `ignored_by_policy` behålls | Arkitekten (förslag) |
| – | Två migrationer 044+ | Ett ägar-ja per migration | Ägaren |

## Föreslagen STATE.md-indexrad
```
  010 · Godkänd · Strava-webhooks (rundor behålls): POST /api/strava/webhook (+ GET-verifiering) svarar 200 inom 2 s och sparar i strava_webhook_events (unik dedupe_key strava:<typ>:<id>:<aspekt>:<event_time>:<updates_hash>); en worker hämtar ALLTID aktiviteten från Strava (händelsen är bara en signal; skydd utan signatur, ordning avgörs aldrig av event_time) och infogar/uppdaterar runda via reprocessRunsFromDate → calculateUserTotals → evaluateBadges; INGEN runda raderas p.g.a. Strava (delete-händelse, privat, typbyte, deauthorize journalförs som ignored_by_policy; deauthorize null-ställer bara tokens) = känd avvikelse från Strava API Agreement 4.4, ägarbeslut 2026-10-13, raderingskedjan dokumenterad för framtiden; claim med lease-RPC (042-mönster) per ägare i batch, retry 1/5/15/60 min, dead + larm efter 48 h, retention 30/90 d; Strava-läsgräns 300/15 min och 3 000/dygn (appens inställningar 2026-10-07) som konstanter med mjukgräns ≈ 70 %; polling var 30:e minut slår i läsgränsen vid ~60 löpare, så webhooks ska vara klara före fler grupper (RUN-95); strava_tokens får strava_athlete_id + consent_version/consented_at (callback kräver consent_version, samtyckestexten ska säga vad som importeras, att rundor stannar, hur man begär borttagning; de sex befintliga null = muntligt godkända); polling 30 min tills verifierat (D6); två migrationer 044+ kräver ägargodkännande
```
