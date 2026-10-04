# Redesign-plan — "Gamification-sida behöver liv" → runquest.dev

Lead-orchestrator 2026-10-04, baserad på fullständig gap-analys av
App Prototype (10 skärmar), Components-biblioteket och dagens backend.
Designprojektet är sanningen: docs/design/claude-design/README.md.

## Ramen håller

Ägarens krav — "ingen ny extern data" — bekräftas. Nästan allt designen
visar är [F] (finns via endpoint) eller [H] (härledbart ur runs/challenges/
events/user_titles). Det enda som kräver NY LAGRING:

| Behov | Minsta lösning |
|---|---|
| Titelbyten i Pack News ("Karl took The Longest Run") | Händelselogg-tabell; titelbyten loggas FRAMÅT (historiken går inte att återskapa — leaderboarden skrivs över). Övriga news-typer (challenges, level ups, events, streak breaks) kan backfyllas retroaktivt ur befintliga tabeller |
| Oläst-räknare + "Mark all read" + notisinställningar | `user_seen_items`-mönstret återanvänds / litet prefs-fält |
| Gruppens mållopp ("Göteborgsvarvet · 268 d") | Två kolumner på groups: race_name, race_date |
| Strava-synklogg | Liten logtabell (dagens info bor i minnet) |
| "Season" | BESLUT: begreppet finns inte i datamodellen (se Ägarbeslut 2) |

## Ägarbeslut — AVGJORDA 2026-10-04

1. **Spelregler: oförändrade.** Detta är en redesign — UI:t visar spelets
   VERKLIGA regler (insatser 0.15/0.25/0.5 med straff, durationer 5–30 d,
   metrics xp/km/runs, fasta tokens, streak-trappan 5→270 d). Designens
   regeltexter justeras vid implementation; layout/flöden följer designen.
2. **Season: senare.** Copy byts till All-time/This year tills
   seasons-featuren (roadmap) byggs.
3. **Titlar: dagens namn och regler.** Designens DISPLAY (kategorigrupper,
   runner-ups, "best so far") implementeras; kategorimappning i frontend.
4. **Landing: hårdkodad dummy-data.** Ingen publik endpoint. Siffror och
   preview är statiska (kan rotera klient-side så det KÄNNS levande).
   "Create your pack" väntar på multi-grupp.
5. **Händelselogg: JA.** Byggs nu för Pack News (display); designad som
   grund för framtida realtid/notifikationer enligt roadmap.

## Ursprunglig beslutsanalys (design ≠ verklighet)

1. **Spelregler.** Designen visar andra regler än spelet kör (verifierat i prod):
   - Insatser: design 0.1/0.3/0.5 ↔ prod 0.15/0.25/0.5 (med straff −0.07/−0.12/−0.25)
   - Durationer: design 3/5/7/14 ↔ prod 5/7/10/14/21/30
   - Metric "Longest run" finns inte (prod: total_xp/km/runs)
   - Designens send-flöde låter avsändaren VÄLJA metric+duration; i dag är de
     fasta per token
   - Streak-trappa: design 3/7/14/21 d → 1.3/1.5/1.8/2.0 ↔ prod 5/15/30/…/270 d
     → 1.1/…/2.0
   VAL: (a) UI visar prods verkliga regler (designtexterna justeras) eller
   (b) spelreglerna ändras till designens (= balansändring för 6 aktiva
   spelare, påverkar pågående streaks/tokens). Kan också delas per punkt.
2. **"Season".** Design säger Season XP / "Legendary once per season" /
   "YOUR SEASON 4 of 12". VAL: (a) ordet byts till All-time/This year tills
   seasons-featuren (roadmap stor) byggs, eller (b) seasons-datamodellen
   tas in nu (växer scope rejält).
