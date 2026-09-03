"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  compute,
  deliverableKey,
  ledgerAfter,
  matchEditor,
  rateFor,
  reviewRateFor,
  round,
  settleRows,
  totals,
} from "@/lib/calc";
import { officialRuns, parseMonth } from "@/lib/months";
import { NOTPAY } from "@/lib/types";
import type { Config, Ledger, RunStatus, RunSummary, SourceRow } from "@/lib/types";

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
  rows: SourceRow[]
): Promise<{ ok: true; rows: SourceRow[] } | { ok: false; error: string }> {
  try {
    const { supabase } = await requireUser();
    const { ledger } = await readLedger(supabase);
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
};

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
          "This run has no month. Type it in the Month box at the top (\u201cAugust 2026\u201d) and save again \u2014 without it, a video re-uploaded next month cannot be recognised as one already paid for.",
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

    const c = compute(input.config, rows);
    const t = totals(c.out);
    const active = c.out.filter((r) => r.mins > 0.05).length;
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
        total_minutes: Math.round(t.m * 10) / 10,
        total_points: Math.round(t.p * 10) / 10,
        total_target: Math.round(t.t),
        total_surplus: Math.round(t.s * 10) / 10,
        total_incentive: Math.round(t.i),
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
      const key = deliverableKey(r);
      if (!key || meta.has(key)) continue;
      const m = matchEditor(input.config, r.raw);
      meta.set(key, { code: r.code as string, no: r.did as string, editor: m.e?.name || r.raw });
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
    const { error } = await supabase.from("runs").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete the run." };
  }
}

export async function loadRun(id: number): Promise<
  | { ok: true; monthLabel: string; fileName: string | null; rows: SourceRow[]; config: Config }
  | { ok: false; error: string }
> {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("runs")
      .select("month_label, file_name, source_rows, config_snapshot")
      .eq("id", id)
      .single();
    if (error || !data) return { ok: false, error: error?.message || "That run no longer exists." };
    return {
      ok: true,
      monthLabel: data.month_label,
      fileName: data.file_name,
      rows: data.source_rows as SourceRow[],
      config: data.config_snapshot as Config,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not open the run." };
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
  status: RunStatus;
};

export async function listAccountability(): Promise<Accountability> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("runs")
    .select(
      "id, month, month_label, file_name, created_at, run_results (editor_name, slab, minutes, points, target_points, surplus_points, incentive_inr, status)"
    )
    .order("created_at", { ascending: false });

  const runs = (data as (RunRow & { run_results: ResultRow[] })[] | null) || [];
  const { kept, superseded, undated } = officialRuns(runs);

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
        target: Number(row.target_points),
        surplus: Number(row.surplus_points),
        incentive: Number(row.incentive_inr),
        status: row.status,
      };
      if (Number(row.minutes) > 0.05) e.active += 1;
      if (Number(row.surplus_points) > 0) e.cleared += 1;
      e.incentive += Number(row.incentive_inr);
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

/** One line of an editor's video-type breakdown, as the Results page shows it. */
export type EditorCat = {
  cat: string;
  minutes: number;
  /** Points per minute. Zero where nothing is payable, shown as a dash. */
  rate: number;
  deducted: number;
  points: number;
  /** "review" lines are videos this person reviewed for somebody else. */
  kind: "edit" | "review" | "untyped";
};

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
  incentive: number;
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
  const { data } = await supabase
    .from("runs")
    .select("id, month, month_label, file_name, created_at, source_rows, config_snapshot")
    .order("created_at", { ascending: false });

  type Row = RunRow & { source_rows: SourceRow[]; config_snapshot: Config };
  const runs = (data as Row[] | null) || [];
  const { kept } = officialRuns(runs);

  const months: EditorMonth[] = [];
  const every = new Set<string>();

  for (const run of kept) {
    const config = run.config_snapshot;
    config.revPen = config.revPen ?? [];
    const me = compute(config, run.source_rows).out.find((r) => r.name === name);
    /* Absent means this editor was not on the team list when the month was
       run, so the month simply is not part of their history. */
    if (!me) continue;

    const cats: EditorCat[] = [];
    for (const cat of Object.keys(me.byCat)) {
      const minutes = round(me.byCat[cat], 1);
      const rate = cat === NOTPAY ? 0 : rateFor(config, cat, me.slab);
      const deducted = round(me.dedByCat[cat] || 0, 1);
      cats.push({
        cat,
        minutes,
        rate,
        deducted,
        points: rate ? Math.round(minutes * rate - deducted) : 0,
        kind: "edit",
      });
      if (rate) every.add(cat);
    }
    for (const cat of Object.keys(me.revByCat)) {
      const minutes = round(me.revByCat[cat], 1);
      const rate = reviewRateFor(config, cat);
      cats.push({
        cat,
        minutes,
        rate,
        deducted: 0,
        points: Math.round(minutes * rate),
        kind: "review",
      });
    }
    if (me.untyped > 0.05) {
      cats.push({
        cat: "No video type recorded",
        minutes: me.untyped,
        rate: 0,
        deducted: 0,
        points: 0,
        kind: "untyped",
      });
    }

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
