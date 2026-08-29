import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Route protection.
 *
 * Everything is private unless listed here. That direction matters: a new
 * route is protected by default, and forgetting to list a genuinely public one
 * shows up immediately as a redirect to sign-in rather than silently as an
 * open page.
 */
const PUBLIC_ROUTES = [
  "/login",
  // The endpoint that establishes the session. Protecting it means a visitor
  // must be signed in to sign in: the POST is redirected to /login, the cookie
  // is never set, and the browser bounces between the two with no error
  // anywhere. Everything-private-by-default is right; this is the one route
  // that has to precede it.
  "/api/auth",
  "/careers",
  "/assessment",
  "/interview",
  "/offer",
  "/api/public",
  // Brand logos out of the private bucket. Public because they render on
  // careers pages for visitors with no account, and in the /public/clients
  // feed an agency points its own site at.
  //
  // The folder, not `/api/files`: a CV lives one path segment away under
  // `/api/files/resumes`, and everything-private-by-default is what keeps it
  // behind a session even before the API decides who may read it.
  "/api/files/logos",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Whether this request carries a session cookie.
 *
 * Deliberately only a presence check. Middleware runs on every request, and
 * verifying a signature here would either need the provider on each one or a
 * key cache in edge runtime. The signature *is* verified — in
 * `getServerSession`, before any data is read, and by the backend on every
 * API call. This decides where to send a visitor, not what they may see.
 */
function isSignedIn(request: NextRequest): boolean {
  return Boolean(request.cookies.get(SESSION_COOKIE)?.value);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    if (isSignedIn(request)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (isSignedIn(request)) return NextResponse.next();

  const signIn = new URL("/login", request.url);
  signIn.searchParams.set("next", pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
