import { createClient } from "@/lib/supabase/server";
import { listRuns } from "@/app/actions";
import HistoryTab from "@/components/HistoryTab";

export const metadata = { title: "History" };

export default async function Page() {
  const supabase = await createClient();
  /* Who is looking, so the Delete button can say whose runs it will not touch;
     a super admin's touches them all. */
  const [runs, { data: auth }] = await Promise.all([listRuns(), supabase.auth.getClaims()]);
  let me = auth?.claims?.sub ?? null;
  let email = auth?.claims?.email ?? null;
  if (!me) {
    const { data } = await supabase.auth.getUser();
    me = data.user?.id ?? null;
    email = data.user?.email ?? null;
  }
  const { data: row } = email
    ? await supabase.from("allowed_emails").select("is_super").eq("email", email.trim().toLowerCase()).maybeSingle()
    : { data: null };
  return <HistoryTab runs={runs} me={me} superAdmin={!!row?.is_super} />;
}
