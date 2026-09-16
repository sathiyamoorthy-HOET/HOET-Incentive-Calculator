"use client";

import { useState } from "react";
import { cats, rateFor } from "@/lib/calc";
import { Config, NOTPAY } from "@/lib/types";
import EditCard from "./EditCard";
import { Sort, SortHead, sorted, toggleSort } from "./SortHead";

type Col = "type" | "cat" | "rate";

/** The mappings in the order asked for, as positions in `config.map`. */
function orderOf(c: Config, sort: Sort<Col>): number[] {
  const value = (i: number, col: Col) => {
    const [type, cat] = c.map[i];
    if (col === "type") return type;
    if (col === "cat") return cat === NOTPAY ? "" : cat;
    return cat === NOTPAY ? 0 : rateFor(c, cat, "A");
  };
  return sorted(c.map.map((_, i) => i), sort, value, (i) => c.map[i][0].trim());
}

export default function MapTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  const [sort, setSort] = useState<Sort<Col>>(null);

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
            onClick={() => {
              /* At the top, where the eye is, in the saved order so that is
                 where it shows — sorted, a blank row would land at the foot. */
              setSort(null);
              update((d) => {
                d.map.unshift(["", d.rates[0] ? d.rates[0].cat : NOTPAY]);
              });
            }}
          >
            Add type
          </button>
        }
      >
        {(editing) => (
          <MapTable
            config={config}
            update={update}
            editing={editing}
            sort={sort}
            onSort={setSort}
            removeMapping={removeMapping}
          />
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

function MapTable({
  config,
  update,
  editing,
  sort,
  onSort,
  removeMapping,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
  editing: boolean;
  sort: Sort<Col>;
  onSort: (s: Sort<Col>) => void;
  removeMapping: (i: number) => void;
}) {
  const options = cats(config);
  const rows = config.map;

  /* While the card is open the order is held still, so a row sorted by type
     does not slide away from under the cursor as the type is typed. It is
     re-read when Edit is pressed, the sort changes, or a row comes or goes. */
  const holdKey = editing ? (sort ? sort.col + sort.dir : "own") + "|" + rows.length : null;
  const [held, setHeld] = useState<{ key: string; order: number[] } | null>(null);
  if (holdKey && held?.key !== holdKey) setHeld({ key: holdKey, order: orderOf(config, sort) });
  const order = holdKey && held?.key === holdKey ? held.order : orderOf(config, sort);

  const head = { sort, onToggle: (col: Col) => onSort(toggleSort(sort, col)) };

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <SortHead {...head} col="type" label="Type as recorded" width="38%" />
            <SortHead {...head} col="cat" label="Payable category" />
            <SortHead {...head} col="rate" label="Points/min (A)" width={110} right />
            {editing && <th style={{ width: 40 }} />}
          </tr>
        </thead>
        <tbody>
          {order.map((i) => {
            const m = rows[i];
            return (
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
