"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  catsOf,
  compute,
  withDefaults,
  settleKey,
  ledgerAfter,
  matchEditor,
  settleRows,
  totals,
} from "@/lib/calc";
import { officialRuns, parseMonth } from "@/lib/months";
import type { Config, EditorCat, Ledger, RunStatus, RunSummary, SourceRow } from "@/lib/types";

export type { EditorCat };

/** Server Actions are reachable independently of the proxy, so re-check auth. */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, user };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The shared rate card as it is now, for a tab that has been open a while. */
export async function loadConfig(): Promise<Config | null> {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("get_config");
    if (error || !data) return null;
    return withDefaults(data as Config);
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.rpc("set_config", { p: config });
    if (error) {
      // A rejected save loses an edit the user has already seen on screen, so
      // leave a trace in the server log as well as returning the message.
      console.error("set_config failed:", error.message, error.details ?? "", error.hint ?? "");
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save settings.";
    console.error("saveConfig failed:", msg);
    return { ok: false, error: msg };
  }
}

/* -------------------------------------------------------------------- ledger
   What has already been paid for, so a cut re-uploaded in a later month is not
   paid for a second time. Orbitova reports such a cut again by design — its
   Methodology sheet calls the figure upload volume, not library length — so
   this memory is what keeps one video to one payment. */

type LedgerRow = {
  key: string;
  run_id: number;
  month: string;
  version: number;
  gross_points: number;
  charged_pct: number;
};

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Every deliverable ever paid for, minus any owned by runs for the month being
 * settled — re-running a month must not find its own previous attempt and call
 * its own work a duplicate.
 */
async function readLedger(
  supabase: Supa,
  exclude: number[] = []
): Promise<{ rows: Map<string, LedgerRow>; ledger: Ledger }> {
  const rows = new Map<string, LedgerRow>();
  /* Paged, because this table only ever grows: one row per deliverable, for
     every month there has ever been. */
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("paid_deliverables")
      .select("key, run_id, month, version, gross_points, charged_pct")
      .range(from, from + PAGE - 1);
    if (error) {
      /* Refuse rather than treat the ledger as empty: an empty ledger would
         quietly pay for every re-uploaded cut a second time, which is the one
         thing this table exists to prevent. */
      throw new Error(
        error.message.includes("paid_deliverables")
          ? "The record of what has already been paid is missing, so a report cannot be settled without risking paying twice for the same video. Apply the migrations in supabase/migrations (supabase db push) and try again."
          : "Could not read what has already been paid: " + error.message
      );
    }
    const page = (data as LedgerRow[] | null) || [];
    for (const r of page) {
      if (exclude.includes(r.run_id)) continue;
      rows.set(r.key, r);
    }
    if (page.length < PAGE) break;
  }

  const ledger: Ledger = {};
  for (const [key, r] of rows) {
    ledger[key] = {
      version: Number(r.version),
      gross: Number(r.gross_points),
      chargedPct: Number(r.charged_pct),
    };
  }
  return { rows, ledger };
}

/**
 * Settles a freshly read report against the ledger, so the Results page shows
 * what will actually be paid rather than what the runtime column says.
 */
export async function settleUpload(
  config: Config,
  rows: SourceRow[],
  /** The month this report is for, when it is already known. */
  monthLabel?: string | null
): Promise<{ ok: true; rows: SourceRow[] } | { ok: false; error: string }> {
  try {
    const { supabase } = await requireUser();
    /* A month run again is settled as Save settles it: against the months
       before it, never against its own earlier save. Otherwise re-uploading
       September after saving September finds every video already paid for
       and prices the whole month at nothing. */
    const month = parseMonth(monthLabel || "");
    let replacing: number[] = [];
    if (month) {
      const { data: same } = await supabase.from("runs").select("id").eq("month", month);
      replacing = ((same as { id: number }[] | null) || []).map((r) => r.id);
    }
    const { ledger } = await readLedger(supabase, replacing);
    return { ok: true, rows: settleRows(config, rows, ledger) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the ledger." };
  }
}

export type SaveRunInput = {
  monthLabel: string;
  fileName: string | null;
  rows: SourceRow[];
  config: Config;
  /** Kudos points by editor name, as typed on Results. */
  kudos?: Record<string, number>;
  /** Days of leave by editor name, where a manager entered any. */
  leave?: Record<string, number>;
  /** Editors away with another department this month, by name. */
  away?: Record<string, boolean>;
};

/** Only the names actually marked, so the stored map stays small. */
function cleanAway(map: Record<string, boolean> | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, v] of Object.entries(map || {})) if (v) out[name] = true;
  return out;
}

