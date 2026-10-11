-- 037: Titelraderna Stormborn, Iceborn och Winter Warrior (RUN-103, v0.6.0).
-- Datum: 2026-10-11. APPLICERAD i prod 2026-10-11 efter v0.6.0-deployen (ägar-ja), följd av tyst omräkning.
-- Applicering via Supabase MCP apply_migration
-- (name: 037_add_weather_and_winter_titles).
-- Ordning vid release (ADR 002 beslut 3, expand först):
--   1. Deploya backend-koden som innehåller motorerna stormRunCount, coldRunCount och winterKm
--      (RUN-99, RUN-100; registrerade i titleEngineRegistry). Titelraderna får inte finnas före koden.
--   2. Applicera den här migrationen (efter ägar-ja).
--   3. Kör tyst reprocess-all: POST /api/titles/reprocess-all (emitNews:false) så att titlarna beräknas
--      för all historik utan att nyhetsflödet spammas.
-- Additiv (expand): tre nya rader i public.titles; inget befintligt ändras, inget tas bort.
-- Idempotent: on conflict (metric_key) do nothing — en omkörning (eller en rad som redan finns) ger samma
-- slutläge. Prod har 20 titlar, inga med de nya namnen/nycklarna. current_holder_id/current_value lämnas på
-- default; innehavare sätts av reprocess-all.
-- Nycklarna måste finnas i titleEngineRegistry (apps/backend/src/titleEngines/index.ts); statiskt test:
-- titlesMigration037.test.ts.
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; beroende rader först):
--   delete from public.title_leaderboard where title_id in (select id from public.titles
--     where metric_key in ('stormRunCount','coldRunCount','winterKm'));
--   delete from public.user_titles where title_id in (select id from public.titles
--     where metric_key in ('stormRunCount','coldRunCount','winterKm'));
--   delete from public.titles where metric_key in ('stormRunCount','coldRunCount','winterKm');
-- Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer).

insert into public.titles (name, description, unlock_requirement, metric_key, outdoor_only) values
  ('Stormborn', 'Most runs in gusts of 12 m/s or more.', 1, 'stormRunCount', true),
  ('Iceborn', 'Most runs at 5 °C or colder.', 3, 'coldRunCount', true),
  ('Winter Warrior', 'Most kilometres in the current winter (December–February). Outside winter, the latest winter counts.', 10, 'winterKm', false)
on conflict (metric_key) do nothing;
