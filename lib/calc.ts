import {
  Computed,
  Config,
  Editor,
  EditorResult,
  EXP,
  NOTPAY,
  Pattern,
  RateRow,
  RunStatus,
  Slab,
  SLABS,
  SourceRow,
} from "./types";

/** A report name must score at least this against a team name to be counted. */
const MATCH_THRESHOLD = 0.72;

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export const inr = (v: number) => "₹" + Math.round(v).toLocaleString("en-IN");

export const num = (v: number) => Math.round(v).toLocaleString("en-IN");

export function cats(c: Config): string[] {
  return c.rates.map((r) => r.cat).concat([NOTPAY]);
}

export function rateFor(c: Config, cat: string, slab: Slab): number {
  const r = c.rates.find((x) => x.cat === cat);
  return r ? r.r[SLABS.indexOf(slab)] || 0 : 0;
}

export function upliftOf(r: RateRow, i: number): number {
  return r.r[0] ? r.r[i] / r.r[0] - 1 : 0;
}

export function patternOf(c: Config, name: string): Pattern {
  return c.patterns.find((p) => p.name === name) || c.patterns[0];
}

export function daysOf(c: Config, e: Editor): number {
  return e.days == null ? patternOf(c, e.pattern).days : e.days;
}

export function targetOf(c: Config, e: Editor): number {
  const p = patternOf(c, e.pattern);
  if (!p || !p.days) return 0;
  return round((p.target * daysOf(c, e)) / p.days, 0);
}

/** Returns the payable category for a report type, or null when unmapped. */
export function catOf(c: Config, type: string | null | undefined): string | null {
  const t = String(type ?? "").trim().toLowerCase();
  if (!t) return null;
  const m = c.map.find((x) => x[0].trim().toLowerCase() === t);
  return m ? m[1] : null;
}

/* -------------------------------------------------------------- name matching
   Report exports spell editor names inconsistently, so names are matched on
   token similarity rather than equality. Exact names and saved aliases win
   outright; everything else has to clear MATCH_THRESHOLD to be counted. */

function toks(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function lev(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const tsim = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length);

export function nameScore(a: string, b: string): number {
  const A = toks(a),
    B = toks(b);
  if (!A.length || !B.length) return 0;
  const [S, L] = A.length <= B.length ? [A, B] : [B, A];
  let sum = 0;
  for (const t of S) sum += Math.max(...L.map((u) => tsim(t, u)));
  return sum / S.length;
}

export function matchEditor(c: Config, raw: string): { e: Editor | null; score: number } {
  const low = String(raw).toLowerCase();
  for (const e of c.team) {
    if (e.name.toLowerCase() === low) return { e, score: 1 };
    if ((e.alias || []).some((a) => a.toLowerCase() === low)) return { e, score: 1 };
  }
  let best: Editor | null = null,
    bs = 0;
  for (const e of c.team) {
    const s = nameScore(raw, e.name);
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return { e: best, score: bs };
}

/* -------------------------------------------------------------------- compute
   Points are minutes x the per-minute rate for the editor's slab. Incentive is
   paid only on points above target, so surplus is floored at zero. */

export function compute(c: Config, rows: SourceRow[]): Computed {
  type Acc = { mins: number; pts: number; byCat: Record<string, number>; untyped: number; notPay: number };
  const per = new Map<string, Acc>();
  const unknownTypes = new Map<string, number>();
  const unmatched = new Map<string, { mins: number; best: string | null; score: number }>();
  const ignore = c.ignore || [];

  for (const r of rows) {
    const isIgnored = ignore.some((x) => x.toLowerCase() === r.raw.toLowerCase());
    if (isIgnored) continue;

    const m = matchEditor(c, r.raw);
    if (!m.e || m.score < MATCH_THRESHOLD) {
      const u = unmatched.get(r.raw) || { mins: 0, best: m.e ? m.e.name : null, score: m.score };
      u.mins += r.mins;
      unmatched.set(r.raw, u);
      continue;
    }

    const key = m.e.name;
    if (!per.has(key)) per.set(key, { mins: 0, pts: 0, byCat: {}, untyped: 0, notPay: 0 });
    const rec = per.get(key)!;
    rec.mins += r.mins;

    const raw = r.type && String(r.type).trim() ? String(r.type).trim() : null;
    const cat = catOf(c, r.type);

    if (cat === null) {
      rec.untyped += r.mins;
      if (raw) unknownTypes.set(raw, (unknownTypes.get(raw) || 0) + r.mins);
      continue;
    }
    if (cat === NOTPAY) {
      rec.notPay += r.mins;
      rec.byCat[cat] = (rec.byCat[cat] || 0) + r.mins;
      continue;
    }
    rec.pts += r.mins * rateFor(c, cat, m.e.slab);
    rec.byCat[cat] = (rec.byCat[cat] || 0) + r.mins;
  }

  const out: EditorResult[] = c.team
    .map((e) => {
      const rec = per.get(e.name) || { mins: 0, pts: 0, byCat: {}, untyped: 0, notPay: 0 };
      const target = targetOf(c, e);
      const pts = round(rec.pts, 1);
      const surplus = Math.max(0, round(pts - target, 1));
      let status: RunStatus = "none";
      if (rec.mins < 0.05) status = "none";
      else if (rec.untyped > 0.05 && pts < 0.05) status = "blocked";
      else if (surplus > 0) status = "over";
      else status = "under";
      return {
        name: e.name,
        slab: e.slab,
        exp: EXP[e.slab],
        pattern: e.pattern,
        days: daysOf(c, e),
        mins: round(rec.mins, 1),
        untyped: round(rec.untyped, 1),
        notPay: round(rec.notPay, 1),
        byCat: rec.byCat,
        pts,
        target,
        surplus,
        incentive: Math.round(surplus * c.rate),
        pctv: target ? pts / target : 0,
        status,
      };
    })
    .sort((a, b) => b.pts - a.pts || b.mins - a.mins);

  return {
    out,
    unknownTypes: [...unknownTypes.entries()].sort((a, b) => b[1] - a[1]),
    unmatched: [...unmatched.entries()].sort((a, b) => b[1].mins - a[1].mins),
    untypedMins: out.reduce((a, r) => a + r.untyped, 0),
  };
}

export function totals(out: EditorResult[]) {
  return out.reduce(
    (a, r) => ({
      m: a.m + r.mins,
      p: a.p + r.pts,
      t: a.t + r.target,
      s: a.s + r.surplus,
      i: a.i + r.incentive,
    }),
    { m: 0, p: 0, t: 0, s: 0, i: 0 }
  );
}
