import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { MISSING_ENV_MESSAGE, supabaseEnv } from "@/lib/env";

export async function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error(MISSING_ENV_MESSAGE);

  const cookieStore = await cookies();

  return createServerClient(
    env.url,
    env.key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, which cannot set cookies. The
            // proxy refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    }
  );
}
