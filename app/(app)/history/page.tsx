import { createClient } from "@/lib/supabase/server";
import { listRuns } from "@/app/actions";
import HistoryTab from "@/components/HistoryTab";

export const metadata = { title: "History" };

export default async function Page() {
  const supabase = await createClient();
  /* Who is looking, so the Delete button can say whose runs it will not touch. */
  const [runs, { data: auth }] = await Promise.all([listRuns(), supabase.auth.getClaims()]);
  let me = auth?.claims?.sub ?? null;
  if (!me) me = (await supabase.auth.getUser()).data.user?.id ?? null;
  return <HistoryTab runs={runs} me={me} />;
}
