"use client";

import { useEffect, useRef, useState } from "react";
import { parseReport } from "@/lib/parse";
import { SourceRow } from "@/lib/types";

export default function RunTab({
  onLoaded,
}: {
  onLoaded: (rows: SourceRow[], fileName: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  function handle(f: File) {
    setBusy(true);
    setError(null);
    const fr = new FileReader();
    fr.onload = (ev) => {
      const res = parseReport(ev.target?.result as ArrayBuffer);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onLoaded(res.rows, f.name);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div
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
      </div>

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
