# Behörigheter — RunQuest

Projektspecifika regler. Basen är `~/.claude/agent-approval-policy.json`
(mänskligt läsbar sanning) speglad i `.claude/settings.json` (teknisk spärr,
genereras från `templates/settings-src/` — redigeras ALDRIG för hand).
Vid konflikt vinner denna fil (beslut i lead-orchestrator-definitionen).

## Projektläge

RunQuest är en LIVE-PRODUKT (runquest.dev) med 6 aktiva användare.
Produktionsmiljön är skarp — "det är bara en testgrupp" är inte ett skäl
att sänka kraven.

## Produktionsgränser (utöver baspolicyn)

| Åtgärd | Regel |
|---|---|
| Migration mot Supabase-produktion (projekt `yrrqaxdngayakcivfrck`) | **ask** — alltid uttryckligt godkännande av ägaren, även för "ofarliga" DDL. Migrationsfil committas i `apps/backend/migrations/` i samma veva |
| Ändra RLS-policyer eller auth-flöden | **ask** |
| Push till `main` | Triggar Railway-deploy av BÅDA tjänsterna = produktionsdeploy. Kräver grön verifiering lokalt (backend-tester + frontend-build) före push |
| Ändra Railway-variabler för tjänsterna | **ask**; hemliga värden (secret keys) klistras aldrig i chatt/kod — ägaren lägger in dem i Railway-UI:t själv |
| Radera data i produktion (users/runs/etc.) | **ask**, alltid med exakt omfattning angiven |
| Backfill-skript mot produktion (`backfill:activity-log`, `backfill:strava-athlete` m.fl.) | dry-run fritt; **`--apply` = ask** med dry-run-rapporten som underlag. Skript skriver alltid ut måldatabasens host. En ev. rensning (`delete … where is_backfill`) = ask |
| Stravas webhook-prenumeration (`strava:webhook create` och `strava:webhook delete`, `--apply`) | **ask**. Prenumerationen är EN per Strava-app och gemensam för alla miljöer, så en `create` eller `delete` gäller även de andra miljöerna; en `delete` stoppar alla nya händelser. Utan `--apply` är båda dry-run (fritt) och `view` är bara läsning. Skriptet skriver ut vad det gör och sätter aldrig en Railway-variabel |
| Staging-skripten (`staging:migrate`, `staging:seed-reference`, `staging:seed-group`, `staging:schema-diff`) | Skriver bara till staging (projekt `aormctqrmguvncxrigwy`, hårdkodat), `--apply` fritt, inget ägar-ja. Prod läses bara med `--read-prod`, med en egen token (`RUNQUEST_PROD_READ_TOKEN`), via Management-API:ts skrivskyddade endpoint och ur en fast lista av SELECT-satser (konfigurationstabellerna och katalogfrågorna). Läsning av annat i prod = ask. Skripten körs aldrig av CI eller av builders mot riktiga projekt, bara av Lead |
| Skriptet `create:group` (`apps/backend/src/scripts/createGroup.ts`, ADR 012) | Går mot den databas som `SUPABASE_URL` pekar på, så målet avgörs av URL:en, inte av en flagga. Staging (`aormctqrmguvncxrigwy`): dry-run och `--apply` fritt, bara för Lead. Prod (`yrrqaxdngayakcivfrck`): **ask** för både dry-run och `--apply`, eftersom även en dry-run läser användare och medlemskap där. Båda vägras utan `--allow-prod`, och `--apply` kräver dessutom `--confirm-prod=I-HAVE-THE-OWNERS-YES-FOR-yrrqaxdngayakcivfrck`. Lead använder flaggorna först efter ägarens uttryckliga ja i den aktuella tråden, och **aldrig för en testgrupp i prod** (ägarbeslut F5). Skriptet skriver ut måldatabasens host, skriver aldrig ut inbjudningskoden utan `--show-invite-code` och körs aldrig av CI eller av builders |
| Tokennyckeln `TOKEN_ENCRYPTION_KEY` / `TOKEN_ENCRYPTION_KEYS_RETIRED` i Railway (ADR 013) | **ask**. Värdet skapas och läggs in av ägaren ([`runbook-token-key.md`](runbook-token-key.md)). Det skrivs aldrig i chatt, kod, commit, Jira eller logg; systemet loggar bara nyckel-id (`kid`) |
| Backfill-skriptet `backfill:strava-token-encryption` (ADR 013 S4) | dry-run fritt, men skriver aldrig ut miljön; **`--apply`, `--refresh-tokens` och `--decrypt` = ask** med dry-run-rapporten som underlag |
| CHECK-migrationen som får databasen att vägra okrypterade tokens (ADR 013 S6) | **ask**, som alla prod-migrationer |
| Radera en tokenrad som inte går att läsa (`token_unreadable`) | **ask**, alltid med exakt omfattning (vilka användare) |
| Misstänkt läckt tokennyckel | Ägaren roterar enligt runbooken och anmäler till developers@strava.com snarast och senast inom 24 timmar (Stravas API Agreement §1.2) |
| Agenter och ett riktigt nyckelvärde | **never_allowed**: läsa, skriva ut eller föreslå ett riktigt värde för tokennyckeln |
| `railway run` med ett skript som skriver ut miljövariabler | Räknas som exponering av hemligheterna: **never_allowed** |
| Force-push | **never_allowed** |
| Hemligheter i kod eller committade filer | **never_allowed** — env-variabler är enda vägen (lärdom: PAT- och service role-läckorna, åtgärdade 2026-10-03/04) |

