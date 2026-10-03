"use client";

import { useState } from "react";
import Link from "next/link";
import { pipShareOf, round, underPipLine } from "@/lib/calc";
import { monthName, monthShort } from "@/lib/months";
import type { Accountability, GridCell, GridEditor } from "@/app/actions";
import { useApp } from "./AppShell";

/**
 * Who fell under the PIP line, one month at a time. Judged from the stored
 * points against the line on today's rate card, not from the status saved
 * with the run, so moving the line on the rate card moves this list with it.
 */
export default function PipTab({ data }: { data: Accountability }) {
  const { config } = useApp();
  const pct = Math.round(pipShareOf(config) * 100);
  const { months } = data;
  /* Managers are marked as reviewers on the Team page: they review rather
     than edit, so a target is not theirs to miss. */
  const reviewers = new Set(config.team.filter((t) => t.reviewer).map((t) => t.name));
  const editors = data.editors.filter((e) => !reviewers.has(e.name));
  /* Newest month first, and open by default: that is the one being asked about. */
  const order = months.slice().reverse();
  const [key, setKey] = useState(order[0]?.key ?? "");
  const month = order.find((m) => m.key === key) ?? order[0];

  const rowsOf = (k: string) =>
    editors
      .map((e) => ({ e, c: e.cells[k] as GridCell | undefined }))
      .filter(({ c }) => c && c.status !== "none" && c.status !== "blocked" && underPipLine(config, c.points, c.kudos, c.target))
      .map(({ e, c }) => ({ e, c: c as GridCell }))
      .sort((a, b) => (a.c.points + a.c.kudos) / a.c.target - (b.c.points + b.c.kudos) / b.c.target);
  const rows = month ? rowsOf(month.key) : [];
  /* The five with the least to show for the month, whether or not they are
     under the line, so the panel is never empty on a good month. */
  const share = (c: GridCell) => (c.points + c.kudos) / c.target;
  const support = month
    ? editors
        .map((e) => ({ e, c: e.cells[month.key] as GridCell | undefined }))
        .filter(({ c }) => c && c.target > 0 && c.status !== "none" && c.status !== "blocked")
        .map(({ e, c }) => ({ e, c: c as GridCell }))
        .sort((a, b) => share(a.c) - share(b.c))
        .slice(0, 5)
    : [];

  return (
    <section className="panel on">
      <h2>PIP</h2>
      <p className="sub">
        Editors who scored under {pct}% of their target in a saved month, kudos points included.
        The line is set on the <Link href="/rate-card">Rate card</Link>; the rule for a PIP after{" "}
        {config.pipMonths ?? 3} months below target is written there too. Anyone ticked as a
        reviewer on <Link href="/team">Team</Link> is left out, since managers review rather than edit.
      </p>

      {!month ? (
        <div className="empty">No saved runs yet. Save a month from Run a month and it shows here.</div>
      ) : (
      <div className="split">
        <div className="card">
          <div className="cardhead">
            <div className="seg">
              {order.map((m) => {
                const n = rowsOf(m.key).length;
                return (
                  <button key={m.key} aria-pressed={m.key === month.key} onClick={() => setKey(m.key)}>
                    {monthShort(m.key)}
                    {n > 0 ? " · " + n : ""}
                  </button>
                );
              })}
            </div>
            <Link className="btn o" style={{ marginLeft: "auto" }} href={"/history/" + month.runId}>
              Open run
            </Link>
          </div>
          <h3 style={{ marginTop: 12 }}>
            {monthName(month.key)} · {rows.length} {rows.length === 1 ? "editor" : "editors"} under the {pct}% line
          </h3>

          {!rows.length ? (
            <div className="note ok">
              <strong>Nobody is under the {pct}% line</strong> in {monthName(month.key)}.
            </div>
          ) : (
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
          )}
        </div>

        <aside className="stack">
          <div className="card">
            <h3>Five who could use the most support</h3>
            <p className="cardhint sub">
              The five furthest from target in {monthName(month.key)}, kudos included, with every
              saved month beside them so a hard month can be told from a pattern. A PIP is due
              after {config.pipMonths ?? 3} months below target in a row.
            </p>
            {!support.length ? (
              <div className="empty">Nobody delivered work in {monthName(month.key)}.</div>
            ) : (
              support.map(({ e }) => <Trend key={e.name} e={e} months={months.map((m) => m.key)} pct={pct} due={config.pipMonths ?? 3} />)
            )}
          </div>
        </aside>
      </div>
      )}
    </section>
  );
}

/** One editor's months, oldest to newest, each as a bar against its target. */
function Trend({ e, months, pct, due }: { e: GridEditor; months: string[]; pct: number; due: number }) {
  const cells = months.map((k) => ({ k, c: e.cells[k] })).filter((x) => x.c && x.c.target > 0);
  /* Months below target counting back from the newest, until one that cleared. */
  let streak = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].c.surplus > 0) break;
    streak++;
  }
  const share = (c: GridCell) => (c.points + c.kudos) / c.target;
  const latest = cells[cells.length - 1];
  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <Link href={"/editors/" + encodeURIComponent(e.name)}><strong>{e.name}</strong></Link>
        <span className="muted" style={{ fontSize: 12 }}>{e.slab}</span>
        <span className={"pill " + (due > 0 && streak >= due ? "r" : streak > 1 ? "a" : "n")} style={{ marginLeft: "auto" }}>
          {streak === 0 && latest
            ? "On target"
            : `${streak} ${streak === 1 ? "month" : "months"} below target${due > 0 && streak >= due ? " · PIP due" : ""}`}
        </span>
      </div>
      <table style={{ width: "100%" }}>
        <tbody>
          {cells.map(({ k, c }) => {
            const s = share(c);
            const low = s < pct / 100;
            return (
              <tr key={k}>
                <td className="muted" style={{ width: 70, fontSize: 12, padding: "2px 0" }}>{monthShort(k)}</td>
                <td style={{ padding: "2px 6px" }}>
                  <div className="bar">
                    <i className={c.surplus > 0 ? "" : "under"} style={{ width: Math.min(100, Math.round(s * 100)) + "%", ...(low ? { background: "var(--rose)" } : {}) }} />
                  </div>
                </td>
                <td className="r num" style={{ width: 46, fontSize: 12, padding: "2px 0", color: low ? "var(--rose)" : undefined }}>
                  {Math.round(s * 100)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
