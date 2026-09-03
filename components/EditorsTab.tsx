"use client";

import { useState } from "react";
import Link from "next/link";
import { inr, num, round } from "@/lib/calc";
import { monthShort } from "@/lib/months";
import { STATUS } from "@/lib/types";
import type { Accountability, GridCell } from "@/app/actions";

type Mode = "incentive" | "surplus" | "status";

const MODES: [Mode, string][] = [
  ["incentive", "Incentive"],
  ["surplus", "Above target"],
  ["status", "Cleared / missed"],
];

/** What a cell says about a month, spelled out for its tooltip. */
function detail(c: GridCell): string {
  return [
    round(c.minutes, 1) + " min delivered",
    round(c.points, 1) + " points against a target of " + Math.round(c.target),
    (c.surplus > 0 ? "+" : "") + round(c.surplus, 1) + " points above target",
    inr(c.incentive),
    STATUS[c.status][1],
  ].join(" · ");
}

function Cell({ cell, mode }: { cell: GridCell | undefined; mode: Mode }) {
  if (!cell) return <td className="cell"><span className="muted-2">·</span></td>;

  const st = STATUS[cell.status];
  return (
    <td className="cell" title={detail(cell)}>
      {mode === "incentive" &&
        (cell.incentive > 0 ? (
          <strong style={{ color: "var(--emerald)" }}>{inr(cell.incentive)}</strong>
        ) : (
          <span className="muted-2">—</span>
        ))}
      {mode === "surplus" &&
        (cell.minutes > 0.05 ? (
          <span style={{ color: cell.surplus > 0 ? "var(--emerald)" : "var(--muted)" }}>
            {(cell.surplus > 0 ? "+" : "") + round(cell.surplus, 1)}
          </span>
        ) : (
          <span className="muted-2">—</span>
        ))}
      {mode === "status" && <span className={"dot " + st[0]} aria-label={st[1]} />}
    </td>
  );
}

export default function EditorsTab({ data }: { data: Accountability }) {
  const [mode, setMode] = useState<Mode>("incentive");
  const { months, editors, undated, superseded } = data;

  return (
    <section className="panel on">
      <h2>Editors</h2>
      <p className="sub">
        Every saved run, read the other way round: one row per editor, one column per month. Use it
        to see who clears target every month and who never does. Open a name for that editor&apos;s
        own report.
      </p>

      {undated.length > 0 && (
        <div className="note bad">
          <strong>
            {undated.length} saved {undated.length === 1 ? "run has" : "runs have"} no month
          </strong>{" "}
          and so appear in no column below. Open{" "}
          {undated.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link href={"/history/" + r.id}>{r.fileName || "run " + r.id}</Link>
            </span>
          ))}
          , type the month in the header box, and save it again.
        </div>
      )}

      {months.length === 0 ? (
        <div className="card">
          <div className="empty">
            No dated runs yet. Save a run with its month filled in and it becomes a column here.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="cardhead">
            <h3>
              {months.length} {months.length === 1 ? "month" : "months"} · {editors.length} editors
            </h3>
            <div className="cardmeta">
              <div className="seg">
                {MODES.map(([m, label]) => (
                  <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Editor</th>
                  <th>Slab</th>
                  {months.map((m) => (
                    <th key={m.key} className="r">
                      <Link href={"/history/" + m.runId} title={m.label || m.fileName || ""}>
                        {monthShort(m.key)}
                      </Link>
                    </th>
                  ))}
                  <th className="r">Cleared</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {editors.map((e) => (
                  <tr key={e.name}>
                    <td>
                      <Link href={"/editors/" + encodeURIComponent(e.name)}>{e.name}</Link>
                    </td>
                    <td className="muted">{e.slab}</td>
                    {months.map((m) => (
                      <Cell key={m.key} cell={e.cells[m.key]} mode={mode} />
                    ))}
                    <td
                      className="cell muted"
                      title={
                        e.cleared +
                        " of the " +
                        e.active +
                        " months this editor delivered work in finished above target"
                      }
                    >
                      {e.active === 0 ? (
                        <span className="muted-2">—</span>
                      ) : (
                        <span
                          style={{
                            color:
                              e.cleared === 0
                                ? "var(--rose)"
                                : e.cleared === e.active
                                  ? "var(--emerald)"
                                  : undefined,
                          }}
                        >
                          {e.cleared} of {e.active}
                        </span>
                      )}
                    </td>
                    <td className="cell">
                      {e.incentive > 0 ? (
                        <strong>{inr(e.incentive)}</strong>
                      ) : (
                        <span className="muted-2">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>All editors</td>
                  <td />
                  {months.map((m) => {
                    const cells = editors.map((e) => e.cells[m.key]).filter(Boolean) as GridCell[];
                    const active = cells.filter((c) => c.minutes > 0.05).length;
                    const cleared = cells.filter((c) => c.surplus > 0).length;
                    const money = cells.reduce((a, c) => a + c.incentive, 0);
                    return (
                      <td key={m.key} className="cell">
                        {mode === "status" ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            {cleared}/{active}
                          </span>
                        ) : mode === "surplus" ? (
                          num(cells.reduce((a, c) => a + Math.max(0, c.surplus), 0))
                        ) : (
                          inr(money)
                        )}
                      </td>
                    );
                  })}
                  <td className="cell muted">
                    {editors.reduce((a, e) => a + e.cleared, 0)} of{" "}
                    {editors.reduce((a, e) => a + e.active, 0)}
                  </td>
                  <td className="cell">
                    {inr(editors.reduce((a, e) => a + e.incentive, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="sub">
        A month that was run more than once is counted once, from its newest run
        {superseded > 0 ? " — " + superseded + " older " + (superseded === 1 ? "run is" : "runs are") + " held back" : ""}
        . A dot means the month was run: green cleared target, amber fell short, red means work
        that could not be priced. An empty cell means that editor was not on the team list when
        the month was run.
      </p>
    </section>
  );
}
