import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { MISSING_SERVICE_KEY_MESSAGE, serviceKey, supabaseEnv } from "@/lib/env";

/**
 * A client holding the service-role key, which ignores row-level security and
 * can manage accounts. Server-side only: never import this from a component
 * that runs in the browser, and never return anything it produces beyond what
 * the caller needs to see.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("The admin client must never be constructed in the browser.");
  }

  const env = supabaseEnv();
  const key = serviceKey();
  if (!env) throw new Error("Supabase is not configured.");
  if (!key) throw new Error(MISSING_SERVICE_KEY_MESSAGE);

  return createSupabaseClient(env.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
