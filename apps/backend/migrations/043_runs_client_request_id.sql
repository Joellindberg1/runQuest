-- 043: runs.client_request_id + partiellt unikt index — idempotensnyckel för POST /api/runs (RUN-225, v0.6.2).
-- Datum: 2026-10-13. APPLICERAD i prod 2026-10-13 (ägar-ja) via Supabase MCP apply_migration (name: 043_runs_client_request_id).
--
-- Problem: om svaret på POST /api/runs aldrig når klienten (timeout, nätfel) skickar användaren igen och får en
-- dubblettrunda. Sedan v0.6.1.1 hanteras "500 efter skrivning" med { error, written: true }, men ett svar som aldrig
-- kommer fram har ingen kropp att läsa det ur. Strava-importen är redan idempotent via unikt (user_id, external_id)
-- (migration 033); manuella rundor saknar motsvarande nyckel.
--
-- Åtgärd: klienten skickar headern Idempotency-Key (uuid v4) per inskick; backenden sparar den i
-- runs.client_request_id. Det partiella unika indexet (user_id, client_request_id) där nyckeln finns gör att en
-- upprepning med samma nyckel inte kan skapa en andra rad, även vid två samtidiga anrop (den förlorande insertens
-- 23505 på indexet läses om till den befintliga raden i appkoden). Indexet är per user_id, så en nyckel kan aldrig
-- krocka mellan användare. Rader utan nyckel (alla befintliga rundor, Strava-rundor, klienter som inte skickar
-- headern) ingår inte i indexet och påverkas inte.
--
-- Ingen TTL-tabell: nyckeln lever så länge rundan lever. En raderad runda frigör nyckeln, vilket är rätt.
--
-- KÖRORDNING: applicera DENNA migration FÖRE deploy av backend-koden i v0.6.2. Koden skriver kolumnen
-- client_request_id; om den saknas misslyckas varje insert med nyckel (PostgREST: okänd kolumn) och manuell
-- rundloggning går sönder. Migrationen är additiv och bakåtkompatibel — den gamla koden ignorerar kolumnen — så
-- den kan inte skada en backend som ännu inte deployats. Rollback av backend-koden kräver ingen rollback av
-- migrationen.
--
-- Idempotent: add column if not exists + create unique index if not exists — en omkörning ger samma slutläge.
-- Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer). Ingen data ändras,
-- ingen RLS-policy rörs (RLS-baslinjen enligt permissions.md gäller oförändrad: inga policyer för klientroller).
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; tar bort sparade nycklar, inga rundor):
--   drop index if exists public.runs_user_client_request_id_key;
--   alter table public.runs drop column if exists client_request_id;
-- Statiskt test: runsClientRequestIdMigration.test.ts.

alter table public.runs
  add column if not exists client_request_id uuid null;

create unique index if not exists runs_user_client_request_id_key
  on public.runs (user_id, client_request_id)
  where client_request_id is not null;
