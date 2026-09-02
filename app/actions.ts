"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { compute, totals } from "@/lib/calc";
import type { Config, RunSummary, SourceRow } from "@/lib/types";

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
    const c = compute(input.config, input.rows);
    const t = totals(c.out);
    const active = c.out.filter((r) => r.mins > 0.05).length;
    const cleared = c.out.filter((r) => r.surplus > 0).length;

    const { data: run, error } = await supabase
      .from("runs")
      .insert({
        month_label: input.monthLabel || "",
        file_name: input.fileName,
        source_rows: input.rows,
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

    const rows = c.out.map((r) => ({
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

    const { error: rowsError } = await supabase.from("run_results").insert(rows);
    if (rowsError) {
      await supabase.from("runs").delete().eq("id", run.id);
      return { ok: false, error: rowsError.message };
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
