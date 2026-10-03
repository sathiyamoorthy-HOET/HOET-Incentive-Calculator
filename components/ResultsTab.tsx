"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { cats, catsOf, inr, kudosRateOf, num, payParts, pipShareOf, round, totals } from "@/lib/calc";
import Breakdown from "./Breakdown";
import NumInput from "./NumInput";
import { exportRun } from "@/lib/export";
import { exportTracker } from "@/lib/tracker";
import { ActiveRun, Computed, Config, DATE_BASES, EditorResult, SLABS, STATUS } from "@/lib/types";
import { Sort, SortHead, sorted, toggleSort } from "./SortHead";
import { saveRun, type ActionResult } from "@/app/actions";
import { parseMonth } from "@/lib/months";

type Col =
  | "name" | "slab" | "mins" | "revised" | "deducted" | "reviewed" | "pts" | "target"
  | "away" | "leave" | "pctv" | "surplus" | "incentive" | "kudos" | "total" | "status";

/* Status in the order a manager reads it: cleared, short, blocked, nothing. */
const STATUS_RANK = { over: 0, under: 1, low: 2, blocked: 3, none: 4, away: 5 } as const;

function colValue(r: EditorResult, col: Col) {
  switch (col) {
    case "name": return r.name;
    case "slab": return SLABS.indexOf(r.slab);
    case "mins": return r.mins;
    case "revised": return r.revised || null;
    case "deducted": return r.deducted > 0.05 ? r.deducted : null;
    case "reviewed": return r.reviewed || null;
    case "pts": return r.pts;
    case "leave": return r.days;
    case "away": return r.away ? 1 : 0;
    case "target": return r.target;
    case "pctv": return r.pctv;
    case "surplus": return r.surplus > 0 ? r.surplus : null;
    case "incentive": return r.incentive > 0 ? r.incentive : null;
    case "kudos": return r.kudos > 0 ? r.kudos : null;
    case "total": return r.total > 0 ? r.total : null;
    case "status": return STATUS_RANK[r.status];
  }
}

