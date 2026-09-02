import { createClient } from "@/lib/supabase/server";
import { serviceKey } from "@/lib/env";
import AccessTab from "@/components/AccessTab";
import type { AccessRow } from "@/lib/types";

export const metadata = { title: "Access" };

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /* Both reads are row-level-security gated to staff, so a non-staff account
     that reaches this page simply sees an empty list. */
  const [{ data: allowed }, { data: profiles }] = await Promise.all([
    supabase.from("allowed_emails").select("email, note, added_at").order("email"),
    supabase.from("profiles").select("email, full_name"),
  ]);

  const byEmail = new Map(
    (profiles || []).map((p) => [String(p.email ?? "").toLowerCase(), p.full_name])
  );
  const mine = (user?.email || "").trim().toLowerCase();

  const rows: AccessRow[] = (allowed || []).map((a) => ({
    email: a.email,
    note: a.note,
    addedAt: a.added_at,
    name: byEmail.get(a.email) ?? null,
    hasAccount: byEmail.has(a.email),
    isYou: a.email === mine,
  }));

  return <AccessTab rows={rows} canCreate={!!serviceKey()} />;
}
