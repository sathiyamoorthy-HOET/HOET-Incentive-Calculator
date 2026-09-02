"use client";

import { useActionState } from "react";
import Link from "next/link";
import Mark from "@/components/Mark";
import PasswordField from "@/components/PasswordField";
import { signUpNew, type AuthState } from "@/app/login/actions";

const initial: AuthState = { error: null };

export default function SignUpForm() {
  const [state, action, pending] = useActionState(signUpNew, initial);

  return (
    <form className="box" action={action}>
      <Mark className="brandmark" label="House of EduTech" />
      <h1>Create your account</h1>
      <p className="sub">
        Your work address has to be on the access list already. If it is not, an admin adds it in
        one click.
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

      <label className="fld" htmlFor="full_name">Your name</label>
      <input id="full_name" name="full_name" type="text" autoComplete="name" placeholder="Priya Nair" />

      <label className="fld" htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="username" required />

      <PasswordField
        id="password"
        name="password"
        label="Choose a password"
        autoComplete="new-password"
        minLength={8}
        hint="At least 8 characters."
      />

      <button className="btn" type="submit" disabled={pending}>
        {pending ? <span className="spin" /> : "Create account"}
      </button>

      <p className="sub" style={{ margin: "16px 0 0", fontSize: 12.5 }}>
        Already have one? <Link href="/login">Sign in</Link>.
      </p>
    </form>
  );
}
