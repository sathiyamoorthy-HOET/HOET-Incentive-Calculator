import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import type { Config } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The signed-in app. Everything the pages share is loaded once here: the
 * session, the shared rate card, and the chrome around them. Layouts stay
 * mounted across navigations, so the report on screen survives a page change.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
          usually means the migrations in <code>supabase/migrations</code> have not been applied
          yet.
        </p>
        {error && <div className="note bad">{error.message}</div>}
      </main>
    );
  }

  const label = user.user_metadata?.full_name || user.email || "Signed in";

  return (
    <AppShell initialConfig={config as Config} userLabel={label}>
      {children}
    </AppShell>
  );
}
