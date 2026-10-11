-- 038: Stäng alla RLS-policyer för Supabase-Auth-sessioner (rollerna authenticated/public) — säkerhetshotfix.
-- Datum: 2026-10-11. Ägargodkännande för applicering: 2026-10-11 (hotfix före v0.6.0-releasen).
-- Bakgrund: integrationskritiken av v0.6.0 inkrement 4 + Leads kontroll i prod. Policyn "Users can view all users"
-- (authenticated, using true) gav VARJE Supabase-Auth-session läsrätt till hela public.users — inklusive email och
-- password_hash. RunQuest använder inte Supabase Auth (egen backend-JWT, ADR-konventionen i STATE.md), men den publika
-- nyckeln har legat i frontend-bundeln, och auth.users har två gamla e-postkonton (2025). Var registrering påslagen
-- kunde vem som helst skaffa en session och läsa tabellen.
-- Ändringen bryter inget: backend använder service role (förbigår RLS) och ingen klient har en Supabase-session
-- (frontend saknar supabase-js sedan RUN-105; den live-bundeln före v0.6.0 använder bara anon-läsning av
-- level_requirements och supabase.auth.signOut()). RLS är på för alla berörda tabeller (kontrollerat i prod före
-- applicering) — utan policyer nekas all klientåtkomst.
-- Kvar med avsikt: "Anyone can view level requirements" (anon + authenticated) tills v0.6.0 (frontend läser nivåerna
-- via GET /api/config/levels) är live; den stängs i migration 039 (RUN-112). Storage-policyn för profile-pictures rörs inte.
-- Idempotent (drop policy if exists). Additiv i säkerhetsriktning: inga tabeller, kolumner eller data ändras.

drop policy if exists "Users can view all users" on public.users;
drop policy if exists "authenticated_read_event_pool_members" on public.event_pool_members;
drop policy if exists "authenticated_read_event_pools" on public.event_pools;
drop policy if exists "Authenticated users can read events" on public.events;
drop policy if exists "Authenticated users can read event entries" on public.event_entries;
drop policy if exists "Authenticated users can read event templates" on public.event_templates;
drop policy if exists "users_read_own_seen_items" on public.user_seen_items;
drop policy if exists "Users can read own run weather" on public.run_weather;
drop policy if exists "Users can view their own Strava tokens" on public.strava_tokens;
drop policy if exists "Users can insert their own Strava tokens" on public.strava_tokens;
drop policy if exists "Users can update their own Strava tokens" on public.strava_tokens;
