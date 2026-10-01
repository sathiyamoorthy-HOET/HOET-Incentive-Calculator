import type ExcelJS from "exceljs";
import { compute, payBandsOf, round } from "./calc";
import { Computed, Config, DATE_BASES, EXP, NOTPAY, Period, PricedLine, SourceRow } from "./types";

/**
 * The detailed report: a Parent sheet of every editor, one tracker sheet per
 * editor listing each video with a link back to its project in Orbitova, the
 * rows that were held for want of a date, the notes, and the rate card.
 *
 * Every figure that can be a formula is one, with the app's own number cached
 * beside it, so the file opens with the right values anywhere and still
 * recalculates when a kudos point is typed in: the tracker total, the Parent
 * row, points above target and the incentive all follow.
 *
 * ExcelJS rather than SheetJS because the file is read by people, and the
 * yellow cells are what tells them where to type. Loaded only when the
 * button is pressed.
 */

type Input = {
  monthLabel: string;
  fileName: string;
  period: Period | null | undefined;
  held: SourceRow[];
  result: Computed;
  config: Config;
};

const NAVY = "FF1F3A5F";
const TOTAL = "FFE8EEF5";
const YELLOW = "FFFFFF00";
const HELD = "FFFFF2CC";
const HELD_INK = "FF9C5700";
const LINK_INK = "FF0563C1";

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const col = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const dateOf = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const crit = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** A sheet name Excel accepts: 31 characters, none of []:*?/\, and unique. */
function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Editor";
  let n = base;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = base.slice(0, 31 - String(i).length - 1) + " " + i;
  taken.add(n.toLowerCase());
  return n;
}

/** What the tracker calls the line's category: the payable one, or why not. */
function catLabel(l: PricedLine): string {
  const raw = l.row.type && String(l.row.type).trim();
  switch (l.kind) {
    case "edit":
    case "project":
      return l.cat || "";
    case "review":
      return (l.cat || "") + " · reviewed for others";
    case "carried":
      return (l.cat || raw || "") + " · paid in an earlier month";
    case "skipped":
      return (l.cat || raw || "") + " · already paid";
    default:
      return l.cat === NOTPAY ? NOTPAY : raw ? raw + " · not on the rate card" : "No video type recorded";
  }
}

/** Lines in the order a tracker reads: by date, then project, then number. */
const byDate = (a: PricedLine, b: PricedLine) =>
  (a.row.assigned || "").localeCompare(b.row.assigned || "") ||
  (a.row.code || "").localeCompare(b.row.code || "") ||
  (a.row.did || "").localeCompare(b.row.did || "", undefined, { numeric: true });

const TCOLS = [
  "Video Name", "Assigned By", "Type of Video/Work", "Approved Video Link", "Assigned Date",
  "Completion Date", "Duration (min)", "Revisions", "Deduction %", "Points", "Kudos Points", "Total Points",
];
const TWIDTHS = [44, 22, 34, 18, 13, 14, 13, 10, 11, 10, 12, 12];

