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

/**
 * `r` is points per minute for editing, indexed by slab: [A, B, C, D].
 * `review` is points per minute for reviewing this kind of video, which does
 * not vary by slab: the work is the same whoever does it.
 */
export type RateRow = {
  cat: string;
  r: number[];
  review?: number;
  /**
   * What the rate is a rate *of*. "minute" prices the runtime delivered, which
   * is the norm. "project" pays the rate once per project whatever was — or
   * was not — uploaded against it: a RAW clip edit is handed over on a drive,
   * so the report has no deliverable and no minutes to price.
   */
  unit?: "minute" | "project";
};

export type Editor = {
  name: string;
  slab: Slab;
  pattern: string;
  days: number | null;
  alias: string[];
  /** Reviews work rather than editing it, so no editing is expected of them. */
  reviewer?: boolean;
  /**
   * A manager: outside the daily editing process, so a missed target is not
   * theirs to answer for and the PIP page leaves them out. Separate from
   * reviewing, which is work that earns points.
   */
  manager?: boolean;
  /** Set to give this person a target of their own instead of the pattern's. */
  target?: number | null;
  /** Where the payout goes. Shown beside the name; the report never uses it. */
  email?: string | null;
};

/**
 * What has already been paid for one deliverable, keyed by project code and
 * deliverable number. Orbitova reports a revised cut again in the month it was
 * re-uploaded — by design, since it measures upload volume — so this is what
 * stops one video being paid for in two months.
 */
export type LedgerEntry = {
  /** The highest version of it that has been settled. */
  version: number;
  /** What it earned the first time, the basis every later deduction is a % of. */
  gross: number;
  /** How much of the revision ladder has already been charged, in percent. */
  chargedPct: number;
};

export type Ledger = Record<string, LedgerEntry>;

/** How one row was settled against that ledger. */
export type Settlement =
  /** Not seen before: price it in full, charging the ladder for its own rounds. */
  | { mode: "full" }
  /**
   * Paid for in an earlier month and back at a higher version. The minutes are
   * not paid again; the ladder is charged against what it earned the first
   * time, so the rework costs points in the month it happened.
   */
  | { mode: "deduct"; gross: number; pct: number }
  /** Paid for already and no further along, so there is nothing to settle. */
  | { mode: "skip" };

/** A source video type paired with the payable category it maps to. */
export type TypeMap = [string, string];

/**
 * One rung of the incentive ladder. `from` is how far above target the points
 * are, not an absolute score, so one ladder reads the same for every target:
 * a 5-day office editor on 650 and a 6-day WFH editor on 730 each start their
 * first rung at their own target. Only the points inside a rung are paid at
 * its rate, so 70 points clear of target pays the first 60 at the first rate
 * and the last 10 at the second.
 */
export type PayBand = { from: number; rate: number };

/** One rung of the ladder as it applies to a particular surplus. */
export type PayPart = {
  from: number;
  /** Where the rung ends, or null for the last one, which has no ceiling. */
  to: number | null;
  rate: number;
  /** How many of the surplus points fall inside this rung. */
  pts: number;
  amount: number;
};

export type Config = {
  ppd: number;
  /**
   * The flat rupees-per-point the ladder replaced. Kept because runs saved
   * before the ladder existed were priced with it, and reopening one from
   * History has to reproduce the payout that was signed off.
   */
  rate: number;
  /** What points above target are worth, in rungs. See {@link PayBand}. */
  payBands: PayBand[];
  /**
   * How many months in a row below target put an editor on a performance
   * improvement plan. Stated on the rate card so the rule is written down
   * next to the target it is measured against.
   */
  pipMonths: number;
  /**
   * Rupees a kudos point pays: the manager's extra points for the month, paid
   * flat whether or not the editor cleared target. Seeds the detailed
   * report's Rate Card sheet.
   */
  kudosRate: number;
  /**
   * The PIP line as a percentage of target. A month whose points, kudos
   * included, fall under it is flagged for a performance improvement plan.
   */
  pipPct: number;
  /**
   * What a revision costs, as a percentage of that video's points, indexed by
   * how many rounds it took: [0] is one revision, [1] is two, and so on. A
   * video revised more times than the list is long is charged the last entry.
   */
  revPen: number[];
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
  /**
   * The project this deliverable belongs to, from the report's project code.
   * Kept so a deliverable can be recognised again in a later month: a video
   * revised across a month boundary must not be paid for twice.
   */
  code?: string | null;
  /**
   * This deliverable's number within its project ("#" in the export). With the
   * project code it names one video for good, across months.
   */
  did?: string | null;
  /**
   * How this row was settled against everything already paid for that
   * deliverable. Written on when the run is saved, so reopening it reproduces
   * the payout that was signed off even though the ledger has moved on.
   */
  settle?: Settlement;
  /** Whether a review has actually happened, from the deliverable's status. */
  reviewed?: boolean;
  /**
   * This row is a whole project that had no deliverable in the report, not a
   * video. It has no minutes, and earns only if its category is priced per
   * project; otherwise it is a project nobody has delivered on yet.
   */
  project?: boolean;
  /**
   * The parent project's dates from the report, as "YYYY-MM-DD". Which work
   * counts in a month is decided by when the project was created, assigned or
   * due — not by when the export was run — so these are what the prompt on
   * the Run page filters on.
   */
  created?: string | null;
  assigned?: string | null;
  due?: string | null;
  /**
   * When this deliverable itself was uploaded, "YYYY-MM-DD": Orbitova's
   * "Work Delivered" basis, the one date that belongs to the video rather
   * than to its project.
   */
  delivered?: string | null;
  /** What the video is called in the export, for the per-editor tracker. */
  title?: string | null;
  /** The deliverable's status as exported ("Approved", "Under Review"). */
  status?: string | null;
  /** The day it was approved, "YYYY-MM-DD", when the export says. */
  approved?: string | null;
  /** The export's own link back to the project in Orbitova. */
  link?: string | null;
};

