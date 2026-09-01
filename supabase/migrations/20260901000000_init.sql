-- HOET Incentive Calculator — initial schema
-- Config (rate card, team, patterns, type mappings) is shared across all users.
-- Every monthly run is stored with an immutable snapshot of the config used,
-- so historic payouts stay reproducible after the rate card changes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------- settings
create table if not exists public.app_settings (
  id                  boolean primary key default true,
  points_per_day      numeric not null default 30,
  incentive_per_point numeric not null default 125,
  rate_mode           text    not null default 'uplift',
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint app_settings_singleton check (id),
  constraint app_settings_rate_mode_valid check (rate_mode in ('uplift', 'direct'))
);

-- ------------------------------------------------------------ work patterns
create table if not exists public.work_patterns (
  id            bigint generated always as identity primary key,
  name          text    not null unique,
  standard_days numeric not null default 0,
  target_points numeric not null default 0,
  sort_order    integer not null default 0
);

-- --------------------------------------------------------- video categories
create table if not exists public.video_categories (
  id                  bigint generated always as identity primary key,
  name                text    not null unique,
  deliverable_minutes numeric not null default 10,
  rate_a              numeric not null default 0,
  rate_b              numeric not null default 0,
  rate_c              numeric not null default 0,
  rate_d              numeric not null default 0,
  sort_order          integer not null default 0
);

-- ----------------------------------------------------------------- editors
create table if not exists public.editors (
  id              bigint generated always as identity primary key,
  name            text    not null unique,
  slab            text    not null,
  work_pattern_id bigint references public.work_patterns (id) on delete set null,
  days_available  numeric,
  sort_order      integer not null default 0,
  constraint editors_slab_valid check (slab in ('A', 'B', 'C', 'D'))
);
create index if not exists editors_work_pattern_id_idx on public.editors (work_pattern_id);

create table if not exists public.editor_aliases (
  id        bigint generated always as identity primary key,
  editor_id bigint not null references public.editors (id) on delete cascade,
  alias     text   not null
);
create index if not exists editor_aliases_editor_id_idx on public.editor_aliases (editor_id);
create unique index if not exists editor_aliases_alias_key on public.editor_aliases (lower(alias));

-- ----------------------------------------------------------- type mappings
-- category_id null means the type is recognised but deliberately not payable.
-- A type absent from this table is unmapped and is flagged after every run.
create table if not exists public.type_mappings (
  id          bigint generated always as identity primary key,
  source_type text not null,
  category_id bigint references public.video_categories (id) on delete set null,
  sort_order  integer not null default 0
);
create index if not exists type_mappings_category_id_idx on public.type_mappings (category_id);
create unique index if not exists type_mappings_source_type_key on public.type_mappings (lower(source_type));

create table if not exists public.ignored_names (
  id   bigint generated always as identity primary key,
  name text not null
);
create unique index if not exists ignored_names_name_key on public.ignored_names (lower(name));