## Supabase-åtkomst

- **Inga AI på Strava-data gäller också agenterna** (ägarkrav; Release Council v0.8.0). Lead och agenter som når prod- eller
  stagingdatabasen (Supabase-MCP) eller tjänsternas loggar (Railway-MCP) läser aldrig innehåll i `runs`, `strava_tokens`,
  `strava_webhook_events` eller `run_weather`, och aldrig loggrader med Strava-aktivitetsnummer eller koordinater. Tillåtet är antal,
  kontrollsummor över icke-Strava-kolumner, katalogfrågor (schema, behörigheter, index), statuskoder, räknarna i
  `GET /api/strava/webhook/health` och fasta loggrader som `🔐 …` och `🛰️ …`. Behövs mer för en felsökning gör ägaren det själv.
- Backend använder secret-nyckeln (env i Railway). Frontend har ingen
  Supabase-klient och inga Supabase-nycklar (RUN-105) — den pratar bara med
  backenden (`VITE_API_URL`) med backend-JWT.
- RLS-baslinje efter migration 030 + 031 + 038 + 039 + 040 + 051 + 053 + 054 + 055 + 056 + 057 (055 och 056
  från och med att de applicerats i prod; 052, 053, 054 och 057 applicerades i prod 2026-10-19): anon läser ingenting. Det finns INGA policyer för rollerna
  anon, authenticated eller public (038, 040) och ingen klientroll kan läsa
  `title_leaderboard_view` (039). RunQuest använder inte Supabase Auth (egen
  backend-JWT); en ny policy för anon eller authenticated = avvikelse →
  eskaleras. Storage (migration 051, RUN-276, applicerad i prod 2026-10-18):
  `storage.objects` har inga policyer alls, så anon och authenticated nekas både
  skrivning och listning via API:t. Prod hade fyra policyer för rollen public
  (SELECT på bucketen, samt INSERT/UPDATE/DELETE som krävde
  `auth.role() = 'authenticated'`); alla är borttagna. Bucketen `profile-pictures`
  är publik och dess bilder nås via den publika URL:en
  (`/storage/v1/object/public/...`), som inte går genom RLS. Uppladdning,
  ersättning och radering sker bara i backend med service role
  (`POST /api/users/profile-picture`). Bucketen har `file_size_limit` 5 MB och
  `allowed_mime_types` jpeg, png, webp och gif, i takt med `routes/users.ts`. En
  ny storage-policy för anon eller authenticated, eller en ny bucket, räknas som
  avvikelse och eskaleras. En rollback av 051 öppnar skrivning för varje Supabase
  Auth-session igen och kräver ägar-ja. Frontend läser inte `level_requirements` direkt
  (`GET /api/config/levels`, RUN-110/111); migration 040 (RUN-112, ägar-ja
  2026-10-12) tar bort den sista anonpolicyn. En frontend-rollback till v0.5.3
  eller äldre kräver att 040 rullas tillbaka (rollback-SQL i filhuvudet).
  Ingen anon-skrivning någonstans — skrivningar går via backend.
