import * as XLSX from "xlsx";
import { daysOf, round, targetOf, totals } from "./calc";
import { Config, EditorResult, EXP, STATUS } from "./types";

export function exportRun(monthLabel: string, out: EditorResult[], c: Config) {
  const mo = monthLabel || "Month";
  const aoa: (string | number)[][] = [
    [
      "Editor", "Slab", "Experience", "Work pattern", "Days available",
      "Minutes delivered", "Minutes with no type", "Minutes not payable",
      "Points earned", "Target points", "Points above target",
      "Incentive (INR)", "Status",
    ],
  ];
  out.forEach((r) =>
    aoa.push([
      r.name, r.slab, r.exp, r.pattern, r.days, r.mins, r.untyped, r.notPay,
      round(r.pts, 1), r.target, r.surplus, r.incentive, STATUS[r.status][1],
    ])
  );

  const t = totals(out);
  aoa.push([]);
  aoa.push([
    "TOTAL", "", "", "", "", round(t.m, 1), "", "",
    round(t.p, 1), Math.round(t.t), round(t.s, 1), Math.round(t.i), "",
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 26 }, { wch: 6 }, { wch: 11 }, { wch: 15 }, { wch: 8 }, { wch: 10 },
    { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 13 }, { wch: 17 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Incentive");

  const rc: (string | number)[][] = [["Video type", "A", "B", "C", "D"]];
  c.rates.forEach((r) => rc.push([r.cat, r.r[0], r.r[1], r.r[2], r.r[3]]));
  rc.push([]);
  rc.push(["Points per working day", c.ppd]);
  rc.push(["Incentive per point above target", c.rate]);
  c.patterns.forEach((p) => rc.push([p.name + " target", p.target, "standard days", p.days]));

  const ws2 = XLSX.utils.aoa_to_sheet(rc);
  ws2["!cols"] = [{ wch: 34 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Rate card");

  XLSX.writeFile(wb, "HOET_Incentive_" + mo.replace(/[^\w]+/g, "_") + ".xlsx");
}

export function exportTeam(c: Config) {
  const aoa: (string | number)[][] = [
    ["Editor", "Slab", "Experience", "Work pattern", "Days available", "Target points"],
  ];
  c.team.forEach((e) =>
    aoa.push([e.name, e.slab, EXP[e.slab], e.pattern, daysOf(c, e), targetOf(c, e)])
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Team");
  XLSX.writeFile(wb, "HOET_Incentive_team_list.xlsx");
}
