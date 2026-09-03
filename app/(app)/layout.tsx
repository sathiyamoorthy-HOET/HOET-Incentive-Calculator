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

  /* Asked for before the session is checked rather than after it, because the
     two do not depend on each other and this one is the round trip. The
     database refuses it to anyone not signed in, and an unsigned caller is
     redirected below before the answer is ever read. */
  const configPromise = supabase.rpc("get_config");

  /* Verified in process against the project's published signing keys, so
     rendering a page costs no round trip to the Auth server. The proxy has
     already refreshed the token by the time this runs. */
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  let claims: { sub: string; email?: string; user_metadata?: Record<string, unknown> } | null =
    auth?.claims ?? null;
  /* Same fallback as the proxy: a verification that could not be carried out
     is not the same as a person who is not signed in. */
  if (!claims && authError) {
    const { data: fallback } = await supabase.auth.getUser();
    if (fallback.user) {
      claims = {
        sub: fallback.user.id,
        email: fallback.user.email,
        user_metadata: fallback.user.user_metadata,
      };
    }
  }
  if (!claims) redirect("/login");

  const { data: config, error } = await configPromise;

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

  const label =
    (claims.user_metadata?.full_name as string | undefined) || claims.email || "Signed in";

  /* The revision ladder and the payout ladder each arrive only once their own
     migration has been applied; until then the flat rate is what pays. */
  const shared = config as Config;
  shared.revPen = shared.revPen ?? [];
  shared.payBands = shared.payBands ?? [];
  shared.pipMonths = shared.pipMonths ?? 3;

  return (
    <AppShell initialConfig={shared} userLabel={label}>
      {children}
    </AppShell>
  );
}