- v0.7.0 lägger till tre tabeller på samma baslinje (migration 046, 048 och 049):
  `strava_webhook_events`, `user_settings` och `news_read` har RLS på, inga policyer
  och `revoke all` från anon och authenticated; de läses och skrivs bara av backend
  (service role). Funktionen `claim_strava_webhook_events` får bara köras av
  `service_role` (execute är indraget från public, anon och authenticated).
- v0.8.0 (ADR 012) lägger till två tabeller på samma baslinje: `group_members` (migration 053, medlemskap,
  roll och fönster) och `group_settings` (migration 054, gruppinställningar). Båda har RLS på, inga
  policyer och `revoke all` från anon och authenticated; de läses och skrivs bara av backend (service
  role). Migration 055 (titlar per grupp) lägger `group_id` på `user_titles` och `title_leaderboard` och
  rör inte RLS-ytan. Funktionerna `join_group`, `create_group_with_admin`, `update_group_title_leaderboard`,
  `update_group_title_leaderboards` och `user_titles_fill_group_id` (053 och 055) får bara köras av
  `service_role` (execute är indraget från public, anon och authenticated). Migration 056 stänger samma sak
  på de fyra äldre funktionerna `update_title_leaderboard`, `update_all_title_leaderboards`,
  `trigger_update_title_leaderboard` och `increment_event_xp`, som tidigare gick att anropa via
  `/rest/v1/rpc` med anon-nyckeln (verkningslöst, men onödig yta). Migration 057 (RUN-322) lägger till
  `recalculation_marks` och sekvensen `recalculation_mark_version_seq` med samma baslinje; funktionerna
  `mark_recalculation` och `clear_recalculation_mark` bara för `service_role`. Migration 052 tog bort
  pg_net och det döda cron-jobbet i prod. En ny funktion i schemat `public` utan indraget execute, eller
  en ny tabell utan RLS, räknas som avvikelse och eskaleras.
- Contract-migration 058 (RUN-309, v0.8.1, ADR 012 addendum 2026-10-19; ask per miljö, inte applicerad förrän
  Lead gjort det) släpper det 055 lämnade för äldre kod: `update_title_leaderboard`, `update_all_title_leaderboards`,
  `trigger_update_title_leaderboard` och `user_titles_fill_group_id` (och därmed bara `update_group_title_leaderboard`
  och `update_group_title_leaderboards` kvar i RPC-ytan, båda bara för `service_role`), triggrarna
  `title_leaderboard_update_trigger` och `user_titles_group_id_shim` på `user_titles`, samt kolumnerna
  `titles.current_holder_id`/`current_value` (destruktivt: värdena är frusna och oläsbara för appen, men går förlorade).
  Ingen ny tabell, funktion, policy eller grant. Efter 058 skriver appen `title_leaderboard` bara via
  `update_group_title_leaderboards` (en gång per gruppomräkning); en skrivning till `user_titles` utanför appen
  bygger inte längre om rankingen automatiskt.

## Kvarvarande `requireAdmin`-rutter (underlag för fas 2: RUN-267 och RUN-95)

`requireAdmin` (`middleware/admin.ts`) slår upp `users.is_admin` färskt per anrop och prövar ingen grupp. Listan
är hämtad ur koden 2026-10-19 (v0.8.1); `is_admin` läses i övrigt bara av inloggningen (`/api/auth/login` ger
`is_admin` till frontendens AuthProvider, som styr admin-ytan) och av stagingens seed-skript. Fas 2 (ADR 012 beslut 2.6):
gruppnära rutter flyttas till rollen (`group_members.role` via `groupRoleCan`, grupp färskt ur databasen,
`resolveActingGroupForWrite`), därefter tas `users.is_admin` bort i en contract-migration. **Vad som gäller tills vidare
(ägarbeslut 2026-10-19):** supportrollen byggs inte nu. De systemnära och globala rutterna (6–15) ligger kvar på
`is_admin` som systemadmin, och supportrollen (uttrycklig, vald grupp, auditlogg) kommer först med RUN-267, när en andra
riktig grupp finns. Support sker tills dess som utvecklare med databasen och skripten. Supportrollen får aldrig härledas
ur att en användare saknar grupp.

