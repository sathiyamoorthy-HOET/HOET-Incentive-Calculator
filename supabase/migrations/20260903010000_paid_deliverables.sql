-- What has already been paid for, one row per deliverable, for good.
--
-- Orbitova's own Methodology sheet says a deliverable uploaded in one period
-- and re-uploaded in the next "appears in both reports, each showing that
-- period's own cut and its own length", because the report measures upload
-- volume rather than finished library length. Paying by runtime therefore paid
-- for the same video twice — and, with a first-rung deduction of only a few
-- percent, made revising a video more profitable than getting it right.
--
-- This table is the memory that stops that. A deliverable is named by its
-- project code and its number within the project ("Project Code" + "#"), which
-- the export gives for every row and which never changes.

create table if not exists public.paid_deliverables (
  -- "PRJ0052#4": the name one video keeps across every month.
  key            text primary key,
  project_code   text   not null,
  deliverable_no text   not null,
  -- The run that first paid for it. Deleting that run frees the deliverable,
  -- so a run can be deleted and re-saved without stranding what it paid for.
  run_id         bigint not null references public.runs (id) on delete cascade,
  month          date   not null,
  editor_name    text   not null,
  -- The highest version settled, and what it earned the first time: every
  -- later deduction is a percentage of that, not of the re-upload's runtime.
  version        integer not null default 1,
  gross_points   numeric not null default 0,
  -- How much of the revision ladder has been charged, so a video already
  -- charged the 5% rung owes only the difference on reaching the 10% rung.
  charged_pct    numeric not null default 0,
  paid_at        timestamptz not null default now()
);

create index if not exists paid_deliverables_run_id_idx on public.paid_deliverables (run_id);
create index if not exists paid_deliverables_month_idx on public.paid_deliverables (month);
create index if not exists paid_deliverables_editor_idx on public.paid_deliverables (editor_name);

alter table public.paid_deliverables enable row level security;

-- Read and written only through saveRun, which is already restricted to staff.
drop policy if exists paid_deliverables_staff on public.paid_deliverables;
create policy paid_deliverables_staff on public.paid_deliverables
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
