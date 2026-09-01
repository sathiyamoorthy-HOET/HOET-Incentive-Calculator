-- Restrict the app to an explicit access list.
--
-- Defence in depth, because the dashboard "allow signups" toggle is one click
-- from being turned back on:
--   1. a trigger refuses to create any account whose email is not listed, so
--      an open signup form still cannot produce a usable account;
--   2. every RLS policy requires the caller to be on the list, so even an
--      account created out of band sees nothing.

create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists public.allowed_emails (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now(),
  added_by   uuid references public.profiles (id) on delete set null
);

-- Stored lowercase so comparisons never depend on how someone typed it.
create or replace function public.normalise_allowed_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(trim(new.email));
  if new.email = '' or position('@' in new.email) = 0 then
    raise exception 'allowed_emails: % is not a valid email address', new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists allowed_emails_normalise on public.allowed_emails;
create trigger allowed_emails_normalise
  before insert or update on public.allowed_emails
  for each row execute function public.normalise_allowed_email();

insert into public.allowed_emails (email, note) values
  ('sathiya.moorthy@houseofedtech.in', 'Admin'),
  ('dheemanth.n@houseofedtech.in',     'Admin')
on conflict (email) do nothing;

-- ------------------------------------------------------------ staff check
-- SECURITY DEFINER so the policy can read allowed_emails without granting
-- callers direct access to it. Lives in `private` and is revoked from the
-- API roles so it cannot be invoked directly.
create or replace function private.is_staff()
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
    where p.id = (select auth.uid())
  );
$$;

-- RLS policy expressions are evaluated as the *querying* role, so authenticated
-- must be able to execute this or every policy below fails closed for everyone.
-- Safe to expose: it takes no arguments and only reports on the caller itself.
revoke execute on function private.is_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_staff() to authenticated;

-- --------------------------------------------------- refuse unlisted signups
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowed_emails a where a.email = lower(trim(new.email))
  ) then
    raise exception 'Account creation is restricted: % is not on the access list.', new.email
      using errcode = '42501';
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- ------------------------------------------------- policies now require staff
do $$
declare t text;
begin
  foreach t in array array[
    'app_settings', 'work_patterns', 'video_categories',
    'editors', 'editor_aliases', 'type_mappings', 'ignored_names'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using ((select private.is_staff())) with check ((select private.is_staff()))',
      t || '_staff_all', t
    );
  end loop;
end $$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));

drop policy if exists runs_read on public.runs;
create policy runs_read on public.runs
  for select to authenticated using ((select private.is_staff()));

drop policy if exists runs_insert on public.runs;
create policy runs_insert on public.runs
  for insert to authenticated
  with check ((select auth.uid()) = created_by and (select private.is_staff()));

drop policy if exists runs_update_own on public.runs;
create policy runs_update_own on public.runs
  for update to authenticated
  using ((select auth.uid()) = created_by and (select private.is_staff()))
  with check ((select auth.uid()) = created_by);

drop policy if exists runs_delete_own on public.runs;
create policy runs_delete_own on public.runs
  for delete to authenticated
  using ((select auth.uid()) = created_by and (select private.is_staff()));

drop policy if exists run_results_read on public.run_results;
create policy run_results_read on public.run_results
  for select to authenticated using ((select private.is_staff()));

-- --------------------------------------------- the access list manages itself
alter table public.allowed_emails enable row level security;

drop policy if exists allowed_emails_staff on public.allowed_emails;
create policy allowed_emails_staff on public.allowed_emails
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- Refuse to remove the last address, which would lock everyone out.
create or replace function public.guard_last_allowed_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.allowed_emails) <= 1 then
    raise exception 'Cannot remove the last address on the access list.';
  end if;
  return old;
end;
$$;

drop trigger if exists allowed_emails_guard_last on public.allowed_emails;
create trigger allowed_emails_guard_last
  before delete on public.allowed_emails
  for each row execute function public.guard_last_allowed_email();