-- -------------------------------------------------------------------- runs
create table if not exists public.runs (
  id                bigint generated always as identity primary key,
  month_label       text not null default '',
  file_name         text,
  source_rows       jsonb   not null default '[]'::jsonb,
  config_snapshot   jsonb   not null,
  total_minutes     numeric not null default 0,
  total_points      numeric not null default 0,
  total_target      numeric not null default 0,
  total_surplus     numeric not null default 0,
  total_incentive   numeric not null default 0,
  untyped_minutes   numeric not null default 0,
  editors_delivered integer not null default 0,
  editors_cleared   integer not null default 0,
  unmatched_names   jsonb   not null default '[]'::jsonb,
  unmapped_types    jsonb   not null default '[]'::jsonb,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists runs_created_at_idx on public.runs (created_at desc);
create index if not exists runs_created_by_idx on public.runs (created_by);

create table if not exists public.run_results (
  id              bigint generated always as identity primary key,
  run_id          bigint  not null references public.runs (id) on delete cascade,
  editor_name     text    not null,
  slab            text    not null,
  work_pattern    text,
  days_available  numeric,
  minutes         numeric not null default 0,
  untyped_minutes numeric not null default 0,
  notpay_minutes  numeric not null default 0,
  points          numeric not null default 0,
  target_points   numeric not null default 0,
  surplus_points  numeric not null default 0,
  incentive_inr   numeric not null default 0,
  status          text    not null,
  by_category     jsonb   not null default '{}'::jsonb
);
create index if not exists run_results_run_id_idx on public.run_results (run_id);
create index if not exists run_results_editor_name_idx on public.run_results (editor_name);

-- ------------------------------------------------------------ row security
-- Signup is disabled in the Supabase dashboard; every account is created by an
-- admin. Any signed-in account is therefore trusted staff and may read and edit
-- the shared config. Runs are readable by all staff but only the person who
-- created a run may delete it.

alter table public.profiles         enable row level security;
alter table public.app_settings     enable row level security;
alter table public.work_patterns    enable row level security;
alter table public.video_categories enable row level security;
alter table public.editors          enable row level security;
alter table public.editor_aliases   enable row level security;
alter table public.type_mappings    enable row level security;
alter table public.ignored_names    enable row level security;
alter table public.runs             enable row level security;
alter table public.run_results      enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_write_own on public.profiles;
create policy profiles_write_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare t text;
begin
  foreach t in array array[
    'app_settings', 'work_patterns', 'video_categories',
    'editors', 'editor_aliases', 'type_mappings', 'ignored_names'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_staff_all', t
    );
  end loop;
end $$;

drop policy if exists runs_read on public.runs;
create policy runs_read on public.runs
  for select to authenticated using (true);

drop policy if exists runs_insert on public.runs;
create policy runs_insert on public.runs
  for insert to authenticated with check ((select auth.uid()) = created_by);

drop policy if exists runs_update_own on public.runs;
create policy runs_update_own on public.runs
  for update to authenticated
  using ((select auth.uid()) = created_by) with check ((select auth.uid()) = created_by);

drop policy if exists runs_delete_own on public.runs;
create policy runs_delete_own on public.runs
  for delete to authenticated using ((select auth.uid()) = created_by);

drop policy if exists run_results_read on public.run_results;
create policy run_results_read on public.run_results
  for select to authenticated using (true);

drop policy if exists run_results_write on public.run_results;
create policy run_results_write on public.run_results
  for all to authenticated
  using (exists (select 1 from public.runs r
                 where r.id = run_id and r.created_by = (select auth.uid())))
  with check (exists (select 1 from public.runs r
                      where r.id = run_id and r.created_by = (select auth.uid())));

-- --------------------------------------------------------------- read config
-- Returns the whole shared config as the single JSON document the UI edits.
create or replace function public.get_config()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'ppd',  s.points_per_day,
    'rate', s.incentive_per_point,
    'mode', s.rate_mode,
    'patterns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', p.name, 'days', p.standard_days, 'target', p.target_points
      ) order by p.sort_order, p.id), '[]'::jsonb)
      from public.work_patterns p
    ),
    'rates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cat', c.name,
        'len', c.deliverable_minutes,
        'r',   jsonb_build_array(c.rate_a, c.rate_b, c.rate_c, c.rate_d)
      ) order by c.sort_order, c.id), '[]'::jsonb)
      from public.video_categories c
    ),
    'map', (
      select coalesce(jsonb_agg(
        jsonb_build_array(m.source_type, coalesce(c.name, 'Not payable'))
        order by m.sort_order, m.id), '[]'::jsonb)
      from public.type_mappings m
      left join public.video_categories c on c.id = m.category_id
    ),
    'ignore', (
      select coalesce(jsonb_agg(n.name order by n.name), '[]'::jsonb)
      from public.ignored_names n
    ),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name',    e.name,
        'slab',    e.slab,
        'pattern', coalesce(p.name, ''),
        'days',    e.days_available,
        'alias',   coalesce((
          select jsonb_agg(a.alias order by a.id)
          from public.editor_aliases a where a.editor_id = e.id
        ), '[]'::jsonb)
      ) order by e.sort_order, e.id), '[]'::jsonb)
      from public.editors e
      left join public.work_patterns p on p.id = e.work_pattern_id
    )
  )
  from public.app_settings s
  where s.id;
