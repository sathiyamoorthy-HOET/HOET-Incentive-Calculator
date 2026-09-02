"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Mark from "@/components/Mark";
import PasswordField from "@/components/PasswordField";
import { signIn, type AuthState } from "./actions";

const initial: AuthState = { error: null };

export default function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const expired = params.get("expired") === "1";
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form className="box" action={action}>
      <Mark className="brandmark" label="House of EduTech" />
      <h1>HOET Incentive calculator</h1>
      <p className="sub">Sign in to run the monthly incentive calculation.</p>

      {expired && !state.error && (
        <div className="note" role="status">
          That link has already been used or has expired. Ask for a new one below.
        </div>
      )}

      {state.error && (
        <div className="note bad" role="alert">
          {state.error}
        </div>
      )}

      <input type="hidden" name="next" value={next} />

      <label className="fld" htmlFor="email">
        Work email
      </label>
      <input id="email" name="email" type="email" autoComplete="username" required autoFocus />

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
      />

      <button className="btn" type="submit" disabled={pending}>
        {pending ? <span className="spin" /> : "Sign in"}
      </button>

      <div className="row" style={{ marginTop: 16, fontSize: 12.5 }}>
        <Link href="/forgot">Forgot your password?</Link>
        <span className="right">
          <Link href="/signup">Create an account</Link>
        </span>
      </div>

      <p className="sub" style={{ margin: "12px 0 0", fontSize: 12.5 }}>
        Only addresses an admin has put on the access list can sign in or sign up.
      </p>
    </form>
  );
}
