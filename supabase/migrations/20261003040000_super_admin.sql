-- A super admin, who can do everything: the one thing the access list held
-- back from staff was deleting a run somebody else saved, and that is now
-- open to anyone marked super on the list. Everything else was already
-- shared, so nothing else changes.
--
-- The flag lives on allowed_emails, beside the gate itself, and is read by
-- a SECURITY DEFINER check in `private` exactly as is_staff is, so the
-- policy can consult it without handing callers the table.

alter table public.allowed_emails add column if not exists is_super boolean not null default false;

create or replace function private.is_super()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.allowed_emails a on a.email = lower(p.email)
    where p.id = (select auth.uid()) and a.is_super
  );
$$;

revoke execute on function private.is_super() from public, anon;
grant execute on function private.is_super() to authenticated;

drop policy if exists runs_delete_own on public.runs;
create policy runs_delete_own on public.runs
  for delete to authenticated
  using (((select auth.uid()) = created_by or (select private.is_super())) and (select private.is_staff()));

update public.allowed_emails set is_super = true where email = 'sathiya.moorthy@houseofedtech.in';
