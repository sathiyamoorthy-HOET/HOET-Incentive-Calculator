"use client";

import { useState } from "react";
import { inr, num } from "@/lib/calc";
import { RunSummary } from "@/lib/types";
import { deleteRun, listRuns, loadRun } from "@/app/actions";
import type { ActiveRun } from "./AppShell";

export default function HistoryTab({
  initialRuns,
  onOpen,
}: {
  initialRuns: RunSummary[];
  onOpen: (r: ActiveRun) => void;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(id: number) {
    setBusy(id);
    setError(null);
    const res = await loadRun(id);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onOpen({
      rows: res.rows,
      fileName: (res.monthLabel ? res.monthLabel + " · " : "") + (res.fileName || "Saved run"),
      snapshot: res.config,
      savedId: id,
    });
  }

  async function remove(id: number) {
    if (!confirm("Delete this saved run? The spreadsheet you already downloaded is unaffected.")) return;
    setBusy(id);
    setError(null);
    const res = await deleteRun(id);
    if (!res.ok) {
      setError(res.error);
      setBusy(null);
      return;
    }
    setRuns(await listRuns());
    setBusy(null);
  }

  return (
    <section className="panel on">
      <h2>History</h2>
      <p className="sub">
        Every saved run, with the rate card and team list exactly as they were at the time. Opening
        one reproduces the payout that was signed off, even if the rate card has changed since.
      </p>

      {error && <div className="note bad">{error}</div>}

      <div className="card">
        {runs.length === 0 ? (
          <div className="empty">
            No runs saved yet. Upload a report, check the results, then choose Save this run.
          </div>
        ) : (
          <div className="scroll">
            <table className="hist">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="wrap">Report</th>
                  <th className="r">Points</th>
                  <th className="r">Cleared target</th>
                  <th className="r">Incentive</th>
                  <th>Saved</th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.month_label || <span className="muted">—</span>}</td>
                    <td className="wrap muted">{r.file_name || "—"}</td>
                    <td className="r num">{num(r.total_points)}</td>
                    <td className="r num">
                      {r.editors_cleared} of {r.editors_delivered}
                    </td>
                    <td className="r num">
                      <strong style={{ color: "var(--teal)" }}>{inr(r.total_incentive)}</strong>
                    </td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {new Date(r.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {r.author ? " · " + r.author : ""}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <button className="btn" disabled={busy === r.id} onClick={() => open(r.id)}>
                          {busy === r.id ? <span className="spin" /> : "Open"}
                        </button>
                        <button className="btn o" disabled={busy === r.id} onClick={() => remove(r.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="sub">
        Only the person who saved a run can delete it. Everyone signed in can open any run.
      </p>
    </section>
  );
}