| # | Rutt | Vad den gör idag | Gruppavgränsning idag | Mål i fas 2 |
|---|---|---|---|---|
| 1 | `GET /api/auth/users` | Listar användarna i adminens grupp | `group_id` ur JWT (`groupIdOrRespondEmpty`), alltså inaktuell efter join | Roll (ny capability, t.ex. `members.read`), grupp färskt ur databasen |
| 2 | `POST /api/auth/users` | Skapar konto och medlemskap (`join_group`) i adminens grupp | `group_id` ur JWT, 403 utan grupp | Roll (t.ex. `members.create`) via `resolveActingGroupForWrite` |
| 3 | `PUT /api/auth/users/:id/password` | Återställer lösenord för en användare i adminens grupp | Målet måste ligga i JWT-gruppen, annars 404 | Roll (t.ex. `members.reset_password`); målet kontrolleras mot den färska gruppen |
| 4 | `POST /api/titles/populate` | Bygger om adminens grupps ranking | `group_id` ur JWT | Roll (gruppnära underhåll); tills vidare `is_admin` |
| 5 | `POST /api/titles/refresh` | Samma som `populate` | `group_id` ur JWT | Samma som 4; slå ihop 4 och 5 (identiska) |
| 6 | `POST /api/titles/reprocess-all` | Räknar om titlarna för alla grupper | Ingen: alla grupper | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |
| 7 | `GET /api/admin/waitlist` | Listar väntelistan | Ingen: global tabell | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |
| 8 | `GET /api/auth/admin-settings` | Läser de globala XP-reglerna | Ingen: gäller alla grupper | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |
| 9 | `PUT /api/auth/admin-settings` | Ändrar de globala XP-reglerna | Ingen: ändrar poängen för alla grupper | Systemrutt som 8 (gruppvisa regler via `group_settings` med RUN-94) |
| 10 | `GET /api/auth/streak-multipliers` | Läser den globala streaktrappan | Ingen | Systemrutt som 8 (gruppvisa regler via `group_settings` med RUN-94) |
| 11 | `PUT /api/auth/streak-multipliers` | Ändrar den globala streaktrappan | Ingen | Systemrutt som 8 (gruppvisa regler via `group_settings` med RUN-94) |
| 12 | `POST /api/events/admin/trigger-daily-draw` | Kör dagens eventlottning manuellt | Ingen | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |
| 13 | `POST /api/strava/backfill-extended` | Hämtar om Stravaaktiviteter för alla anslutna användare | Ingen: alla grupper | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |
| 14 | `GET /api/strava/sync-all` | Synkar alla anslutna användare | Ingen | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |
| 15 | `GET /api/strava/webhook/health` | Visar globala köräknare | Ingen (bara räknare, ingen gruppdata) | Systemrutt: ligger kvar på `is_admin`; supportrollen kommer först med RUN-267 |

Fem av femton är gruppnära (1–5) och ska bli roll; tio är systemnära (6–15) och är systemrutter: de ligger kvar på
`is_admin` tills supportrollen finns (RUN-267). Idag räcker flaggan för alla femton, och eftersom det finns en admin
(ägaren) i en grupp är skillnaden osynlig tills grupp två finns. Med flera grupper skulle varje användare med `is_admin`
nå alla tio systemrutterna: därför får `is_admin` inte ges till någon annan än ägaren utan att RUN-267/RUN-95 är gjorda. `titles/populate` och `titles/refresh` är redan gruppavgränsade
(de bygger bara anroparens egen grupp), `GET /api/groups/settings` och `PUT /api/groups/settings` använder redan
rollen och inte `requireAdmin`.
- Rollmodell för grupper (ADR 012 beslut 2 och 6). Gruppadmin är en roll i ett aktivt medlemskap
  (`group_members.role = 'admin'`, `left_at is null`), inte flaggan `users.is_admin`. En grupp har högst en
  admin (partiellt unikt index) och admin är gruppens skapare. Rollen läses alltid färskt ur databasen,
  aldrig ur JWT, URL, body eller header. Vad en roll får göra avgörs på ett enda ställe, `groupRoleCan`
  i `packages/shared` (i dag bara `settings.write` för `admin`), och vilken grupp en användare får skriva
  i avgörs på ett enda ställe, `resolveActingGroupForWrite` i `utils/groupAccess.ts`. Funktionen tar bara
  användarens id, aldrig en grupp, så en admin kan inte rikta en skrivning mot en annan grupp. Saknat
  medlemskap, fel roll och databasfel ger nekad skrivning (fail-closed). CI-vakter i `scripts/ci-guards.mjs`
  fäller bygget om `users.group_id` skrivs utanför `join_group` och `create_group_with_admin` (regel 14), om
  en rolljämförelse dyker upp utanför `groupRoleCan` (regel 13) eller om `group_settings` skrivs utan den
  vägen (regel 15).
