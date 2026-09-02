"use client";

import { useActionState } from "react";
import Link from "next/link";
import Mark from "@/components/Mark";
import PasswordField from "@/components/PasswordField";
import { updatePassword, type AuthState } from "@/app/login/actions";

const initial: AuthState = { error: null };

export default function ResetForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);

  return (
    <form className="box" action={action}>
      <Mark className="brandmark" label="House of EduTech" />
      <h1>Set a new password</h1>
      <p className="sub">The link signed you in. Choose the password you will use from now on.</p>

      {state.error && (
        <div className="note bad" role="alert">
          {state.error}
        </div>
      )}

      <PasswordField
        id="password"
        name="password"
        label="New password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
      />

      <button className="btn" type="submit" disabled={pending}>
        {pending ? <span className="spin" /> : "Save and continue"}
      </button>

      <p className="sub" style={{ margin: "16px 0 0", fontSize: 12.5 }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
