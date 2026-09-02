"use client";

import { cats, rateFor } from "@/lib/calc";
import { Config, NOTPAY } from "@/lib/types";
import EditCard from "./EditCard";

export default function MapTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  const options = cats(config);

  function removeMapping(i: number) {
    const type = config.map[i][0];
    if (
      !confirm(
        `Stop recognising "${type || "this type"}"? Minutes recorded under it will be flagged ` +
          `as unmapped after every run until it is added back.`
      )
    )
      return;
    update((d) => { d.map.splice(i, 1); });
  }

  function stopIgnoring(n: string) {
    if (
      !confirm(
        `Stop ignoring "${n}"? Their minutes will be flagged as an unmatched name instead of ` +
          `being skipped quietly.`
      )
    )
      return;
    update((d) => { d.ignore = d.ignore.filter((x) => x !== n); });
  }

  return (
    <section className="panel on narrow">
      <h2>Video types</h2>
      <p className="sub">
        Each type recorded in the report maps to one payable category. New types can be added here
        without changing the rate card. Anything left unmapped scores nothing and is flagged after
        every run.
      </p>

      <EditCard
        meta={<span className="muted">{config.map.length} types mapped</span>}
        tools={
          <button
            className="btn o"
            onClick={() =>
              update((d) => {
                d.map.push(["", d.rates[0] ? d.rates[0].cat : NOTPAY]);
              })
            }
          >
            Add type
          </button>
        }
      >
        {(editing) => (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "38%" }}>Type as recorded</th>
                  <th>Payable category</th>
                  <th className="r" style={{ width: 110 }}>Points/min (A)</th>
                  {editing && <th style={{ width: 40 }} />}
                </tr>
              </thead>
              <tbody>
                {config.map.map((m, i) => (
                  <tr key={i}>
                    <td>
                      {editing ? (
                        <input
                          value={m[0]}
                          onChange={(ev) => update((d) => { d.map[i][0] = ev.target.value; })}
                        />
                      ) : (
                        m[0] || <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select
                          value={m[1]}
                          onChange={(ev) => update((d) => { d.map[i][1] = ev.target.value; })}
                        >
                          {options.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      ) : m[1] === NOTPAY ? (
                        <span className="muted">{NOTPAY}</span>
                      ) : (
                        m[1]
                      )}
                    </td>
                    <td className="r num">
                      {m[1] === NOTPAY ? <span className="pill n">0</span> : rateFor(config, m[1], "A")}
                    </td>
                    {editing && (
                      <td>
                        <button
                          className="x"
                          aria-label={"Remove " + (m[0] || "type")}
                          onClick={() => removeMapping(i)}
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

      {config.ignore.length > 0 && (
        <EditCard
          title="Ignored names"
          hint="Names in the report that are not editors. Their minutes are skipped without being flagged."
        >
          {(editing) => (
            <div className="row">
              {config.ignore.map((n) => (
                <span
                  key={n}
                  className="pill n"
                  style={editing ? { padding: "4px 6px 4px 10px" } : undefined}
                >
                  {n}
                  {editing && (
                    <button
                      className="x"
                      aria-label={"Stop ignoring " + n}
                      onClick={() => stopIgnoring(n)}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </EditCard>
      )}
    </section>
  );
}
