"use client";

import { useState } from "react";
import Link from "next/link";
import { inr, num, round } from "@/lib/calc";
import { monthName } from "@/lib/months";
import { STATUS } from "@/lib/types";
import { exportEditor } from "@/lib/export";
import type { EditorCat, EditorMonth, EditorReport } from "@/app/actions";

/** The video-type table, the same five columns Results opens under a name. */
function Breakdown({ cats }: { cats: EditorCat[] }) {
  if (!cats.length) {
    return (
      <span style={{ color: "var(--muted)" }}>No work recorded against this editor.</span>
    );
  }
  return (
    <table style={{ width: "auto", minWidth: 460 }}>
      <thead>
        <tr>
          <th>Video type</th>
          <th className="r">Minutes</th>
          <th className="r">Rate</th>
          <th className="r">Deducted</th>
          <th className="r">Points</th>
        </tr>
      </thead>
      <tbody>
        {cats.map((c, i) => (
          <tr key={c.kind + c.cat + i}>
            <td style={c.kind === "untyped" ? { color: "var(--rose)" } : undefined}>
              {c.cat}
              {c.kind === "review" && (
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {" · reviewed for others"}
                </span>
              )}
            </td>
            <td
              className="r num"
              style={c.kind === "untyped" ? { color: "var(--rose)" } : undefined}
            >
              {c.minutes}
            </td>
            <td className="r num">{c.rate ? c.rate : "—"}</td>
            <td className="r num" style={c.deducted ? { color: "var(--rose)" } : undefined}>
              {c.deducted ? "−" + c.deducted : "—"}
            </td>
            <td className="r num">{c.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What a month cost in rework, spelled out only when there was any. */
function Rework({ m }: { m: EditorMonth }) {
  const bits: string[] = [];
  if (m.revised > 0) {
    bits.push(
      m.revised + (m.revised === 1 ? " video revised" : " videos revised") +
        " over " + m.rounds + (m.rounds === 1 ? " round" : " rounds")
    );
  }
  if (m.deducted > 0.05) bits.push(round(m.deducted, 1) + " points deducted");
  if (m.carried > 0) {
    bits.push(
      m.carried +
        (m.carried === 1 ? " video was" : " videos were") +
        " already paid for in an earlier month"
    );
  }
  if (m.reviewed > 0) {
    bits.push(
      m.reviewed + " reviewed for others, worth " + round(m.reviewPts, 1) + " points"
    );
  }
  if (!bits.length) return null;
  return (
    <p className="sub" style={{ margin: "0 0 10px", fontSize: 12.5 }}>
      {bits.join(" · ")}
    </p>
  );
}

export default function EditorTab({ report }: { report: EditorReport }) {
  const { name, months, cats } = report;
  /* The newest month open, since that is the one being asked about. */
  const [open, setOpen] = useState<Set<number>>(new Set([0]));

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const sum = (f: (m: EditorMonth) => number) => months.reduce((a, m) => a + f(m), 0);
  const active = months.filter((m) => m.minutes > 0.05).length;
  const cleared = months.filter((m) => m.surplus > 0).length;
  const latest = months[0];

  /* This editor was only ever in runs whose month could not be read. */
  if (!latest) {
    return (
      <section className="panel on">
        <h2>{name}</h2>
        <div className="note bad">
          This editor appears in saved runs, but none of those runs has a month set, so there is
          nothing to show month by month. Open the run from <Link href="/editors">Editors</Link>,
          type its month in the header box, and save it again.
        </div>
      </section>
    );
  }

  /* Every video type this editor has ever been credited for, totalled across
     all months, so a year reads as one table. Review lines are kept separate
     from editing so a rate is never averaged across the two. */
  const lifetime = new Map<string, EditorCat>();
  for (const m of months) {
    for (const c of m.cats) {
      const key = c.kind + "|" + c.cat;
      const at = lifetime.get(key);
      if (!at) {
        lifetime.set(key, { ...c });
        continue;
      }
      at.minutes = round(at.minutes + c.minutes, 1);
      at.deducted = round(at.deducted + c.deducted, 1);
      at.points += c.points;
      /* Rates change over time; a lifetime row cannot claim a single one. */
      if (at.rate !== c.rate) at.rate = 0;
    }
  }

  return (
    <section className="panel on">
      <h2>{name}</h2>
      <p className="sub">
        Every month this editor appears in a saved run, priced with the rate card that was in force
        at the time. Slab {latest.slab}
        {latest.pattern ? " · " + latest.pattern : ""} as of {monthName(latest.month)}.{" "}
        <Link href="/editors">Back to all editors</Link>
      </p>

      <div className="card">
        <div className="cardhead">
          <h3>
            {cleared} of {active} {active === 1 ? "month" : "months"} above target ·{" "}
            {inr(sum((m) => m.incentive))} earned
          </h3>
          <button
            className="btn g"
            style={{ marginLeft: "auto" }}
            onClick={() => exportEditor(name, months, cats)}
          >
            Export CSV
          </button>
        </div>
        <p className="cardhint sub">
          Open a month for the video types behind its points — the same breakdown Results shows.
        </p>

        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">Minutes</th>
                <th className="r">Points</th>
                <th className="r">Target</th>
                <th className="r">Above target</th>
                <th className="r">Incentive</th>
                <th>Status</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {months.flatMap((m, i) => {
                const st = STATUS[m.status];
                const isOpen = open.has(i);
                const rows = [
                  <tr key={m.runId} className="clk" onClick={() => toggle(i)}>
                    <td>
                      <span className="tw">{isOpen ? "▾" : "▸"}</span> {monthName(m.month)}
                    </td>
                    <td
                      className="r num"
                      title={
                        round(m.untyped, 1) +
                        " min with no type · " +
                        round(m.notPay, 1) +
                        " min not payable"
                      }
                    >
                      {round(m.minutes, 1)}
                    </td>
                    <td className="r num">{round(m.points, 1)}</td>
                    <td className="r num muted">{Math.round(m.target)}</td>
                    <td className="r num">
                      <span style={{ color: m.surplus > 0 ? "var(--emerald)" : "var(--muted)" }}>
                        {(m.surplus > 0 ? "+" : "") + round(m.surplus, 1)}
                      </span>
                    </td>
                    <td className="r num">
                      {m.incentive > 0 ? (
                        <strong style={{ color: "var(--emerald)" }}>{inr(m.incentive)}</strong>
                      ) : (
                        <span className="muted-2">—</span>
                      )}
                    </td>
                    <td>
                      <span className={"pill " + st[0]}>{st[1]}</span>
                    </td>
                    <td>
                      <Link
                        className="btn o"
                        href={"/history/" + m.runId}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Run
                      </Link>
                    </td>
                  </tr>,
                ];

                if (isOpen) {
                  rows.push(
                    <tr key={m.runId + "-det"} className="det on">
                      <td colSpan={8}>
                        <div className="detbox">
                          <Rework m={m} />
                          <Breakdown cats={m.cats} />
                        </div>
                      </td>
                    </tr>
                  );
                }
                return rows;
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="r num">{round(sum((m) => m.minutes), 1)}</td>
                <td className="r num">{round(sum((m) => m.points), 1)}</td>
                <td className="r num">{num(sum((m) => m.target))}</td>
                <td className="r num">{round(sum((m) => m.surplus), 1)}</td>
                <td className="r num">{inr(sum((m) => m.incentive))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {lifetime.size > 0 && (
        <div className="card">
          <h3>Across every month</h3>
          <p className="cardhint sub">
            The same video types added up over {months.length}{" "}
            {months.length === 1 ? "month" : "months"}. A rate reads as a dash where it changed
            between months.
          </p>
          <div className="scroll">
            <Breakdown cats={[...lifetime.values()]} />
          </div>
        </div>
      )}
    </section>
  );
}