$$;

-- -------------------------------------------------------------- write config
-- The UI edits the config as one document, so replace it as one atomic swap.
-- The config is small (tens of rows), so a full replace is cheaper to reason
-- about than per-row diffing, and it can never leave a half-applied rate card.
create or replace function public.set_config(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item      jsonb;
  idx       integer;
  editor_id bigint;
  alias     jsonb;
begin
  if p is null or p -> 'rates' is null or p -> 'team' is null then
    raise exception 'set_config: config must include rates and team';
  end if;

  delete from public.type_mappings;
  delete from public.editors;          -- aliases cascade
  delete from public.video_categories;
  delete from public.work_patterns;
  delete from public.ignored_names;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'patterns', '[]'::jsonb)) loop
    insert into public.work_patterns (name, standard_days, target_points, sort_order)
    values (item ->> 'name', (item ->> 'days')::numeric, (item ->> 'target')::numeric, idx);
    idx := idx + 1;
  end loop;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'rates', '[]'::jsonb)) loop
    insert into public.video_categories
      (name, deliverable_minutes, rate_a, rate_b, rate_c, rate_d, sort_order)
    values (
      item ->> 'cat',
      coalesce((item ->> 'len')::numeric, 10),
      coalesce((item -> 'r' ->> 0)::numeric, 0),
      coalesce((item -> 'r' ->> 1)::numeric, 0),
      coalesce((item -> 'r' ->> 2)::numeric, 0),
      coalesce((item -> 'r' ->> 3)::numeric, 0),
      idx
    );
    idx := idx + 1;
  end loop;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'team', '[]'::jsonb)) loop
    insert into public.editors (name, slab, work_pattern_id, days_available, sort_order)
    values (
      item ->> 'name',
      coalesce(item ->> 'slab', 'D'),
      (select w.id from public.work_patterns w where w.name = item ->> 'pattern'),
      case when item -> 'days' is null or jsonb_typeof(item -> 'days') = 'null'
           then null else (item ->> 'days')::numeric end,
      idx
    )
    returning id into editor_id;

    for alias in select * from jsonb_array_elements(coalesce(item -> 'alias', '[]'::jsonb)) loop
      insert into public.editor_aliases (editor_id, alias)
      values (editor_id, alias #>> '{}')
      on conflict do nothing;
    end loop;

    idx := idx + 1;
  end loop;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'map', '[]'::jsonb)) loop
    if coalesce(item ->> 0, '') <> '' then
      insert into public.type_mappings (source_type, category_id, sort_order)
      values (
        item ->> 0,
        (select c.id from public.video_categories c where c.name = item ->> 1),
        idx
      )
      on conflict do nothing;
    end if;
    idx := idx + 1;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p -> 'ignore', '[]'::jsonb)) loop
    insert into public.ignored_names (name) values (item #>> '{}') on conflict do nothing;
  end loop;

  insert into public.app_settings (id, points_per_day, incentive_per_point, rate_mode, updated_at, updated_by)
  values (
    true,
    coalesce((p ->> 'ppd')::numeric, 30),
    coalesce((p ->> 'rate')::numeric, 125),
    coalesce(nullif(p ->> 'mode', ''), 'uplift'),
    now(),
    auth.uid()
  )
  on conflict (id) do update set
    points_per_day      = excluded.points_per_day,
    incentive_per_point = excluded.incentive_per_point,
    rate_mode           = excluded.rate_mode,
    updated_at          = now(),
    updated_by          = excluded.updated_by;

  return public.get_config();
end;
$$;

revoke execute on function public.set_config(jsonb) from public, anon;
revoke execute on function public.get_config() from anon;

-- ---------------------------------------------------------------------- seed
-- Seeds the rate card, work patterns, team and type mapping the spreadsheet
-- tool shipped with, so a fresh deployment is usable immediately. Runs once.
do $$
begin
  if exists (select 1 from public.app_settings) then
    return;
  end if;

  insert into public.app_settings (id, points_per_day, incentive_per_point, rate_mode)
  values (true, 30, 125, 'uplift');

  insert into public.work_patterns (name, standard_days, target_points, sort_order) values
    ('5-day Office', 21.7, 650, 0),
    ('6-day WFH',    24.3, 730, 1);

  insert into public.video_categories
    (name, deliverable_minutes, rate_a, rate_b, rate_c, rate_d, sort_order)
  values
    ('Organic - A (Motion Graphics)',    10, 10,   12,   13,    13.5,  0),
    ('Organic - B (Screen records)',     10,  5,    5.5,  5.75,  6,     1),
    ('Shorts / Ads / Testimonials',       1, 15,   16.5, 17.25, 18,    2),
    ('LMS - Drops',                      20,  1.5,  1.8,  1.83,  2.025, 3),
    ('Podcast / Trailer / Testimonials', 15,  6,    6.9,  7.32,  7.5,   4),
    ('Events - Glimpses',                 5, 30,   36,   36.6,  40.5,  5);

  insert into public.editors (name, slab, work_pattern_id, sort_order)
  select t.name, t.slab, (select id from public.work_patterns where name = '5-day Office'), t.ord
  from (values
    ('Prince Tiwari','A',0),           ('Kiran Koppal','A',1),
    ('Mallikarjun Myagalamani','A',2), ('Krishna Sharma','A',3),
    ('Vikash','A',4),                  ('Midhlaj Anver KK','A',5),
    ('Sunain Swapnajit','B',6),        ('Lakshmi Prasad','B',7),
    ('Santhosh Kumar S','B',8),        ('Hariharan G','B',9),
    ('Deepjoti Acharjee','B',10),      ('Adesh Singh','B',11),
    ('Vivek Mhaisdhune','B',12),       ('Bhoomika L','B',13),
    ('Vishal Roopchandani','B',14),    ('Vikrant Raju Sansare','B',15),
    ('Rajesh D Raikar','B',16),        ('Vivek Dutonde','C',17),
    ('Aditya Kadlag','C',18),          ('Dhairya Ramesh Dholu','C',19),
    ('Vishnu Sreejith','C',20),        ('Anil Fulmali','C',21),
    ('Gunjan Aher','C',22),            ('Sakshi','C',23),
    ('Sarthak','C',24),                ('Suraj','C',25),
    ('Siddhesh Dipak','C',26),         ('Gaurav Suman','C',27),
    ('Dhanush','D',28),                ('Priya Rajesh Kaithwas','D',29),
    ('Karan G','D',30),                ('Sahaana Shankar','D',31),
    ('Mahasweta Maity','D',32),        ('Nithin Kumar N','D',33),
    ('Surabi B R','D',34)
  ) as t(name, slab, ord);

  insert into public.type_mappings (source_type, category_id, sort_order)
  select m.src, (select id from public.video_categories c where c.name = m.cat), m.ord
  from (values
    ('Ads',              'Shorts / Ads / Testimonials',       0),
    ('Shorts',           'Shorts / Ads / Testimonials',       1),
    ('Short Form',       'Shorts / Ads / Testimonials',       2),
    ('Reel',             'Shorts / Ads / Testimonials',       3),
    ('Motivation Reel',  'Shorts / Ads / Testimonials',       4),
    ('Podcast',          'Podcast / Trailer / Testimonials',  5),
    ('Organic',          'Organic - A (Motion Graphics)',     6),
    ('Long Form',        'Organic - A (Motion Graphics)',     7),
    ('Longform',         'Organic - A (Motion Graphics)',     8),
    ('Documentary Edit', 'Organic - A (Motion Graphics)',     9),
    ('Video Edit',       'Organic - A (Motion Graphics)',     10),
    ('Poster',           'Not payable',                       11)
  ) as m(src, cat, ord);
end $$;
