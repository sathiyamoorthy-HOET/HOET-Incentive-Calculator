import {
  Computed,
  Config,
  Editor,
  EditorResult,
  EXP,
  NOTPAY,
  Pattern,
  PayBand,
  PayPart,
  RateRow,
  Ledger,
  RunStatus,
  Settlement,
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

/** Points a minute for reviewing this kind of video. */
export function reviewRateFor(c: Config, cat: string): number {
  const r = c.rates.find((x) => x.cat === cat);
  return r ? r.review || 0 : 0;
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
  if (e.target != null) return round(e.target, 0);
  const p = patternOf(c, e.pattern);
  if (!p || !p.days) return 0;
  return round((p.target * daysOf(c, e)) / p.days, 0);
}

/* --------------------------------------------------------------- the payout
   Points above target are not all worth the same. The ladder is read the way
   an income-tax slab is: each rung pays only for the points that fall inside
   it, so somebody 70 clear of target earns 60 at the first rate and 10 at the
   second, not 70 at the second. Rungs are measured from the editor's own
   target, so one ladder serves every work pattern. */

/**
 * The ladder, in order and without nonsense in it. A config with no ladder is
 * a run saved before the ladder existed: it falls back to the flat rate it was
 * priced with, so reopening it reproduces the payout that was signed off.
 */
export function payBandsOf(c: Config): PayBand[] {
  const bands = (c.payBands || [])
    .filter((b) => b && Number.isFinite(b.from) && b.from >= 0)
    .sort((a, b) => a.from - b.from);
  return bands.length ? bands : [{ from: 0, rate: c.rate || 0 }];
}

/** What each rung of the ladder pays on a given surplus, rungs included. */
export function payParts(c: Config, surplus: number): PayPart[] {
  const bands = payBandsOf(c);
  return bands.map((b, i) => {
    const to = i + 1 < bands.length ? bands[i + 1].from : null;
    const rate = b.rate || 0;
    const pts = round(Math.max(0, Math.min(surplus, to ?? surplus) - b.from), 1);
    return { from: b.from, to, rate, pts, amount: pts * rate };
  });
}

export function incentiveOf(c: Config, surplus: number): number {
  return Math.round(payParts(c, surplus).reduce((a, p) => a + p.amount, 0));
}

/**
 * What a revision costs, as a fraction of that video's points. The ladder is
 * read by round count, not summed: three rounds is charged the third rung, and
 * anything beyond the ladder is charged its last rung.
 */
export function penaltyOf(c: Config, rounds: number): number {
  const ladder = c.revPen || [];
  if (rounds <= 0 || !ladder.length) return 0;
  const pct = ladder[Math.min(rounds, ladder.length) - 1] || 0;
  return Math.min(1, Math.max(0, pct / 100));
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

/**
 * The name one video keeps for good: its project code and its number within
 * that project. Null when the report gives neither, in which case the video
 * cannot be recognised in a later month and is priced as first-seen.
 */
export function deliverableKey(r: SourceRow): string | null {
  if (!r.code || !r.did) return null;
  return r.code + "#" + r.did;
}

/** The version of a deliverable a row represents. Version 1 means no revisions. */
const versionOf = (r: SourceRow) => Math.max(1, Math.round((r.rev ?? 0) + 1));

/**
 * Decides, for every row, whether it is new work or a cut that has already
 * been paid for, and writes that decision onto the row.
 *
 * This is the only part of pricing that depends on other months, so it is kept
 * out of `compute`: settle once when a report is read, store the answers with
 * the run, and `compute` stays a pure function of the rows and the rate card.
 * A run reopened from History therefore reproduces exactly, however much the
 * ledger has moved on since.
 */
export function settleRows(c: Config, rows: SourceRow[], ledger: Ledger): SourceRow[] {
  /* A copy, advanced as we go, so a deliverable repeated inside one report
     cannot be paid for twice either. */
  const seen: Ledger = { ...ledger };

  return rows.map((r) => {
    const key = deliverableKey(r);
    if (!key) return { ...r, settle: { mode: "full" } as Settlement };

    const version = versionOf(r);
    const pctNow = penaltyOf(c, version - 1) * 100;
    const prior = seen[key];

    if (!prior) {
      /* First sight. What it earns now is the basis for any later deduction,
         so it is worked out here rather than left to compute. */
      const m = matchEditor(c, r.raw);
      const cat = catOf(c, r.type);
      const gross =
        m.e && m.score >= MATCH_THRESHOLD && cat && cat !== NOTPAY
          ? r.mins * rateFor(c, cat, m.e.slab)
          : 0;
      seen[key] = { version, gross, chargedPct: pctNow };
      return { ...r, settle: { mode: "full" } as Settlement };
    }

    /* Seen before and no further along: nothing new was delivered. */
    if (version <= prior.version) return { ...r, settle: { mode: "skip" } as Settlement };

    /* The ladder is read by round count, not summed, so a video already
       charged 5% at two rounds owes only the difference when it reaches the
       10% rung — never 15%. */
    const owed = round(pctNow - prior.chargedPct, 4);
    seen[key] = { version, gross: prior.gross, chargedPct: Math.max(pctNow, prior.chargedPct) };
    if (owed <= 0 || prior.gross <= 0) return { ...r, settle: { mode: "skip" } as Settlement };
    return { ...r, settle: { mode: "deduct", gross: prior.gross, pct: owed } as Settlement };
  });
}

/** What a settled report leaves in the ledger, ready for the next month. */
export function ledgerAfter(c: Config, rows: SourceRow[], ledger: Ledger): Ledger {
  const next: Ledger = { ...ledger };
  for (const r of settleRows(c, rows, ledger)) {
    const key = deliverableKey(r);
    if (!key) continue;
    const version = versionOf(r);
    const pctNow = penaltyOf(c, version - 1) * 100;
    const prior = next[key];
    if (!prior) {
      const m = matchEditor(c, r.raw);
      const cat = catOf(c, r.type);
      const gross =
        m.e && m.score >= MATCH_THRESHOLD && cat && cat !== NOTPAY
          ? r.mins * rateFor(c, cat, m.e.slab)
          : 0;
      next[key] = { version, gross, chargedPct: pctNow };
    } else if (version > prior.version) {
      next[key] = {
        version,
        gross: prior.gross,
        chargedPct: Math.max(pctNow, prior.chargedPct),
      };
    }
  }
  return next;
}

export function compute(c: Config, rows: SourceRow[]): Computed {
  type Acc = {
    mins: number;
    pts: number;
    byCat: Record<string, number>;
    dedByCat: Record<string, number>;
    untyped: number;
    notPay: number;
    revised: number;
    rounds: number;
    deducted: number;
    carried: number;
    carryDed: number;
    revByCat: Record<string, number>;
    reviewMins: number;
    reviewPts: number;
    reviewed: number;
  };
  const per = new Map<string, Acc>();
  const unknownTypes = new Map<string, number>();
  const unmatched = new Map<string, { mins: number; best: string | null; score: number }>();
  const ignore = c.ignore || [];

  const blank = (): Acc => ({
    mins: 0, pts: 0, byCat: {}, dedByCat: {}, untyped: 0, notPay: 0,
    revised: 0, rounds: 0, deducted: 0, carried: 0, carryDed: 0,
    revByCat: {}, reviewMins: 0, reviewPts: 0, reviewed: 0,
  });
  const accFor = (name: string): Acc => {
    if (!per.has(name)) per.set(name, blank());
    return per.get(name)!;
  };

  for (const r of rows) {
    const isIgnored = ignore.some((x) => x.toLowerCase() === r.raw.toLowerCase());
    if (isIgnored) continue;

    const m = matchEditor(c, r.raw);
    const cat = catOf(c, r.type);

    /* Reviewing is credited from the same row as the editing, because it is
       the same video: the manager of its project reviews it, and only once
       the status says a review has happened. Their own work does not count,
       and a video whose type nobody set has no rate to pay either side. */
    if (r.reviewed && r.reviewer && cat && cat !== NOTPAY) {
      const who = r.reviewer;
      const skip = ignore.some((x) => x.toLowerCase() === who.toLowerCase());
      if (!skip) {
        const rv = matchEditor(c, who);
        if (rv.e && rv.score >= MATCH_THRESHOLD) {
          const own = !!m.e && m.score >= MATCH_THRESHOLD && m.e.name === rv.e.name;
          if (!own) {
            const acc = accFor(rv.e.name);
            acc.reviewMins += r.mins;
            acc.reviewPts += r.mins * reviewRateFor(c, cat);
            acc.revByCat[cat] = (acc.revByCat[cat] || 0) + r.mins;
            acc.reviewed += 1;
          }
        } else {
          const u = unmatched.get(who) || { mins: 0, best: rv.e ? rv.e.name : null, score: rv.score };
          u.mins += r.mins;
          unmatched.set(who, u);
        }
      }
    }

    if (!m.e || m.score < MATCH_THRESHOLD) {
      const u = unmatched.get(r.raw) || { mins: 0, best: m.e ? m.e.name : null, score: m.score };
      u.mins += r.mins;
      unmatched.set(r.raw, u);
      continue;
    }

    const rec = accFor(m.e.name);

    /* Settled against earlier months before anything is credited. A cut that
       was already paid for adds no minutes here, whatever its duration says:
       Orbitova reports it again because it was re-uploaded, not because more
       video was made. Reviewing is credited above and deliberately left
       alone — looking at a revised cut is a fresh review either way. */
    const settle: Settlement = r.settle ?? { mode: "full" };
    if (settle.mode === "skip") continue;

    if (settle.mode === "deduct") {
      const cut = round(settle.gross * (settle.pct / 100), 4);
      const rounds = Math.max(0, Math.round(r.rev ?? 0));
      rec.pts -= cut;
      rec.deducted += cut;
      rec.carried += 1;
      rec.carryDed += cut;
      rec.revised += 1;
      rec.rounds += rounds;
      const back = catOf(c, r.type);
      if (cut > 0 && back && back !== NOTPAY) {
        rec.dedByCat[back] = (rec.dedByCat[back] || 0) + cut;
      }
      continue;
    }

    rec.mins += r.mins;

    const raw = r.type && String(r.type).trim() ? String(r.type).trim() : null;

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
    /* Revisions are charged against the video that was revised, so the
       deduction is visible next to the work it came from. */
    const gross = r.mins * rateFor(c, cat, m.e.slab);
    const rounds = Math.max(0, Math.round(r.rev ?? 0));
    const cut = round(gross * penaltyOf(c, rounds), 4);

    rec.pts += gross - cut;
    rec.deducted += cut;
    rec.byCat[cat] = (rec.byCat[cat] || 0) + r.mins;
    if (rounds > 0) {
      rec.revised += 1;
      rec.rounds += rounds;
      if (cut > 0) rec.dedByCat[cat] = (rec.dedByCat[cat] || 0) + cut;
    }
  }

  const out: EditorResult[] = c.team
    .map((e) => {
      const rec =
        per.get(e.name) || {
          mins: 0, pts: 0, byCat: {}, dedByCat: {}, untyped: 0, notPay: 0,
          revised: 0, rounds: 0, deducted: 0, carried: 0, carryDed: 0,
          revByCat: {}, reviewMins: 0, reviewPts: 0, reviewed: 0,
        };
      const target = targetOf(c, e);
      const pts = round(rec.pts + rec.reviewPts, 1);
      const surplus = Math.max(0, round(pts - target, 1));
      let status: RunStatus = "none";
      if (rec.mins < 0.05 && rec.reviewMins < 0.05) status = "none";
      else if (rec.mins < 0.05) status = surplus > 0 ? "over" : "under";
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
        dedByCat: rec.dedByCat,
        revised: rec.revised,
        rounds: rec.rounds,
        deducted: round(rec.deducted, 1),
      carried: rec.carried,
      carryDed: round(rec.carryDed, 1),
        revByCat: rec.revByCat,
        reviewMins: round(rec.reviewMins, 1),
        reviewPts: round(rec.reviewPts, 1),
        reviewed: rec.reviewed,
        isReviewer: !!e.reviewer,
        pts,
        target,
        surplus,
        incentive: incentiveOf(c, surplus),
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
      d: a.d + r.deducted,
      rm: a.rm + r.reviewMins,
      rp: a.rp + r.reviewPts,
    }),
    { m: 0, p: 0, t: 0, s: 0, i: 0, d: 0, rm: 0, rp: 0 }
  );
}
