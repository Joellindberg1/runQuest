# Playbook Feature — `/playbook`

Spelets regler som nio kapitel. Desktop = kapitelflikar (`?view=<kapitel>`, `useViewParam`) med kapitlet bredvid sin tabell (380 px) och
"← förra · 3 / 9 · nästa →" (Web Prototypen). Mobil = dragspel, ett kapitel öppet i taget (App Prototypens `mPlaybook`). `pages/PlaybookPage.tsx` är tunn.

## Struktur

- **components/**
  - `PlaybookScreen` — datakoppling (`useXpConfig`), val mellan flikar och dragspel, status-regionen för reservsiffror
  - `ChapterAccordion` — mobilens nio rader (riktiga knappar med `aria-expanded`/`aria-controls`)
  - `ChapterParts` — `ChapterText`, `ChapterTable` (hjältekortet med siffrorna) och `TitleList` (titlarna ur databasen)
- **playbookModel.ts** — `buildChapters(rules)`: alla nio kapitel som data (ingress, stycken, tabell), `neighbours()` för föregående/nästa
- **titleRules.ts** (nu i features/titles) — `buildTitleRuleRows`: titelns namn, regel och låsgräns ur `GET /titles/leaderboard` (delas med Admin)
- `playbook.css` — enda stilfilen; mått (`--rq-playbook-*`) i temafilen, sektion 1.32 (index.css + docs/design/temafil-forslag.css)

## Regler värda att komma ihåg

- **Siffrorna är inte hårdkodade.** Bas-XP, XP/km, distansbonusar, min distans och streak-trappan läses ur `GET /config/xp` (`useXpConfig`); räkneexemplen
  ("5 km: 15 + 10 + 5 = 30 XP", "5 km-runda: 52 XP") är shareds formel (`calculateRunXP`/`calculateCompleteRunXP`) över samma konfiguration. Går
  config inte att läsa faller sidan tillbaka på shareds standardvärden och säger det i en permanent `role=status`-region med Retry.
  Guard-testet vaktar att komponenterna inte innehåller XP-siffror och att modellen läser `rules.settings`.
- **Nivåtabellen** är shareds `FALLBACK_LEVEL_REQUIREMENTS` (enda hemmet, ADR 004), milstolparna i `LEVEL_MILESTONES`; "≈ N runs" räknas med konfigurationens XP per runda.
- **Titlarna** hämtas först när titelkapitlet visas (`useTitleBoard`, samma cache som Titles): skelett, felkort med Retry (resten av kapitlet står kvar), tomt läge.
- **Playbook påstår bara det koden gör.** Eventens fönster, krav och XP är en kopia av backend i `playbookFacts.ts` (ingen endpoint exponerar `event_templates`), och
  `playbookFacts.test.ts` läser backendens migrationer/eventService/eventScheduler/routes och faller om de glider isär. Utmaningstexten är Rules-vyns egen (`HOW_IT_WORKS`),
  insatserna är observerade ur `GET /challenges/my` (seed bara där inget exempel finns), minimidistansen är manuell-bara (Strava räknas oavsett längd).
  Se docs/open-assumptions.md ("Restsidor").
- **Ingen guldknapp** — sidan är läsning. Kapitelrubriken har ett guldstreck (prototypens accent).
- Mobil: öppen rad = guld-tint + guld vänsterkant (statusrecept 14 %/50 %), pilen vrids med CSS (ingen transition). Kapitlets innehåll glider in med `.rq-rise`.
