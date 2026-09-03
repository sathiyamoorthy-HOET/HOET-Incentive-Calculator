-- Give every run a real month, so runs can be grouped and ordered by the month
-- the work happened in rather than by the day someone happened to save them.
--
-- `month_label` stays as the free text that was typed, because it is what the
-- History page has always shown. This column is the sortable truth behind it,
-- held as the first day of the month.

-- ------------------------------------------------------------ label parsing
-- Reads a month out of whatever text is available: the label someone typed
-- ("August 2026"), or failing that the report's own file name, which carries
-- the period it covers ("..._01_Aug_31_Aug_2026.xlsx"). A file name spanning
-- two months is taken as the later one, matching how such a report is filed.
create or replace function private.parse_month(t text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  s     text := lower(coalesce(t, ''));
  abbr  text[] := array['jan','feb','mar','apr','may','jun',
                        'jul','aug','sep','oct','nov','dec'];
  hits  text[];
  parts text[];
  yr    integer;
  mo    integer;
begin
  if s = '' then
    return null;
  end if;

  select max(m.hit[1]::integer) into yr
  from regexp_matches(s, '((?:19|20)[0-9]{2})', 'g') with ordinality as m(hit, n);

  -- WITH ORDINALITY because which month name comes last is the whole point.
  select array_agg(m.hit[1] order by m.n) into hits
  from regexp_matches(s, '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', 'g')
       with ordinality as m(hit, n);

  if hits is not null then
    mo := array_position(abbr, hits[array_length(hits, 1)]);
  end if;

  -- 2026-08, 2026/8
  if mo is null then
    parts := regexp_match(s, '((?:19|20)[0-9]{2})[-/](0?[1-9]|1[0-2])([^0-9]|$)');
    if parts is not null then
      yr := parts[1]::integer;
      mo := parts[2]::integer;
    end if;
  end if;

  -- 08/2026, 8-2026
  if mo is null then
    parts := regexp_match(s, '(^|[^0-9])(0?[1-9]|1[0-2])[-/]((?:19|20)[0-9]{2})');
    if parts is not null then
      mo := parts[2]::integer;
      yr := parts[3]::integer;
    end if;
  end if;

  if yr is null or mo is null then
    return null;
  end if;
  return make_date(yr, mo, 1);
end;
$$;

revoke all on function private.parse_month(text) from public, anon, authenticated;

-- ------------------------------------------------------------------- column
alter table public.runs add column if not exists month date;

-- Runs saved before this column existed keep their month, read back out of the
-- label or the file name. Anything unparseable stays null and is listed on the
-- Editors page so it can be fixed by re-saving.
update public.runs
   set month = coalesce(private.parse_month(month_label), private.parse_month(file_name))
 where month is null;

create index if not exists runs_month_idx on public.runs (month desc, created_at desc);