/** The project dates a run can be limited by, with the label each shows as. */
export const DATE_BASES = {
  created: "Created",
  assigned: "Assigned",
  due: "Due",
  delivered: "Work delivered",
} as const;
export type DateBasis = keyof typeof DATE_BASES;

/** The window a report was cut down to before it was priced. */
export type Period = {
  basis: DateBasis;
  from: string;
  to: string;
  kept: number;
  /** Rows whose date fell outside the window. */
  dropped: number;
  /** Rows with no date to judge by, also left out. */
  undated: number;
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
  /** The header the project code was read from, or null when there was none. */
  codeColumn: string | null;
  /** The header a deliverable's own number was read from, null when absent. */
  idColumn: string | null;
  /** How many deliverable rows were read, before any pricing. */
  deliverables: number;
  /**
   * Deliverables that share a project and an exact duration to the second.
   * With no deliverable id in the export, a project code and a duration are
   * the only identity a video has, so these are the rows that identity cannot
   * tell apart — and therefore the rows that a paid-once rule would risk
   * mistaking for each other.
   */
  ambiguous: number;
  /** The date window the rows were kept to, or null when the whole report ran. */
  period: Period | null;
};

/** The report currently on screen, either just uploaded or opened from History. */
export type ActiveRun = {
  rows: SourceRow[];
  /**
   * Rows left out of the window because they carry no date to judge by. Not
   * priced, but listed in the detailed report so somebody can look them up.
   * Only a live run has them; a run reopened from History stored its rows
   * after the cut.
   */
  held?: SourceRow[];
  fileName: string;
  /** How the file was read. Absent for a run reopened from History. */
  source?: ParsedSource;
  /** Set when viewing a saved run: prices it with the rate card of the day. */
  snapshot: Config | null;
  savedId: number | null;
  /**
   * A manager's kudos points for the month, by editor name: effort the
   * report did not score, paid flat at the rate card's kudos rate. Typed on
   * Results and saved with the run.
   */
  kudos: Record<string, number>;
  /**
   * Days of leave taken this month, by editor name. The editor's target for
   * this run is scaled to the days they were actually in.
   */
  leave: Record<string, number>;
};

export type RunStatus = "over" | "under" | "low" | "blocked" | "none";

/** One line of an editor's video-type breakdown, as Results and the editor page show it. */
export type EditorCat = {
  cat: string;
  minutes: number;
  /** Points per minute. Zero where nothing is payable, shown as a dash. */
  rate: number;
  deducted: number;
  points: number;
  /** "review" lines are videos this person reviewed for somebody else. */
  kind: "edit" | "review" | "untyped";
  /** For a per-project category, `minutes` is a count of projects. */
  unit?: "minute" | "project";
};

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
  revByCat: Record<string, number>;
  reviewMins: number;
  reviewPts: number;
  reviewed: number;
  /** True when this person is on the team list as a reviewer. */
  isReviewer: boolean;
  /** Projects paid at a per-project rate. For those categories `byCat` counts projects, not minutes. */
  projects: number;
  /** Points taken off for revisions, before target and incentive. */
  deducted: number;
  /** Deliverables paid for in an earlier month, so not paid for again here. */
  carried: number;
  /** Of `deducted`, the part charged for revising those earlier deliverables. */
  carryDed: number;
  pts: number;
  target: number;
  surplus: number;
  /** The performance incentive: what points above target paid on the ladder. */
  incentive: number;
  /** Kudos points given this month, and what they pay at the flat rate. */
  kudos: number;
  kudosInr: number;
  /** Performance incentive plus kudos: what is actually paid out. */
  total: number;
  pctv: number;
  status: RunStatus;
};

/**
 * One row of the report as it was priced: which editor it went to, under what
 * category, and what it earned. The per-video record behind every total in
 * `out`, so a report can show the videos and not only the sums.
 */
export type PricedLine = {
  editor: string;
  row: SourceRow;
  /**
   * edit: a video priced by the minute. project: a project fee, paid once.
   * review: credited to the project's manager for reviewing it. carried: paid
   * for in an earlier month and revised this one, so only the deduction
   * lands. skipped: nothing new to pay (already paid, or a second cut of a
   * project already charged). unpriced: no payable category, so nothing.
   */
  kind: "edit" | "project" | "review" | "carried" | "skipped" | "unpriced";
  cat: string | null;
  /** Points a minute, or for the project; the review rate on a review line. */
  rate: number;
  rounds: number;
  /** Share of the gross taken off for revisions, 0 to 1. */
  pct: number;
  gross: number;
  cut: number;
  pts: number;
};

export type Computed = {
  out: EditorResult[];
  lines: PricedLine[];
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
  low: ["r", "Flagged for PIP"],
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
