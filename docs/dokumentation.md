# Dokumentation i RunQuest — vem läser vad, och när det uppdateras

Ägarbeslut 2026-10-05. Målet: gruppen ska kunna följa vad som händer i appen
(Feature & Version-sidan + "vad är nytt"-popupen), och utvecklingsdokumenten
ska gå att lita på. Varje dokument har EN publik och EN ägare — skriv inte
samma sak på två ställen.

## Tre publiker

| Publik | Dokument | Språk | Ägare |
|---|---|---|---|
| **Gruppen** (användarna) | `apps/frontend/src/data/changelog.json` → Feature & Version-sidan och popupen "What's new" | Enkel engelska, vad *du* märker | Lead vid release |
| **Utvecklare** | `CHANGELOG.md` (tekniskt, varje release) · `STATE.md` (nuläget) · `docs/adr/` (beslut) · `docs/open-assumptions.md` · feature-READMEs i `apps/frontend/src/features/*/README.md` | Svenska | Lead / respektive builder |
| **Ägaren** | Notion (idéer, roadmap, monetisering — hålls utanför det publika repot) | Fritt | Ägaren |

`docs/archive/` innehåller äldre dokument som inte längre uppdateras.

## Versioner

- **Semver, en version för hela appen:** `vMAJOR.MINOR.PATCH` (fortsätter från
  v2.0.0 = redesignen). MAJOR = ny generation av appen, MINOR = något gruppen
  märker (ny funktion, synlig förändring), PATCH = fixar.
- **Samma nummer överallt:** git-taggen, `version` i rotens `package.json` och
  `apps/frontend/package.json`, och översta rubriken i `CHANGELOG.md`.
  CI fäller bygget om de inte stämmer (`scripts/check-versions.mjs`).

## Vad som går var

| Ändring | CHANGELOG.md | changelog.json (gruppen) | Popup |
|---|---|---|---|
| Ny funktion eller tydligt synlig förändring | ja | **ja** | om den är stor |
| Fix som gruppen märkte (t.ex. något som var trasigt) | ja | ja, kort | nej |
| Liten/osynlig fix, städ, refaktor, docs | ja | **nej** | nej |
| Admin-only | ja | nej (admin ser CHANGELOG/GitHub) | nej |

`changelog.json` behöver alltså INTE ha en post för varje version — den
hoppar över rena fix-releaser. Popupen visas för poster med `"announce": true`
(en gång per användare), och kan sammanfatta flera releaser.

## Releasechecklista (Lead, i samma PR som ändringen)

1. Bumpa versionen i rotens `package.json` och `apps/frontend/package.json`.
2. Ny överst-post i `CHANGELOG.md` (teknisk sammanfattning).
3. Märks det för gruppen? → post i `changelog.json` (typ `feature` /
   `improvement` / `fix`, enkel engelska). Stort? → `"announce": true`.
4. Påverkar det arkitekturen eller ett beslut? → `STATE.md` / ADR-addendum.
5. Ändrades en features syfte eller beroenden? → dess README.
6. Efter merge och verifierad deploy: tagga `vX.Y.Z` på merge-commiten.

Rot-`README.md` beskriver projektet (stack, struktur, hur man kör) — inte
varje funktion i detalj; funktionerna beskrivs för gruppen i changelog.json och
för utvecklare i feature-READMEs.
