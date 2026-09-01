/**
 * Supabase connection details. Both are safe to expose to the browser; access
 * is enforced by row-level security, not by key secrecy.
 *
 * Returns null when unset so callers can fail with a readable message. Without
 * this, createServerClient(undefined, undefined) throws inside the proxy and
 * every route — even static ones — answers a bare 500.
 */
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export const MISSING_ENV_MESSAGE =
  "This deployment is missing NEXT_PUBLIC_SUPABASE_URL and/or " +
  "NEXT_PUBLIC_SUPABASE_ANON_KEY. Set both in the hosting project's " +
  "environment variables and redeploy.";
