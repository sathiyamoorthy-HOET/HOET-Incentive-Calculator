import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listRuns } from "./actions";
import AppShell from "@/components/AppShell";
import type { Config } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: config, error } = await supabase.rpc("get_config");

  if (error || !config) {
    return (
      <main style={{ padding: 40, maxWidth: 640, margin: "0 auto" }}>
        <h2>The settings could not be loaded</h2>
        <p className="sub">
          The app is signed in but could not read the shared rate card from the database. This
          usually means the migration in <code>supabase/migrations</code> has not been applied yet.
        </p>
        {error && <div className="note bad">{error.message}</div>}
      </main>
    );
  }

  const runs = await listRuns();
  const label = user.user_metadata?.full_name || user.email || "Signed in";

  return (
    <AppShell initialConfig={config as Config} initialRuns={runs} userLabel={label} />
  );
}
