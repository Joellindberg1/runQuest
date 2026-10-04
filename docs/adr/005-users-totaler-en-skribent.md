# ADR 005 — users-totaler har EN skribent: appens calculateUserTotals

**Status:** Godkänd av ägaren 2026-10-04 (buggfixpaketet, issue #4)

## Kontext

`users.total_xp/total_km/current_level` skrevs av TVÅ oberoende mekanismer:

1. DB-triggrarna `trigger_update_user_totals_*` på `runs` (upptäckta i
   schema-baslinjen) — formel: `SUM(runs.xp_gained)`, **utan** `event_xp`.
2. Appens `calculateUserTotals` — inkluderar `event_xp`, räknar dessutom
   streaks, tokens och titlar.

Två skribenter med olika formler gav rasvillkor och fel: radering av sista
rundan lät triggern nolla `total_xp` inklusive användarens event-XP (issue #3),
medan appens tidiga return lämnade streaks orörda.

## Beslut

Appens `calculateUserTotals` är **enda skribenten**. Den anropas i slutet av
varje skrivväg (manuell logg, edit, delete, Strava-import, event-avräkning
justerar level separat via `increment_event_xp` + level-uppdatering).

- Triggrarna och funktionen `update_user_totals` tas bort (migration 032).
- `calculateUserTotals` fixas att INTE returnera tidigt vid noll rundor —
  totaler, level, streaks, tokens och titlar nollställs/omräknas korrekt.
- Titel-tilldelningar återkallas när kravet inte längre uppfylls (issue #10),
  så hela gamification-tillståndet följer löphistoriken.

## Alternativ som övervägts

- **Triggrarna som ägare** (lära dem event_xp + streaks i PL/pgSQL): flyttar
  komplex domänlogik till SQL, duplicerar streak-/token-/titellogiken som
  redan finns och testas i appen. Avvisad.
- **Behålla båda** (status quo): det är buggen. Avvisad.

## Konsekvenser

- All totalsskrivning går genom en kodväg som kan testas (ADR 001:s
  beteendetester bygger vidare på detta).
- Om `calculateUserTotals` kraschar uppdateras totalerna inte alls (tidigare
  "räddade" triggern delvis) — felet syns i loggen och nästa skrivning läker.
- Inga nya externa tjänster eller kostnader. Migration 032 kräver
  ägargodkännande enligt docs/permissions.md.
