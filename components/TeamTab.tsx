"use client";

import { daysOf, patternOf, targetOf } from "@/lib/calc";
import { exportTeam } from "@/lib/export";
import { Config, Slab, SLABS } from "@/lib/types";
import EditCard from "./EditCard";
import NumInput from "./NumInput";

export default function TeamTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  /* Marks the rows the save will refuse, so the message in the banner has
     something to point at. */
  const clashing = new Set<string>();
  const seen = new Set<string>();
  for (const e of config.team) {
    const k = e.name.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) clashing.add(k);
    seen.add(k);
  }

  function removeEditor(i: number) {
    const e = config.team[i];
    const aliases = e.alias.length
      ? ` The ${e.alias.length} report name${e.alias.length > 1 ? "s" : ""} linked to them go too.`
      : "";
    if (
      !confirm(
        `Remove ${e.name || "this editor"} from the team?${aliases} Reports that list them will ` +
          `flag those minutes as unmatched until they are added back. Saved runs are unaffected.`
      )
    )
      return;
    update((d) => { d.team.splice(i, 1); });
  }

  return (
    <section className="panel on narrow">
      <h2>Team</h2>
      <p className="sub">
        Slab sets the points rate. Work pattern sets the monthly target. Reduce days available for
        approved leave, joiners and leavers. Mark someone a reviewer when they review rather than
        edit, and give them a target of their own — an editing target is not one they can clear.
        Changes here are shared with everyone.
      </p>

      <EditCard
        meta={
          <>
            <button className="btn o" onClick={() => exportTeam(config)}>
              Export team list
            </button>
            <span className="muted">{config.team.length} editors</span>
          </>
        }
        tools={
          <button
            className="btn o"
            onClick={() =>
              update((d) => {
                let n = "New editor";
                let k = 2;
                while (d.team.some((e) => e.name.trim().toLowerCase() === n.toLowerCase()))
                  n = "New editor " + k++;
                d.team.push({
                  name: n,
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
        }
      >
        {(editing) => (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Editor</th>
                  <th style={{ width: 120 }}>Slab</th>
                  <th style={{ width: 150 }}>Work pattern</th>
                  <th style={{ width: 90 }} title="Reviews work rather than editing it">
                    Reviews
                  </th>
                  <th className="r" style={{ width: 110 }}>Days available</th>
                  <th className="r" style={{ width: 100 }}>Target</th>
                  {editing && <th style={{ width: 40 }} />}
                </tr>
              </thead>
              <tbody>
                {config.team.map((e, i) => (
                  <tr key={i}>
                    <td>
                      {editing ? (
                        <input
                          value={e.name}
                          aria-invalid={
                            !e.name.trim() || clashing.has(e.name.trim().toLowerCase())
                          }
                          onChange={(ev) => update((d) => { d.team[i].name = ev.target.value; })}
                        />
                      ) : (
                        <>
                          {e.name || <span className="muted">—</span>}
                          {e.alias.length > 0 && (
                            <span className="muted" style={{ fontSize: 12 }}>
                              {" · also " + e.alias.join(", ")}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          value={e.slab}
                          onChange={(ev) =>
                            update((d) => { d.team[i].slab = ev.target.value as Slab; })
                          }
                        >
                          {SLABS.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        e.slab
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          value={e.pattern}
                          onChange={(ev) =>
                            update((d) => { d.team[i].pattern = ev.target.value; })
                          }
                        >
                          {config.patterns.map((p) => (
                            <option key={p.name}>{p.name}</option>
                          ))}
                        </select>
                      ) : (
                        e.pattern || <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          type="checkbox"
                          checked={!!e.reviewer}
                          style={{ width: "auto" }}
                          aria-label={"Reviews rather than edits: " + e.name}
                          onChange={(ev) =>
                            update((d) => { d.team[i].reviewer = ev.target.checked; })
                          }
                        />
                      ) : e.reviewer ? (
                        <span className="pill n">Reviewer</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className={editing ? "" : "r num"}>
                      {editing ? (
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
                      ) : (
                        daysOf(config, e)
                      )}
                    </td>
                    <td className={editing ? "" : "r num"}>
                      {editing ? (
                        <NumInput
                          step="10"
                          min="0"
                          value={targetOf(config, e)}
                          onCommit={(v) =>
                            update((d) => {
                              /* Typing the pattern's own number back means
                                 "follow the pattern", not "pin it here". */
                              const p = patternOf(d, d.team[i].pattern);
                              const fromPattern = p && p.days
                                ? Math.round((p.target * daysOf(d, d.team[i])) / p.days)
                                : 0;
                              d.team[i].target = Math.abs(v - fromPattern) < 0.5 ? null : v;
                            })
                          }
                        />
                      ) : (
                        <>
                          {targetOf(config, e)}
                          {e.target != null && (
                            <span className="muted" style={{ fontSize: 11 }}> · set</span>
                          )}
                        </>
                      )}
                    </td>
                    {editing && (
                      <td>
                        <button
                          className="x"
                          aria-label={"Remove " + e.name}
                          onClick={() => removeEditor(i)}
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
    </section>
  );
}
