import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where every link in a Supabase email lands: confirmations and password
 * recoveries alike. It accepts both shapes those links come in, so it works
 * whether or not the project's email templates have been switched to the
 * token_hash form:
 *
 *   ?token_hash=…&type=recovery   the current templates, verified here
 *   ?code=…                       the default templates, exchanged here
 *
 * Success signs the person in and hands them on to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/run";

  /* Only ever redirect within this app, whatever the link asked for. */
  const to = next.startsWith("/") ? next : "/run";

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(to);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(to);
  }

  redirect("/login?expired=1");
}
