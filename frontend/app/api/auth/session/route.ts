import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { JWKS, SESSION_COOKIE, TOKEN_ISSUER } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Exchanges a token the provider issued for this app's own session cookie.
 *
 * The token is verified before it is stored. Without that this endpoint would
 * accept any string a caller posted and hand it back as a session on every
 * later request — the cookie is httpOnly, which stops a script reading it, and
 * would do nothing to stop a script setting one.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { accessToken?: unknown }
    | null;

  const token = body?.accessToken;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  try {
    await jwtVerify(token, JWKS, { issuer: TOKEN_ISSUER });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Off on plain-HTTP localhost; on everywhere else.
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

/** Signing out: drop the cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
