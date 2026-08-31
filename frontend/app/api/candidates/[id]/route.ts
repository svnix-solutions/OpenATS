import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth/session";
import { publicConfig } from "@/lib/public-config";

/** The local helper threw when unauthenticated; callers still rely on that. */
async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Unauthorized");
  return token;
}

// The internal address first. This runs on the server, and the public
// hostname from in here leaves the network, goes out to whatever terminates
// TLS and comes back — slow where it works, refused where it does not.
const API_BASE_URL = process.env.OPENATS_API_URL || publicConfig().apiUrl;

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    if (!id) {
      return NextResponse.json(
        { error: "Candidate ID is required" },
        { status: 400 },
      );
    }

    const token = await requireAccessToken();
    const formData = await req.formData();

    const res = await fetch(`${API_BASE_URL}/api/candidates/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const json = await res.json().catch(() => ({ error: "Request failed" }));
    return NextResponse.json(json, { status: res.status });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update candidate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
