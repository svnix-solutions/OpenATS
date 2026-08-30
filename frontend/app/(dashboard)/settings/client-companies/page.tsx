"use client";

import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Building02Icon, CloudUploadIcon } from "@hugeicons/core-free-icons";
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
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const companies = data?.data ?? [];
  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function submit() {
    if (!name.trim() || !effectiveSlug) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        slug: effectiveSlug,
        website: website.trim() || null,
        logoUrl,
      });
      toast.success(`${name.trim()} added`);
      setName(""); setSlug(""); setSlugEdited(false); setWebsite("");
      setLogoUrl(null);
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
            <Label>Logo (optional)</Label>
            <LogoPicker
              value={logoUrl}
              onChange={setLogoUrl}
              label={name.trim() || "this company"}
            />
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
 * Choosing a logo file and uploading it, without saying where it belongs.
 *
 * Used twice on this page and it has to be, because the two moments are
 * different: on the add form there is no company to attach a URL to yet, so
 * the caller holds it and sends it with the rest of the fields. On a row that
 * already exists, the caller saves it immediately.
 *
 * Uploading before the company is created can leave a file in the bucket that
 * nothing references, if the form is then abandoned. That is a few kilobytes
 * and no correctness problem; the alternative is making people add a company
 * and then come back for its logo, which is what this is fixing.
 */
function LogoPicker({
  value,
  onChange,
  label,
  busy = false,
}: {
  value: string | null;
  onChange: (url: string) => void | Promise<void>;
  label: string;
  busy?: boolean;
}) {
  const upload = useUploadLogo();
  const fileRef = useRef<HTMLInputElement>(null);
  const working = upload.isPending || busy;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { url } = await upload.mutateAsync(file);
      await onChange(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload");
    }
  };

  return (
    <div className="flex items-stretch gap-3">
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-contain" />
        ) : (
          <HugeiconsIcon icon={Building02Icon} className="size-5 text-slate-400" />
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={working}
        aria-label={`Upload a logo for ${label}`}
        className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/60"
      >
        <span className="flex size-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
          <HugeiconsIcon icon={CloudUploadIcon} className="size-3.5" />
        </span>
        <span className="text-xs text-slate-600 dark:text-neutral-300">
          <span className="font-semibold text-theme">
            {working ? "Uploading…" : value ? "Replace logo" : "Click to upload"}
          </span>
        </span>
        <span className="text-[11px] text-slate-400 dark:text-neutral-500">
          PNG, JPG or WebP — shown on the careers page
        </span>
      </button>
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
      className="group relative size-11 shrink-0 cursor-pointer rounded-md border border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900"
      title={company.logoUrl ? "Replace logo" : "Add a logo"}
    >
      <span className="block size-full overflow-hidden rounded-md">
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
      </span>

      {/*
        Always visible, not only on hover. This tile was the only way to set a
        logo and it looked like decoration — the first person to go looking for
        it searched the add form, found nothing, and asked where it was. A
        hover state cannot answer a question nobody knows to ask, and on a
        touch screen there is no hover at all.
      */}
      <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors group-hover:border-slate-300 group-hover:text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
        {busy ? (
          <span className="text-[9px]">…</span>
        ) : (
          <HugeiconsIcon icon={CloudUploadIcon} className="size-2.5" />
        )}
      </span>

      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={`${company.logoUrl ? "Replace" : "Add"} the logo for ${company.name}`}
        className="sr-only"
        disabled={busy}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </label>
  );
}