- `users.is_admin` finns kvar i v0.8.0 och betyder i praktiken "systemadmin": den styr de befintliga
  `requireAdmin`-rutterna (väntelista, `admin-settings`, `streak-multipliers`, Strava-admin,
  `strava/webhook/health`, `titles/reprocess-all`, `/auth/users`). `titles/populate` och `titles/refresh`
  är `requireAdmin` men bygger bara om anroparens egen grupp. Någon supportroll för alla grupper byggs inte
  nu (ägarbeslut 2026-10-19, RUN-267 i backloggen): support sker som utvecklare, med databasen och skripten
  och ägarens ja där reglerna ovan kräver det. Byggs rollen senare ska den vara uttrycklig, aldrig härledas
  ur att en användare saknar grupp.
- `GET /api/groups/settings` läses av varje medlem i gruppen (utan grupp: 200 med tomma värden och
  `can_edit: false`). `PUT /api/groups/settings` kräver admin-rollen och skriver bara anroparens egen grupp.
  Inga produktionsnycklar är registrerade i v0.8.0, så `group_settings` är tom.
- Titelrutterna är gruppavgränsade (ADR 012 beslut 5): `GET /api/titles/leaderboard` och
  `GET /api/titles/group-eligibility` ger anroparens grupp (utan grupp: tom lista), och
  `GET /api/titles/user/:userId` ger 404 för en löpare utanför anroparens grupp, med samma svar som för en
  som inte finns. `POST /api/titles/refresh/:titleId` är borttagen (404).
- `POST /api/strava/webhook` är appens första oautentiserade, skrivande endpoint som
  anropas av en extern tjänst (väntelistans `POST /api/waitlist` är också publik, men
  anropas av besökarens webbläsare). Strava signerar inte händelserna, så skyddet är
  ADR 010 beslut 1 och 3: händelsen är bara en signal och aktiviteten hämtas alltid
  från Strava (en radering verifieras mot Strava före varje borttagning);
  `subscription_id` måste vara lika med `STRAVA_WEBHOOK_SUBSCRIPTION_ID`; en okänd
  ägare kastas utan rad; ett tak per ägare stoppar översvämning; bara vitlistade
  `updates` sparas. Det finns ingen IP-gräns (Lead-beslut 2026-10-14): alla händelser
  kommer från Stravas adresser, så en gräns skulle strypa riktiga leveranser.
- `GET /api/strava/webhook/health` är admin (`requireAdmin`) och visar bara globala
  köräknare, ingen gruppdata. Den flyttas till supportrollen när RUN-267 landar.
- Claude Codes Supabase-MCP är låst till RunQuest-projektet via `--project-ref`
  i `.mcp.json` och en finkornig PAT (Projects: read, Database: read/write).

## CI-grind

Alla steg i `.github/workflows/ci.yml` är blockerande (på push och PR mot `main`):

- Backend: typecheck, build, tester.
- Shared: tester.
- Frontend: versionsvakt (`scripts/check-versions.mjs`), build, statisk
  serveringskontroll (Caddy), `tsc -b`, `eslint . --max-warnings 0`, tester.

Typ- och lintstegen är blockerande sedan 2026-10-04 (typskulden betalades i
Fas 2, ADR 001): 0 fel/0 varningar är baslinjen och får inte regressa.

CI är merge-grinden via branch protection på `main` (kräver de tre jobben
Backend, Frontend och Shared; admin-undantag finns), inte deploy-grinden:
Railway deployar vid push till `main` oberoende av CI.
