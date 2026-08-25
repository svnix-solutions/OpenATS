"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useClientCompanies,
  useCreateClientCompany,
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
              className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-3 dark:border-neutral-800"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
                  {c.name}
                </p>
                <p className="text-xs text-slate-400">/careers/{c.slug}</p>
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