export default function ResultsTab({
  config,
  liveConfig,
  run,
  result,
  month,
  setMonth,
  update,
  setKudos,
  setLeave,
  setAway,
  adjustDirty,
  onSaveAdjust,
  onRerunLive,
  onSaved,
  goRun,
}: {
  config: Config;
  liveConfig: Config;
  run: ActiveRun | null;
  result: Computed | null;
  month: string;
  /** Lets the run be given its month right here, beside Save, when it has none. */
  setMonth?: (m: string) => void;
  update: (fn: (draft: Config) => void) => void;
  /** Gives an editor kudos points for this month. */
  setKudos: (name: string, points: number) => void;
  /** Records an editor's leave this month, which scales their target down. */
  setLeave: (name: string, days: number) => void;
  /** Marks an editor as lent to another department this month. */
  setAway: (name: string, away: boolean) => void;
  /** On a saved run: whether the kudos or leave on screen differ from what is stored. */
  adjustDirty?: boolean;
  /** On a saved run: writes the kudos and leave on screen to it. */
  onSaveAdjust?: () => Promise<ActionResult>;
  onRerunLive: () => void;
  onSaved: (id: number) => void;
  goRun: () => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<Sort<Col>>(null);
  const [saving, setSaving] = useState(false);
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const linkSel = useRef<Record<string, string>>({});
  const mapSel = useRef<Record<string, string>>({});

  if (!run || !result) {
    return (
      <section className="panel on">
        <h2>Results</h2>
        <p className="sub">Incentive is earned only on points above target.</p>
        <div className="empty">
          Nothing loaded. Upload a report on <Link href="/run">Run a month</Link>, or open a saved
          one from <Link href="/history">History</Link>.
        </div>
      </section>
    );
  }

  const o = result.out;
  const t = totals(o);
  /* Positions into `o` rather than a re-sorted copy, so the rows held open
     stay open whichever column the table is read by. */
  const order = sorted(o.map((_, i) => i), sort, (i, col) => colValue(o[i], col), (i) => o[i].name);
  const head = { sort, onToggle: (col: Col) => setSort(toggleSort(sort, col)) };
  const active = o.filter((r) => r.mins > 0.05 || r.projects > 0);
  const here = o.filter((r) => !r.away);
  const cleared = o.filter((r) => r.surplus > 0);
  const blocked = o.filter((r) => r.status === "blocked");
  const low = o.filter((r) => r.status === "low");
  const affected = o.filter((r) => r.untyped > 0.05).sort((a, b) => b.untyped - a.untyped);
  const untypedTotal = round(result.untypedMins, 1);
  const readOnly = !!run.snapshot;
  /* A run cannot be saved without its month, so the month sits where the
     Save button is: filled from the upload window or the file name, and
     typed over when neither said. */
  const noMonth = !readOnly && !parseMonth(month) && !parseMonth(run.fileName);
  /* A whole run scoring zero is almost always this: the export had no column
     naming the kind of video, so every minute is unpriced. Say it at the top,
     with the columns the file did have, instead of leaving a zero to explain
     itself. */
  const noTypeColumn = !!run.source && run.source.typeColumn === null && untypedTotal > 0.05;
  /* Two ways a report can be short of what the rate card now prices on. */
  const noVersions = !!run.source && run.source.mode === "projects";
  /* Deliverables this report re-reports because they were re-uploaded, and the
     points charged for having revised them. */
  const carried = result.out.reduce((a, r) => a + r.carried, 0);
  const carryDed = result.out.reduce((a, r) => a + r.carryDed, 0);
  const orphans = run.source?.orphans ?? 0;
  const splitApprovals = run.source?.splitApprovals ?? [];
  const hasProblems =
    result.unmatched.length > 0 || result.unknownTypes.length > 0 || untypedTotal > 0.05;

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function doSave() {
    if (!run) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await saveRun({
      monthLabel: month,
      fileName: run.fileName,
      rows: run.rows,
      config: liveConfig,
      kudos: run.kudos,
      leave: run.leave,
      away: run.away,
    });
    setSaving(false);
    if (res.ok) {
      onSaved(res.id);
      setSaveMsg({ ok: true, text: "Saved to History. Everyone on the team can see it." });
    } else {
      setSaveMsg({ ok: false, text: res.error });
    }
  }

  async function doSaveAdjust() {
    if (!onSaveAdjust) return;
    setSavingAdjust(true);
    setSaveMsg(null);
    const res = await onSaveAdjust();
    setSavingAdjust(false);
    setSaveMsg(res.ok ? { ok: true, text: "Saved to this run." } : { ok: false, text: res.error });
  }

  return (
    <section className="panel on">
      <h2>Results</h2>
      <p className="sub">
        Incentive is earned only on points above target. Leave scales the target down to the days
        worked; Away means another department&apos;s month, with no target here. Under {Math.round(pipShareOf(config) * 100)}% of target, kudos included, is flagged
        for a performance improvement plan. Kudos points pay ₹{kudosRateOf(config)} each, target or
        no target.
      </p>

      {noTypeColumn && (
        <div className="note bad">
          <strong>This report has no video type column, so nothing can be priced.</strong> Every
          minute in it is unpriced, which is why the points are zero. The sheet
          {run.source?.sheet ? ' "' + run.source.sheet + '"' : ""} has these columns:{" "}
          <span className="num" style={{ fontSize: 12.5 }}>
            {run.source?.headers.join(" · ")}
          </span>
          . Add a column named <strong>Type</strong>, <strong>Video type</strong> or{" "}
          <strong>Category</strong> to the export — anything whose name contains &ldquo;type&rdquo;
          or &ldquo;category&rdquo; is read — then upload it again. The names in it are matched on
          the Video types page.
        </div>
      )}

      {noVersions && (
        <div className="note">
          <strong>No revisions counted in this report.</strong> It was read one row per project
          from
          {run.source?.sheet ? ' "' + run.source.sheet + '"' : " the sheet"}, which carries no
          version column, so every video is priced as a first-pass approval. A report with a
          deliverables sheet prices each video on its own and charges the ladder on the rate card.
        </div>
      )}

      {carried > 0 && (
        <div className="note">
          <strong>
            {carried} {carried === 1 ? "video was" : "videos were"} already paid for in an earlier
            month, so {carried === 1 ? "it is" : "they are"} not paid for again here.
          </strong>{" "}
          Orbitova reports a revised cut in the month it was re-uploaded as well as the month it
          was first delivered — its own Methodology sheet calls that figure upload volume, not
          finished length — so the runtime in this report counts {carried === 1 ? "it" : "them"}{" "}
          twice.{" "}
          {carryDed > 0.05
            ? round(carryDed, 1) +
              " points were deducted instead, charged against what those videos earned first time round, because the revision happened this month."
            : "No deduction was due on top of that."}
        </div>
      )}

      {!!run.source && run.source.ambiguous > 0 && (
        <div className="note bad">
          <strong>
            {run.source.ambiguous} of {run.source.deliverables} deliverables in this report cannot
            be told apart.
          </strong>{" "}
          A video is recognised by its project code
          {run.source.idColumn ? ' and its "' + run.source.idColumn + '" number' : ", and this export gives it no number of its own"}
          , which is what stops the same cut being paid for twice when it is revised in a later
          month. These rows share an identity, so that check cannot see them as separate videos.
          Ask for the deliverable number to be included in the export before relying on the
          paid-once rule.
        </div>
      )}

      {splitApprovals.length > 0 && (
        <div className="note">
          <strong>
            {splitApprovals.length} project{splitApprovals.length > 1 ? "s" : ""} had deliverables
            signed off by more than one person.
          </strong>{" "}
          Review points went to each project&apos;s manager, so for{" "}
          {splitApprovals.length > 1 ? "these" : "this one"} that is an assumption rather than a
          record: <span className="num">{splitApprovals.join(", ")}</span>.
        </div>
      )}

      {orphans > 0 && (
        <div className="note">
          <strong>
            {orphans} deliverable{orphans > 1 ? "s" : ""} could not be tied to a project
          </strong>{" "}
          and {orphans > 1 ? "were" : "was"} left out, because the editor is named on the project
          rather than the deliverable.
        </div>
      )}

      {readOnly && (
        <div className="note">
          <strong>Viewing a saved run.</strong> It is priced with the rate card and team list as
          they were when it was saved, so the payout stays exactly as it was signed off.{" "}
          <button className="btn o" style={{ marginLeft: 8 }} onClick={onRerunLive}>
            Re-run with today&apos;s settings
          </button>
        </div>
      )}

      <div className="actbar">
        <div>
          <div className="t">{run.fileName || "Report"}</div>
          <div className="m">
            {active.length} of {here.length} editors delivered work · {num(t.p)} points ·{" "}
            {inr(t.i + t.k)} payable
            {run.source?.period && (
              <>
                {" · "}
                {DATE_BASES[run.source.period.basis]} {run.source.period.from} to{" "}
                {run.source.period.to}
                {run.source.period.dropped + run.source.period.undated > 0 &&
                  ` · ${run.source.period.dropped + run.source.period.undated} rows left out`}
              </>
            )}
          </div>
        </div>
        <button
          className="btn g"
          style={{ marginLeft: "auto" }}
          title="Parent sheet, one tracker per editor with links to Orbitova, held projects, notes and the rate card"
          onClick={() =>
            exportTracker({
              monthLabel: month,
              fileName: run.fileName,
              period: run.source?.period,
              held: run.held || [],
              result,
              config,
            })
          }
        >
          Download detailed report
        </button>
        {!readOnly && setMonth && (
          <input
            className="fld-in wide"
            type="text"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="Month, e.g. September 2026"
            aria-label="Month this run covers"
            title="The month this run is saved as"
            style={{ width: 200 }}
          />
        )}
        {!readOnly && (
          <button className="btn o" onClick={doSave} disabled={saving || noMonth} title={noMonth ? "Type the month first" : undefined}>
            {saving ? <span className="spin" /> : run.savedId ? "Save again" : "Save this run"}
          </button>
        )}
        {readOnly && onSaveAdjust && (
          <button
            className="btn o"
            onClick={doSaveAdjust}
            disabled={savingAdjust || !adjustDirty}
            title={adjustDirty ? "Store the away marks, leave and kudos below on this run" : "Change away, leave or kudos in the table to enable"}
          >
            {savingAdjust ? <span className="spin" /> : "Save changes"}
          </button>
        )}
        <button className="btn o" onClick={goRun}>
          Run another report
        </button>
      </div>

      {saveMsg && (
        <div className={"note " + (saveMsg.ok ? "ok" : "bad")}>{saveMsg.text}</div>
      )}

      {hasProblems ? (
        <div className="card bad">
          <h3>Fix these before using the numbers</h3>

          {result.unmatched.length > 0 && (
            <>
              <p className="sub" style={{ margin: "0 0 10px" }}>
                <strong>
                  {result.unmatched.length} name{result.unmatched.length > 1 ? "s" : ""} in the
                  report did not match your team list.
                </strong>{" "}
                That work is not counted at all.{" "}
                {readOnly
                  ? "Re-run with today's settings to fix them."
                  : "Link each one to the right editor, or ignore it if the person is not an editor."}
              </p>
              <div className="scroll">
                <table style={{ maxWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Name in report</th>
                      <th className="r" style={{ width: 90 }}>Minutes</th>
                      <th style={{ width: 290 }}>This is</th>
                      {!readOnly && <th style={{ width: 150 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {result.unmatched.map(([raw, u]) => (
                      <tr key={raw}>
                        <td>{raw}</td>
                        <td className="r num">{round(u.mins, 1)}</td>
                        <td>
                          {readOnly ? (
                            <span className="muted">{u.best ?? "—"}</span>
                          ) : (
                            <select
                              defaultValue={u.best ?? config.team[0]?.name}
                              onChange={(e) => { linkSel.current[raw] = e.target.value; }}
                            >
                              {config.team.map((e) => (
                                <option key={e.name}>{e.name}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        {!readOnly && (
                          <td>
                            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                              <button
                                className="btn g"
                                onClick={() => {
                                  const nm = linkSel.current[raw] ?? u.best ?? config.team[0]?.name;
                                  update((d) => {
                                    const e = d.team.find((x) => x.name === nm);
                                    if (!e) return;
                                    e.alias = e.alias || [];
                                    if (!e.alias.includes(raw)) e.alias.push(raw);
                                  });
                                }}
                              >
                                Link
                              </button>
                              <button
                                className="btn o"
                                onClick={() =>
                                  update((d) => {
                                    d.ignore = d.ignore || [];
                                    if (!d.ignore.includes(raw)) d.ignore.push(raw);
                                  })
                                }
                              >
                                Ignore
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result.unknownTypes.length > 0 && (
            <>
              <p className="sub" style={{ margin: "16px 0 10px" }}>
                <strong>
                  {result.unknownTypes.length} video type
                  {result.unknownTypes.length > 1 ? "s are" : " is"} not in your mapping.
                </strong>{" "}
                Those minutes score nothing until you map them.
              </p>
              <div className="scroll">
                <table style={{ maxWidth: 820 }}>
                  <thead>
                    <tr>
                      <th>Type in report</th>
                      <th className="r" style={{ width: 90 }}>Minutes</th>
                      <th style={{ width: 300 }}>Map to</th>
                      {!readOnly && <th style={{ width: 100 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {result.unknownTypes.map(([type, mins]) => (
                      <tr key={type}>
                        <td>{type}</td>
                        <td className="r num">{round(mins, 1)}</td>
                        <td>
                          {readOnly ? (
                            <span className="muted">—</span>
                          ) : (
                            <select
                              defaultValue={cats(config)[0]}
                              onChange={(e) => { mapSel.current[type] = e.target.value; }}
                            >
                              {cats(config).map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        {!readOnly && (
                          <td>
                            <button
                              className="btn g"
                              onClick={() => {
                                const cat = mapSel.current[type] ?? cats(config)[0];
                                update((d) => { d.map.push([type, cat]); });
                              }}
                            >
                              Add
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {affected.length > 0 && (
            <>
              <p className="sub" style={{ margin: "16px 0 10px" }}>
                <strong>
                  {untypedTotal} minutes were delivered with no video type, or a type that is not
                  on the rate card or the mapping above.
                </strong>{" "}
                Those minutes cannot be priced, so the editors below are scored lower than the work
                they actually did.{" "}
                {blocked.length > 0 && (
                  <span style={{ color: "var(--rose)" }}>
                    {blocked.length} of them score zero for this reason alone.
                  </span>
                )}
              </p>
              <div className="scroll">
                <table style={{ maxWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "34%" }}>Editor</th>
                      <th className="r" style={{ width: "19%" }}>Minutes with no type</th>
                      <th className="r" style={{ width: "16%" }}>Minutes priced</th>
                      <th className="r" style={{ width: "13%" }}>Points</th>
                      <th style={{ width: "18%" }}>Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affected.map((r) => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td className="r num">{r.untyped}</td>
                        <td className="r num">{round(r.mins - r.untyped, 1)}</td>
                        <td className="r num">{Math.round(r.pts)}</td>
                        <td>
                          {r.status === "blocked" ? (
                            <span className="pill r">Scores zero</span>
                          ) : (
                            <span className="pill a">Under-counted</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="note ok">
          <strong>All work in this report was matched and priced.</strong> No data gaps found.
        </div>
      )}

      <div className="kpis">
        <Kpi b={num(t.m)} s="Minutes delivered" />
        <Kpi b={num(t.p)} s="Points earned" />
        <Kpi b={num(t.t)} s={"Total target, " + here.length + " editors"} />
        <Kpi
          b={cleared.length + " of " + active.length}
          s="Cleared target, of those who delivered"
          cls={cleared.length ? "hi" : "warn"}
        />
        {t.rp > 0.05 && <Kpi b={num(t.rp)} s={"Review points, " + round(t.rm, 0) + " min reviewed"} />}
        {t.d > 0.05 && <Kpi b={"−" + num(t.d)} s="Points off for revisions" cls="warn" />}
        {low.length > 0 && <Kpi b={String(low.length)} s="Flagged for PIP" cls="warn" />}
        {t.k > 0 && <Kpi b={inr(t.k)} s={"Kudos, " + num(t.kp) + " points"} />}
        <Kpi b={inr(t.i + t.k)} s="Incentive payable" cls="hi" />
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Every editor</h3>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
            Click a row to see the breakdown by video type. Away, Leave and Kudos can be set
            {readOnly ? ", then press Save changes" : "; they are saved with the run"}.
          </span>
          <button className="btn o" style={{ marginLeft: "auto" }} onClick={() => exportRun(month, o, config)}>
            Download summary sheet
          </button>
        </div>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <SortHead {...head} col="name" label="Editor" />
                <SortHead {...head} col="slab" label="Slab" />
                <SortHead {...head} col="mins" label="Minutes" right />
                <SortHead
                  {...head}
                  col="revised"
                  label="Revisions"
                  right
                  title="Videos that came back, and the rounds they took"
                />
                <SortHead {...head} col="deducted" label="Deducted" right />
                <SortHead
                  {...head}
                  col="reviewed"
                  label="Reviewed"
                  right
                  title="Videos reviewed for other editors, and the points earned"
                />
                <SortHead {...head} col="pts" label="Points" right />
                <SortHead {...head} col="away" label="Away" title="Lent to another department this month: no target, nothing paid here" />
                <SortHead {...head} col="leave" label="Leave" right title="Days of leave this month; the target scales down to the days worked" />
                <SortHead {...head} col="target" label="Target" right />
                <SortHead {...head} col="pctv" label="Progress" width={80} />
                <SortHead {...head} col="surplus" label="Above target" right />
                <SortHead {...head} col="incentive" label="Incentive" right />
                <SortHead {...head} col="kudos" label="Kudos" right title="Kudos points, a manager's extra points for the month" />
                <SortHead {...head} col="total" label="Total" right title="Incentive plus kudos" />
                <SortHead {...head} col="status" label="Status" />
              </tr>
            </thead>
            <tbody>
              {order.flatMap((i) => {
                const r = o[i];
                const pc = Math.min(100, Math.round(r.pctv * 100));
                const st = STATUS[r.status];
                const isOpen = open.has(i);

                const rows = [
                  <tr
                    key={r.name}
                    className={"clk" + (isOpen ? " open" : "")}
                    aria-expanded={isOpen}
                    tabIndex={0}
                    onClick={() => toggle(i)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i); }
                    }}
                  >
                    <td>
                      <span className="tw" aria-hidden="true">▸</span> {r.name}
                      {r.isReviewer && (
                        <span className="muted" style={{ fontSize: 11.5 }}> · reviewer</span>
                      )}
                    </td>
                    <td>{r.slab}</td>
                    <td className="r num">
                      {r.mins}
                      {r.projects > 0 && (
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {" · " + r.projects + (r.projects === 1 ? " project" : " projects")}
                        </span>
                      )}
                    </td>
                    <td className="r num">
                      {r.revised ? (
                        <>
                          {r.revised}
                          {r.rounds > r.revised && (
                            <span className="muted" style={{ fontSize: 11.5 }}>
                              {" / " + r.rounds + " rounds"}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="r num" style={r.deducted > 0.05 ? { color: "var(--rose)" } : undefined}>
                      {r.deducted > 0.05 ? "−" + num(r.deducted) : "—"}
                    </td>
                    <td className="r num">
                      {r.reviewed ? (
                        <>
                          {r.reviewed}
                          <span className="muted" style={{ fontSize: 11.5 }}>
                            {" / " + num(r.reviewPts) + " pts"}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="r num"><strong>{num(r.pts)}</strong></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={r.away}
                        style={{ width: "auto" }}
                        aria-label={"Away this month: " + r.name}
                        onChange={(ev) => setAway(r.name, ev.target.checked)}
                      />
                    </td>
                    <td className="r num" onClick={(e) => e.stopPropagation()}>
                      <NumInput
                        value={run.leave[r.name] || 0}
                        min="0"
                        step="0.5"
                        width={56}
                        onCommit={(v) => setLeave(r.name, Math.max(0, v))}
                      />
                      {run.leave[r.name] > 0 && (
                        <span className="muted" style={{ fontSize: 11.5 }}>{" → " + r.days + " d"}</span>
                      )}
                    </td>
                    <td className="r num">{r.target}</td>
                    <td>
                      <div className="bar">
                        <i className={r.surplus > 0 ? "" : "under"} style={{ width: pc + "%" }} />
                      </div>
                    </td>
                    <td className="r num">{r.surplus > 0 ? Math.round(r.surplus) : "—"}</td>
                    <td className="r num">
                      {r.incentive > 0 ? (
                        <strong style={{ color: "var(--emerald)" }}>{inr(r.incentive)}</strong>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="r num" onClick={(e) => e.stopPropagation()}>
                      <NumInput
                        value={r.kudos}
                        min="0"
                        step="0.5"
                        width={60}
                        onCommit={(v) => setKudos(r.name, Math.max(0, v))}
                      />
                      {r.kudosInr > 0 && (
                        <span className="muted" style={{ fontSize: 11.5 }}>{" " + inr(r.kudosInr)}</span>
                      )}
                    </td>
                    <td className="r num">
                      {r.total > 0 ? (
                        <strong style={{ color: "var(--emerald)" }}>{inr(r.total)}</strong>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={"pill " + st[0]}>{st[1]}</span>
                    </td>
                  </tr>,
                ];

                if (isOpen) {
                  rows.push(
                    <tr key={r.name + "-det"} className="det on">
                      <td colSpan={16}>
                        <div className="detbox">
                          <div className="detmain">
                            <Breakdown cats={catsOf(config, r)} />
                          </div>
                          <PaySplit config={config} r={r} />
                        </div>
                      </td>
                    </tr>
                  );
                }

                return rows;
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="r num">{round(t.m, 0)}</td>
                <td className="r num">{o.reduce((a, r) => a + r.revised, 0) || "—"}</td>
                <td className="r num">{t.d > 0.05 ? "−" + num(t.d) : "—"}</td>
                <td className="r num">{t.rp > 0.05 ? num(t.rp) : "—"}</td>
                <td className="r num">{num(t.p)}</td>
                <td />
                <td />
                <td className="r num">{num(t.t)}</td>
                <td />
                <td className="r num">{Math.round(t.s)}</td>
                <td className="r num">{inr(t.i)}</td>
                <td className="r num">{t.kp > 0 ? num(t.kp) : "—"}</td>
                <td className="r num">{inr(t.i + t.k)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}

/**
 * How the ladder arrived at this editor's money. The single rupee figure in
 * the row stops being self-evident once points above target are paid in rungs,
 * so the rungs that actually paid are spelled out underneath.
 */
function PaySplit({ config, r }: { config: Config; r: EditorResult }) {
  const surplus = r.surplus;
  const parts = surplus > 0 ? payParts(config, surplus).filter((p) => p.pts > 0) : [];
  if (!parts.length && r.kudos <= 0) return null;
  const total = parts.reduce((a, p) => a + p.amount, 0);
  return (
    <div className="detpay">
      <h4>How the incentive is made</h4>
      <table>
        <tbody>
          {parts.map((p) => (
            <tr key={p.from}>
              <td className="muted">
                {p.to === null ? "+" + p.from + " and above" : "+" + p.from + " to +" + p.to}
              </td>
              <td className="r num">
                {round(p.pts, 1)}
                <span className="unit">pts</span>
              </td>
              <td className="r num muted">× ₹{p.rate}</td>
              <td className="r num">{inr(p.amount)}</td>
            </tr>
          ))}
          {r.kudos > 0 && (
            <tr>
              <td className="muted">Kudos</td>
              <td className="r num">
                {round(r.kudos, 1)}
                <span className="unit">pts</span>
              </td>
              <td className="r num muted">× ₹{kudosRateOf(config)}</td>
              <td className="r num">{inr(r.kudosInr)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              {surplus > 0 ? round(surplus, 1) + " points above target" : "No points above target"}
              {r.kudos > 0 ? " · " + round(r.kudos, 1) + " kudos" : ""}
            </td>
            <td className="r num pos">{inr(total + r.kudosInr)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Kpi({ b, s, cls }: { b: string; s: string; cls?: string }) {
  return (
    <div className={"kpi " + (cls || "")}>
      <b>{b}</b>
      <span>{s}</span>
    </div>
  );
}
