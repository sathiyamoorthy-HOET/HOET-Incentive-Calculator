import * as XLSX from "xlsx";
import { ParsedSource, SourceRow } from "./types";

const NAME_H = ["assignee", "editor", "member", "name", "owner"];
/* Substring matching means "type" already catches Video Type, Project Type and
   Content Type. Nothing looser belongs here: "deliverable" looked tempting
   until it matched "Deliverables (approved/total)" and priced work by "0/1". */
const TYPE_H = ["type", "video type", "project type", "category"];
const SEC_H = ["runtime in period (sec)", "duration (sec)", "runtime (sec)", "seconds"];
const MIN_H = ["minutes", "runtime (min)", "duration (min)"];

/** Finds a column by exact header first, then by substring. -1 when absent. */
function pick(hdrs: unknown[], cands: string[]): number {
  const low = hdrs.map((h) => String(h ?? "").trim().toLowerCase());
  for (const c of cands) {
    const i = low.indexOf(c);
    if (i >= 0) return i;
  }
  for (const c of cands) {
    const i = low.findIndex((h) => h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

export type ParseResult =
  | { ok: true; rows: SourceRow[]; source: ParsedSource }
  | { ok: false; error: string };

/**
 * Scans every sheet and keeps the one that looks most like a delivery report:
 * it must have an editor column and a duration column, and having a type
 * column as well breaks the tie.
 */
export function parseReport(data: ArrayBuffer): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(data), { type: "array" });
  } catch {
    return { ok: false, error: "That file could not be read. Export it again as .xlsx or .csv and retry." };
  }

  let best: { sn: string; aoa: unknown[][]; ni: number; ti: number; si: number; mi: number; sc: number } | null = null;

  for (const sn of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: null });
    if (!aoa.length) continue;
    const h = (aoa[0] || []) as unknown[];
    const ni = pick(h, NAME_H),
      ti = pick(h, TYPE_H),
      si = pick(h, SEC_H),
      mi = pick(h, MIN_H);
    if (ni >= 0 && (si >= 0 || mi >= 0)) {
      const sc = (ti >= 0 ? 2 : 0) + aoa.length / 1000;
      if (!best || sc > best.sc) best = { sn, aoa, ni, ti, si, mi, sc };
    }
  }

  if (!best) {
    return {
      ok: false,
      error:
        "No sheet in that file has an editor column and a duration column. Check the export includes assignee and runtime.",
    };
  }

  const rows: SourceRow[] = [];
  for (let i = 1; i < best.aoa.length; i++) {
    const r = best.aoa[i];
    if (!r) continue;
    const nm = r[best.ni];
    if (!nm || !String(nm).trim()) continue;
    let mins = 0;
    if (best.si >= 0 && r[best.si] != null) mins = (parseFloat(String(r[best.si])) || 0) / 60;
    else if (best.mi >= 0 && r[best.mi] != null) mins = parseFloat(String(r[best.mi])) || 0;
    rows.push({
      raw: String(nm).trim(),
      type: best.ti >= 0 && r[best.ti] != null ? String(r[best.ti]) : null,
      mins,
    });
  }

  if (!rows.length) return { ok: false, error: "That sheet has headers but no data rows." };

  /* Index into the row as it is, and only drop the blanks for display: a gap
     before the type column would otherwise shift the name off by one. */
  const raw = ((best.aoa[0] || []) as unknown[]).map((h) => String(h ?? "").trim());

  return {
    ok: true,
    rows,
    source: {
      sheet: best.sn,
      headers: raw.filter(Boolean),
      typeColumn: best.ti >= 0 ? raw[best.ti] || null : null,
    },
  };
}

export { XLSX };
