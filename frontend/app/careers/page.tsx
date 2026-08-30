import { notFound, redirect } from "next/navigation";
import { publicConfig } from "@/lib/public-config";

// Careers pages are addressed by the company advertising the roles
// (/careers/acme). This bare URL is what a single-tenant install has always
// linked to, so it forwards to that install's one client company rather than
// breaking.
//
// An agency has several, and /careers cannot mean any of them. Rather than
// picking one — which would show a candidate the wrong company's jobs — it
// gives up and 404s.

type ClientCompany = { name: string; slug: string };

function getApiBase() {
  return (
    process.env.OPENATS_API_URL || publicConfig().apiUrl
  ).replace(/\/$/, "");
}

async function getClientCompanies(): Promise<ClientCompany[]> {
  const base = getApiBase();
  if (!base) return [];

  try {
    const res = await fetch(`${base}/public/clients`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: ClientCompany[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

export default async function CareersIndexPage() {
  const companies = await getClientCompanies();

  if (companies.length === 1) {
    redirect(`/careers/${companies[0]!.slug}`);
  }

  notFound();
}
