/* Types only, so reading a report costs the half-megabyte of SheetJS at the
   moment a file is dropped rather than when the page is opened. */
import type * as XLSX from "xlsx";
import { ParsedSource, SourceRow } from "./types";

const NAME_H = ["assignee", "editor", "member", "name", "owner"];
/* Substring matching means "type" already catches Video Type, Project Type and
   Content Type. Nothing looser belongs here: "deliverable" looked tempting
   until it matched "Deliverables (approved/total)" and priced work by "0/1". */
const TYPE_H = ["type", "video type", "project type", "category"];
const SEC_H = ["runtime in period (sec)", "duration (sec)", "runtime (sec)", "seconds"];
const MIN_H = ["minutes", "runtime (min)", "duration (min)"];
const CODE_H = ["project code", "project id", "code"];
const VER_H = ["version", "revision no", "revisions"];
const PERIOD_H = ["uploaded in period", "upload in period"];
const STATUS_H = ["status", "deliverable status"];
const MGR_H = ["manager", "reviewer", "reviewed by"];
/* A deliverable's number within its project. Orbitova exports it as "#", and
   with the project code it is the only stable name a video has: the identity
   that lets a cut uploaded in August be recognised again in September. */
const DID_H = ["deliverable #", "deliverable no", "deliverable number", "#"];

/**
 * A deliverable whose status says somebody has actually looked at it. Work
 * still sitting in review, or merely uploaded, has not been reviewed yet and
 * earns the reviewer nothing until it has.
 */
function isReviewed(status: string): boolean {
  const t = status.trim().toLowerCase();
  if (!t) return false;
  return t.includes("approv") || t.includes("revision");
}

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

type Sheet = { name: string; aoa: unknown[][]; head: string[] };

const cell = (r: unknown[] | undefined, i: number) =>
  r && i >= 0 && r[i] != null ? String(r[i]).trim() : "";

const numAt = (r: unknown[] | undefined, i: number) =>
  r && i >= 0 && r[i] != null ? parseFloat(String(r[i])) || 0 : 0;

/** Minutes from whichever duration column the sheet has. */
function minutesOf(r: unknown[], si: number, mi: number): number {
  if (si >= 0 && r[si] != null) return numAt(r, si) / 60;
  if (mi >= 0 && r[mi] != null) return numAt(r, mi);
  return 0;
}

/**
 * Reads the delivery report.
 *
 * Preferred shape is one row per *deliverable*: that is the level at which a
 * video has a version, and so the only level at which a revision can be
 * charged for. Deliverables carry no editor, so the editor comes from the
 * parent project, joined on the project code.
 *
 * A report without a deliverables sheet still works the old way — one row per
 * project, no revisions — and says so, rather than quietly pricing every
 * video as a first-time pass.
 */
export async function parseReport(data: ArrayBuffer): Promise<ParseResult> {
  const xlsx = await import("xlsx");
  let wb: XLSX.WorkBook;
  try {
    wb = xlsx.read(new Uint8Array(data), { type: "array" });
  } catch {
    return { ok: false, error: "That file could not be read. Export it again as .xlsx or .csv and retry." };
  }

  const sheets: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const aoa = xlsx.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null });
    if (!aoa.length) continue;
    sheets.push({
      name,
      aoa,
      head: ((aoa[0] || []) as unknown[]).map((h) => String(h ?? "").trim()),
    });
  }

  const deliverables = bestDeliverables(sheets);
  if (deliverables) {
    const joined = fromDeliverables(deliverables, sheets);
    if (joined) return joined;
  }

  return fromProjects(sheets);
}

/** A deliverables sheet has a version, a duration and a project to join to. */
function bestDeliverables(sheets: Sheet[]): Sheet | null {
  let best: Sheet | null = null;
  for (const s of sheets) {
    const hasVersion = pick(s.head, VER_H) >= 0;
    const hasCode = pick(s.head, CODE_H) >= 0;
    const hasTime = pick(s.head, SEC_H) >= 0 || pick(s.head, MIN_H) >= 0;
    /* An editor column means it is a project-shaped sheet that happens to
       count revisions, not a list of deliverables. */
    const hasEditor = pick(s.head, NAME_H) >= 0;
    if (hasVersion && hasCode && hasTime && !hasEditor) {
      if (!best || s.aoa.length > best.aoa.length) best = s;
    }
  }
  return best;
}

/** The sheet that can name the editor behind a project code. */
function projectLookup(sheets: Sheet[], exclude: string) {
  let best: { s: Sheet; ci: number; ni: number; ti: number; mi: number } | null = null;
  for (const s of sheets) {
    if (s.name === exclude) continue;
    const ci = pick(s.head, CODE_H);
    const ni = pick(s.head, NAME_H);
    if (ci < 0 || ni < 0) continue;
    if (!best || s.aoa.length > best.s.aoa.length) {
      best = { s, ci, ni, ti: pick(s.head, TYPE_H), mi: pick(s.head, MGR_H) };
    }
  }
  return best;
}

