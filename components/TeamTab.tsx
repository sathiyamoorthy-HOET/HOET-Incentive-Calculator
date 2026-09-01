"use client";

import { daysOf, patternOf, targetOf } from "@/lib/calc";
import { exportTeam } from "@/lib/export";
import { Config, Slab, SLABS } from "@/lib/types";
import NumInput from "./NumInput";

export default function TeamTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  return (
    <section className="panel on">
      <h2>Team</h2>
      <p className="sub">
        Slab sets the points rate. Work pattern sets the monthly target. Reduce days available for
        approved leave, joiners and leavers. Changes here are shared with everyone.
      </p>
      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className="btn"
            onClick={() =>
              update((d) => {
                d.team.push({
                  name: "New editor",
                  slab: "D",
                  pattern: d.patterns[0]?.name ?? "",
                  days: null,
                  alias: [],
                });
              })
            }
          >
            Add editor
          </button>
          <button className="btn o" onClick={() => exportTeam(config)}>
            Export team list
          </button>
          <span style={{ color: "var(--muted)", marginLeft: "auto" }}>
            {config.team.length} editors
          </span>
        </div>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Editor</th>
                <th style={{ width: 120 }}>Slab</th>
                <th style={{ width: 150 }}>Work pattern</th>
                <th className="r" style={{ width: 110 }}>Days available</th>
                <th className="r" style={{ width: 100 }}>Target</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {config.team.map((e, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={e.name}
                      onChange={(ev) => update((d) => { d.team[i].name = ev.target.value; })}
                    />
                  </td>
                  <td>
                    <select
                      value={e.slab}
                      onChange={(ev) => update((d) => { d.team[i].slab = ev.target.value as Slab; })}
                    >
                      {SLABS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={e.pattern}
                      onChange={(ev) => update((d) => { d.team[i].pattern = ev.target.value; })}
                    >
                      {config.patterns.map((p) => (
                        <option key={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumInput
                      step="0.5"
                      value={daysOf(config, e)}
                      onCommit={(v) =>
                        update((d) => {
                          const p = patternOf(d, d.team[i].pattern);
                          d.team[i].days = Math.abs(v - p.days) < 0.01 ? null : v;
                        })
                      }
                    />
                  </td>
                  <td className="r num">{targetOf(config, e)}</td>
                  <td>
                    <button
                      className="x"
                      aria-label={"Remove " + e.name}
                      onClick={() => update((d) => { d.team.splice(i, 1); })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
