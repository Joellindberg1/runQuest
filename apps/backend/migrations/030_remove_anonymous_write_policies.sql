-- 030: Ta bort RLS-policyer som gav anonym skriv-/läsåtkomst via publishable-nyckeln.
--
-- Bakgrund: appen pratade ursprungligen direkt med Supabase från frontend, och
-- policyerna öppnades då för rollen public/anon ("Anyone can ..."). All skrivning
-- går numera via backend med service role-nyckeln, som går förbi RLS helt —
-- policyerna nedan gjorde därför bara en sak: gav vem som helst på internet
-- skrivåtkomst via den publika publishable-nyckeln.
--
-- Profilbildsflödet (enda kvarvarande frontend-skrivningen, mot users.profile_picture
-- och storage) flyttades till backend-endpointen POST /api/users/profile-picture
-- i samma release (commit ad1d2c9) — denna migration får INTE köras före den.
--
-- Kvar för anon: SELECT på level_requirements (läses direkt av frontend) samt
-- övriga rena konfig-/leaderboard-SELECT:ar (ses över i kommande audit).

-- runs: all anonym åtkomst bort (läsning sker via backend)
drop policy if exists "Anyone can insert runs" on public.runs;
drop policy if exists "Anyone can update runs" on public.runs;
drop policy if exists "Anyone can delete runs" on public.runs;
drop policy if exists "Anyone can view all runs" on public.runs;

-- users: anonym UPDATE bort (profilbild går via backend nu)
drop policy if exists "Anyone can update users" on public.users;

-- user_titles: "system"-policyerna var verkningslösa för service role (som ändå
-- går förbi RLS) men öppnade skrivning för alla andra
drop policy if exists "Allow system to assign titles" on public.user_titles;
drop policy if exists "Allow system to update titles" on public.user_titles;
drop policy if exists "Allow system to remove titles" on public.user_titles;
