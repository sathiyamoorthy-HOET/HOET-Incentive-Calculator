"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Mark from "@/components/Mark";
import { signIn, type AuthState } from "./actions";

const initial: AuthState = { error: null };

export default function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form className="box" action={action}>
      <Mark className="brandmark" label="House of EduTech" />
      <h1>HOET Incentive</h1>
      <p className="sub">Sign in to run the monthly incentive calculation.</p>

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

      <label className="fld" htmlFor="password">
        Password
      </label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />

      <button className="btn" type="submit" disabled={pending}>
        {pending ? <span className="spin" /> : "Sign in"}
      </button>

      <p className="sub" style={{ margin: "16px 0 0", fontSize: 12.5 }}>
        Accounts are created by an administrator. Ask your admin if you need access or a password reset.
      </p>
    </form>
  );
}
