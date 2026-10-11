-- 039: Stäng anonym läsning av title_leaderboard_view och Supabase-Auth-registreringens trigger — säkerhetshotfix.
-- Datum: 2026-10-11. Ägargodkännande för applicering: 2026-10-11 (direkt efter 038).
-- Bakgrund (Leads kontroll i prod efter 038):
--   1. title_leaderboard_view är SECURITY DEFINER och hade SELECT för anon/authenticated → vem som helst med den publika
--      nyckeln kunde, utan inloggning, läsa alla användares namn, kön, profilbild och titelvärden (alla grupper).
--      Bara backenden (service role, titleLeaderboardService) läser vyn.
--   2. Triggern on_auth_user_created (auth.users → public.handle_new_user) skapade en RunQuest-användarrad för varje ny
--      Supabase-Auth-registrering. RunQuest använder inte Supabase Auth (egen backend-JWT). Funktionen var dessutom
--      körbar för anon/authenticated via RPC.
-- Ändringen bryter inget: ingen klient läser vyn eller använder Supabase Auth. Funktionen handle_new_user behålls (bara
-- utan trigger och utan EXECUTE för klientroller) så att historiken i 000_baseline.sql är spårbar.
-- Idempotent.

revoke select on public.title_leaderboard_view from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
