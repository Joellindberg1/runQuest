-- 031: Stäng kvarvarande anon-läsning (körd mot prod 2026-10-04, godkänd av ägaren).
-- Princip (STATE.md zon 2): anon läser INGET utom level_requirements.
-- All annan läsning går via backend (service role).
-- Känsligast: admin_settings exponerade admin_password_hash, groups exponerar
-- invite_code, user_* exponerar användardata.

drop policy if exists "Anyone can view admin settings" on public.admin_settings;
drop policy if exists "Anyone can view groups" on public.groups;
drop policy if exists "Anyone can view user titles" on public.user_titles;
drop policy if exists "Anyone can view user boosts" on public.user_boosts;
drop policy if exists "Anyone can view user challenge tokens" on public.user_challenge_tokens;
drop policy if exists "Anyone can view title leaderboard" on public.title_leaderboard;
drop policy if exists "Anyone can view titles" on public.titles;
drop policy if exists "Anyone can view streak multipliers" on public.streak_multipliers;
drop policy if exists "Anyone can view challenges" on public.challenges;
drop policy if exists "Anyone can view challenge metrics" on public.challenge_metrics;
drop policy if exists "Anyone can view challenge durations" on public.challenge_durations;
drop policy if exists "Anyone can view challenge rewards" on public.challenge_rewards;
drop policy if exists "Anyone can view level challenge rewards" on public.level_challenge_rewards;

-- Kvar med avsikt: "Anyone can view level requirements" (läses direkt av
-- frontend), "Users can read own run weather" (auth.uid()-villkor, i praktiken
-- stängd), storage-SELECT på profile-pictures (publika profilbilds-URL:er).