/** Only names with a usable number against them, so the stored map stays small. */
function cleanMap(map: Record<string, number> | undefined, min: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, v] of Object.entries(map || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= min) out[name] = n;
  }
  return out;
}
/* Half a point of kudos or half a day of leave is the least worth keeping. */
const cleanKudos = (m: Record<string, number> | undefined) => cleanMap(m, 0.5);
const cleanLeave = (m: Record<string, number> | undefined) => cleanMap(m, 0.5);

export async function saveRun(
  input: SaveRunInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const { supabase, user } = await requireUser();

    /* A run has to know its month before it can be settled: the ledger is
       ordered by month, and the Editors grid is laid out by it. */
    const month = parseMonth(input.monthLabel) || parseMonth(input.fileName);
    if (!month) {
      return {
        ok: false,
        error:
          "This run has no month. Type it in the Month box beside Save (\u201cAugust 2026\u201d) and save again \u2014 without it, a video re-uploaded next month cannot be recognised as one already paid for.",
      };
    }

    /* Months must be settled oldest first, or a later month would already have
       charged a revision against a video this run is only now paying for. */
    const { data: newer } = await supabase
      .from("runs")
      .select("id, month, month_label")
      .gt("month", month)
      .order("month", { ascending: false })
      .limit(1);
    if (newer && newer.length) {
      const n = newer[0] as { month: string; month_label: string };
      return {
        ok: false,
        error:
          "A later month (" +
          (n.month_label || n.month) +
          ") has already been saved, and it was priced against what had been paid up to then. Save months oldest first: delete that run, save this one, then run it again.",
      };
    }

    /* Runs already covering this month are being replaced, so what they paid
       for must not count against this attempt. */
    const { data: same } = await supabase.from("runs").select("id").eq("month", month);
    const replacing = ((same as { id: number }[] | null) || []).map((r) => r.id);

    const { ledger, rows: ledgerRows } = await readLedger(supabase, replacing);
    const rows = settleRows(input.config, input.rows, ledger);

    const kudos = cleanKudos(input.kudos);
    const leave = cleanLeave(input.leave);
    const away = cleanAway(input.away);
    const c = compute(input.config, rows, kudos, leave, away);
    const t = totals(c.out);
    const active = c.out.filter((r) => r.mins > 0.05 || r.projects > 0).length;
    const cleared = c.out.filter((r) => r.surplus > 0).length;

    const { data: run, error } = await supabase
      .from("runs")
      .insert({
        month_label: input.monthLabel || "",
        /* The sortable month behind the label. Falls back to the report's own
           file name, which carries the period it covers. */
        month,
        file_name: input.fileName,
        /* Settled rows, not the raw ones: each carries the decision made about
           it, so reopening this run reproduces this payout even after the
           ledger has moved on. */
        source_rows: rows,
        config_snapshot: input.config,
        kudos,
        leave,
        away,
        total_minutes: Math.round(t.m * 10) / 10,
        total_points: Math.round(t.p * 10) / 10,
        total_target: Math.round(t.t),
        total_surplus: Math.round(t.s * 10) / 10,
        /* What is paid out: the performance incentive plus kudos. */
        total_incentive: Math.round(t.i + t.k),
        untyped_minutes: Math.round(c.untypedMins * 10) / 10,
        editors_delivered: active,
        editors_cleared: cleared,
        unmatched_names: c.unmatched.map(([raw, u]) => ({ name: raw, mins: u.mins })),
        unmapped_types: c.unknownTypes.map(([type, mins]) => ({ type, mins })),
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !run) return { ok: false, error: error?.message || "Could not save the run." };

    const resultRows = c.out.map((r) => ({
      run_id: run.id,
      editor_name: r.name,
      slab: r.slab,
      work_pattern: r.pattern,
      days_available: r.days,
      minutes: r.mins,
      untyped_minutes: r.untyped,
      notpay_minutes: r.notPay,
      points: r.pts,
      target_points: r.target,
      surplus_points: r.surplus,
      incentive_inr: r.incentive,
      kudos_points: r.kudos,
      kudos_inr: r.kudosInr,
      status: r.status,
      by_category: r.byCat,
    }));

    const { error: rowsError } = await supabase.from("run_results").insert(resultRows);
    if (rowsError) {
      await supabase.from("runs").delete().eq("id", run.id);
      return { ok: false, error: rowsError.message };
    }

    /* Record what this month paid for. A deliverable seen for the first time is
       owned by this run — delete the run and it is freed to be paid again. One
       already on the ledger keeps its original owner and its original value,
       and only has its version and charged percentage moved forward, so a
       later revision is always charged against what the video first earned. */
    const after = ledgerAfter(input.config, input.rows, ledger);
    const meta = new Map<string, { code: string; no: string; editor: string }>();
    for (const r of rows) {
      const key = settleKey(input.config, r);
      if (!key || meta.has(key)) continue;
      const m = matchEditor(input.config, r.raw);
      /* "project" in place of a number when the whole project was the thing paid for. */
      meta.set(key, {
        code: r.code as string,
        no: key.slice(key.indexOf("#") + 1),
        editor: m.e?.name || r.raw,
      });
    }

    const entries = [...meta.entries()].map(([key, m]) => {
      const e = after[key];
      const was = ledgerRows.get(key);
      return {
        key,
        project_code: m.code,
        deliverable_no: m.no,
        run_id: was ? was.run_id : run.id,
        month: was ? was.month : month,
        editor_name: m.editor,
        version: e.version,
        gross_points: was ? was.gross_points : Math.round(e.gross * 10000) / 10000,
        charged_pct: e.chargedPct,
      };
    });

    if (entries.length) {
      const { error: ledgerError } = await supabase
        .from("paid_deliverables")
        .upsert(entries, { onConflict: "key" });
      if (ledgerError) {
        await supabase.from("runs").delete().eq("id", run.id);
        return {
          ok: false,
          error:
            "The run was not saved because what it paid for could not be recorded, which would have let next month pay for the same videos again: " +
            ledgerError.message,
        };
      }
    }

    /* Only now that this month is recorded, release the runs it replaces. */
    if (replacing.length) {
      await supabase.from("paid_deliverables").delete().in("run_id", replacing);
    }

    revalidatePath("/", "layout");
    return { ok: true, id: run.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the run." };
  }
}

export async function deleteRun(id: number): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    /* The database lets only the author delete a run, and says so by deleting
       nothing rather than by refusing. Count what went, so a run that is not
       yours gets a reason instead of a button that does nothing. */
    const { data, error } = await supabase.from("runs").delete().eq("id", id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || !data.length) {
      return {
        ok: false,
        error: "Only the person who saved this run, or a super admin, can delete it. Ask them to, or save the month again yourself: the newest save is the one that counts.",
      };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete the run." };
  }
}

