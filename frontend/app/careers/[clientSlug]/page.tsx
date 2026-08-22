import { notFound } from "next/navigation";
import type { Job } from "@/types";
import { CareersJobsList } from "../_components/careers-jobs-list";

// A careers page belongs to the company advertising the roles, not the agency
// behind it. The slug in the URL is what tells the backend which tenant this
// is — there is no session here to say so.

type CareerJobRow = {
  id: number;
  slug: string;
  title: string;
  employmentType: Job["employmentType"];
  location: string | null;
  departmentName: string;
  createdAt: string;
};

type CareersPage = {
  company: {
    name: string;
    logoUrl: string | null;
    description: string | null;
    website: string | null;
  };
  jobs: CareerJobRow[];
};

function getApiBase() {
  return (
    process.env.OPENATS_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    ""
  ).replace(/\/$/, "");
}

async function getCareersPage(
  clientSlug: string,
): Promise<CareersPage | null> {
  const base = getApiBase();
  if (!base) return null;

  try {
    const res = await fetch(
      `${base}/public/clients/${encodeURIComponent(clientSlug)}/jobs`,
      { cache: "no-store" },
    );
    // The backend answers 404 for a slug it cannot resolve, deliberately not
    // distinguishing "no such client" from "a client belonging to nobody".
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: CareersPage };
    return body.data ?? null;
  } catch {
    return null;
  }
}

export default async function ClientCareersPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const page = await getCareersPage(clientSlug);

  if (!page) notFound();

  const { company, jobs } = page;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 transition-colors duration-300">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <div className="mb-10 flex flex-col items-center text-center">
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoUrl}
              alt={company.name}
              className="mb-4 h-8 w-auto max-w-[160px] object-contain"
            />
          )}
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-neutral-100">
            {company.name}
          </h1>
          {company.description && (
            <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-neutral-400 leading-relaxed">
              {company.description}
            </p>
          )}
        </div>

        <h2 className="text-lg font-semibold text-slate-900 dark:text-neutral-100 mb-6">
          Open roles
        </h2>

        {jobs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-neutral-400 py-8 text-center">
            There are no open positions at {company.name} at the moment. Please
            check back later.
          </p>
        ) : (
          <CareersJobsList jobs={jobs} basePath={`/careers/${clientSlug}`} />
        )}
      </div>
    </div>
  );
}
