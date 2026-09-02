"use client";

import { useState } from "react";

function Eye({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.7" />
      {off && <path d="M4 20 20 4" />}
    </svg>
  );
}

/**
 * Password input with a reveal toggle. People type these from memory into a
 * field that shows nothing, and a temporary password read off a message is
 * worse — so let them look.
 */
export default function PasswordField({
  id,
  name,
  label,
  autoComplete,
  required = true,
  minLength,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);

  return (
    <>
      <label className="fld" htmlFor={id}>
        {label}
      </label>
      <div className="pw">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
        />
        <button
          type="button"
          className="pw-eye"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
        >
          <Eye off={shown} />
        </button>
      </div>
      {hint && (
        <p className="sub" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {hint}
        </p>
      )}
    </>
  );
}
