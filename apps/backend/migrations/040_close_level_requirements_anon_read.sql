-- 040: Stäng anonym läsning av public.level_requirements (RUN-112) — sista anonpolicyn.
-- Datum: 2026-10-12. Ägarbeslut 2026-10-12: gör den nu. APPLICERAD i prod 2026-10-12 (ägar-ja), efter merge av PR #31.
-- Bakgrund: efter 030, 031, 038 och 039 var "Anyone can view level requirements" (SELECT, roller anon + authenticated) den
-- enda kvarvarande policyn för klientroller. Den fanns för att frontenden läste nivåtabellen direkt med den publika
-- nyckeln. Sedan v0.6.0 har frontenden ingen Supabase-klient (RUN-105) och hämtar tabellen via GET /api/config/levels
-- (RUN-110, RUN-111); backenden använder service role, som förbigår RLS. ADR 004 och ADR 007 upphäver undantaget.
-- Körordning: när som helst efter att v0.6.0 är live (redan uppfyllt). Inga beroenden till andra migrationer.
-- Efter applicering: RLS är på och tabellen saknar policyer => anon och authenticated nekas (grants lämnas som för övriga
-- tabeller efter 038/039). Ingen data eller kolumn ändras.
-- Konsekvens: en frontend-rollback till v0.5.3 eller äldre (som läser tabellen direkt med anon-nyckeln) kräver att denna
-- migration rullas tillbaka först, annars får den tomma nivåtabeller och faller tillbaka på fallback-tabellen.
-- Idempotent (drop policy if exists).
--
-- Rollback (återskapar policyn exakt som i 000_baseline.sql rad 652; ägar-ja krävs, det öppnar anon-läsning igen):
--   create policy "Anyone can view level requirements" on public.level_requirements for select to anon, authenticated using (true);

drop policy if exists "Anyone can view level requirements" on public.level_requirements;
