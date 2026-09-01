/**
 * Supabase connection details.
 *
 * Deliberately NOT prefixed with NEXT_PUBLIC_. Every Supabase call in this app
 * happens on the server — the proxy and Server Actions — so these values never
 * need to reach the browser, and the prefix would ship them there for no
 * reason. The legacy NEXT_PUBLIC_ names are still accepted so an existing
 * deployment keeps working while its variables are renamed.
 *
 * The publishable key is not a secret in Supabase's model; access is enforced
 * by row-level security. Keeping it server-side is defence in depth, not the
 * thing standing between a stranger and the data.
 */
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export const MISSING_ENV_MESSAGE =
  "This deployment is missing SUPABASE_URL and/or SUPABASE_PUBLISHABLE_KEY. " +
  "Set both in the hosting project's environment variables and redeploy.";
