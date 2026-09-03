"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { cats, inr, num, payParts, rateFor, reviewRateFor, round, totals } from "@/lib/calc";
import { exportRun } from "@/lib/export";
import { ActiveRun, Computed, Config, NOTPAY, STATUS } from "@/lib/types";
import { saveRun } from "@/app/actions";

export default function ResultsTab({
  config,
  liveConfig,
  run,
  result,
  month,
  update,
  onRerunLive,
  onSaved,
  goRun,
}: {
  config: Config;
  liveConfig: Config;
  run: ActiveRun | null;
  result: Computed | null;
  month: string;
  update: (fn: (draft: Config) => void) => void;
  onRerunLive: () => void;
  onSaved: (id: number) => void;
  goRun: () => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
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
  const active = o.filter((r) => r.mins > 0.05);
  const cleared = o.filter((r) => r.surplus > 0);
  const blocked = o.filter((r) => r.status === "blocked");
  const affected = o.filter((r) => r.untyped > 0.05).sort((a, b) => b.untyped - a.untyped);
  const untypedTotal = round(result.untypedMins, 1);
  const readOnly = !!run.snapshot;
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
    });
    setSaving(false);
    if (res.ok) {
      onSaved(res.id);
      setSaveMsg({ ok: true, text: "Saved to History. Everyone on the team can see it." });
    } else {
      setSaveMsg({ ok: false, text: res.error });
    }
  }

  return (
    <section className="panel on">
      <h2>Results</h2>
      <p className="sub">Incentive is earned only on points above target.</p>

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
            {active.length} of {o.length} editors delivered work · {num(t.p)} points ·{" "}
            {inr(t.i)} payable
          </div>
        </div>
        <button className="btn g" style={{ marginLeft: "auto" }} onClick={() => exportRun(month, o, config)}>
          Download spreadsheet
        </button>
        {!readOnly && (
          <button className="btn o" onClick={doSave} disabled={saving}>
            {saving ? <span className="spin" /> : run.savedId ? "Save again" : "Save this run"}
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
        <div className="card" style={{ borderColor: "#F0CFCA" }}>
          <h3 style={{ color: "var(--red)" }}>Fix these before using the numbers</h3>

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
                  {untypedTotal} minutes were delivered with no video type recorded.
                </strong>{" "}
                Those minutes cannot be priced, so the editors below are scored lower than the work
                they actually did.{" "}
                {blocked.length > 0 && (
                  <span style={{ color: "var(--red)" }}>
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
        <Kpi b={num(t.t)} s={"Total target, " + o.length + " editors"} />
        <Kpi
          b={cleared.length + " of " + active.length}
          s="Cleared target, of those who delivered"
          cls={cleared.length ? "hi" : "warn"}
        />
        {t.rp > 0.05 && <Kpi b={num(t.rp)} s={"Review points, " + round(t.rm, 0) + " min reviewed"} />}
        {t.d > 0.05 && <Kpi b={"−" + num(t.d)} s="Points off for revisions" cls="warn" />}
        <Kpi b={inr(t.i)} s="Incentive payable" cls="hi" />
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Every editor</h3>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
            Click a row to see the breakdown by video type
          </span>
          <button className="btn o" style={{ marginLeft: "auto" }} onClick={() => exportRun(month, o, config)}>
            Download spreadsheet
          </button>
        </div>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Editor</th>
                <th>Slab</th>
                <th className="r">Minutes</th>
                <th className="r" title="Videos that came back, and the rounds they took">
                  Revisions
                </th>
                <th className="r">Deducted</th>
                <th className="r" title="Videos reviewed for other editors, and the points earned">
                  Reviewed
                </th>
                <th className="r">Points</th>
                <th className="r">Target</th>
                <th style={{ width: 80 }}>Progress</th>
                <th className="r">Above target</th>
                <th className="r">Incentive</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {o.flatMap((r, i) => {
                const pc = Math.min(100, Math.round(r.pctv * 100));
                const st = STATUS[r.status];
                const keys = Object.keys(r.byCat);
                const isOpen = open.has(i);

                const rows = [
                  <tr key={r.name} className="clk" onClick={() => toggle(i)}>
                    <td>
                      <span className="tw">{isOpen ? "▾" : "▸"}</span> {r.name}
                      {r.isReviewer && (
                        <span className="muted" style={{ fontSize: 11.5 }}> · reviewer</span>
                      )}
                    </td>
                    <td>{r.slab}</td>
                    <td className="r num">{r.mins}</td>
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
                    <td className="r num">{r.target}</td>
                    <td>
                      <div className="bar">
                        <i className={r.surplus > 0 ? "" : "under"} style={{ width: pc + "%" }} />
                      </div>
                    </td>
                    <td className="r num">{r.surplus > 0 ? Math.round(r.surplus) : "—"}</td>
                    <td className="r num">
                      {r.incentive > 0 ? (
                        <strong style={{ color: "var(--teal)" }}>{inr(r.incentive)}</strong>
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
                      <td colSpan={12}>
                        <div className="detbox">
                          {keys.length || r.untyped > 0.05 || r.reviewed ? (
                            <table style={{ width: "auto", minWidth: 460 }}>
                              <thead>
                                <tr>
                                  <th>Video type</th>
                                  <th className="r">Minutes</th>
                                  <th className="r">Rate</th>
                                  <th className="r">Deducted</th>
                                  <th className="r">Points</th>
                                </tr>
                              </thead>
                              <tbody>
                                {keys.map((c) => {
                                  const mn = round(r.byCat[c], 1);
                                  const rt = c === NOTPAY ? 0 : rateFor(config, c, r.slab);
                                  return (
                                    <tr key={c}>
                                      <td>{c}</td>
                                      <td className="r num">{mn}</td>
                                      <td className="r num">{rt ? rt : "—"}</td>
                                      <td
                                        className="r num"
                                        style={r.dedByCat[c] ? { color: "var(--rose)" } : undefined}
                                      >
                                        {r.dedByCat[c] ? "−" + round(r.dedByCat[c], 1) : "—"}
                                      </td>
                                      <td className="r num">
                                        {rt ? Math.round(mn * rt - (r.dedByCat[c] || 0)) : 0}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {Object.keys(r.revByCat).map((c) => {
                                  const mn = round(r.revByCat[c], 1);
                                  const rt = reviewRateFor(config, c);
                                  return (
                                    <tr key={"rev-" + c}>
                                      <td>
                                        {c}
                                        <span className="muted" style={{ fontSize: 11.5 }}>
                                          {" · reviewed for others"}
                                        </span>
                                      </td>
                                      <td className="r num">{mn}</td>
                                      <td className="r num">{rt || "—"}</td>
                                      <td className="r">—</td>
                                      <td className="r num">{Math.round(mn * rt)}</td>
                                    </tr>
                                  );
                                })}
                                {r.untyped > 0.05 && (
                                  <tr>
                                    <td style={{ color: "var(--red)" }}>No video type recorded</td>
                                    <td className="r num" style={{ color: "var(--rose)" }}>{r.untyped}</td>
                                    <td className="r">—</td>
                                    <td className="r">—</td>
                                    <td className="r num">0</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>
                              No work recorded against this editor in the report.
                            </span>
                          )}
                          <PaySplit config={config} surplus={r.surplus} />
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
                <td className="r num">{num(t.t)}</td>
                <td />
                <td className="r num">{Math.round(t.s)}</td>
                <td className="r num">{inr(t.i)}</td>
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
function PaySplit({ config, surplus }: { config: Config; surplus: number }) {
  if (surplus <= 0) return null;
  const parts = payParts(config, surplus).filter((p) => p.pts > 0);
  if (parts.length < 2) return null;
  const total = parts.reduce((a, p) => a + p.amount, 0);
  return (
    <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--muted)" }}>
      {round(surplus, 1)} points above target:{" "}
      {parts.map((p, i) => (
        <span key={p.from}>
          {i > 0 && " + "}
          {round(p.pts, 1)} &times; ₹{p.rate}
          <span style={{ fontSize: 11.5 }}>
            {" (" + (p.to === null ? "+" + p.from + " and above" : "+" + p.from + " to +" + p.to) + ")"}
          </span>
        </span>
      ))}
      {" = "}
      <strong style={{ color: "var(--teal)" }}>{inr(total)}</strong>
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
