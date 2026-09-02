"use client";

import { useActionState } from "react";
import Link from "next/link";
import Mark from "@/components/Mark";
import { requestReset, type AuthState } from "@/app/login/actions";

const initial: AuthState = { error: null };

export default function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, initial);

  return (
    <form className="box" action={action}>
      <Mark className="brandmark" label="House of EduTech" />
      <h1>Reset your password</h1>
      <p className="sub">
        We send a link that signs you in once, so you can set a new password.
      </p>

      {state.error && (
        <div className="note bad" role="alert">
          {state.error}
        </div>
      )}
      {state.notice && (
        <div className="note ok" role="status">
          {state.notice}
        </div>
      )}

      <label className="fld" htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="username" required autoFocus />

      <button className="btn" type="submit" disabled={pending}>
        {pending ? <span className="spin" /> : "Send the link"}
      </button>

      <p className="sub" style={{ margin: "16px 0 0", fontSize: 12.5 }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
