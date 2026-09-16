"use client";

import { useState } from "react";
import { daysOf, patternOf, targetOf } from "@/lib/calc";
import { exportTeam } from "@/lib/export";
import { Config, Slab, SLABS } from "@/lib/types";
import EditCard from "./EditCard";
import NumInput from "./NumInput";

type SortCol = "name" | "email" | "slab" | "pattern" | "reviews" | "days" | "target";
/** Which column the table is sorted on and which way. null is the saved team order. */
type Sort = { col: SortCol; dir: "asc" | "desc" } | null;

const byText = (a: string, b: string) => {
  /* Blank cells sit at the foot whichever way the column is sorted. */
  const ea = !a.trim(), eb = !b.trim();
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" });
};

/**
 * The team in the order asked for, as positions in `config.team`. Rows are
 * addressed by that position rather than moved, so an edit under any sort
 * still lands on the right editor and the saved order is never touched.
 */
function orderOf(c: Config, sort: Sort): number[] {
  const idx = c.team.map((_, i) => i);
  if (!sort) return idx;
  const t = c.team;
  const cmp: Record<SortCol, (i: number, j: number) => number> = {
    name: (i, j) => byText(t[i].name, t[j].name),
    email: (i, j) => byText(t[i].email ?? "", t[j].email ?? ""),
    slab: (i, j) => SLABS.indexOf(t[i].slab) - SLABS.indexOf(t[j].slab),
    pattern: (i, j) => byText(t[i].pattern, t[j].pattern),
    reviews: (i, j) => Number(!!t[i].reviewer) - Number(!!t[j].reviewer),
    days: (i, j) => daysOf(c, t[i]) - daysOf(c, t[j]),
    target: (i, j) => targetOf(c, t[i]) - targetOf(c, t[j]),
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  const by = cmp[sort.col];
  /* Ties fall back to the name, always A to Z, so a column of equal values
     — every slab B, say — still reads as a list rather than a shuffle. */
  return idx.sort((i, j) => sign * by(i, j) || byText(t[i].name, t[j].name));
}

type HeadProps = {
  col: SortCol;
  label: string;
  width?: number;
  right?: boolean;
  title?: string;
  sort: Sort;
  onToggle: (col: SortCol) => void;
};

/** A column header that sorts the table when clicked, and says which way. */
function SortHead({ col, label, width, right, title, sort, onToggle }: HeadProps) {
  const on = sort?.col === col;
  return (
    <th
      className={right ? "r" : undefined}
      style={width ? { width } : undefined}
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={"sorth" + (on ? " on" : "")}
        onClick={() => onToggle(col)}
        title={title ?? "Sort by " + label.toLowerCase()}
      >
        {label}
        <span className="arrow" aria-hidden="true">
          {on ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    </th>
  );
}

export default function TeamTab({
  config,
  update,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
}) {
  const [sort, setSort] = useState<Sort>(null);

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

  function addEditor() {
    /* The new row goes in at the top, where the eye already is, and the sort
       drops back to team order so that is where it appears — under any other
       sort "New editor" would land somewhere in the middle of the list. */
    setSort(null);
    update((d) => {
      let n = "New editor";
      let k = 2;
      while (d.team.some((e) => e.name.trim().toLowerCase() === n.toLowerCase()))
        n = "New editor " + k++;
      d.team.unshift({
        name: n,
        slab: "D",
        pattern: d.patterns[0]?.name ?? "",
        days: null,
        alias: [],
        email: "",
      });
    });
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
          <button className="btn o" onClick={addEditor}>
            Add editor
          </button>
        }
      >
        {(editing) => (
          <TeamTable
            config={config}
            update={update}
            editing={editing}
            sort={sort}
            onSort={setSort}
            clashing={clashing}
            removeEditor={removeEditor}
          />
        )}
      </EditCard>
    </section>
  );
}

function TeamTable({
  config,
  update,
  editing,
  sort,
  onSort,
  clashing,
  removeEditor,
}: {
  config: Config;
  update: (fn: (draft: Config) => void) => void;
  editing: boolean;
  sort: Sort;
  onSort: (s: Sort) => void;
  clashing: Set<string>;
  removeEditor: (i: number) => void;
}) {
  const team = config.team;

  /* While the card is open the order is held still: sorted by name, a row
     would otherwise slide away from under the cursor with every letter typed
     into it. The order is re-read when Edit is pressed, when the sort changes,
     and when a row is added or removed — never on a keystroke. */
  const holdKey = editing ? (sort ? sort.col + sort.dir : "team") + "|" + team.length : null;
  const [held, setHeld] = useState<{ key: string; order: number[] } | null>(null);
  if (holdKey && held?.key !== holdKey) setHeld({ key: holdKey, order: orderOf(config, sort) });

  const order = holdKey && held?.key === holdKey ? held.order : orderOf(config, sort);

  /* A header is clicked the way a spreadsheet column is: once for ascending,
     again for descending, a third time to go back to the saved team order. */
  function toggle(col: SortCol) {
    if (!sort || sort.col !== col) onSort({ col, dir: "asc" });
    else if (sort.dir === "asc") onSort({ col, dir: "desc" });
    else onSort(null);
  }

  const head = { sort, onToggle: toggle };

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <SortHead {...head} col="name" label="Editor" />
            <SortHead {...head} col="email" label="Mail ID" width={230} />
            <SortHead {...head} col="slab" label="Slab" width={90} />
            <SortHead {...head} col="pattern" label="Work pattern" width={130} />
            <SortHead
              {...head}
              col="reviews"
              label="Reviews"
              width={90}
              title="Reviews work rather than editing it"
            />
            <SortHead {...head} col="days" label="Days available" width={100} right />
            <SortHead {...head} col="target" label="Target" width={90} right />
            {editing && <th style={{ width: 40 }} />}
          </tr>
        </thead>
        <tbody>
          {order.map((i) => {
            const e = team[i];
            return (
              <tr key={i}>
                <td>
                  {editing ? (
                    <input
                      value={e.name}
                      aria-invalid={!e.name.trim() || clashing.has(e.name.trim().toLowerCase())}
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
                    <input
                      type="email"
                      value={e.email ?? ""}
                      placeholder="name@houseofedtech.in"
                      aria-label={"Mail ID: " + e.name}
                      onChange={(ev) => update((d) => { d.team[i].email = ev.target.value; })}
                    />
                  ) : e.email?.trim() ? (
                    <a className="mail" href={"mailto:" + e.email.trim()}>{e.email.trim()}</a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {editing ? (
                    <select
                      value={e.slab}
                      onChange={(ev) => update((d) => { d.team[i].slab = ev.target.value as Slab; })}
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
                      onChange={(ev) => update((d) => { d.team[i].pattern = ev.target.value; })}
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
                      onChange={(ev) => update((d) => { d.team[i].reviewer = ev.target.checked; })}
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
                    <button className="x" aria-label={"Remove " + e.name} onClick={() => removeEditor(i)}>
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
