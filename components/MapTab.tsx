"use client";

import { cats, rateFor } from "@/lib/calc";
import { Config, NOTPAY } from "@/lib/types";

export default function MapTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  const options = cats(config);

  return (
    <section className="panel on">
      <h2>Video types</h2>
      <p className="sub">
        Each type recorded in the report maps to one payable category. New types can be added here
        without changing the rate card. Anything left unmapped scores nothing and is flagged after
        every run.
      </p>

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className="btn"
            onClick={() =>
              update((d) => {
                d.map.push(["", d.rates[0] ? d.rates[0].cat : NOTPAY]);
              })
            }
          >
            Add type
          </button>
          <span style={{ color: "var(--muted)", marginLeft: "auto" }}>
            {config.map.length} types mapped
          </span>
        </div>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: "38%" }}>Type as recorded</th>
                <th>Payable category</th>
                <th className="r" style={{ width: 110 }}>Points/min (A)</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {config.map.map((m, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={m[0]}
                      onChange={(ev) => update((d) => { d.map[i][0] = ev.target.value; })}
                    />
                  </td>
                  <td>
                    <select
                      value={m[1]}
                      onChange={(ev) => update((d) => { d.map[i][1] = ev.target.value; })}
                    >
                      {options.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="r num">
                    {m[1] === NOTPAY ? (
                      <span className="pill n">0</span>
                    ) : (
                      rateFor(config, m[1], "A")
                    )}
                  </td>
                  <td>
                    <button
                      className="x"
                      aria-label="Remove type"
                      onClick={() => update((d) => { d.map.splice(i, 1); })}
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

      {config.ignore.length > 0 && (
        <div className="card">
          <h3>Ignored names</h3>
          <p className="sub" style={{ marginBottom: 12 }}>
            Names in the report that are not editors. Their minutes are skipped without being
            flagged.
          </p>
          <div className="row">
            {config.ignore.map((n) => (
              <span key={n} className="pill n" style={{ padding: "4px 6px 4px 10px" }}>
                {n}
                <button
                  className="x"
                  aria-label={"Stop ignoring " + n}
                  onClick={() =>
                    update((d) => {
                      d.ignore = d.ignore.filter((x) => x !== n);
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
