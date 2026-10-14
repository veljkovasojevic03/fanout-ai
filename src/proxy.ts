import { NextResponse, type NextRequest } from "next/server";

import { SIGNED_IN_HEADER } from "@/lib/auth/hint";
import { updateSession } from "@/lib/supabase/proxy";

const isProtectedPath = (pathname: string) => pathname === "/app" || pathname.startsWith("/app/");

export async function proxy(request: NextRequest) {
  const { response, userId, unavailable } = await updateSession(request);

  // First line of defence only. The /app layout re-checks the user on the server,
  // and the database enforces RLS no matter what reaches it. When the Auth server
  // is unreachable we let the request through: the layout shows "waking up"
  // rather than bouncing a signed-in user to the login page.
  if (!userId && !unavailable && isProtectedPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);

    const redirect = NextResponse.redirect(loginUrl);
    // Keep any cookies the session refresh just set (e.g. clearing a dead session).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  // The landing page only needs to know which buttons to show. The proxy has
  // just verified the session, so it says so in a request header instead of
  // the page asking the Auth server again — one network round trip fewer
  // before the first byte. Always overwritten, so a client cannot set it.
  if (request.nextUrl.pathname === "/") {
    const headers = new Headers(request.headers);
    headers.set(SIGNED_IN_HEADER, userId ? "1" : "0");
    const forwarded = NextResponse.next({ request: { headers } });
    for (const cookie of response.cookies.getAll()) forwarded.cookies.set(cookie);
    response.headers.forEach((value, key) => {
      if (!key.toLowerCase().startsWith("x-middleware")) forwarded.headers.set(key, value);
    });
    return forwarded;
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation, metadata files, the health
    // check and the machine-to-machine endpoints. Those have no session: the Stripe
    // webhook and the n8n callback are authenticated by their signature, the cron tick
    // by its bearer secret.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health|api/stripe/webhook|api/publish/callback|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
