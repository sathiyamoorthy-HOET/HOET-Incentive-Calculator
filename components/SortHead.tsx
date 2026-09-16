"use client";

import type { CSSProperties, ReactNode } from "react";

/** Which column a table is sorted on and which way. null is the table's own order. */
export type Sort<C extends string> = { col: C; dir: "asc" | "desc" } | null;

export type SortValue = string | number | boolean | null | undefined;

/** The state after a click on `col`: ascending, then descending, then off. */
export function toggleSort<C extends string>(sort: Sort<C>, col: C): Sort<C> {
  if (!sort || sort.col !== col) return { col, dir: "asc" };
  if (sort.dir === "asc") return { col, dir: "desc" };
  return null;
}

const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * `items` in the order `sort` asks for, or as given when there is none.
 *
 * Blank and missing values sit at the foot whichever way the column is read,
 * and ties fall back to `tie` — always A to Z — so a column of equal values
 * still reads as a list rather than a shuffle. Rows are usually passed as
 * positions into the real list, so an edit made under any sort still lands on
 * the right row and the saved order is never touched.
 */
export function sorted<T, C extends string>(
  items: readonly T[],
  sort: Sort<C>,
  value: (item: T, col: C) => SortValue,
  tie: (item: T) => string
): T[] {
  const out = [...items];
  if (!sort) return out;
  const sign = sort.dir === "asc" ? 1 : -1;
  const norm = (v: SortValue): string | number | null => {
    if (v == null) return null;
    if (typeof v === "boolean") return Number(v);
    if (typeof v === "string") return v.trim() || null;
    return v;
  };
  return out.sort((a, b) => {
    const va = norm(value(a, sort.col));
    const vb = norm(value(b, sort.col));
    if (va === null || vb === null) {
      return va === vb ? text(tie(a), tie(b)) : va === null ? 1 : -1;
    }
    const d =
      typeof va === "string" && typeof vb === "string" ? text(va, vb) : Number(va) - Number(vb);
    return sign * d || text(tie(a), tie(b));
  });
}

/**
 * A column header that sorts the table when clicked, the way a spreadsheet's
 * does, and says which way. With no `label` it is only the arrow, for a header
 * whose text is something else — a link, say — passed as `before`.
 */
export function SortHead<C extends string>({
  col,
  label,
  before,
  width,
  right,
  title,
  className,
  sort,
  onToggle,
}: {
  col: C;
  label?: string;
  before?: ReactNode;
  width?: number | string;
  right?: boolean;
  title?: string;
  className?: string;
  sort: Sort<C>;
  onToggle: (col: C) => void;
}) {
  const on = sort?.col === col;
  const style: CSSProperties | undefined = width ? { width } : undefined;
  const cls = [right ? "r" : "", className ?? ""].filter(Boolean).join(" ") || undefined;
  return (
    <th
      className={cls}
      style={style}
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {before}
      <button
        type="button"
        className={"sorth" + (on ? " on" : "") + (label ? "" : " bare")}
        onClick={() => onToggle(col)}
        title={title ?? (label ? "Sort by " + label.toLowerCase() : "Sort by this column")}
        aria-label={label ? undefined : "Sort by this column"}
      >
        {label}
        <span className="arrow" aria-hidden="true">
          {on ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    </th>
  );
}
