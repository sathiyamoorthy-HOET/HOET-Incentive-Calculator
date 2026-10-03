"use client";

import Link from "next/link";
import { pipShareOf, round, underPipLine } from "@/lib/calc";
import { monthName } from "@/lib/months";
import type { Accountability, GridCell } from "@/app/actions";
import { useApp } from "./AppShell";

/**
 * Who fell under the PIP line, month by month. Judged from the stored points
 * against the line on today's rate card, not from the status saved with the
 * run, so moving the line on the rate card moves this list with it.
 */
export default function PipTab({ data }: { data: Accountability }) {
  const { config } = useApp();
  const pct = Math.round(pipShareOf(config) * 100);
  const { months, editors } = data;

  const flagged = months
    .map((m) => ({
      month: m,
      rows: editors
        .map((e) => ({ e, c: e.cells[m.key] as GridCell | undefined }))
        .filter(({ c }) => c && c.status !== "none" && c.status !== "blocked" && underPipLine(config, c.points, c.kudos, c.target))
        .map(({ e, c }) => ({ e, c: c as GridCell }))
        .sort((a, b) => a.c.points / a.c.target - b.c.points / b.c.target),
    }))
    .filter((m) => m.rows.length > 0);
  const total = flagged.reduce((a, m) => a + m.rows.length, 0);

  return (
    <section className="panel on">
      <h2>PIP</h2>
      <p className="sub">
        Editors who scored under {pct}% of their target in a saved month, kudos points included.
        The line is set on the <Link href="/rate-card">Rate card</Link>; the rule for a PIP after{" "}
        {config.pipMonths ?? 3} months below target is written there too.
      </p>

      {!months.length ? (
        <div className="empty">No saved runs yet. Save a month from Run a month and it shows here.</div>
      ) : !total ? (
        <div className="note ok">
          <strong>Nobody is under the {pct}% line</strong> in any of the {months.length} saved{" "}
          {months.length === 1 ? "month" : "months"}.
        </div>
      ) : (
        flagged.map(({ month, rows }) => (
          <div className="card" key={month.key}>
            <div className="cardhead">
              <h3>
                {monthName(month.key)} · {rows.length} {rows.length === 1 ? "editor" : "editors"}
              </h3>
              <Link className="btn o" style={{ marginLeft: "auto" }} href={"/history/" + month.runId}>
                Open run
              </Link>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Editor</th>
                    <th>Slab</th>
                    <th className="r">Minutes</th>
                    <th className="r">Points</th>
                    <th className="r">Kudos</th>
                    <th className="r">Target</th>
                    <th className="r">Of target</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ e, c }) => (
                    <tr key={e.name}>
                      <td>{e.name}</td>
                      <td>{e.slab}</td>
                      <td className="r num">{round(c.minutes, 1)}</td>
                      <td className="r num">{round(c.points, 1)}</td>
                      <td className="r num">{c.kudos > 0 ? round(c.kudos, 1) : "—"}</td>
                      <td className="r num">{Math.round(c.target)}</td>
                      <td className="r num" style={{ color: "var(--rose)" }}>
                        {Math.round(((c.points + c.kudos) / c.target) * 100)}%
                      </td>
                      <td>
                        <Link className="btn o" href={"/editors/" + encodeURIComponent(e.name)}>
                          History
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
