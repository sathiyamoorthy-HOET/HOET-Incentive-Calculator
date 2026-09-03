import * as XLSX from "xlsx";
import { daysOf, payBandsOf, round, targetOf, totals } from "./calc";
import { Config, EditorResult, EXP, STATUS } from "./types";
import { monthName } from "./months";
import type { EditorMonth } from "@/app/actions";

export function exportRun(monthLabel: string, out: EditorResult[], c: Config) {
  const mo = monthLabel || "Month";
  const aoa: (string | number)[][] = [
    [
      "Editor", "Slab", "Experience", "Work pattern", "Days available",
      "Minutes delivered", "Minutes with no type", "Minutes not payable",
      "Videos revised", "Revision rounds", "Points off for revisions",
      "Paid in an earlier month", "Points off for those revisions",
      "Videos reviewed", "Minutes reviewed", "Review points",
      "Points earned", "Target points", "Points above target",
      "Incentive (INR)", "Status",
    ],
  ];
  out.forEach((r) =>
    aoa.push([
      r.name, r.slab, r.exp, r.pattern, r.days, r.mins, r.untyped, r.notPay,
      r.revised, r.rounds, round(r.deducted, 1),
      r.carried, round(r.carryDed, 1),
      r.reviewed, r.reviewMins, round(r.reviewPts, 1),
      round(r.pts, 1), r.target, r.surplus, r.incentive, STATUS[r.status][1],
    ])
  );

  const t = totals(out);
  aoa.push([]);
  aoa.push([
    "TOTAL", "", "", "", "", round(t.m, 1), "", "",
    out.reduce((a, r) => a + r.revised, 0), out.reduce((a, r) => a + r.rounds, 0), round(t.d, 1),
    out.reduce((a, r) => a + r.carried, 0), round(out.reduce((a, r) => a + r.carryDed, 0), 1),
    out.reduce((a, r) => a + r.reviewed, 0), round(t.rm, 1), round(t.rp, 1),
    round(t.p, 1), Math.round(t.t), round(t.s, 1), Math.round(t.i), "",
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 26 }, { wch: 6 }, { wch: 11 }, { wch: 15 }, { wch: 8 }, { wch: 10 },
    { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 9 }, { wch: 12 },
    { wch: 13 }, { wch: 14 },
    { wch: 9 }, { wch: 10 }, { wch: 9 },
    { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 13 }, { wch: 17 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Incentive");

  const rc: (string | number)[][] = [["Video type", "A", "B", "C", "D", "Review / min"]];
  c.rates.forEach((r) => rc.push([r.cat, r.r[0], r.r[1], r.r[2], r.r[3], r.review ?? 0]));
  rc.push([]);
  rc.push(["Points per working day", c.ppd]);
  c.patterns.forEach((p) => rc.push([p.name + " target", p.target, "standard days", p.days]));

  /* The ladder, rung by rung. Each rung pays only for the points inside it,
     so the sheet says which points those are for every work pattern. */
  const bands = payBandsOf(c);
  rc.push([]);
  rc.push(["Points above target", "₹ per point", ...c.patterns.map((p) => p.name)]);
  bands.forEach((b, i) => {
    const to = i + 1 < bands.length ? bands[i + 1].from : null;
    rc.push([
      to === null ? "+" + b.from + " and above" : "+" + b.from + " to +" + to,
      b.rate,
      ...c.patterns.map((p) =>
        to === null
          ? Math.round(p.target + b.from) + "+"
          : Math.round(p.target + b.from) + "-" + Math.round(p.target + to)
      ),
    ]);
  });
  if (c.pipMonths > 0) {
    rc.push([]);
    rc.push([
      "Performance improvement plan",
      c.pipMonths + " months below target in a row",
    ]);
  }
  const ladder = c.revPen || [];
  if (ladder.length) {
    rc.push([]);
    rc.push(["Revision deductions", "% off that video's points"]);
    ladder.forEach((pct, i) =>
      rc.push([
        i + 1 + " revision" + (i ? "s" : "") + " (version " + (i + 2) + ")",
        pct + "%",
        i === ladder.length - 1 ? "and any more rounds" : "",
      ])
    );
  }

  const ws2 = XLSX.utils.aoa_to_sheet(rc);
  ws2["!cols"] = [{ wch: 34 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Rate card");

  XLSX.writeFile(wb, "HOET_Incentive_" + mo.replace(/[^\w]+/g, "_") + ".xlsx");
}

export function exportTeam(c: Config) {
  const aoa: (string | number)[][] = [
    ["Editor", "Slab", "Experience", "Work pattern", "Days available", "Target points", "Reviews"],
  ];
  c.team.forEach((e) =>
    aoa.push([
      e.name, e.slab, EXP[e.slab], e.pattern, daysOf(c, e), targetOf(c, e),
      e.reviewer ? "yes" : "",
    ])
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Team");
  XLSX.writeFile(wb, "HOET_Incentive_team_list.xlsx");
}

/**
 * One editor's own history, month by month. A flat CSV rather than the
 * workbook the monthly run exports, because this is the sheet that gets
 * pasted into a review or a payout query.
 */
export function exportEditor(name: string, months: EditorMonth[], cats: string[]) {
  const aoa: (string | number)[][] = [
    [
      "Month", "Slab", "Work pattern", "Days available",
      "Minutes delivered", "Minutes with no type", "Minutes not payable",
      "Points earned", "Target points", "Points above target",
      "Incentive (INR)", "Status",
      "Videos revised", "Revision rounds", "Points off for revisions",
      "Paid in an earlier month", "Videos reviewed", "Review points",
      ...cats.map((c) => c + " (min)"),
    ],
  ];

  months.forEach((m) =>
    aoa.push([
      monthName(m.month), m.slab, m.pattern || "", m.days ?? "",
      round(m.minutes, 1), round(m.untyped, 1), round(m.notPay, 1),
      round(m.points, 1), Math.round(m.target), round(m.surplus, 1),
      Math.round(m.incentive), STATUS[m.status][1],
      m.revised, m.rounds, round(m.deducted, 1),
      m.carried, m.reviewed, round(m.reviewPts, 1),
      ...cats.map((c) => round(m.byCat[c] || 0, 1)),
    ])
  );

  const sum = (f: (m: EditorMonth) => number) => months.reduce((a, m) => a + f(m), 0);
  aoa.push([]);
  aoa.push([
    "TOTAL", "", "", "",
    round(sum((m) => m.minutes), 1), round(sum((m) => m.untyped), 1), round(sum((m) => m.notPay), 1),
    round(sum((m) => m.points), 1), Math.round(sum((m) => m.target)), round(sum((m) => m.surplus), 1),
    Math.round(sum((m) => m.incentive)), "",
    sum((m) => m.revised), sum((m) => m.rounds), round(sum((m) => m.deducted), 1),
    sum((m) => m.carried), sum((m) => m.reviewed), round(sum((m) => m.reviewPts), 1),
    ...cats.map((c) => round(sum((m) => m.byCat[c] || 0), 1)),
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "History");
  XLSX.writeFile(wb, "HOET_" + name.replace(/[^\w]+/g, "_") + "_history.csv");
}
