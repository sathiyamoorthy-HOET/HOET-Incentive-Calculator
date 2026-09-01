"use client";

import { rateFor, round, upliftOf } from "@/lib/calc";
import { Config, NOTPAY, SLABS } from "@/lib/types";
import NumInput from "./NumInput";

export default function RatesTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  const up = config.mode !== "direct";

  return (
    <section className="panel on">
      <h2>Rate card</h2>
      <p className="sub">
        Base rate is what a slab A editor earns per minute. The uplift is the allowance less
        experienced editors receive while they learn.
      </p>

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Points per minute</h3>
          <div className="seg" role="group" aria-label="How to set B, C and D rates">
            <button
              aria-pressed={up}
              onClick={() => update((d) => { d.mode = "uplift"; })}
            >
              From uplift %
            </button>
            <button
              aria-pressed={!up}
              onClick={() => update((d) => { d.mode = "direct"; })}
            >
              Enter each rate
            </button>
          </div>
          <button
            className="btn"
            style={{ marginLeft: "auto" }}
            onClick={() =>
              update((d) => {
                let n = "New video type";
                let k = 2;
                while (d.rates.some((r) => r.cat === n)) n = "New video type " + k++;
                d.rates.push({ cat: n, len: 10, r: [5, 5.5, 5.75, 6] });
              })
            }
          >
            Add video type
          </button>
        </div>

        <div className="scroll">
          <table>
            <thead>
              {up ? (
                <tr>
                  <th>Video type</th>
                  <th className="r" style={{ width: 78 }}>Length</th>
                  <th className="r" style={{ width: 84 }}>A rate</th>
                  <th className="r" style={{ width: 74 }}>B +%</th>
                  <th className="r" style={{ width: 74 }}>C +%</th>
                  <th className="r" style={{ width: 74 }}>D +%</th>
                  <th className="r" style={{ width: 62 }}>B</th>
                  <th className="r" style={{ width: 62 }}>C</th>
                  <th className="r" style={{ width: 62 }}>D</th>
                  <th style={{ width: 34 }} />
                </tr>
              ) : (
                <tr>
                  <th>Video type</th>
                  <th className="r" style={{ width: 78 }}>Length</th>
                  {SLABS.map((s) => (
                    <th key={s} className="r" style={{ width: 82 }}>{s} rate</th>
                  ))}
                  <th style={{ width: 34 }} />
                </tr>
              )}
            </thead>
            <tbody>
              {config.rates.map((r, i) => (
                <tr key={i}>
                  <td>
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
                  </td>
                  <td>
                    <NumInput
                      value={r.len}
                      step="1"
                      min="0"
                      onCommit={(v) => update((d) => { d.rates[i].len = Math.max(0, v); })}
                    />
                  </td>

                  {up ? (
                    <>
                      <td>
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
                      </td>
                      {[1, 2, 3].map((s) => (
                        <td key={s}>
                          <NumInput
                            value={Math.round(upliftOf(r, s) * 100)}
                            step="1"
                            onCommit={(v) =>
                              update((d) => {
                                d.rates[i].r[s] = round(d.rates[i].r[0] * (1 + v / 100), 4);
                              })
                            }
                          />
                        </td>
                      ))}
                      {[1, 2, 3].map((s) => (
                        <td key={"v" + s} className="r num" style={{ color: "var(--muted)" }}>
                          {round(r.r[s], 2)}
                        </td>
                      ))}
                    </>
                  ) : (
                    [0, 1, 2, 3].map((s) => (
                      <td key={s}>
                        <NumInput
                          value={round(r.r[s], 3)}
                          step="0.1"
                          min="0"
                          onCommit={(v) => update((d) => { d.rates[i].r[s] = Math.max(0, v); })}
                        />
                      </td>
                    ))
                  )}

                  <td>
                    <button
                      className="x"
                      aria-label="Remove video type"
                      onClick={() => {
                        const cat = config.rates[i].cat;
                        const used = config.map.filter((m) => m[1] === cat).length;
                        if (
                          used &&
                          !confirm(
                            used +
                              " video type" +
                              (used > 1 ? "s are" : " is") +
                              ' mapped to "' +
                              cat +
                              '". Removing it will move them to Not payable. Continue?'
                          )
                        )
                          return;
                        update((d) => {
                          d.map.forEach((m) => { if (m[1] === cat) m[1] = NOTPAY; });
                          d.rates.splice(i, 1);
                        });
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="sub" style={{ margin: "12px 0 0" }}>
          Rename a type here and the mapping follows it. Length is the size of one typical
          deliverable and is used only for the effort check below.
        </p>
      </div>

      <div className="g2">
        <div className="card">
          <h3>Target and payout</h3>
          <div className="row" style={{ gap: 18, alignItems: "flex-end" }}>
            <div>
              <label className="fld" htmlFor="ppd">Points per working day</label>
              <NumInput
                className="fld-in"
                value={config.ppd}
                step="0.5"
                onCommit={(v) => update((d) => { d.ppd = v || 30; })}
              />
            </div>
            <div>
              <label className="fld" htmlFor="rate">Incentive per point above target</label>
              <NumInput
                className="fld-in"
                value={config.rate}
                step="5"
                onCommit={(v) => update((d) => { d.rate = v || 0; })}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Work patterns</h3>
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
                    <td>
                      <NumInput
                        value={p.days}
                        step="0.1"
                        onCommit={(v) => update((d) => { d.patterns[i].days = v; })}
                      />
                    </td>
                    <td>
                      <NumInput
                        value={p.target}
                        step="10"
                        onCommit={(v) => update((d) => { d.patterns[i].target = v; })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Effort check</h3>
        <p className="sub" style={{ marginBottom: 12 }}>
          Each rate turned into working days per deliverable. Ask the managers whether these match
          reality. If one is wrong, change the base rate rather than the uplift.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Deliverable</th>
                {SLABS.map((s) => (
                  <th key={s} className="r">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.rates.map((r) => (
                <tr key={r.cat}>
                  <td>{r.cat} · {r.len} min</td>
                  {SLABS.map((s) => (
                    <td key={s} className="r num">
                      {round((rateFor(config, r.cat, s) * r.len) / (config.ppd || 30), 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
