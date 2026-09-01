export const NOTPAY = "Not payable";
export const SLABS = ["A", "B", "C", "D"] as const;
export type Slab = (typeof SLABS)[number];

export const EXP: Record<Slab, string> = {
  A: "6+ years",
  B: "3-6 years",
  C: "1-3 years",
  D: "Fresher",
};

export type Pattern = { name: string; days: number; target: number };

/** `r` is points per minute, indexed by slab: [A, B, C, D]. */
export type RateRow = { cat: string; len: number; r: number[] };

export type Editor = {
  name: string;
  slab: Slab;
  pattern: string;
  days: number | null;
  alias: string[];
};

/** A source video type paired with the payable category it maps to. */
export type TypeMap = [string, string];

export type Config = {
  ppd: number;
  rate: number;
  mode: "uplift" | "direct";
  patterns: Pattern[];
  rates: RateRow[];
  map: TypeMap[];
  ignore: string[];
  team: Editor[];
};

/** One row as read out of the uploaded delivery report. */
export type SourceRow = { raw: string; type: string | null; mins: number };

export type RunStatus = "over" | "under" | "blocked" | "none";

export type EditorResult = {
  name: string;
  slab: Slab;
  exp: string;
  pattern: string;
  days: number;
  mins: number;
  untyped: number;
  notPay: number;
  byCat: Record<string, number>;
  pts: number;
  target: number;
  surplus: number;
  incentive: number;
  pctv: number;
  status: RunStatus;
};

export type Computed = {
  out: EditorResult[];
  unknownTypes: [string, number][];
  unmatched: [string, { mins: number; best: string | null; score: number }][];
  untypedMins: number;
};

export type RunSummary = {
  id: number;
  month_label: string;
  file_name: string | null;
  total_minutes: number;
  total_points: number;
  total_target: number;
  total_surplus: number;
  total_incentive: number;
  untyped_minutes: number;
  editors_delivered: number;
  editors_cleared: number;
  created_at: string;
  created_by: string | null;
  author: string | null;
};

export const STATUS: Record<RunStatus, [string, string]> = {
  over: ["t", "Above target"],
  under: ["a", "Below target"],
  blocked: ["r", "Work not priced"],
  none: ["n", "No work recorded"],
};