function fromDeliverables(d: Sheet, sheets: Sheet[]): ParseResult | null {
  const lookup = projectLookup(sheets, d.name);
  if (!lookup) return null;

  const ci = pick(d.head, CODE_H);
  const vi = pick(d.head, VER_H);
  const ti = pick(d.head, TYPE_H);
  const si = pick(d.head, SEC_H);
  const mi = pick(d.head, MIN_H);
  const pi = pick(d.head, PERIOD_H);
  const sti = pick(d.head, STATUS_H);
  const api = pick(d.head, ["approved by", "approver"]);
  const di = pick(d.head, DID_H);

  /* Editor, reviewer and fallback type, by project code. */
  const editor = new Map<string, string>();
  const reviewer = new Map<string, string>();
  const projectType = new Map<string, string>();
  for (let i = 1; i < lookup.s.aoa.length; i++) {
    const r = lookup.s.aoa[i];
    const code = cell(r, lookup.ci);
    if (!code) continue;
    const who = cell(r, lookup.ni);
    if (who && !editor.has(code)) editor.set(code, who);
    const mgr = cell(r, lookup.mi);
    if (mgr && !reviewer.has(code)) reviewer.set(code, mgr);
    const t = cell(r, lookup.ti);
    if (t && !projectType.has(code)) projectType.set(code, t);
  }
  if (!editor.size) return null;

  /* The export is already scoped to a period, but a deliverable can carry a
     duration from an earlier upload. Where the sheet says which ones landed
     in the period, believe it. */
  const usePeriod =
    pi >= 0 && d.aoa.slice(1).some((r) => cell(r as unknown[], pi) !== "");

  const rows: SourceRow[] = [];
  const approvers = new Map<string, Set<string>>();
  let orphans = 0;

  for (let i = 1; i < d.aoa.length; i++) {
    const r = d.aoa[i];
    if (!r) continue;

    const mins = minutesOf(r, si, mi);
    if (mins <= 0) continue;
    if (usePeriod && cell(r, pi) === "") continue;

    const code = cell(r, ci);
    const who = editor.get(code);
    if (!who) {
      orphans++;
      continue;
    }

    const version = numAt(r, vi);
    const type = cell(r, ti) || projectType.get(code) || "";
    const status = cell(r, sti);

    /* Who signed a deliverable off is recorded, but it is not who reviewed it:
       most approvals are editors marking their own work. It is kept only to
       notice projects where several people signed off, since the points go to
       one manager and those are the projects where that is a guess. */
    const signer = cell(r, api);
    if (signer) {
      const set = approvers.get(code) || new Set<string>();
      set.add(signer);
      approvers.set(code, set);
    }

    rows.push({
      raw: who,
      type: type || null,
      mins,
      rev: Math.max(0, Math.round(version) - 1),
      reviewer: reviewer.get(code) || null,
      reviewed: sti >= 0 ? isReviewed(status) : false,
      code: code || null,
      did: di >= 0 ? cell(r, di) || null : null,
    });
  }

  if (!rows.length) return null;

  /* Whether each deliverable can be told apart from its siblings, and so
     recognised again in a later month. Project code plus deliverable number
     where the export numbers them; failing that, project code plus the exact
     duration in seconds, which collides far more often. Rows sharing a key
     are counted, because those are the ones a paid-once rule could confuse. */
  const identity = new Map<string, number>();
  for (const r of rows) {
    const key = (r.code || "") + "#" + (r.did || "@" + Math.round(r.mins * 60));
    identity.set(key, (identity.get(key) || 0) + 1);
  }
  const ambiguous = [...identity.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);

  return {
    ok: true,
    rows,
    source: {
      sheet: d.name,
      headers: d.head.filter(Boolean),
      typeColumn: ti >= 0 ? d.head[ti] || null : null,
      mode: "deliverables",
      versionColumn: vi >= 0 ? d.head[vi] || null : null,
      orphans,
      statusColumn: sti >= 0 ? d.head[sti] || null : null,
      splitApprovals: [...approvers.entries()]
        .filter(([, set]) => set.size > 1)
        .map(([code]) => code),
      codeColumn: ci >= 0 ? d.head[ci] || null : null,
      idColumn: di >= 0 ? d.head[di] || null : null,
      deliverables: rows.length,
      ambiguous,
    },
  };
}

/**
 * The older read: whichever sheet has an editor and a duration, one row per
 * project. It must have a type column to break a tie, since a sheet without
 * one prices nothing.
 */
function fromProjects(sheets: Sheet[]): ParseResult {
  let best: { s: Sheet; ni: number; ti: number; si: number; mi: number; sc: number } | null = null;

  for (const s of sheets) {
    const ni = pick(s.head, NAME_H);
    const ti = pick(s.head, TYPE_H);
    const si = pick(s.head, SEC_H);
    const mi = pick(s.head, MIN_H);
    if (ni >= 0 && (si >= 0 || mi >= 0)) {
      const sc = (ti >= 0 ? 2 : 0) + s.aoa.length / 1000;
      if (!best || sc > best.sc) best = { s, ni, ti, si, mi, sc };
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
  for (let i = 1; i < best.s.aoa.length; i++) {
    const r = best.s.aoa[i];
    if (!r) continue;
    const nm = cell(r, best.ni);
    if (!nm) continue;
    rows.push({
      raw: nm,
      type: best.ti >= 0 ? cell(r, best.ti) || null : null,
      mins: minutesOf(r, best.si, best.mi),
      rev: 0,
    });
  }

  if (!rows.length) return { ok: false, error: "That sheet has headers but no data rows." };

  return {
    ok: true,
    rows,
    source: {
      sheet: best.s.name,
      headers: best.s.head.filter(Boolean),
      typeColumn: best.ti >= 0 ? best.s.head[best.ti] || null : null,
      mode: "projects",
      versionColumn: null,
      orphans: 0,
      statusColumn: null,
      splitApprovals: [],
      codeColumn: null,
      idColumn: null,
      deliverables: 0,
      ambiguous: 0,
    },
  };
}

export { XLSX };
