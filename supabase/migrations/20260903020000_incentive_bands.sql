-- Pays points above target in rungs, and writes down when a PIP is due.
--
-- One rate for every point above target treated the editor who scraped past it
-- and the editor who cleared it by a hundred as the same thing. The ladder is
-- read the way an income-tax slab is: a rung pays only for the points that
-- fall inside it, so 70 points clear of target earns 60 at the first rate and
-- 10 at the second -- never 70 at the second.
--
-- Rungs are counted from the editor's own target rather than as absolute
-- scores, so one ladder serves every work pattern: a 5-day office editor on
-- 650 reads them as 650, 710 and 770, and a 6-day WFH editor on 730 reads the
-- same three rungs as 730, 790 and 850.
--
-- app_settings.incentive_per_point stays where it is. Runs already in History
-- were priced with it and are reopened by recomputing from the config snapshot
-- stored with them, so removing it would move payouts that were signed off.
--
-- pip_months is the other half of what the target means: how many months in a
-- row below it put an editor on a performance improvement plan. It is a rule
-- the team will argue about, so it lives here and is edited on the rate card
-- rather than being written into the UI.

alter table public.app_settings add column if not exists pip_months integer not null default 3
  check (pip_months >= 0);

create table if not exists public.incentive_bands (
  from_points integer primary key check (from_points >= 0),
  rate_inr    numeric not null default 0 check (rate_inr >= 0)
);

alter table public.incentive_bands enable row level security;

drop policy if exists incentive_bands_staff_all on public.incentive_bands;
create policy incentive_bands_staff_all on public.incentive_bands
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- set_config runs as the caller, so the caller needs the table privileges too;
-- row-level security is what decides which of them may actually use it.
grant select, insert, update, delete on public.incentive_bands to authenticated;

insert into public.incentive_bands (from_points, rate_inr) values
  (  0, 175),
  ( 60, 200),
  (120, 225)
on conflict (from_points) do nothing;

-- ------------------------------------------------------------- read config
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
    'pipMonths', s.pip_months,
    'payBands', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'from', b.from_points, 'rate', b.rate_inr
      ) order by b.from_points), '[]'::jsonb)
      from public.incentive_bands b
    ),
    'revPen', (
      select coalesce(jsonb_agg(v.pct order by v.round), '[]'::jsonb)
      from public.revision_penalties v
    ),
    'patterns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', p.name, 'days', p.standard_days, 'target', p.target_points
      ) order by p.sort_order, p.id), '[]'::jsonb)
      from public.work_patterns p
    ),
    'rates', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cat',    c.name,
        'r',      jsonb_build_array(c.rate_a, c.rate_b, c.rate_c, c.rate_d),
        'review', c.review_rate
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
        'reviewer', e.is_reviewer,
        'target',  e.target_override,
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

