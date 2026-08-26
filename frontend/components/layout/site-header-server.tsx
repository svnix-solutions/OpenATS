import { getAccessToken as readAccessToken } from "@/lib/auth/session";
import { SiteHeader } from "./site-header";

async function getAccessToken(): Promise<string | undefined> {
  try {
    return (await readAccessToken()) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function SiteHeaderServer() {
  const accessToken = await getAccessToken();
  return <SiteHeader accessToken={accessToken} />;
}
