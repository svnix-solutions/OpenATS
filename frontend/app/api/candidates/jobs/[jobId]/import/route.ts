import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth/session";
import { publicConfig } from "@/lib/public-config";

/**
 * The import is multipart, so it cannot go through `serverFetch` like the
 * dashboard's other calls — that sends JSON. This forwards the file with the
 * session's token attached, the same way the uploads do.
 */
const API_BASE_URL = process.env.OPENATS_API_URL || publicConfig().apiUrl;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const token = await getAccessToken();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const form = await req.formData();

    const res = await fetch(
      `${API_BASE_URL}/api/candidates/jobs/${jobId}/import`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );

    const json = await res.json().catch(() => ({ error: "Import failed" }));
    return NextResponse.json(json, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
