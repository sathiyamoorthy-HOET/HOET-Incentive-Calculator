"use client";

import { useState } from "react";

function Pencil() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/**
 * A settings card that reads before it writes.
 *
 * These pages are looked at far more often than they are changed — someone
 * checks a rate mid-run, or reads the team list — and every field being live
 * meant a stray keystroke or a mistimed click silently changed a number that
 * decides someone's pay. So the card shows values as text until Edit is
 * pressed, and only then hands out inputs.
 *
 * Edits still save as they are made; Done only puts the fields away.
 */
export default function EditCard({
  title,
  hint,
  meta,
  tools,
  children,
}: {
  title?: string;
  /** Explanatory line under the title, in both modes. */
  hint?: React.ReactNode;
  /** Shown in both modes — counts, exports: anything that changes nothing. */
  meta?: React.ReactNode;
  /** Shown only while editing — add buttons, mode switches. */
  tools?: React.ReactNode;
  children: (editing: boolean) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className={"card" + (editing ? " editing" : "")}>
      <div className="cardhead">
        {title && <h3>{title}</h3>}
        {editing && tools}
        {meta && <span className="cardmeta">{meta}</span>}
        <button
          className={"btn " + (editing ? "" : "o")}
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
        >
          {editing ? "Done" : <><Pencil /> Edit</>}
        </button>
      </div>

      {hint && <p className="sub cardhint">{hint}</p>}

      {children(editing)}
    </div>
  );
}
