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
export type RateRow = { cat: string; r: number[] };

export type Editor = {
  name: string;
  slab: Slab;
  pattern: string;
  days: number | null;
  alias: string[];
  /** Reviews work rather than editing it, so no editing is expected of them. */
  reviewer?: boolean;
  /** Set to give this person a target of their own instead of the pattern's. */
  target?: number | null;
};

/** A source video type paired with the payable category it maps to. */
export type TypeMap = [string, string];

export type Config = {
  ppd: number;
  rate: number;
  /**
   * What a revision costs, as a percentage of that video's points, indexed by
   * how many rounds it took: [0] is one revision, [1] is two, and so on. A
   * video revised more times than the list is long is charged the last entry.
   */
  revPen: number[];
  /** Points a minute for reviewing, whatever the video type. */
  reviewRate: number;
  patterns: Pattern[];
  rates: RateRow[];
  map: TypeMap[];
  ignore: string[];
  team: Editor[];
};

/**
 * One row as read out of the uploaded delivery report — one deliverable when
 * the report has them, otherwise one project.
 */
export type SourceRow = {
  raw: string;
  type: string | null;
  mins: number;
  /** Rounds of revision this video went through. Version 1 means none. */
  rev?: number;
  /** Who reviews this video: the manager of the project it belongs to. */
  reviewer?: string | null;
  /** Whether a review has actually happened, from the deliverable's status. */
  reviewed?: boolean;
};

/** What the parser made of the file, so the Results page can explain itself. */
export type ParsedSource = {
  sheet: string;
  /** Every non-empty header on the sheet it read, in order. */
  headers: string[];
  /** The header it took the video type from, or null when there was none. */
  typeColumn: string | null;
  /**
   * "deliverables" prices each deliverable and counts its revisions, taking
   * the editor from the parent project. "projects" is the older, coarser read:
   * one row per project, no revision data.
   */
  mode: "deliverables" | "projects";
  /** The header revisions were counted from, or null when there was none. */
  versionColumn: string | null;
  /** Deliverables that could not be tied back to a project, so were skipped. */
  orphans: number;
  /** The status column reviews were read from, or null when there was none. */
  statusColumn: string | null;
  /**
   * Projects whose deliverables were approved by more than one person. Review
   * points go to the manager, so these are the ones where that is a guess.
   */
  splitApprovals: string[];
};

/** The report currently on screen, either just uploaded or opened from History. */
export type ActiveRun = {
  rows: SourceRow[];
  fileName: string;
  /** How the file was read. Absent for a run reopened from History. */
  source?: ParsedSource;
  /** Set when viewing a saved run: prices it with the rate card of the day. */
  snapshot: Config | null;
  savedId: number | null;
};

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
  /** Points taken off for revisions, by category. */
  dedByCat: Record<string, number>;
  /** Videos that took at least one revision, and the rounds they took. */
  revised: number;
  rounds: number;
  /** Reviewing: minutes reviewed, the points they earned, and videos seen. */
  reviewMins: number;
  reviewPts: number;
  reviewed: number;
  /** True when this person is on the team list as a reviewer. */
  isReviewer: boolean;
  /** Points taken off for revisions, before target and incentive. */
  deducted: number;
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

/** One row of the Access page: who is allowed in, and whether they can sign in. */
export type AccessRow = {
  email: string;
  /** Free text captured when they were added, usually their name or role. */
  note: string | null;
  addedAt: string;
  /** From their profile, so it reflects what they signed up as. */
  name: string | null;
  hasAccount: boolean;
  isYou: boolean;
};
