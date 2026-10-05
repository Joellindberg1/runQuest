# Changelog

## v2.0.0 — Redesignen (2026-10-05)

Hela appen omritad enligt designprojektet (RunQuest App/Web Prototype):
mörk arena, guld som belöningssignal, skarpa hörn, Bebas Neue/Barlow
Condensed/Share Tech Mono. Byggd i 11 kritikergranskade inkrement.

### Nytt
- **App-skal:** bottenbar (Ranks/Titles/+New/Duels/You) på mobil, sidonav på
  desktop; riktiga routes (`/board /titles /duels /events /news /log /profile
  /runner/:id`); "Right now"-pills; ErrorBoundary (ett panelfel ger felkort,
  aldrig vit skärm).
- **Board:** podium med spökrank, veckoflik med dagstaplar och Mover of the
  week, streaks-flik, rank-delta och XP-pace.
- **Runner card:** egen skärm/overlay med nivåring, statflikar, titlar,
  head-to-head och Challenge-knapp.
- **Titles:** kategorigrupper, titelkort med innehavare/värde/runner-ups,
  On display-val, Closest chase.
- **Duels:** Standings/Live/Rules/History, send-sheet med token-val och
  head-to-head-tips, verkliga insatser ur datan.
- **Events:** öppet-kort med nedräkningsring, competition-tabell, Up next,
  This week, facit och historik med pager.
- **Log runs:** Estimated XP-förhandsvisning via shared-formeln, effektrader
  ("streak lever", "Closes on …"), group history, löpbandsflagga.
- **Profile:** hjältekort, Frodo-zoom i tre lägen, Distance/Streak/Fun/
  Consistency-heatmap, edit/delete med full omräkningskedja, profilbild.
- **Pack News:** händelselogg (activity_log, migration 034) med klock-popover,
  oläst-badge, dag-grupperat flöde, filterchips och Mark all read. Titelbyten,
  utmaningar, level-ups, milstolpar, streak-brott och event loggas live;
  historiken backfillad.
- **Landing:** publik startsida med arena-bana, aggregat och produktglimtar.

### Fixat på vägen
- Login visar fel ("Invalid credentials") i stället för att tyst tömma
  formuläret.
- Onboarding-touren spelas inte längre om efter inloggning utan omladdning.
- Utgången session loggar ut (401) i stället för att fastna på felkort.
- Radering av rundor som kvalificerat event ger begripligt besked (409) i
  stället för serverfel; Strava-rundor kan inte längre raderas i appen (synken
  återskapade dem ändå — radera i Strava i stället).
- Datumvalidering räknar svensk tid (midnatt–02 går att logga).
- Redigering/radering av rundor uppdaterar nu leaderboard, events, titlar och
  utmaningar direkt.

### Tekniskt
- Frontend: 1268 tester (från 0), typecheck/lint blockerande i CI.
- Backend: 450 tester; shared: 156 tester med delade API-kontrakt.
- ADR 006 (navigering), 007 (härledningsendpoints), 008 (händelselogg).
