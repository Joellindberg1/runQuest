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
| Backfill-skript mot produktion (`backfill:activity-log` m.fl.) | dry-run fritt; **`--apply` = ask** med dry-run-rapporten som underlag. Skript skriver alltid ut måldatabasens host. En ev. rensning (`delete … where is_backfill`) = ask |
| Force-push | **never_allowed** |
| Hemligheter i kod eller committade filer | **never_allowed** — env-variabler är enda vägen (lärdom: PAT- och service role-läckorna, åtgärdade 2026-10-03/04) |

## Supabase-åtkomst

- Backend använder secret-nyckeln (env i Railway). Frontend har ingen
  Supabase-klient och inga Supabase-nycklar (RUN-105) — den pratar bara med
  backenden (`VITE_API_URL`) med backend-JWT.
- RLS-baslinje efter migration 030 + 031: anon läser endast `level_requirements`
  (031 stängde övrig anonläsning). Kvar med avsikt: storage-SELECT på
  `profile-pictures` (publika profilbilds-URL:er) samt en `auth.uid()`-bunden
  policy på run-väder som i praktiken är stängd. Frontend läser inte längre
  `level_requirements` direkt (`GET /api/config/levels`, RUN-110/111); RUN-112
  stänger även den sista anonpolicyn på `level_requirements` efter v0.6.0-deploy.
  Ingen anon-skrivning någonstans — skrivningar går via backend. Ny policy som
  öppnar anon-åtkomst = avvikelse → eskaleras.
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