-- ------------------------------------------------------------ write config
create or replace function public.set_config(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item      jsonb;
  dup        text;
  prev       jsonb;
  prevReview jsonb;
  idx       integer;
  editor_id bigint;
  alias     jsonb;
begin
  if p is null or p -> 'rates' is null or p -> 'team' is null then
    raise exception 'set_config: config must include rates and team';
  end if;

  -- Names are the identity of every list here: editors, video types and work
  -- patterns are each stored unique. A duplicate therefore does not fail on
  -- its own row -- it fails the whole replace, so a duplicate created on one
  -- page silently stops every later save on every other page. Check it first
  -- and say which name is at fault.
  select n into dup from (
    select lower(trim(e.item ->> 'name')) as n
    from jsonb_array_elements(coalesce(p -> 'team', '[]'::jsonb)) as e(item)
  ) s where n <> '' group by n having count(*) > 1 limit 1;
  if dup is not null then
    raise exception 'Two editors are called "%". Editor names must be different.', dup
      using errcode = '23505';
  end if;

  select n into dup from (
    select lower(trim(e.item ->> 'cat')) as n
    from jsonb_array_elements(coalesce(p -> 'rates', '[]'::jsonb)) as e(item)
  ) s where n <> '' group by n having count(*) > 1 limit 1;
  if dup is not null then
    raise exception 'Two video types are called "%". Rename one of them.', dup
      using errcode = '23505';
  end if;

  select n into dup from (
    select lower(trim(e.item ->> 'name')) as n
    from jsonb_array_elements(coalesce(p -> 'patterns', '[]'::jsonb)) as e(item)
  ) s where n <> '' group by n having count(*) > 1 limit 1;
  if dup is not null then
    raise exception 'Two work patterns are called "%". Rename one of them.', dup
      using errcode = '23505';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p -> 'team', '[]'::jsonb)) as e(item)
    where coalesce(trim(e.item ->> 'name'), '') = ''
  ) then
    raise exception 'Every editor needs a name.' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p -> 'rates', '[]'::jsonb)) as e(item)
    where coalesce(trim(e.item ->> 'cat'), '') = ''
  ) then
    raise exception 'Every video type needs a name.' using errcode = '23514';
  end if;

  -- The `where id > 0` on each of these is load-bearing, not decoration.
  -- This function is security invoker, so the deletes run as `authenticated`,
  -- and that role has safeupdate on: an unqualified delete is refused with
  -- "DELETE requires a WHERE clause" and the whole save fails. The clause is
  -- true for every row (id is a generated identity), so it still clears the
  -- table -- it just states a predicate the guard can see. Do not simplify it
  -- to `where true`, which the planner folds away again.
  /* The team is replaced wholesale, so anything a caller does not send would
     be lost. An older build sends no reviewer flag and no target of its own:
     remember them by name and put them back rather than clearing them. */
  select coalesce(jsonb_object_agg(e.name, jsonb_build_object(
           'reviewer', e.is_reviewer, 'target', e.target_override)), '{}'::jsonb)
    into prev
  from public.editors e;

  select coalesce(jsonb_object_agg(c.name, c.review_rate), '{}'::jsonb)
    into prevReview
  from public.video_categories c;

  delete from public.type_mappings   where id > 0;
  delete from public.editors         where id > 0;   -- aliases cascade
  delete from public.video_categories where id > 0;
  delete from public.work_patterns   where id > 0;
  delete from public.ignored_names   where id > 0;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'patterns', '[]'::jsonb)) loop
    insert into public.work_patterns (name, standard_days, target_points, sort_order)
    values (item ->> 'name', (item ->> 'days')::numeric, (item ->> 'target')::numeric, idx);
    idx := idx + 1;
  end loop;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'rates', '[]'::jsonb)) loop
    insert into public.video_categories
      (name, rate_a, rate_b, rate_c, rate_d, review_rate, sort_order)
    values (
      item ->> 'cat',
      coalesce((item -> 'r' ->> 0)::numeric, 0),
      coalesce((item -> 'r' ->> 1)::numeric, 0),
      coalesce((item -> 'r' ->> 2)::numeric, 0),
      coalesce((item -> 'r' ->> 3)::numeric, 0),
      case when item ? 'review' then greatest(0, coalesce((item ->> 'review')::numeric, 0))
           else coalesce((prevReview ->> (item ->> 'cat'))::numeric, 0) end,
      idx
    );
    idx := idx + 1;
  end loop;

  -- Absent means unchanged here too, for the same reason as the revision
  -- ladder below: a browser tab left open on the build before the payout
  -- ladder existed sends no 'payBands', and one save from it must not leave
  -- the team on a rate card that pays nothing above target.
  if p ? 'payBands' then
    delete from public.incentive_bands where from_points >= 0;

    -- Two rungs starting at the same point are one rung, and the table says
    -- so: from_points is the key. Deduplicated here rather than left to
    -- ON CONFLICT, which cannot touch the same row twice in one statement.
    insert into public.incentive_bands (from_points, rate_inr)
    select distinct on (b.f) b.f, b.r
    from (
      select greatest(0, round(coalesce((e.item ->> 'from')::numeric, 0))::integer) as f,
             greatest(0, coalesce((e.item ->> 'rate')::numeric, 0))                 as r
      from jsonb_array_elements(p -> 'payBands') as e(item)
    ) b
    order by b.f;
  end if;

  -- A client that predates the revision ladder sends no 'revPen' at all, and
  -- must not be read as "clear the ladder": one save from a stale browser tab
  -- would otherwise wipe what the rate card charges for revisions. Absent
  -- means unchanged; an explicit empty list still clears it.
  if p ? 'revPen' then
    delete from public.revision_penalties where round > 0;

    idx := 0;
    for item in select * from jsonb_array_elements(p -> 'revPen') loop
      idx := idx + 1;
      insert into public.revision_penalties (round, pct)
      values (idx, greatest(0, least(100, coalesce((item #>> '{}')::numeric, 0))));
    end loop;
  end if;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'team', '[]'::jsonb)) loop
    insert into public.editors
      (name, slab, work_pattern_id, days_available, is_reviewer, target_override, sort_order)
    values (
      item ->> 'name',
      coalesce(item ->> 'slab', 'D'),
      (select w.id from public.work_patterns w where w.name = item ->> 'pattern'),
      case when item -> 'days' is null or jsonb_typeof(item -> 'days') = 'null'
           then null else (item ->> 'days')::numeric end,
      case when item ? 'reviewer' then coalesce((item ->> 'reviewer')::boolean, false)
           else coalesce((prev -> (item ->> 'name') ->> 'reviewer')::boolean, false) end,
      case when item ? 'target'
           then (case when jsonb_typeof(item -> 'target') = 'null' then null
                      else (item ->> 'target')::numeric end)
           else (prev -> (item ->> 'name') ->> 'target')::numeric end,
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

  insert into public.app_settings
    (id, points_per_day, incentive_per_point, pip_months, updated_at, updated_by)
  values (
    true,
    coalesce((p ->> 'ppd')::numeric, 30),
    coalesce((p ->> 'rate')::numeric, 125),
    coalesce((p ->> 'pipMonths')::integer, (select s.pip_months from public.app_settings s where s.id), 3),
    now(),
    auth.uid()
  )
  on conflict (id) do update set
    points_per_day      = excluded.points_per_day,
    incentive_per_point = excluded.incentive_per_point,
    pip_months          = excluded.pip_months,
    updated_at          = now(),
    updated_by          = excluded.updated_by;

  return public.get_config();
end;
$$;

revoke execute on function public.set_config(jsonb) from public, anon;
revoke execute on function public.get_config() from anon;
