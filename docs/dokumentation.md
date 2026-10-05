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

En version är inte varje commit, utan flera arbeten som tillsammans blir något —
så att gruppen kan följa resan i appen. Därför finns två nivåer:

- **Användarversion — tre delar, `0.MINOR.PATCH`** (fortsätter från v0.4.2; v0.5.0 =
  redesignen + Pack News). Det är den gruppen ser: `changelog.json`, Feature &
  Version-sidan, popupen. MINOR = något gruppen märker (ny funktion, synlig
  förändring), PATCH = fixar och finputs som gruppen märker.
- **Intern version — fyra delar, `0.5.0.1`, `0.5.0.2` …** Små fixar och arbeten som
  bara syns i `CHANGELOG.md` och som git-tagg. De rullas sedan ihop och "blir" nästa
  användarversion (0.5.0.1–0.5.0.4 släpptes tillsammans som 0.5.1). Fyrdelade
  versioner finns aldrig i `changelog.json` eller `package.json`.
- **`package.json` (rot + frontend) måste vara giltig semver**, så den håller
  användarversionens tre delar — de tre första delarna av översta rubriken i
  `CHANGELOG.md`. Under interna steg ändras den alltså inte:

  | Översta rubriken i CHANGELOG.md | `package.json` | Kommentar |
  |---|---|---|
  | `## v0.5.2` | `0.5.2` | användarversion |
  | `## v0.5.1.2` | `0.5.1` | internt steg efter 0.5.1 |
  | `## v0.5.1.3` | `0.5.1` | nästa interna steg |
  | `## v0.5.2` | `0.5.2` | de interna stegen rullas ihop till 0.5.2 |

- **Rubrikerna i `CHANGELOG.md`** är `vX.Y.Z` eller `vX.Y.Z.N` (N ≥ 1), nyast först;
  en fyrdelad sorteras ovanför sin tredelade bas (`v0.5.1.2` ligger över `v0.5.1`
  och under `v0.5.2`). Varje användarversion i `changelog.json` har en tredelad
  rubrik i `CHANGELOG.md` (från v0.5.0 och uppåt; äldre versioner finns bara i
  `changelog.json`). Inga förreleaser (`-rc.1`).
- **Git-taggen** har samma nummer som rubriken (`v0.5.1`, `v0.5.0.3`).
- CI fäller bygget om något inte stämmer (`scripts/check-versions.mjs`).

## Vad som går var

| Ändring | CHANGELOG.md | changelog.json (gruppen) | Popup |
|---|---|---|---|
| Ny funktion eller tydligt synlig förändring | ja | **ja** | om den är stor |
| Fix som gruppen märkte (t.ex. något som var trasigt) | ja | ja, kort | nej |
| Liten/osynlig fix, städ, refaktor, docs | ja | **nej** | nej |
| Admin-only | ja | nej (admin ser CHANGELOG/GitHub) | nej |

`changelog.json` har bara användarversioner (tre delar) och behöver INTE ha en
post för varje — den hoppar över rena interna fix-steg. Popupen visas för poster med `"announce": true`
(en gång per användare), och kan sammanfatta flera releaser.

Filen har formen `{ features, workingOn, releases }`: `releases` är release-posterna
(nyaste först), `features` och `workingOn` är korten under flikarna Features och
Working on på Feature & Version-sidan. `scripts/check-versions.mjs` kontrollerar
formen och att versionerna hänger ihop (se feature-README:n
`apps/frontend/src/features/changelog/README.md`).

## Releasechecklista (Lead, i samma PR som ändringen)

1. Bumpa versionen i rotens `package.json` och `apps/frontend/package.json` till
   användarversionens tre delar (hoppa över detta för ett internt steg `vX.Y.Z.N`).
2. Ny överst-post i `CHANGELOG.md` (teknisk sammanfattning): `## vX.Y.Z` för en
   användarversion, `## vX.Y.Z.N` för ett internt steg. En användarversion som
   rullar ihop interna steg får en kort post som säger vilka.
3. Märks det för gruppen? → post i `changelog.json` (typ `feature` /
   `improvement` / `bugfix`, enkel engelska; posten läggs överst i `releases`). Stort? → `"announce": true`.
4. Påverkar det arkitekturen eller ett beslut? → `STATE.md` / ADR-addendum.
5. Ändrades en features syfte eller beroenden? → dess README.
6. Efter merge och verifierad deploy: tagga `vX.Y.Z` (eller `vX.Y.Z.N`) på merge-commiten.

Rot-`README.md` beskriver projektet (stack, struktur, hur man kör) — inte
varje funktion i detalj; funktionerna beskrivs för gruppen i changelog.json och
för utvecklare i feature-READMEs.
