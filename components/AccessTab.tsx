"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AccessRow } from "@/lib/types";
import { addUser, allowEmail, removeUser } from "@/app/(app)/admin/actions";
import EditCard from "./EditCard";

type Created = { email: string; password: string | null; listedOnly?: boolean };

export default function AccessTab({
  rows,
  canCreate,
}: {
  rows: AccessRow[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  async function add(mode: "invite" | "account") {
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    const res = mode === "account" ? await addUser(name, email) : await allowEmail(name, email);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCreated({ email: res.email, password: res.password, listedOnly: res.listedOnly });
    setName("");
    setEmail("");
    startTransition(() => router.refresh());
  }

  async function remove(row: AccessRow) {
    const what = row.hasAccount
      ? `Remove ${row.name || row.email}? Their account is deleted and they can no longer sign in. ` +
        `Runs they saved stay in History, without their name against them.`
      : `Take ${row.email} off the access list? They have no account yet, so nothing else changes.`;
    if (!confirm(what)) return;

    setBusy(true);
    setError(null);
    const res = await removeUser(row.email);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="panel on narrow">
      <h2>Admin</h2>
      <p className="sub">
        Who can sign in. Everyone here sees the same rate card, team and history; the only thing
        held back is deleting someone else&apos;s saved run. The list is the gate — the database
        refuses to create an account for an address that is not on it, however they arrive.
      </p>

      {error && <div className="note bad">{error}</div>}

      {!canCreate && (
        <div className="note">
          <strong>Accounts cannot be created from here yet.</strong> This needs
          <code style={{ margin: "0 4px" }}>SUPABASE_SERVICE_ROLE_KEY</code>
          in the server environment. Until it is set, add the address below and create the account
          in Supabase → Authentication → Users.
        </div>
      )}

      {created && (
        <div className="note ok">
          {created.listedOnly ? (
            <>
              <strong>{created.email} is on the access list.</strong> They can now sign
              themselves up at the sign-in page and choose their own password.
            </>
          ) : created.password ? (
            <>
              <strong>{created.email} can sign in now.</strong> Send them this password — it is not
              stored anywhere and cannot be shown again.
              <div className="row" style={{ marginTop: 10 }}>
                <code className="num" style={{ fontSize: 15, padding: "6px 10px" }}>
                  {created.password}
                </code>
                <button
                  className="btn o"
                  onClick={() => {
                    navigator.clipboard?.writeText(created.password || "");
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          ) : (
            <>
              <strong>{created.email} already had an account.</strong> They are on the access list
              now, so their existing password works.
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="cardhead">
          <h3>Add someone</h3>
        </div>
        <form
          className="row"
          style={{ gap: 14, alignItems: "flex-end" }}
          onSubmit={(e) => {
            e.preventDefault();
            add("invite");
          }}
        >
          <div>
            <label className="fld" htmlFor="an">Name</label>
            <input
              id="an"
              className="fld-in"
              style={{ width: 200, textAlign: "left", fontFamily: "inherit" }}
              value={name}
              placeholder="Priya Nair"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="fld" htmlFor="ae">Work email</label>
            <input
              id="ae"
              className="fld-in"
              style={{ width: 280, textAlign: "left", fontFamily: "inherit" }}
              type="email"
              value={email}
              placeholder="priya@houseofedtech.in"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? <span className="spin" /> : "Allow this address"}
          </button>
          <button
            className="btn o"
            type="button"
            disabled={busy || !email.trim() || !canCreate}
            title={canCreate ? undefined : "Needs SUPABASE_SERVICE_ROLE_KEY"}
            onClick={() => add("account")}
          >
            Allow and create the account
          </button>
        </form>
        <p className="sub" style={{ margin: "14px 0 0" }}>
          Allowing the address is usually enough: they sign themselves up and pick their own
          password, and can reset it later from the sign-in page. Creating the account here
          instead hands you a temporary password to pass on, shown once.
        </p>
      </div>

      <EditCard
        title="Who has access"
        meta={<span className="muted">{rows.length} people</span>}
      >
        {(editing) => (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th style={{ width: 130 }}>Account</th>
                  <th style={{ width: 120 }}>Added</th>
                  {editing && <th style={{ width: 110 }} />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={editing ? 5 : 4} className="muted">
                      Nobody is listed, which should not be possible — the database refuses to
                      remove the last address.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.email}>
                    <td>
                      {r.name || r.note || <span className="muted">—</span>}
                      {r.isYou && <span className="muted" style={{ fontSize: 12 }}> · you</span>}
                    </td>
                    <td className="wrap">{r.email}</td>
                    <td>
                      {r.hasAccount ? (
                        <span className="pill t">Can sign in</span>
                      ) : (
                        <span className="pill a">No account</span>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {new Date(r.addedAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    {editing && (
                      <td>
                        {r.isYou ? (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        ) : (
                          <button className="btn o" disabled={busy} onClick={() => remove(r)}>
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </EditCard>
    </section>
  );
}
