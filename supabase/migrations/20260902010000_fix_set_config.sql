-- Makes saving settings work again, and fail legibly when it cannot.
--
-- Two things were wrong with set_config:
--
--   1. It cleared the five config tables with unqualified DELETEs. The
--      function is security invoker, so those run as `authenticated`, and that
--      role has safeupdate enabled: every save was refused with "DELETE
--      requires a WHERE clause". Nothing could be saved from any page -- a new
--      video type, a rate, a target -- and the UI only showed it in a small
--      grey label. Each delete now carries a predicate the guard accepts.
--
--   2. Names are the identity of every list here: editors, video types and
--      work patterns are each stored unique. A duplicate does not fail its own
--      row, it fails the whole replace, so one duplicate created on one page
--      silently stopped every later save on every other page. Postgres
--      reported that as a constraint violation naming a table the UI never
--      mentions; it now names the row at fault instead.
--
-- The UI checks the same name rules before sending (lib/validate.ts); these
-- are here for imported settings files and any other caller.

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
