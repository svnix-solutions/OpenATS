"use client";

import { useState } from "react";
import { useUploadLogo } from "@/hooks/queries/use-company";
import { toast } from "sonner";
import type { ClientCompany } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useClientCompanies,
  useCreateClientCompany,
  useUpdateClientCompany,
  useDeleteClientCompany,
  slugify,
} from "@/hooks/queries/use-client-companies";

/**
 * The companies this agency recruits for.
 *
 * Every job belongs to one, so an install with none cannot create a job at
 * all — which is why this page exists before anything else can be done.
 */
export default function ClientCompaniesPage() {
  const { data, isLoading } = useClientCompanies();
  const create = useCreateClientCompany();
  const remove = useDeleteClientCompany();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [website, setWebsite] = useState("");

  const companies = data?.data ?? [];
  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function submit() {
    if (!name.trim() || !effectiveSlug) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        slug: effectiveSlug,
        website: website.trim() || null,
      });
      toast.success(`${name.trim()} added`);
      setName(""); setSlug(""); setSlugEdited(false); setWebsite("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add company");
    }
  }

  async function destroy(id: number, label: string) {
    try {
      await remove.mutateAsync(id);
      toast.success(`${label} removed`);
    } catch (err) {
      // The API refuses while jobs still point at it, and says how many.
      toast.error(err instanceof Error ? err.message : "Could not remove");
    }
  }

  return (
    <div className="p-5 sm:p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-900 dark:text-neutral-100">
          Client companies
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          The companies you recruit for. Every job belongs to one, and the URL
          slug addresses that company&apos;s public careers page.
        </p>
      </div>

      <div className="rounded-md border border-slate-200 p-5 dark:border-neutral-800">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Company name</Label>
            <Input
              id="cc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-slug">Careers page URL</Label>
            <Input
              id="cc-slug"
              value={effectiveSlug}
              onChange={(e) => { setSlugEdited(true); setSlug(e.target.value); }}
              placeholder="acme-corp"
            />
            <p className="text-xs text-slate-400">/careers/{effectiveSlug || "…"}</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cc-site">Website (optional)</Label>
            <Input
              id="cc-site"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://acme.example"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={submit}
            disabled={!name.trim() || !effectiveSlug || create.isPending}
          >
            {create.isPending ? "Adding…" : "Add client company"}
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : companies.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 px-4 py-10 text-center dark:border-neutral-700">
            <p className="text-sm font-semibold text-slate-500">
              No client companies yet
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Add one before creating a job — a job has to belong to a company.
            </p>
          </div>
        ) : (
          companies.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3 dark:border-neutral-800"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ClientLogo company={c} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-200">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    /careers/{c.slug}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => destroy(c.id, c.name)}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The client's brand mark, and how it is set.
 *
 * Shown on that company's careers page and returned by `/public/clients`, so
 * an agency's own website can render the companies it recruits for. The
 * column and the careers page have supported a logo all along; there was
 * simply nowhere to put one.
 *
 * Uploaded then saved in two steps, because they fail differently: the upload
 * can be refused for size or type before anything is written, and only a URL
 * that exists is stored against the company.
 */
function ClientLogo({
  company,
}: {
  company: ClientCompany;
}) {
  const upload = useUploadLogo();
  const update = useUpdateClientCompany();
  const busy = upload.isPending || update.isPending;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { url } = await upload.mutateAsync(file);
      // Every field goes back, not just the logo. PUT replaces the row —
      // anything left out is written as null, so sending the logo alone would
      // clear the website and description on the way past.
      await update.mutateAsync({
        id: company.id,
        name: company.name,
        slug: company.slug,
        website: company.website,
        description: company.description,
        logoUrl: url,
      });
      toast.success(`Logo set for ${company.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the logo");
    }
  };

  return (
    <label
      className="group relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900"
      title={company.logoUrl ? "Replace logo" : "Add a logo"}
    >
      {company.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={company.logoUrl}
          alt={`${company.name} logo`}
          className="size-full object-contain"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-sm font-semibold text-slate-400 dark:text-neutral-500">
          {company.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-[10px] font-semibold text-white group-hover:flex">
        {busy ? "…" : "Change"}
      </span>
      <input
        type="file"
        accept="image/*"
        aria-label={`${company.logoUrl ? "Replace" : "Add"} the logo for ${company.name}`}
        className="sr-only"
        disabled={busy}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </label>
  );
}
