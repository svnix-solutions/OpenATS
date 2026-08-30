import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth/session";
import { publicConfig } from "@/lib/public-config";

/** The local helper threw when unauthenticated; callers still rely on that. */
async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Unauthorized");
  return token;
}

const API_BASE_URL = publicConfig().apiUrl;

export async function POST(req: Request) {
  try {
    const token = await requireAccessToken();
    const formData = await req.formData();

    const res = await fetch(`${API_BASE_URL}/api/upload/logo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const json = await res.json().catch(() => ({ error: "Request failed" }));
    return NextResponse.json(json, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
