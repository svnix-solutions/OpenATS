/**
 * Where the API is, from wherever this is running.
 *
 * `OPENATS_API_URL` first, and only the server ever sees it: Next inlines
 * `NEXT_PUBLIC_*` into the browser bundle and leaves every other variable
 * undefined there, so a browser falls through to the public URL on its own.
 *
 * That distinction is the point in a container deployment. The public URL is a
 * hostname the outside world resolves; the frontend container often cannot —
 * split-horizon DNS, or a router that will not hairpin — and when it cannot,
 * every server-rendered page fails with "fetch failed" while the API is
 * plainly healthy. The public careers pages already read this variable; the
 * dashboard did not, so only half the app went container to container.
 */
const API_BASE_URL =
  process.env.OPENATS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8080";

export async function apiFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((error as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
