-- 032: Ta bort DB-triggrarna som räknade om users-totaler (bugg #4, ADR 005).
-- Appens calculateUserTotals är ENDA skribenten av total_xp/total_km/
-- current_level/streaks. Triggrarna använde en annan formel (utan event_xp)
-- och gav två skribenter med olika sanning. Körs via MCP efter ägargodkännande.

drop trigger if exists trigger_update_user_totals_insert on public.runs;
drop trigger if exists trigger_update_user_totals_update on public.runs;
drop trigger if exists trigger_update_user_totals_delete on public.runs;
drop function if exists public.update_user_totals();
