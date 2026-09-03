import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { MISSING_ENV_MESSAGE, supabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot", "/auth"];

/**
 * Refreshes the Supabase session on every request and keeps signed-out users
 * out of the app. Server Actions re-check auth themselves; this is the front
 * door, not the only lock.
 *
 * The check is deliberately an optimistic one, as Next's own guidance for
 * proxies asks: getClaims() verifies the token's signature against the
 * project's published keys using WebCrypto, in process, so the front door
 * costs no network round trip. getUser() would ask the Auth server on every
 * single request, which put a whole trip to the database in front of every
 * page in the app. Authorisation still happens where it counts — row-level
 * security in the database, and requireUser() in every Server Action.
 */
export async function proxy(request: NextRequest) {
  const env = supabaseEnv();
  if (!env) {
    // Say what is wrong rather than letting the client constructor throw and
    // turn every route, static ones included, into an unexplained 500.
    return new NextResponse(MISSING_ENV_MESSAGE, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.url,
    env.key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.getClaims();
  let user = data?.claims ? { id: data.claims.sub } : null;

  /* Verification can fail for reasons that have nothing to do with the person
     holding the token — the signing keys could not be fetched, say. Ask the
     Auth server before bouncing somebody who is genuinely signed in. This
     costs a round trip, but only when the cheap path has already failed. */
  if (!user && error) {
    const { data: fallback } = await supabase.auth.getUser();
    user = fallback.user ? { id: fallback.user.id } : null;
  }

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  /* Someone following a recovery link is signed in but does not yet know
     their password, so /auth/reset has to stay reachable while signed in. */
  if (user && (path === "/login" || path === "/signup" || path === "/forgot")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
