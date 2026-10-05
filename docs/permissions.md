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

- Backend använder secret-nyckeln (env i Railway). Frontend använder
  publishable-nyckeln via `VITE_`-env — den är publik; allt skydd ligger i RLS.
- RLS-baslinje efter migration 030: anon får LÄSA `level_requirements` och
  konfigtabeller, inget mer. Ingen anon-skrivning någonstans — skrivningar går
  via backend. Ny policy som öppnar anon-åtkomst = avvikelse → eskaleras.
- Claude Codes Supabase-MCP är låst till RunQuest-projektet via `--project-ref`
  i `.mcp.json` och en finkornig PAT (Projects: read, Database: read/write).

## CI-grind

Blockerande i CI: backend typecheck + build + tester, frontend build.
Icke-blockerande (känd skuld, Fas 2): frontend `tsc -b` (~98 fel) och
`eslint` (15 fel/22 varningar). När skulden är betald görs stegen blockerande.
