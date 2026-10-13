-- 044: waitlist_signups — väntelista nivå 1 (RUN-202, v0.6.2).
-- Datum: 2026-10-13. EJ APPLICERAD i prod — appliceras av Lead efter ägar-ja (permissions.md: migration mot prod = ask).
--
-- Bakgrund: landningssidan ska kunna samla in e-postadresser till en väntelista. Nivå 1 (ägarbeslut): adressen sparas i
-- en egen tabell, listan visas i Admin, inget mail skickas och ingen extern tjänst anlitas. Nivå 2 (Resend) kommer
-- senare. Tabellen skrivs av POST /api/waitlist och läses av GET /api/admin/waitlist, båda via backend (service role).
--
-- Personuppgifter: e-post är en personuppgift. Tabellen har därför bara det som behövs — ingen IP-adress, ingen
-- user agent, ingen referrer. consent_version anger vilken samtyckestext som visades vid anmälan (text i RUN-201).
-- Raderas en person ur listan görs det manuellt i databasen; ingen kod raderar rader.
--
-- E-posten lagras normaliserad (trim + gemener) och högst 254 tecken. Appen normaliserar innan insert; CHECK-villkoren
-- gör att databasen vägrar allt annat, och det unika indexet på email gör att en dubblettanmälan aldrig ger en andra
-- rad (appen läser en krock som "redan anmäld" och svarar likadant som för en ny anmälan — ingen e-postuppräkning).
--
-- Åtkomst: RLS på, inga policyer, ingen åtkomst för anon eller authenticated (RLS-baslinjen i permissions.md gäller
-- oförändrad: en ny policy för klientroller vore en avvikelse). Skrivning och läsning sker uteslutande via backend.
--
-- KÖRORDNING: applicera DENNA migration FÖRE deploy av backend-koden i v0.6.2. Koden skriver och läser tabellen; saknas
-- den svarar POST /api/waitlist 500 och admin-listan 500. Migrationen är additiv (ny tabell, inget befintligt rörs) och
-- bakåtkompatibel — den gamla koden känner inte till tabellen — så den kan inte skada en backend som ännu inte deployats.
--
-- Idempotent: create table if not exists + create unique index if not exists + enable row level security/revoke (båda
-- kan köras om utan effekt) — en omkörning ger samma slutläge. Ingen egen begin/commit: apply_migration kör filen som
-- en transaktion (som övriga migrationer).
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; tar bort alla sparade adresser):
--   drop table if exists public.waitlist_signups;
-- Statiskt test: waitlistSignupsMigration.test.ts.

create table if not exists public.waitlist_signups (
  id              uuid        primary key default gen_random_uuid(),
  email           text        not null,
  created_at      timestamptz not null default now(),
  source          text        not null default 'landing',
  consent_version text        not null,
  constraint waitlist_signups_email_length check (char_length(email) <= 254),
  constraint waitlist_signups_email_normalized check (email = lower(btrim(email)))
);

create unique index if not exists waitlist_signups_email_key
  on public.waitlist_signups (email);

alter table public.waitlist_signups enable row level security;   -- inga policyer = ingen åtkomst utom service role
revoke all on public.waitlist_signups from anon, authenticated;
