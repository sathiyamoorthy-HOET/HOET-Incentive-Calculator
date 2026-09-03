"use client";

import { useEffect, useState } from "react";

import { useMaybeApp } from "./AppShell";

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
 * Edits still save as they are made — unless the card is marked `confirm`, in
 * which case they are held in the browser while it is open and a bar at the
 * foot of the page saves or discards them as a set. That is for the cards
 * where a slip is not a typo but a change to what somebody is paid.
 */
export default function EditCard({
  title,
  hint,
  meta,
  tools,
  confirm,
  children,
}: {
  title?: string;
  /** Explanatory line under the title, in both modes. */
  hint?: React.ReactNode;
  /** Shown in both modes — counts, exports: anything that changes nothing. */
  meta?: React.ReactNode;
  /** Shown only while editing — add buttons, mode switches. */
  tools?: React.ReactNode;
  /** Hold this card's edits back until they are confirmed for everyone. */
  confirm?: boolean;
  children: (editing: boolean) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const app = useMaybeApp();
  const guarded = !!confirm && !!app;

  /* Held open for as long as the fields are: what is typed into them is
     staged, not saved, and the page's bar is what settles it. */
  useEffect(() => {
    if (!guarded || !editing || !app) return;
    app.openGuard();
    return () => app.closeGuard();
    /* openGuard and closeGuard are stable, and re-running this on any other
       change would stage and unstage the card mid-edit. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guarded, editing]);

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
          {editing ? (guarded ? "Close" : "Done") : <><Pencil /> Edit</>}
        </button>
      </div>

      {hint && <p className="sub cardhint">{hint}</p>}

      {children(editing)}
    </div>
  );
}