export async function loadRun(id: number): Promise<
  | {
      ok: true;
      monthLabel: string;
      fileName: string | null;
      rows: SourceRow[];
      config: Config;
      kudos: Record<string, number>;
      leave: Record<string, number>;
      away: Record<string, boolean>;
    }
  | { ok: false; error: string }
> {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("runs")
      .select("month_label, file_name, source_rows, config_snapshot, kudos, leave, away")
      .eq("id", id)
      .single();
    if (error || !data) return { ok: false, error: error?.message || "That run no longer exists." };
    return {
      ok: true,
      monthLabel: data.month_label,
      fileName: data.file_name,
      rows: data.source_rows as SourceRow[],
      config: data.config_snapshot as Config,
      kudos: (data.kudos as Record<string, number> | null) || {},
      leave: (data.leave as Record<string, number> | null) || {},
      away: (data.away as Record<string, boolean> | null) || {},
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not open the run." };
  }
}

/**
 * Changes the kudos points, leave and away marks on a run that is already saved,
 * and re-prices it with its own snapshot so the stored totals and the
 * per-editor rows follow. Nothing else about the run moves: the rows, the
 * rate card and the ledger stay as they were signed off.
 */
export async function saveAdjustments(
  id: number,
  input: { kudos: Record<string, number>; leave: Record<string, number>; away: Record<string, boolean> }
): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("runs")
      .select("source_rows, config_snapshot")
      .eq("id", id)
      .single();
    if (error || !data) return { ok: false, error: error?.message || "That run no longer exists." };

    const config = data.config_snapshot as Config;
    config.revPen = config.revPen ?? [];
    const kudos = cleanKudos(input.kudos);
    const leave = cleanLeave(input.leave);
    const away = cleanAway(input.away);
    const c = compute(config, data.source_rows as SourceRow[], kudos, leave, away);
    const t = totals(c.out);

    const { error: runError } = await supabase
      .from("runs")
      .update({
        kudos,
        leave,
        away,
        total_target: Math.round(t.t),
        total_surplus: Math.round(t.s * 10) / 10,
        total_incentive: Math.round(t.i + t.k),
        editors_cleared: c.out.filter((r) => r.surplus > 0).length,
      })
      .eq("id", id);
    if (runError) return { ok: false, error: runError.message };

    /* ponytail: one update per editor; the run's own maps above are what a
       reopened run reads, these only feed the Editors grid. */
    const results = await Promise.all(
      c.out.map((r) =>
        supabase
          .from("run_results")
          .update({
            kudos_points: r.kudos,
            kudos_inr: r.kudosInr,
            days_available: r.days,
            target_points: r.target,
            surplus_points: r.surplus,
            incentive_inr: r.incentive,
            status: r.status,
          })
          .eq("run_id", id)
          .eq("editor_name", r.name)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return { ok: false, error: failed.error.message };

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the changes." };
  }
}