3. **Titelnamn/-texter.** Flera designtitlar matchar inte motorerna (Hamster,
   Commuter, Finisher, Double Trouble, Weekend Destroyer, Monthly Monster …)
   och några namn finns inte alls ("The Longest Run" heter "The Reborn Eliud
   Kipchoge"). VAL per titel: döp om i DB (lätt) eller skriv om designcopy.
   Kategorierna (Time of day/Distance/…) läggs som frontend-mappning.
4. **Landing + "Create your pack".** Publika aggregat kräver en ny oautad
   endpoint + integritetsbeslut (riktiga namn/XP på publik sida?).
   Rekommendation: anonymiserad/mockad preview; CTA:n "Create your pack"
   pekas mot "kontakta ägaren" tills multi-grupp/self-serve (roadmap stor)
   byggs.
5. **Händelseloggen.** Ny tabell (lagrar härledda händelser framåt + backfill
   där det går) — bekräfta att det ryms i ramen (ingen extern data, men ny
   lagring).

## Byggordning — inkrement för builder-par

Appvyn (mobil) är facit och byggs först per inkrement; webb-prototypens
desktop-variant av samma skärm tas i samma inkrement där den finns.
Varje inkrement: design-referens = skärmen i App Prototype; kontrakt i
docs/contracts.md; tester enligt ADR 001.

| # | Inkrement | Innehåll | Backend-arbete |
|---|---|---|---|
| 0 | **Tema & fundament** | Temafil (tokens ur Components → index.css, EN uppsättning: #070e09-bas, guld, hairlines, 0-radius), fonts (Bebas/Barlow/Share Tech Mono — Playfair/Silkscreen/VT323 bort), runquest-icons portas till React-komponent (ersätter lucide där designen kräver), loaders (stadion-ovalen + skeletons), kortmönstret som delad komponent | — |
| 1 | **App-skal & navigation** | Bottenbar (Ranks/Titles/+New/Duels/You), header (gruppnamn, kalender- & klockikon, avatarmeny), "Right now"-pills, routingomläggning (?tab= → riktiga vyer), +New-sheet, tour-ankare uppdateras | `last-sync` finns; streak-deadline härleds i klient |
| 2 | **Board: Season/Week/Streaks** | Podium med spökrank, ribbons, xp-pace/ETA (finns i leaderboardUtils), Week-fliken med dagstaplar + "Mover of the week" + pack-total, Streaks-fliken med status/countdown | Ny `GET /leaderboard/week` (härledning), rank-delta (förra veckans ranking), `start_time/created_at` in i users-with-runs-selecten, publik XP-config-endpoint (streak-trappa + formel — i dag admin-only) |
| 3 | **Runner card** | Egen skärm (ersätter UserProfileModal): nivåring, statflikar, titlar, head-to-head, Challenge-knapp | Ny `GET /challenges/head-to-head/:userId` (härledning ur challenges) |
| 4 | **Titles** | Kategorigrupperad lista, All/Mine/Unclaimed, runner-ups, "Best so far" för olåsta | Finns ([F] leaderboard + group-eligibility). OBS: global vs grupp — ok med 1 grupp, flaggad i STATE |
| 5 | **Duels** | Live-kort, inkommande, standings, Rules, Match history (hela packet), send-sheet ENLIGT BESLUT 1 | Ny `GET /challenges/group-history` (härledning); progress-batchning |
| 6 | **Events** | Open now med "X of Y done", Up next, This week (endast faktiskt schemalagda — framtida lottningar EXISTERAR inte, designjustering), Your season-räknaren (ENLIGT BESLUT 2), historik med pager | `/events` exponerar participant-antal; `/events/history` får offset |
| 7 | **Log runs** | Formulär + Estimated XP-förhandsvisning (shared-formeln), effekter ("streak lever", "closes on Karl"), group history | `POST /runs` får `is_treadmill`; group-history offset; XP-config från #2 |
| 8 | **Profile** | Hjältekort, Frodo-zoom, statflikar (Distance/Streak/Fun/Consistency-heatmap) | Härledningar klient-side ur befintliga runs-data; ev. `GET /users/me/stats` om payload blir tung |
| 9 | **Pack News** | Händelselogg (ENLIGT BESLUT 5): tabell + skrivpunkter i settle-/titel-/level-flödena, retroaktiv backfill för härledbara typer, oläst-status, klock-popover + skärm, filterchips | Ny tabell + `GET /news`, `POST /news/seen` |
| 10 | **Landing** | Publik sida (ENLIGT BESLUT 4): hero med arena-banan, XP-explainer, aggregat, anonymiserad preview | Ny publik aggregat-endpoint (cache:ad) |
| — | **Playbook/Features/Settings/Admin** | Omklädnad till nya temat (option-wheel för Playbook enligt prototyp); Playbooks siffror från XP-config-endpointen i stället för hårdkod | — |

Badge-sektionerna (Profile) HOPPAS ÖVER tills ägaren friger badge-designen.

## Städvinster som ingår på köpet

- Design-skulden: 240 inline-styles + 7 typsnitt ersätts av temafilen
  (STATE.md zon "designskuld" betalas per inkrement)
- `?tab=`-routingen försvinner; onboarding-turernas ankare uppdateras i
  samma inkrement som respektive skärm
- PlaybookPage/FeaturesPage hårdkodningar ersätts med riktiga källor

## Process

Redesignen är triage-klass STOR och går genom systemet: architect
(growth) skriver ADR för routingomläggning + endpoints-paketet +
händelseloggen → Designer äger temafilen och fyller STATE.md:s
designspråk → builder/critic-par per inkrement mot kontrakt →
integration per inkrement → release-preview per milstolpe.
