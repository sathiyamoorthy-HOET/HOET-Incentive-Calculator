import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { MISSING_ENV_MESSAGE, supabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot", "/auth"];

/**
 * Refreshes the Supabase session on every request and keeps signed-out users
 * out of the app. Server Actions re-check auth themselves; this is the front
 * door, not the only lock.
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
