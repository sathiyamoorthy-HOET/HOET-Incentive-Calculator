"use client";

import { round, upliftOf } from "@/lib/calc";
import { Config, NOTPAY } from "@/lib/types";
import EditCard from "./EditCard";
import NumInput from "./NumInput";

export default function RatesTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  /* Dropping a category is the one change here that cannot be typed back in:
     the report's video types that pointed at it become unpayable. Always ask,
     and say how many of them there are. */
  function removeCategory(i: number) {
    const cat = config.rates[i].cat;
    const used = config.map.filter((m) => m[1] === cat).length;
    const consequence = used
      ? ` ${used} video type${used > 1 ? "s" : ""} mapped to it will move to Not payable, and minutes recorded under ${used > 1 ? "them" : "it"} will stop scoring.`
      : " Nothing is mapped to it.";
    if (!confirm(`Remove "${cat}" from the rate card?${consequence}`)) return;
    update((d) => {
      d.map.forEach((m) => { if (m[1] === cat) m[1] = NOTPAY; });
      d.rates.splice(i, 1);
    });
  }

  const ladder = config.revPen ?? [];
  const bands = config.payBands ?? [];

  return (
    <section className="panel on">
      <h2>Rate card</h2>
      <p className="sub">
        Base rate is what a slab A editor earns per minute. The uplift is the allowance less
        experienced editors receive while they learn.
      </p>

      <div className="split">
        <div className="stack">
          <EditCard
            confirm
            title="Points per minute"
            hint="Rename a category here and the mapping follows it. Review is what reviewing a minute of this kind of video pays, whoever does it — the reviewer is the manager of the project, and reviewing your own edit earns nothing."
            tools={
              <button
                className="btn o"
                onClick={() =>
                  update((d) => {
                    let n = "New video category";
                    let k = 2;
                    while (d.rates.some((r) => r.cat === n)) n = "New video category " + k++;
                    d.rates.push({ cat: n, r: [5, 5.5, 5.75, 6], review: 0 });
                  })
                }
              >
                Add video category
              </button>
            }
          >
            {(editing) => (
              <div className="scroll">
                <table className="tight">
                  <thead>
                    <tr>
                      <th>Video category</th>
                      <th className="r" style={{ width: 62 }}>A rate</th>
                      <th className="r" style={{ width: 52 }}>B +%</th>
                      <th className="r" style={{ width: 52 }}>C +%</th>
                      <th className="r" style={{ width: 52 }}>D +%</th>
                      <th className="r" style={{ width: 46 }}>B</th>
                      <th className="r" style={{ width: 46 }}>C</th>
                      <th className="r" style={{ width: 46 }}>D</th>
                      <th className="r" style={{ width: 56 }} title="Points per minute for reviewing this kind of video">
                        Review
                      </th>
                      {editing && <th style={{ width: 28 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {config.rates.map((r, i) => (
                      <tr key={i}>
                        <td>
                          {editing ? (
                            <input
                              key={r.cat}
                              defaultValue={r.cat}
                              onBlur={(ev) => {
                                const nu = ev.target.value.trim();
                                const old = r.cat;
                                if (nu === old) return;
                                if (!nu || config.rates.some((x, j) => j !== i && x.cat === nu)) {
                                  ev.target.value = old;
                                  return;
                                }
                                update((d) => {
                                  d.rates[i].cat = nu;
                                  d.map.forEach((m) => { if (m[1] === old) m[1] = nu; });
                                });
                              }}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                              }}
                            />
                          ) : (
                            r.cat
                          )}
                        </td>

                        <td className={editing ? "" : "r num"}>
                          {editing ? (
                            <NumInput
                              value={r.r[0]}
                              step="0.1"
                              min="0"
                              onCommit={(v) =>
                                update((d) => {
                                  const nv = Math.max(0, v);
                                  const f = d.rates[i].r[0] ? nv / d.rates[i].r[0] : 0;
                                  d.rates[i].r = d.rates[i].r.map((x, j) =>
                                    j === 0 ? nv : round(x * f, 4)
                                  );
                                })
                              }
                            />
                          ) : (
                            round(r.r[0], 2)
                          )}
                        </td>
                        {[1, 2, 3].map((s) => (
                          <td key={s} className={editing ? "" : "r num"}>
                            {editing ? (
                              <NumInput
                                value={Math.round(upliftOf(r, s) * 100)}
                                step="1"
                                onCommit={(v) =>
                                  update((d) => {
                                    d.rates[i].r[s] = round(d.rates[i].r[0] * (1 + v / 100), 4);
                                  })
                                }
                              />
                            ) : (
                              Math.round(upliftOf(r, s) * 100) + "%"
                            )}
                          </td>
                        ))}
                        {[1, 2, 3].map((s) => (
                          <td key={"v" + s} className="r num" style={{ color: "var(--muted)" }}>
                            {round(r.r[s], 2)}
                          </td>
                        ))}

                        <td className={editing ? "" : "r num"}>
                          {editing ? (
                            <NumInput
                              value={r.review ?? 0}
                              step="0.5"
                              min="0"
                              onCommit={(v) =>
                                update((d) => { d.rates[i].review = Math.max(0, v); })
                              }
                            />
                          ) : (
                            round(r.review ?? 0, 2)
                          )}
                        </td>

                        {editing && (
                          <td>
                            <button
                              className="x"
                              aria-label={"Remove " + r.cat}
                              onClick={() => removeCategory(i)}
                            >
                              ×
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EditCard>
          <EditCard
            confirm
            title="Revisions"
            hint={
              "A deliverable's version says how many times it came back: version 1 is a first-pass " +
              "approval, 2 is one revision, 3 is two. The deduction is read by round, not added up — " +
              "three rounds costs the third rung, and more rounds than the ladder has costs the last one."
            }
            tools={
              <>
                <button
                  className="btn o"
                  onClick={() =>
                    update((d) => {
                      d.revPen = d.revPen ?? [];
                      d.revPen.push(d.revPen[d.revPen.length - 1] ?? 5);
                    })
                  }
                >
                  Add a round
                </button>
                {ladder.length > 1 && (
                  <button className="btn o" onClick={() => update((d) => { d.revPen?.pop(); })}>
                    Remove the last
                  </button>
                )}
              </>
            }
          >
            {(editing) => (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Rounds of revision</th>
                      <th className="r" style={{ width: 150 }}>Deducted</th>
                      <th>What that means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ladder.map((pct, i) => (
                      <tr key={i}>
                        <td>
                          {i + 1} revision{i ? "s" : ""}
                          <span className="muted" style={{ fontSize: 12 }}>
                            {" · version " + (i + 2)}
                          </span>
                        </td>
                        <td className={editing ? "" : "r num"}>
                          {editing ? (
                            <NumInput
                              value={pct}
                              step="1"
                              min="0"
                              onCommit={(v) =>
                                update((d) => { d.revPen[i] = Math.min(100, Math.max(0, v)); })
                              }
                            />
                          ) : (
                            pct + "%"
                          )}
                        </td>
                        <td className="muted" style={{ fontSize: 12.5 }}>
                          {i === ladder.length - 1
                            ? `${i + 1} or more rounds cost ${pct}% of that video's points`
                            : `${pct}% off that video's points`}
                        </td>
                      </tr>
                    ))}
                    {ladder.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">
                          No ladder set, so revisions cost nothing.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </EditCard>
        </div>

        <aside className="stack">
          <EditCard confirm title="Work patterns">
            {(editing) => (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Pattern</th>
                      <th className="r" style={{ width: 120 }}>Standard days</th>
                      <th className="r" style={{ width: 120 }}>Target points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.patterns.map((p, i) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className={editing ? "" : "r num"}>
                          {editing ? (
                            <NumInput
                              value={p.days}
                              step="0.1"
                              onCommit={(v) => update((d) => { d.patterns[i].days = v; })}
                            />
                          ) : (
                            p.days
                          )}
                        </td>
                        <td className={editing ? "" : "r num"}>
                          {editing ? (
                            <NumInput
                              value={p.target}
                              step="10"
                              onCommit={(v) => update((d) => { d.patterns[i].target = v; })}
                            />
                          ) : (
                            p.target
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EditCard>
          <EditCard
            confirm
            title="Target and payout"
            hint={
              "Points above target are paid in rungs, and a rung pays only for the points inside " +
              "it: 70 points clear of target earns the first 60 at the first rate and the last 10 " +
              "at the second. Rungs are counted from the editor's own target, so the same ladder " +
              "serves every work pattern."
            }
            tools={
              <>
                <button
                  className="btn o"
                  onClick={() =>
                    update((d) => {
                      d.payBands = d.payBands ?? [];
                      const last = d.payBands[d.payBands.length - 1];
                      d.payBands.push(
                        last ? { from: last.from + 60, rate: last.rate + 25 } : { from: 0, rate: 175 }
                      );
                    })
                  }
                >
                  Add a rung
                </button>
                {bands.length > 1 && (
                  <button className="btn o" onClick={() => update((d) => { d.payBands?.pop(); })}>
                    Remove the last
                  </button>
                )}
              </>
            }
          >
            {(editing) => (
              <>
                <div className="row" style={{ gap: 26, alignItems: "flex-end", marginBottom: 14 }}>
                  <div>
                    <label className="fld" htmlFor="ppd">Points per working day</label>
                    {editing ? (
                      <NumInput
                        className="fld-in"
                        value={config.ppd}
                        step="0.5"
                        onCommit={(v) => update((d) => { d.ppd = v || 30; })}
                      />
                    ) : (
                      <div className="val">{config.ppd}</div>
                    )}
                  </div>
                  <div>
                    <label className="fld" htmlFor="pip">Months below target before a PIP</label>
                    {editing ? (
                      <NumInput
                        className="fld-in"
                        value={config.pipMonths ?? 3}
                        step="1"
                        min="0"
                        onCommit={(v) => update((d) => { d.pipMonths = Math.max(0, Math.round(v)); })}
                      />
                    ) : (
                      <div className="val">{config.pipMonths ?? 3}</div>
                    )}
                  </div>
                </div>

                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>Points above target</th>
                        <th className="r" style={{ width: 130 }}>Per point</th>
                        <th>What that is, in points scored</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bands.map((b, i) => {
                        const to = i + 1 < bands.length ? bands[i + 1].from : null;
                        return (
                          <tr key={i}>
                            <td className={editing ? "" : "num"}>
                              {editing ? (
                                <NumInput
                                  value={b.from}
                                  step="10"
                                  min="0"
                                  onCommit={(v) =>
                                    update((d) => { d.payBands[i].from = Math.max(0, Math.round(v)); })
                                  }
                                />
                              ) : to === null ? (
                                "+" + b.from + " and above"
                              ) : (
                                "+" + b.from + " to +" + to
                              )}
                            </td>
                            <td className={editing ? "" : "r num"}>
                              {editing ? (
                                <NumInput
                                  value={b.rate}
                                  step="5"
                                  min="0"
                                  onCommit={(v) =>
                                    update((d) => { d.payBands[i].rate = Math.max(0, v); })
                                  }
                                />
                              ) : (
                                "₹" + b.rate
                              )}
                            </td>
                            <td className="muted" style={{ fontSize: 12.5 }}>
                              {config.patterns
                                .map(
                                  (p) =>
                                    p.name + " " +
                                    (to === null
                                      ? Math.round(p.target + b.from) + "+"
                                      : Math.round(p.target + b.from) + "–" + Math.round(p.target + to))
                                )
                                .join(" · ")}
                            </td>
                          </tr>
                        );
                      })}
                      {bands.length === 0 && (
                        <tr>
                          <td colSpan={3} className="muted">
                            No ladder set, so clearing target pays nothing.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
                  <strong>Performance improvement plan.</strong>{" "}
                  {(config.pipMonths ?? 3) > 0
                    ? "An editor who misses the basic target " +
                      (config.pipMonths ?? 3) +
                      " months running goes on a PIP training. The count is of consecutive months " +
                      "below target, whatever the shortfall; a single month at or above target " +
                      "starts it again."
                    : "No PIP threshold is set, so missing target does not trigger one."}
                </p>
              </>
            )}
          </EditCard>
        </aside>
      </div>
    </section>
  );
}
