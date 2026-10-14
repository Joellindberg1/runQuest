-- Rollback för migration 045_strava_athlete_consent_pause.sql (RUN-164). KÖRS INTE AUTOMATISKT och ligger medvetet i en
-- undermapp så att inget verktyg som läser migrations/*.sql tar upp den som en framåtmigration.
-- Körs manuellt, bara efter ägarens uttryckliga ja. Tar bort sparade Strava athlete-id, samtyckesloggen och pausflaggorna
-- (inga rundor). Backa först backend-koden som skriver kolumnerna; annars misslyckas varje anslutning av Strava.
-- Samma SQL står som kommentar i filhuvudet i 045.

drop index if exists public.strava_tokens_athlete_id_key;
alter table public.strava_tokens drop column if exists paused_at;
alter table public.strava_tokens drop column if exists sync_paused;
alter table public.strava_tokens drop column if exists consented_at;
alter table public.strava_tokens drop column if exists consent_version;
alter table public.strava_tokens drop column if exists strava_athlete_id;
