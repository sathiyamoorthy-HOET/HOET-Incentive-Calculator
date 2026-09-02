-- Charges for revisions.
--
-- A deliverable's Version says how many times it came back: 1 is a first-pass
-- approval, 2 is one revision, 3 is two. The cost of each rung is a business
-- decision that will be argued about, so it lives in the database and is
-- edited on the rate card rather than being hard-coded here.
--
-- The ladder is read by round count, not summed: a video revised three times
-- is charged the third rung, and anything past the end of the ladder is
-- charged its last rung. Runs already in History keep the ladder they were
-- saved with, so signed-off payouts do not move.

create table if not exists public.revision_penalties (
  round integer primary key check (round > 0),
  pct   numeric not null default 0 check (pct >= 0 and pct <= 100)
);

alter table public.revision_penalties enable row level security;

drop policy if exists revision_penalties_staff_all on public.revision_penalties;
create policy revision_penalties_staff_all on public.revision_penalties
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- set_config runs as the caller, so the caller needs the table privileges too;
-- row-level security is what decides which of them may actually use it.
grant select, insert, update, delete on public.revision_penalties to authenticated;

insert into public.revision_penalties (round, pct) values
  (1,  5),
  (2, 10),
  (3, 30)
on conflict (round) do nothing;

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
        'cat', c.name,
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

-- ------------------------------------------------------------ write config
create or replace function public.set_config(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item      jsonb;
  dup       text;
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
  delete from public.type_mappings   where id > 0;
  delete from public.editors         where id > 0;   -- aliases cascade
  delete from public.video_categories where id > 0;
  delete from public.work_patterns   where id > 0;
  delete from public.ignored_names   where id > 0;
  delete from public.revision_penalties where round > 0;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'patterns', '[]'::jsonb)) loop
    insert into public.work_patterns (name, standard_days, target_points, sort_order)
    values (item ->> 'name', (item ->> 'days')::numeric, (item ->> 'target')::numeric, idx);
    idx := idx + 1;
  end loop;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'rates', '[]'::jsonb)) loop
    insert into public.video_categories
      (name, rate_a, rate_b, rate_c, rate_d, sort_order)
    values (
      item ->> 'cat',
      coalesce((item -> 'r' ->> 0)::numeric, 0),
      coalesce((item -> 'r' ->> 1)::numeric, 0),
      coalesce((item -> 'r' ->> 2)::numeric, 0),
      coalesce((item -> 'r' ->> 3)::numeric, 0),
      idx
    );
    idx := idx + 1;
  end loop;

  idx := 0;
  for item in select * from jsonb_array_elements(coalesce(p -> 'revPen', '[]'::jsonb)) loop
    idx := idx + 1;
    insert into public.revision_penalties (round, pct)
    values (idx, greatest(0, least(100, coalesce((item #>> '{}')::numeric, 0))));
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

  insert into public.app_settings (id, points_per_day, incentive_per_point, updated_at, updated_by)
  values (
    true,
    coalesce((p ->> 'ppd')::numeric, 30),
    coalesce((p ->> 'rate')::numeric, 125),
    now(),
    auth.uid()
  )
  on conflict (id) do update set
    points_per_day      = excluded.points_per_day,
    incentive_per_point = excluded.incentive_per_point,
    updated_at          = now(),
    updated_by          = excluded.updated_by;

  return public.get_config();
end;
$$;

revoke execute on function public.set_config(jsonb) from public, anon;
revoke execute on function public.get_config() from anon;
