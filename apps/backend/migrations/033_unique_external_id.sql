-- 033: Unikt index på (user_id, external_id) för Strava-dedupe (bugg #9).
-- Dedupe skedde tidigare enbart i appkod — race vid samtidig sync kunde ge
-- dubbletter. Dubblettkontroll körd i prod 2026-10-04: noll träffar.
-- Ersätter det icke-unika idx_runs_external_id.

drop index if exists idx_runs_external_id;
create unique index idx_runs_external_id
  on public.runs (user_id, external_id)
  where external_id is not null;