export async function listRuns(): Promise<RunSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("runs")
    .select(
      "id, month_label, file_name, total_minutes, total_points, total_target, total_surplus, total_incentive, untyped_minutes, editors_delivered, editors_cleared, created_at, created_by, profiles:created_by (email, full_name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  type Row = Omit<RunSummary, "author"> & {
    profiles: { email: string | null; full_name: string | null } | null;
  };

  return ((data as Row[] | null) || []).map((r) => ({
    ...r,
    author: r.profiles?.full_name || r.profiles?.email || null,
  }));
}

/* ------------------------------------------------------------- accountability
   Both editor views read the same saved rows the Results page wrote, and both
   pass them through officialRuns first, so a month that was run twice is
   counted once and the two pages can never disagree. */

export type MonthCol = {
  key: string;
  runId: number;
  label: string;
  fileName: string | null;
};

export type GridCell = {
  minutes: number;
  points: number;
  /** Kudos points given that month; they count towards the PIP line. */
  kudos: number;
  target: number;
  surplus: number;
  incentive: number;
  status: RunStatus;
};

export type GridEditor = {
  name: string;
  slab: string;
  cells: Record<string, GridCell>;
  /** Months this editor delivered any work in. */
  active: number;
  /** Months they finished above target. */
  cleared: number;
  incentive: number;
  surplus: number;
};

export type Accountability = {
  months: MonthCol[];
  editors: GridEditor[];
  /** Runs held back because a newer run covers the same month. */
  superseded: number;
  /** Runs with no readable month, which therefore appear in no column. */
  undated: { id: number; fileName: string | null; createdAt: string }[];
};

type RunRow = {
  id: number;
  month: string | null;
  month_label: string;
  file_name: string | null;
  created_at: string;
};

type ResultRow = {
  editor_name: string;
  slab: string;
  minutes: number;
  points: number;
  target_points: number;
  surplus_points: number;
  incentive_inr: number;
  kudos_points: number;
  kudos_inr: number;
  status: RunStatus;
};

export async function listAccountability(): Promise<Accountability> {
  const supabase = await createClient();
  /* Which run speaks for which month is decided first, from the cheap columns
     alone, so the rows behind a superseded run are never fetched at all. */
  const { data: index } = await supabase
    .from("runs")
    .select("id, month, month_label, file_name, created_at")
    .order("created_at", { ascending: false });

  const all = (index as RunRow[] | null) || [];
  const { kept: keptIndex, superseded, undated } = officialRuns(all);

  const { data } = keptIndex.length
    ? await supabase
        .from("runs")
        .select(
          "id, month, month_label, file_name, created_at, run_results (editor_name, slab, minutes, points, target_points, surplus_points, incentive_inr, kudos_points, kudos_inr, status)"
        )
        .in("id", keptIndex.map((r) => r.id))
    : { data: [] };

  const rows = (data as (RunRow & { run_results: ResultRow[] })[] | null) || [];
  /* Re-sorted the same way, so the column order does not depend on the order
     the database chose to return them in. */
  const kept = keptIndex
    .map((r) => rows.find((x) => x.id === r.id))
    .filter((r): r is RunRow & { run_results: ResultRow[] } => !!r);

  const months: MonthCol[] = kept.map((r) => ({
    key: r.month as string,
    runId: r.id,
    label: r.month_label,
    fileName: r.file_name,
  }));

  const editors = new Map<string, GridEditor>();
  for (const run of kept) {
    for (const row of run.run_results || []) {
      let e = editors.get(row.editor_name);
      if (!e) {
        e = {
          name: row.editor_name,
          slab: row.slab,
          cells: {},
          active: 0,
          cleared: 0,
          incentive: 0,
          surplus: 0,
        };
        editors.set(row.editor_name, e);
      }
      e.cells[run.month as string] = {
        minutes: Number(row.minutes),
        points: Number(row.points),
        kudos: Number(row.kudos_points || 0),
        target: Number(row.target_points),
        surplus: Number(row.surplus_points),
        /* What was paid: the performance incentive plus any kudos. */
        incentive: Number(row.incentive_inr) + Number(row.kudos_inr || 0),
        status: row.status,
      };
      if (Number(row.minutes) > 0.05) e.active += 1;
      if (Number(row.surplus_points) > 0) e.cleared += 1;
      e.incentive += Number(row.incentive_inr) + Number(row.kudos_inr || 0);
      e.surplus += Number(row.surplus_points);
    }
  }

  return {
    months,
    /* Newest run wins on slab, so someone promoted mid-year reads as they are
       now. Ordered as the team list reads: slab first, then name. */
    editors: [...editors.values()].sort(
      (a, b) => a.slab.localeCompare(b.slab) || a.name.localeCompare(b.name)
    ),
    superseded: superseded.length,
    undated: undated.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      createdAt: r.created_at,
    })),
  };
}


