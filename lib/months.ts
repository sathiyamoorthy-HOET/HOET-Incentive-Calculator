/**
 * A run's month, and the rule for which run speaks for a month.
 *
 * The month a report covers is not the day it was saved — an August report is
 * usually saved in early September — so it is read out of the label someone
 * typed, or failing that out of the report's own file name, which carries the
 * period it covers.
 */

const ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A month as the first of it, "YYYY-MM-01", or null when there is none to read. */
export function parseMonth(text: string | null | undefined): string | null {
  const s = (text || "").toLowerCase();
  if (!s) return null;

  let year: number | null = null;
  const years = s.match(/(?:19|20)\d{2}/g);
  if (years) year = Math.max(...years.map(Number));

  let mo: number | null = null;
  /* A file name spanning two months ("01_Aug_31_Aug_2026", and at a month
     boundary "25_Jul_24_Aug_2026") is taken as the later one, which is how
     such a report is filed. */
  const names = s.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/g);
  if (names) mo = ABBR.indexOf(names[names.length - 1]) + 1;

  if (!mo) {
    const iso = s.match(/((?:19|20)\d{2})[-/](0?[1-9]|1[0-2])(?!\d)/);
    if (iso) {
      year = Number(iso[1]);
      mo = Number(iso[2]);
    }
  }
  if (!mo) {
    const rev = s.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[-/]((?:19|20)\d{2})/);
    if (rev) {
      mo = Number(rev[1]);
      year = Number(rev[2]);
    }
  }

  if (!year || !mo) return null;
  return year + "-" + String(mo).padStart(2, "0") + "-01";
}

/** "2026-08-01" as "August 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split("-");
  return (FULL[Number(m) - 1] || month) + " " + y;
}

/** "2026-08-01" as "Aug 2026", for a column heading that has to stay narrow. */
export function monthShort(month: string): string {
  const [y, m] = month.split("-");
  const name = FULL[Number(m) - 1];
  return name ? name.slice(0, 3) + " " + y : month;
}

/**
 * One run per month, so nothing is counted twice.
 *
 * A month is often run more than once — a report is re-exported, a mapping is
 * corrected, someone re-uploads the same file. Every one of those runs is kept
 * in History, but only the newest may speak for its month, or an editor would
 * appear once per attempt and their incentive would be added up as many times.
 *
 * Runs with no month readable at all are returned separately rather than
 * guessed at, because guessing would file an August report under September.
 */
export function officialRuns<T extends { id: number; month: string | null; created_at: string }>(
  runs: T[]
): { kept: T[]; superseded: T[]; undated: T[] } {
  const kept = new Map<string, T>();
  const superseded: T[] = [];
  const undated: T[] = [];

  /* Newest first, so the first run seen for a month is the one that wins.
     created_at can tie on a fast double-save, so id breaks it. */
  const ordered = [...runs].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id
  );

  for (const r of ordered) {
    if (!r.month) {
      undated.push(r);
      continue;
    }
    if (kept.has(r.month)) superseded.push(r);
    else kept.set(r.month, r);
  }

  return {
    kept: [...kept.values()].sort((a, b) => (a.month || "").localeCompare(b.month || "")),
    superseded,
    undated,
  };
}
