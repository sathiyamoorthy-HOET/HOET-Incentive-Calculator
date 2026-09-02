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
  /* Dropping a type is the one change here that cannot be typed back in: the
     mapping rows that pointed at it become unpayable. Always ask, and say how
     many of them there are. */
  function removeType(i: number) {
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

  return (
    <section className="panel on narrow">
      <h2>Rate card</h2>
      <p className="sub">
        Base rate is what a slab A editor earns per minute. The uplift is the allowance less
        experienced editors receive while they learn.
      </p>

      <EditCard
        title="Points per minute"
        hint="Rename a type here and the mapping follows it."
        tools={
          <button
            className="btn o"
            onClick={() =>
              update((d) => {
                let n = "New video type";
                let k = 2;
                while (d.rates.some((r) => r.cat === n)) n = "New video type " + k++;
                d.rates.push({ cat: n, r: [5, 5.5, 5.75, 6] });
              })
            }
          >
            Add video type
          </button>
        }
      >
        {(editing) => (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Video type</th>
                  <th className="r" style={{ width: 84 }}>A rate</th>
                  <th className="r" style={{ width: 74 }}>B +%</th>
                  <th className="r" style={{ width: 74 }}>C +%</th>
                  <th className="r" style={{ width: 74 }}>D +%</th>
                  <th className="r" style={{ width: 62 }}>B</th>
                  <th className="r" style={{ width: 62 }}>C</th>
                  <th className="r" style={{ width: 62 }}>D</th>
                  {editing && <th style={{ width: 34 }} />}
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

                    {editing && (
                      <td>
                        <button
                          className="x"
                          aria-label={"Remove " + r.cat}
                          onClick={() => removeType(i)}
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

      <div className="g2">
        <EditCard title="Target and payout">
          {(editing) => (
            <div className="row" style={{ gap: 26, alignItems: "flex-end" }}>
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
                <label className="fld" htmlFor="rate">Incentive per point above target</label>
                {editing ? (
                  <NumInput
                    className="fld-in"
                    value={config.rate}
                    step="5"
                    onCommit={(v) => update((d) => { d.rate = v || 0; })}
                  />
                ) : (
                  <div className="val">₹{config.rate}</div>
                )}
              </div>
            </div>
          )}
        </EditCard>

        <EditCard title="Work patterns">
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
      </div>
    </section>
  );
}
