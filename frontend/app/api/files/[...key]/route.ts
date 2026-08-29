import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth/session";

/**
 * The address a browser uses for anything in the bucket.
 *
 * The bucket is private, so a stored `resume_url` or `logo_url` points here
 * rather than at the object store. This exists on the frontend, and not only
 * on the API, because of how the files are read: a CV is opened in an
 * `<iframe src>` and a logo in an `<img src>`, and a browser attaches no
 * Authorization header to either. It does send this app's session cookie, so
 * the token is picked up here, server-side, and forwarded to the API — which
 * is where the decision is actually made.
 *
 * Nothing is proxied. The API answers with a redirect to a short-lived signed
 * URL and that is passed straight back, so the bytes go from the bucket to the
 * browser without touching either server.
 */

const API_BASE_URL =
  process.env.OPENATS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8080";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;

  // Logos are readable without a session — they render on careers pages for
  // visitors who have no account. Sending no header is what the API reads as
  // anonymous, and it refuses a resume on that basis.
  const token = await getAccessToken().catch(() => null);

  const res = await fetch(`${API_BASE_URL}/files/${key.join("/")}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: "manual",
    cache: "no-store",
  });

  const location = res.headers.get("location");
  if (res.status === 302 && location) {
    const out = NextResponse.redirect(location, 302);
    // Carried over rather than re-decided: the API knows whether this was a
    // public logo or one user's authorized read of a CV.
    const cacheControl = res.headers.get("cache-control");
    if (cacheControl) out.headers.set("Cache-Control", cacheControl);
    return out;
  }

  return NextResponse.json(
    { error: res.status === 401 ? "Unauthorized" : "Not found" },
    { status: res.status === 401 ? 401 : 404 },
  );
}
