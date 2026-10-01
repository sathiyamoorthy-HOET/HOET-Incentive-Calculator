"use client";

import { useEffect, useRef, useState } from "react";
import { inPeriod, parseReport } from "@/lib/parse";
import { parseMonth } from "@/lib/months";
import { DATE_BASES, DateBasis, ParsedSource, SourceRow } from "@/lib/types";

type Pending = { rows: SourceRow[]; fileName: string; source: ParsedSource };

/** The first and last of a project date across the rows, or null when none has it. */
function span(rows: SourceRow[], basis: DateBasis): [string, string] | null {
  const ds = rows.map((r) => r[basis]).filter((d): d is string => !!d).sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}

/** The calendar month the file name says the report covers, as [first, last]. */
function monthSpan(fileName: string): [string, string] | null {
  const m = parseMonth(fileName);
  if (!m) return null;
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [m.slice(0, 8) + "01", m.slice(0, 8) + String(last).padStart(2, "0")];
}

export default function RunTab({
  onLoaded,
}: {
  /** Returns an error to show, or nothing when the report was accepted. */
  onLoaded: (
    rows: SourceRow[],
    fileName: string,
    source: ParsedSource
  ) => void | Promise<string | null | void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  /* A report that has been read but not yet priced: it waits here until the
     date window is confirmed. Which work belongs to a month is a judgement
     (assigned in it? created in it? due in it?), so the tool asks rather than
     pricing everything the export happened to include. */
  const [pending, setPending] = useState<Pending | null>(null);
  const [basis, setBasis] = useState<DateBasis>("assigned");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function handle(f: File) {
    setBusy(true);
    setError(null);
    const fr = new FileReader();
    fr.onload = async (ev) => {
      const res = await parseReport(ev.target?.result as ArrayBuffer);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      /* Assigned is the house rule; fall back to whichever date the report
         has. The window defaults to the month in the file name, else to the
         dates actually present, so confirming as-is runs the whole month. */
      const b = (["assigned", "created", "due"] as DateBasis[]).find((k) => span(res.rows, k)) || "assigned";
      const w = monthSpan(f.name) || span(res.rows, b);
      setBasis(b);
      setFrom(w?.[0] || "");
      setTo(w?.[1] || "");
      setPending({ rows: res.rows, fileName: f.name, source: res.source });
    };
    fr.onerror = () => {
      setBusy(false);
      setError("That file could not be read.");
    };
    fr.readAsArrayBuffer(f);
  }

  /* The whole page is a drop target, matching the original tool. */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setOver(true); };
    const overFn = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const dropFn = (e: DragEvent) => {
      e.preventDefault(); depth = 0; setOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) handle(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overFn);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", dropFn);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", dropFn);
    };
     
  }, []);

  function run(all: boolean) {
    if (!pending) return;
    const p = pending;
    setBusy(true);
    setError(null);
    let rows = p.rows;
    let source = p.source;
    if (!all) {
      const cut = inPeriod(p.rows, basis, from, to);
      rows = cut.rows;
      source = { ...p.source, period: { basis, from, to, kept: cut.rows.length, dropped: cut.dropped, undated: cut.undated } };
    }
    /* Stay busy while the report is settled against what has already been
       paid: the figures on the next page depend on that answer. */
    Promise.resolve(onLoaded(rows, p.fileName, source)).then((err) => {
      setBusy(false);
      if (err) setError(err);
      else setPending(null);
    });
  }

  const hasDates = !!pending && (["created", "assigned", "due"] as DateBasis[]).some((k) => span(pending.rows, k));
  const preview = pending && hasDates && from && to && from <= to ? inPeriod(pending.rows, basis, from, to) : null;

  return (
    <section className="panel on">
      <div className={"ov" + (over ? " on" : "")}>
        <b>Drop the report to run it</b>
        <span>Excel or CSV</span>
      </div>

      <h2>Run a month</h2>
      <p className="sub">
        Upload the monthly delivery report. The tool reads each editor, the video type and the
        minutes delivered, then works out points, target and incentive.
      </p>

      {error && <div className="note bad">{error}</div>}

      {pending && (
        <div className="note">
          <strong>Which work counts?</strong> {pending.fileName} has {pending.rows.length} rows.
          {hasDates ? (
            <>
              {" "}Keep the projects whose date falls in this window, then price them.
              <div className="row" style={{ marginTop: 12 }}>
                <div>
                  <label className="fld" htmlFor="basis">Date</label>
                  <select id="basis" className="fld-in wide" value={basis} onChange={(e) => {
                    const b = e.target.value as DateBasis;
                    setBasis(b);
                    const w = monthSpan(pending.fileName) || span(pending.rows, b);
                    if (w) { setFrom(w[0]); setTo(w[1]); }
                  }}>
                    {(Object.keys(DATE_BASES) as DateBasis[]).map((k) => (
                      <option key={k} value={k} disabled={!span(pending.rows, k)}>
                        {DATE_BASES[k]}{span(pending.rows, k) ? "" : " (not in report)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="fld" htmlFor="from">From</label>
                  <input id="from" className="fld-in wide" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="fld" htmlFor="to">To</label>
                  <input id="to" className="fld-in wide" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <button className="btn g" style={{ marginLeft: "auto" }} disabled={busy || !preview} onClick={() => run(false)}>
                  {busy ? <span className="spin" /> : "Work out points"}
                </button>
                <button className="btn o" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              </div>
              <div className="m" style={{ marginTop: 10 }}>
                {!from || !to
                  ? "Pick both dates."
                  : from > to
                  ? "The From date is after the To date."
                  : preview &&
                    `${preview.rows.length} of ${pending.rows.length} rows are in this window` +
                    (preview.dropped ? ` · ${preview.dropped} outside it` : "") +
                    (preview.undated ? ` · ${preview.undated} with no ${DATE_BASES[basis].toLowerCase()} date, left out` : "")}
              </div>
            </>
          ) : (
            <>
              {" "}It has no Created, Assigned or Due column, so it cannot be cut to a window.
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn g" disabled={busy} onClick={() => run(true)}>
                  {busy ? <span className="spin" /> : "Price the whole report"}
                </button>
                <button className="btn o" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {!pending && <div
        className={"drop" + (busy ? " busy" : "")}
        tabIndex={0}
        role="button"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
      >
        <strong>
          {busy ? "Reading the report…" : "Drop the report here, or click to choose a file"}
        </strong>
        <span>
          Or drop it anywhere on this page. Excel or CSV. The file is read in your browser — only
          the result is saved.
        </span>
      </div>}

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handle(f);
        }}
      />
    </section>
  );
}