export async function buildTracker(input: Input): Promise<ExcelJS.Workbook> {
  const mod = await import("exceljs");
  const X = (("default" in mod ? mod.default : mod) as typeof ExcelJS);
  const { config: c, result, monthLabel, period } = input;
  const month = monthLabel || "this month";
  const basisLabel = period ? DATE_BASES[period.basis] : "Assigned";

  const wb = new X.Workbook();
  wb.creator = "HOET Incentive calculator";
  wb.created = new Date();

  const parent = wb.addWorksheet("Parent");

  /* ---------------------------------------------------------- rate card
     Written first in code so the trackers can point their formulas at it;
     moved to the back of the workbook once everything else exists. */
  const rc = wb.addWorksheet("Rate Card");
  const nCat = c.rates.length;
  rc.addRow(["Category", "A", "B", "C", "D", "Unit", "Review rate"]);
  c.rates.forEach((r) =>
    rc.addRow([r.cat, r.r[0], r.r[1], r.r[2], r.r[3], r.unit === "project" ? "project" : "minute", r.review ?? 0])
  );
  const ladder = (c.revPen || []).length ? c.revPen : [0];
  const ladderRow = nCat + 3;
  rc.getCell(ladderRow, 1).value = "Revision deduction, by rounds";
  ladder.forEach((pct, i) => {
    const cell = rc.getCell(ladderRow, i + 2);
    cell.value = pct / 100;
    cell.numFmt = "0%";
  });
  rc.getCell(ladderRow + 1, 1).value = "1 round costs the first rung, 2 the second … more rounds than rungs cost the last.";
  rc.getCell(ladderRow + 1, 1).font = { italic: true, color: { argb: "FF7F7F7F" } };
  const bands = payBandsOf(c);
  const bandRow = ladderRow + 3;
  rc.getCell(bandRow, 1).value = "Points above target";
  rc.getCell(bandRow, 2).value = "₹ per point";
  bands.forEach((b, i) => {
    const to = i + 1 < bands.length ? bands[i + 1].from : null;
    rc.getCell(bandRow + 1 + i, 1).value = to === null ? "+" + b.from + " and above" : "+" + b.from + " to +" + to;
    rc.getCell(bandRow + 1 + i, 2).value = b.rate;
  });
  /* What a kudos point pays: the rate card's figure, and yellow because it
     is the one number on this sheet meant to be changed by hand. */
  const kudosRow = bandRow + bands.length + 1;
  rc.getCell(kudosRow, 1).value = "Kudos, ₹ per point";
  rc.getCell(kudosRow, 1).font = { bold: true };
  rc.getCell(kudosRow, 2).value = c.kudosRate ?? bands[0]?.rate ?? 0;
  rc.getCell(kudosRow, 2).fill = fill(YELLOW);
  const patRow = kudosRow + 2;
  rc.getCell(patRow, 1).value = "Work pattern";
  rc.getCell(patRow, 2).value = "Standard days";
  rc.getCell(patRow, 3).value = "Target points";
  c.patterns.forEach((p, i) => {
    rc.getCell(patRow + 1 + i, 1).value = p.name;
    rc.getCell(patRow + 1 + i, 2).value = p.days;
    rc.getCell(patRow + 1 + i, 3).value = p.target;
  });
  rc.getCell(patRow + c.patterns.length + 2, 1).value = "Points per working day";
  rc.getCell(patRow + c.patterns.length + 2, 2).value = c.ppd;
  for (const r of [1, ladderRow, bandRow, patRow]) {
    rc.getRow(r).eachCell((cell) => {
      cell.fill = fill(NAVY);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
  }
  [34, 9, 9, 9, 9, 10, 12].forEach((w, i) => (rc.getColumn(i + 1).width = w));

  const RC = quote("Rate Card") + "!";
  const CATS = RC + "$A$2:$A$" + (nCat + 1);
  const RATES = RC + "$B$2:$E$" + (nCat + 1);
  const SLABS = RC + "$B$1:$E$1";
  const LADDER = RC + "$B$" + ladderRow + ":$" + col(ladder.length + 1) + "$" + ladderRow;
  const KUDOS_RATE = RC + "$B$" + kudosRow;

  /* ------------------------------------------------------------ trackers */
  const byEditor = new Map<string, PricedLine[]>();
  for (const l of result.lines) {
    if (!byEditor.has(l.editor)) byEditor.set(l.editor, []);
    byEditor.get(l.editor)!.push(l);
  }
  /* Held rows are priced the same way, on their own, so the sheet can say
     what each would earn if it did belong to the month. */
  const heldLines = input.held.length ? compute(c, input.held).lines : [];
  const heldBy = new Map<string, PricedLine[]>();
  for (const l of heldLines) {
    if (l.kind === "skipped" || l.kind === "unpriced") continue;
    if (!heldBy.has(l.editor)) heldBy.set(l.editor, []);
    heldBy.get(l.editor)!.push(l);
  }

  /* Parent columns: the categories that actually have a video in this run,
     in rate-card order, with Not payable at the end if anything landed there. */
  const seenCats = new Set(
    result.lines.filter((l) => l.kind === "edit" || l.kind === "project").map((l) => l.cat as string)
  );
  const parentCats = c.rates.map((r) => r.cat).filter((x) => seenCats.has(x));

  type Ref = { sheet: string; first: number; last: number; total: number };
  const refs = new Map<string, Ref>();
  const taken = new Set(["parent", "rate card", "held projects", "notes"]);

  const writeHead = (ws: ExcelJS.Worksheet, row: number, labels: string[], bg = NAVY, ink = "FFFFFFFF") => {
    labels.forEach((t, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = t;
      cell.fill = fill(bg);
      cell.font = { bold: true, color: { argb: ink } };
      cell.alignment = { wrapText: true, vertical: "middle" };
    });
  };

  const writeLine = (ws: ExcelJS.Worksheet, r: number, l: PricedLine, held: boolean) => {
    const row = l.row;
    /* The project's name, then which of its deliverables this is, so five
       cuts of one project read as five lines and not one repeated. */
    ws.getCell(r, 1).value = (row.title || row.code || "—") + (row.did && !row.project ? " · #" + row.did : "");
    ws.getCell(r, 2).value = row.reviewer || "";
    ws.getCell(r, 3).value = catLabel(l);
    const d = ws.getCell(r, 4);
    const text = row.status || (row.link ? "Open in Orbitova" : "");
    if (row.link) {
      d.value = { text: text || "Open", hyperlink: row.link };
      d.font = { color: { argb: LINK_INK }, underline: true };
    } else {
      d.value = text;
    }
    const a = dateOf(row.assigned);
    if (a) { ws.getCell(r, 5).value = a; ws.getCell(r, 5).numFmt = "dd-mm-yyyy"; }
    const f = dateOf(row.approved);
    if (f) { ws.getCell(r, 6).value = f; ws.getCell(r, 6).numFmt = "dd-mm-yyyy"; }
    /* Exact minutes, as priced; the format shows two places. Rounded here,
       the formula would drift a few paise from what the app paid. */
    ws.getCell(r, 7).value = row.mins;
    ws.getCell(r, 7).numFmt = "0.00";
    ws.getCell(r, 8).value = l.rounds;

    const ded = ws.getCell(r, 9);
    if (l.kind === "edit") {
      ded.value = { formula: `IF(H${r}=0,0,INDEX(${LADDER},MIN(H${r},${ladder.length})))`, result: l.pct };
    } else {
      ded.value = l.pct;
    }
    ded.numFmt = "0%";

    const lookup = `INDEX(${RATES},MATCH(C${r},${CATS},0),MATCH($B$2,${SLABS},0))`;
    const pts = ws.getCell(r, 10);
    /* Cached at full precision, the same number the formula arrives at, so
       the two engines agree to the last paisa once the Parent rounds. */
    const value = l.pts;
    if (l.kind === "edit") pts.value = { formula: `G${r}*${lookup}*(1-I${r})`, result: value };
    else if (l.kind === "project") pts.value = { formula: lookup, result: value };
    else pts.value = value;
    pts.numFmt = "0.0";

    if (!held) {
      ws.getCell(r, 11).fill = fill(YELLOW);
      ws.getCell(r, 11).numFmt = "0.0";
      ws.getCell(r, 12).value = { formula: `J${r}+K${r}`, result: value };
      ws.getCell(r, 12).numFmt = "0.0";
    }
  };

  const videos = (ls: PricedLine[]) => ls.filter((l) => l.kind === "edit" || l.kind === "project").length;

  for (const e of result.out) {
    const lines = (byEditor.get(e.name) || []).slice().sort(byDate);
    const hl = (heldBy.get(e.name) || []).slice().sort(byDate);
    if (!lines.length && !hl.length) continue;

    const name = sheetName(e.name, taken);
    const ws = wb.addWorksheet(name);
    ws.getCell("A1").value = "Editor";
    ws.getCell("A1").font = { bold: true };
    ws.getCell("B1").value = e.name;
    ws.getCell("B1").font = { bold: true };
    ws.getCell("E1").value = { text: "← Back to Parent", hyperlink: "#'Parent'!A1" };
    ws.getCell("E1").font = { color: { argb: LINK_INK }, underline: true };
    ws.getCell("A2").value = "Slab";
    ws.getCell("A2").font = { bold: true };
    ws.getCell("B2").value = e.slab;
    ws.getCell("C2").value = EXP[e.slab];
    ws.getCell("A3").value =
      `Work in ${month}` + (period ? ` (projects with ${basisLabel.toLowerCase()} date ${period.from} to ${period.to})` : "") +
      ". Yellow cells (Kudos Points) are for internal use — type a number and the Parent's kudos incentive follows.";
    writeHead(ws, 4, TCOLS);

    let r = 5;
    for (const l of lines) writeLine(ws, r++, l, false);
    const last = Math.max(r - 1, 5);
    const t = r;
    const n = videos(lines);
    ws.getCell(t, 1).value = `Total · ${n} video${n === 1 ? "" : "s"}`;
    const sum = (ls: PricedLine[], f: (l: PricedLine) => number) => ls.reduce((a, l) => a + f(l), 0);
    const totals: [number, number, string][] = [
      [7, sum(lines, (l) => l.row.mins), "0.00"],
      [10, sum(lines, (l) => l.pts), "0.0"],
      [11, 0, "0.0"],
      [12, sum(lines, (l) => l.pts), "0.0"],
    ];
    for (const [cIdx, value, fmt] of totals) {
      const cell = ws.getCell(t, cIdx);
      cell.value = { formula: `SUM(${col(cIdx)}5:${col(cIdx)}${last})`, result: value };
      cell.numFmt = fmt;
    }
    for (let i = 1; i <= 12; i++) {
      ws.getCell(t, i).fill = fill(TOTAL);
      ws.getCell(t, i).font = { bold: true };
    }
    refs.set(e.name, { sheet: name, first: 5, last, total: t });

    if (hl.length) {
      const h0 = t + 2;
      ws.getCell(h0, 1).value =
        `Held — no ${basisLabel.toLowerCase()} date in the export. Check the project in Orbitova; the points are what these would earn if it belongs to ${month}. Not in any total.`;
      ws.getCell(h0, 1).font = { bold: true, color: { argb: HELD_INK } };
      writeHead(ws, h0 + 1, TCOLS.slice(0, 10), HELD, HELD_INK);
      let hr = h0 + 2;
      for (const l of hl) writeLine(ws, hr++, l, true);
      const m = videos(hl);
      ws.getCell(hr, 1).value = `Held total · ${m} video${m === 1 ? "" : "s"}`;
      ws.getCell(hr, 1).font = { bold: true, color: { argb: HELD_INK } };
      ws.getCell(hr, 7).value = { formula: `SUM(G${h0 + 2}:G${hr - 1})`, result: sum(hl, (l) => l.row.mins) };
      ws.getCell(hr, 7).numFmt = "0.00";
      ws.getCell(hr, 10).value = { formula: `SUM(J${h0 + 2}:J${hr - 1})`, result: sum(hl, (l) => l.pts) };
      ws.getCell(hr, 10).numFmt = "0.0";
    }

    TWIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  /* -------------------------------------------------------------- parent */
  parent.getCell("A1").value =
    `Editor Points — ${month}` + (period ? ` (projects with ${basisLabel.toLowerCase()} date ${period.from} to ${period.to})` : "");
  parent.getCell("A1").font = { bold: true, size: 14 };
  parent.getCell("A2").value =
    "Click an editor's name to open their tracker, and a video's status to open its project in Orbitova. " +
    "Kudos Points (yellow) are internal: type a number on the tracker and the kudos incentive here follows, at the rate set on the Rate Card sheet. " +
    "Held = no " + basisLabel.toLowerCase() + " date in the export; listed on the Held Projects sheet, not counted.";
  parent.getCell("A2").font = { bold: true, size: 10 };
  parent.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  parent.mergeCells(2, 1, 2, 12);
  parent.getRow(2).height = 44;

  const PCOLS = [
    "Editor Name", "Slab", ...parentCats, "Total Videos", "Total Video Minutes", "Points",
    "Target", "Above Target", "Performance Incentive (₹)",
    "Kudos Points", "Kudos Incentive (₹)", "Total Incentive (₹)",
  ];
  writeHead(parent, 4, PCOLS);
  parent.getRow(4).height = 42;
  const cV = 3 + parentCats.length; // Total Videos
  const cM = cV + 1, cP = cV + 2, cTg = cV + 3, cA = cV + 4, cI = cV + 5;
  const cG = cV + 6, cGI = cV + 7, cTI = cV + 8;

  /* The ladder as a formula: each rung pays for the points inside it. */
  const incentiveFormula = (above: string) =>
    bands
      .map((b, i) => {
        const to = i + 1 < bands.length ? bands[i + 1].from : null;
        const inside = to === null ? `${above}-${b.from}` : `MIN(${above},${to})-${b.from}`;
        return `${b.rate}*MAX(0,${inside})`;
      })
      .join("+") || "0";

  let pr = 5;
  const zero: string[] = [];
  for (const e of result.out) {
    const ref = refs.get(e.name);
    const lines = byEditor.get(e.name) || [];
    const row = parent.getRow(pr);
    const nameCell = parent.getCell(pr, 1);
    if (ref) {
      nameCell.value = { text: e.name, hyperlink: `#${quote(ref.sheet)}!A1` };
      nameCell.font = { color: { argb: LINK_INK }, underline: true };
    } else {
      nameCell.value = e.name;
    }
    const sh = ref ? quote(ref.sheet) + "!" : null;
    parent.getCell(pr, 2).value = sh ? { formula: `${sh}$B$2`, result: e.slab } : e.slab;
    parentCats.forEach((cat, i) => {
      const count = lines.filter((l) => (l.kind === "edit" || l.kind === "project") && l.cat === cat).length;
      parent.getCell(pr, 3 + i).value = sh
        ? { formula: `COUNTIF(${sh}$C$${ref!.first}:$C$${ref!.last},${crit(cat)})`, result: count }
        : count;
    });
    const nVid = videos(lines);
    parent.getCell(pr, cV).value = parentCats.length
      ? { formula: `SUM(C${pr}:${col(cV - 1)}${pr})`, result: nVid }
      : nVid;
    /* Rounded as the app rounds: points to a tenth before the target is
       subtracted, rupees to the whole, so the sheet and Results agree. */
    const mins = lines.reduce((a, l) => a + l.row.mins, 0);
    const pts = round(lines.reduce((a, l) => a + l.pts, 0), 1);
    parent.getCell(pr, cM).value = sh ? { formula: `${sh}$G$${ref!.total}`, result: mins } : mins;
    parent.getCell(pr, cP).value = sh ? { formula: `ROUND(${sh}$J$${ref!.total},1)`, result: pts } : pts;
    parent.getCell(pr, cTg).value = e.target;
    parent.getCell(pr, cA).value = { formula: `MAX(0,ROUND(${col(cP)}${pr}-${col(cTg)}${pr},1))`, result: e.surplus };
    parent.getCell(pr, cI).value = { formula: `ROUND(${incentiveFormula(`${col(cA)}${pr}`)},0)`, result: e.incentive };
    /* Kudos pay a flat rate for every point, target or no target. The rate
       is a cell on the Rate Card sheet, so it can be changed in the file. */
    parent.getCell(pr, cG).value = sh ? { formula: `${sh}$K$${ref!.total}`, result: 0 } : 0;
    parent.getCell(pr, cG).fill = fill(YELLOW);
    parent.getCell(pr, cGI).value = { formula: `ROUND(${col(cG)}${pr}*${KUDOS_RATE},0)`, result: 0 };
    parent.getCell(pr, cTI).value = { formula: `${col(cI)}${pr}+${col(cGI)}${pr}`, result: e.incentive };
    parent.getCell(pr, cTI).font = { bold: true };
    for (const i of [cI, cGI, cTI]) parent.getCell(pr, i).numFmt = "#,##0";
    for (const i of [cM, cP, cG, cA]) parent.getCell(pr, i).numFmt = "0.0";
    row.commit();
    if (!nVid && pts < 0.05) zero.push(`${e.name} (${e.slab})`);
    pr++;
  }
  const tot = pr;
  parent.getCell(tot, 1).value = `Total · ${result.out.length} editors`;
  for (let i = 3; i <= cTI; i++) {
    const L = col(i);
    const value = result.out.reduce((a, e) => {
      const v = parent.getCell(5 + result.out.indexOf(e), i).value;
      const n = typeof v === "number" ? v : v && typeof v === "object" && "result" in v ? Number(v.result) : 0;
      return a + (n || 0);
    }, 0);
    const cell = parent.getCell(tot, i);
    cell.value = { formula: `SUM(${L}5:${L}${tot - 1})`, result: round(value, 2) };
    cell.numFmt = i >= cI && i !== cG ? "#,##0" : i >= cM ? "0.0" : "General";
  }
  for (let i = 1; i <= cTI; i++) {
    parent.getCell(tot, i).fill = fill(TOTAL);
    parent.getCell(tot, i).font = { bold: true };
  }
  if (zero.length) {
    parent.getCell(tot + 2, 1).value = `No priced video in the report (${zero.length}): ${zero.join(", ")}`;
    parent.getCell(tot + 2, 1).font = { italic: true, color: { argb: "FF7F7F7F" } };
  }
  const pw = [28, 8, ...parentCats.map(() => 13), 11, 12, 10, 9, 11, 13, 12, 14, 14];
  pw.forEach((w, i) => (parent.getColumn(i + 1).width = w));
  parent.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }];

  /* ------------------------------------------------------- held projects */
  const hp = wb.addWorksheet("Held Projects");
  const groups = new Map<string, PricedLine[]>();
  for (const l of heldLines) {
    if (l.kind === "skipped" || l.kind === "unpriced") continue;
    const k = l.row.code || l.row.title || "?";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  if (!groups.size) {
    hp.getCell("A1").value = input.held.length
      ? `${input.held.length} row${input.held.length === 1 ? "" : "s"} had no ${basisLabel.toLowerCase()} date, and none of them prices to anything.`
      : `Every row in the report carried ${period ? "a " + basisLabel.toLowerCase() + " date" : "a date"}; nothing was held.`;
  } else {
    hp.getCell("A1").value =
      `Projects with no ${basisLabel.toLowerCase()} date in the export — open each in Orbitova and read the date. ` +
      `Those that belong to ${month} can be added to the editor's total by hand; the rest stay out.`;
    hp.getCell("A1").font = { bold: true };
    writeHead(hp, 3, [
      "Project ID", "Project Name", "Editor", "Deliverables", "Minutes", `Points if ${month}`, "Orbitova", `${basisLabel} date (fill in)`,
    ]);
    let r = 4;
    const sorted = [...groups.entries()].sort(
      (a, b) => b[1].reduce((x, l) => x + l.pts, 0) - a[1].reduce((x, l) => x + l.pts, 0)
    );
    for (const [code, ls] of sorted) {
      hp.getCell(r, 1).value = code;
      hp.getCell(r, 2).value = ls[0].row.title || "";
      hp.getCell(r, 3).value = ls[0].editor;
      hp.getCell(r, 4).value = ls.length;
      hp.getCell(r, 5).value = round(ls.reduce((a, l) => a + l.row.mins, 0), 2);
      hp.getCell(r, 6).value = round(ls.reduce((a, l) => a + l.pts, 0), 2);
      const link = ls.find((l) => l.row.link)?.row.link;
      if (link) {
        hp.getCell(r, 7).value = { text: "Open in Orbitova", hyperlink: link };
        hp.getCell(r, 7).font = { color: { argb: LINK_INK }, underline: true };
      }
      hp.getCell(r, 8).fill = fill(YELLOW);
      r++;
    }
    [12, 44, 24, 12, 10, 16, 18, 20].forEach((w, i) => (hp.getColumn(i + 1).width = w));
    hp.views = [{ state: "frozen", ySplit: 3 }];
  }

  /* --------------------------------------------------------------- notes */
  const notes = wb.addWorksheet("Notes");
  const counted = result.lines.filter((l) => l.kind === "edit" || l.kind === "project").length;
  const reviews = result.lines.filter((l) => l.kind === "review").length;
  const carried = result.lines.filter((l) => l.kind === "carried" || l.kind === "skipped").length;
  const mapping = c.map
    .filter(([, cat]) => cat !== NOTPAY)
    .map(([type, cat]) => `${type} → ${cat}`)
    .join("; ");
  const rows: [string, string][] = [
    ["Source", input.fileName || "Orbitova export"],
    ["Window", period
      ? `Projects whose ${basisLabel.toLowerCase()} date falls between ${period.from} and ${period.to}: ${period.kept} rows kept, ${period.dropped} outside the window, ${period.undated} with no such date (held).`
      : "The whole report, as exported."],
    ["Counted", `${counted} video${counted === 1 ? "" : "s"} priced, whatever their status.`],
    ["Reviews", reviews
      ? `${reviews} review line${reviews === 1 ? "" : "s"}: the project's manager is credited at the review rate for a video somebody else edited, once its status says it was reviewed. Shown on the manager's tracker as "reviewed for others".`
      : "No review points in this run."],
    ["Paid once", carried
      ? `${carried} row${carried === 1 ? "" : "s"} belong to videos already paid for in an earlier month. A revision this month charges the deduction only; a re-upload with nothing new pays nothing.`
      : "No video in this run had been paid for in an earlier month."],
    ["Points", "Duration (min) × the per-minute rate for the video's category and the editor's slab (Rate Card sheet), less the revision deduction. A category priced per project pays its rate once for the project."],
    ["Revisions", (c.revPen || []).length
      ? "Deduction by rounds of revision: " + (c.revPen || []).map((p, i) => `${i + 1} → ${p}%`).join(", ") + ". More rounds than the ladder has cost the last rung."
      : "No revision ladder is set, so revisions cost nothing."],
    ["Incentive", bands.length
      ? "Points above target are paid in rungs: " + bands.map((b, i) => {
          const to = i + 1 < bands.length ? bands[i + 1].from : null;
          return (to === null ? `+${b.from} and above` : `+${b.from} to +${to}`) + ` at ₹${b.rate} a point`;
        }).join("; ") + ". The Parent sheet works it out from Points, before any kudos points."
      : "No payout ladder is set."],
    ["Kudos Points", "Internal. Yellow cells on the trackers are for you to fill. Every kudos point pays the rate in the yellow cell on the Rate Card sheet (₹" + (c.kudosRate ?? bands[0]?.rate ?? 0) + " when this file was made), whether or not the editor cleared target; Total Incentive adds it to the performance incentive."],
    ["Type mapping", mapping || "None."],
    ["Editor matching", "Names in the export are matched to the team list as the app does; names it could not match are listed on the Results page, not here."],
  ];
  rows.forEach(([k, v], i) => {
    notes.getCell(i + 1, 1).value = k;
    notes.getCell(i + 1, 1).font = { bold: true };
    notes.getCell(i + 1, 2).value = v;
    notes.getCell(i + 1, 2).alignment = { wrapText: true, vertical: "top" };
  });
  notes.getColumn(1).width = 16;
  notes.getColumn(2).width = 120;

  /* Rate card last, where a reader expects it. ExcelJS orders tabs by this
     field but leaves it out of its typings. */
  (rc as unknown as { orderNo: number }).orderNo = wb.worksheets.length + 1;
  return wb;
}

/** Builds the workbook and hands it to the browser as a download. */
export async function exportTracker(input: Input) {
  const wb = await buildTracker(input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Editor_Points_" + (input.monthLabel || "report").replace(/[^\w]+/g, "_") + ".xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
