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
| Force-push | **never_allowed** |
| Hemligheter i kod eller committade filer | **never_allowed** — env-variabler är enda vägen (lärdom: PAT- och service role-läckorna, åtgärdade 2026-10-03/04) |

## Supabase-åtkomst

- Backend använder secret-nyckeln (env i Railway). Frontend har ingen
  Supabase-klient och inga Supabase-nycklar (RUN-105) — den pratar bara med
  backenden (`VITE_API_URL`) med backend-JWT.
- RLS-baslinje efter migration 030 + 031 + 038 + 039 + 040 (040 från och med att den
  applicerats i prod): anon läser ingenting. Det finns INGA policyer för rollerna
  anon, authenticated eller public (038, 040) och ingen klientroll kan läsa
  `title_leaderboard_view` (039). RunQuest använder inte Supabase Auth (egen
  backend-JWT); en ny policy för anon eller authenticated = avvikelse →
  eskaleras. Kvar med avsikt: storage-SELECT på `profile-pictures` (publika
  profilbilds-URL:er). Frontend läser inte `level_requirements` direkt
  (`GET /api/config/levels`, RUN-110/111); migration 040 (RUN-112, ägar-ja
  2026-10-12) tar bort den sista anonpolicyn. En frontend-rollback till v0.5.3
  eller äldre kräver att 040 rullas tillbaka (rollback-SQL i filhuvudet).
  Ingen anon-skrivning någonstans — skrivningar går via backend.
- v0.7.0 lägger till tre tabeller på samma baslinje (migration 046, 048 och 049):
  `strava_webhook_events`, `user_settings` och `news_read` har RLS på, inga policyer
  och `revoke all` från anon och authenticated; de läses och skrivs bara av backend
  (service role). Funktionen `claim_strava_webhook_events` får bara köras av
  `service_role` (execute är indraget från public, anon och authenticated).
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