export type EditorMonth = {
  runId: number;
  month: string;
  label: string;
  fileName: string | null;
  slab: string;
  pattern: string | null;
  days: number | null;
  minutes: number;
  untyped: number;
  notPay: number;
  points: number;
  target: number;
  surplus: number;
  /** The performance incentive, from points above target. */
  incentive: number;
  /** Kudos points given that month, and what they paid. */
  kudos: number;
  kudosInr: number;
  status: RunStatus;
  byCat: Record<string, number>;
  /** The video-type table for this month: minutes, rate, deductions, points. */
  cats: EditorCat[];
  revised: number;
  rounds: number;
  deducted: number;
  carried: number;
  carryDed: number;
  reviewed: number;
  reviewMins: number;
  reviewPts: number;
};

export type EditorReport = {
  name: string;
  months: EditorMonth[];
  /** Every video type this editor has ever been credited for, for the CSV. */
  cats: string[];
};

/**
 * One editor's history, month by month.
 *
 * Each month is recomputed from the run's own stored rows and the rate card it
 * was priced with, rather than read back from the summary row. That is what
 * lets this page show the same video-type breakdown as Results — rates and
 * per-type deductions are not in the summary — and it guarantees the two pages
 * cannot disagree, since they run the same function over the same input.
 */
export async function loadEditorReport(name: string): Promise<EditorReport | null> {
  const supabase = await createClient();
  /* The stored rows of one run are tens of kilobytes, so which runs are wanted
     is settled from the cheap columns before any of them are read. */
  const { data: index } = await supabase
    .from("runs")
    .select("id, month, month_label, file_name, created_at")
    .order("created_at", { ascending: false });

  const { kept: keptIndex } = officialRuns((index as RunRow[] | null) || []);
  if (!keptIndex.length) return null;

  type Row = RunRow & {
    source_rows: SourceRow[];
    config_snapshot: Config;
    kudos: Record<string, number> | null;
    leave: Record<string, number> | null;
    away: Record<string, boolean> | null;
  };
  const { data } = await supabase
    .from("runs")
    .select("id, month, month_label, file_name, created_at, source_rows, config_snapshot, kudos, leave, away")
    .in("id", keptIndex.map((r) => r.id));

  const byId = new Map(((data as Row[] | null) || []).map((r) => [r.id, r]));
  const kept = keptIndex
    .map((r) => byId.get(r.id))
    .filter((r): r is Row => !!r);

  const months: EditorMonth[] = [];
  const every = new Set<string>();

  for (const run of kept) {
    const config = run.config_snapshot;
    config.revPen = config.revPen ?? [];
    const me = compute(config, run.source_rows, run.kudos || {}, run.leave || {}, run.away || {}).out.find((r) => r.name === name);
    /* Absent means this editor was not on the team list when the month was
       run, so the month simply is not part of their history. */
    if (!me) continue;

    const cats = catsOf(config, me);
    for (const c of cats) if (c.kind === "edit" && c.rate) every.add(c.cat);

    months.push({
      runId: run.id,
      month: run.month as string,
      label: run.month_label,
      fileName: run.file_name,
      slab: me.slab,
      pattern: me.pattern,
      days: me.days,
      minutes: me.mins,
      untyped: me.untyped,
      notPay: me.notPay,
      points: me.pts,
      target: me.target,
      surplus: me.surplus,
      incentive: me.incentive,
      kudos: me.kudos,
      kudosInr: me.kudosInr,
      status: me.status,
      byCat: me.byCat,
      cats,
      revised: me.revised,
      rounds: me.rounds,
      deducted: me.deducted,
      carried: me.carried,
      carryDed: me.carryDed,
      reviewed: me.reviewed,
      reviewMins: me.reviewMins,
      reviewPts: me.reviewPts,
    });
  }

  if (!months.length) return null;

  /* Newest month first: the question asked of this page is nearly always
     "how is this person doing lately". */
  months.reverse();

  return { name, months, cats: [...every] };
}
