-- Kudos points and leave, kept with the run.
--
-- A manager gives an editor kudos points for the month on the Results page,
-- whether the run is still on screen or already saved. The run stores them
-- as {"editor name": points}, so reopening it reproduces the payout, and
-- run_results carries the money so the Editors grid can add it up without
-- re-pricing every month.
--
-- Leave is the same shape: {"editor name": days off}. An editor who was on
-- leave is measured against a target scaled to the days they were actually
-- in, instead of the pattern's full month. Absent means no leave.
--
-- Both are a manager's call, not the uploader's, so any member of staff may
-- write them to any run. The update policy is widened to staff for that; the
-- insert and delete rules are unchanged.

alter table public.runs add column if not exists kudos jsonb not null default '{}'::jsonb;
alter table public.runs add column if not exists leave jsonb not null default '{}'::jsonb;

alter table public.run_results add column if not exists kudos_points numeric not null default 0;
alter table public.run_results add column if not exists kudos_inr    numeric not null default 0;

drop policy if exists runs_update_own on public.runs;
drop policy if exists runs_update_staff on public.runs;
create policy runs_update_staff on public.runs
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

drop policy if exists run_results_write on public.run_results;
create policy run_results_write on public.run_results
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));
