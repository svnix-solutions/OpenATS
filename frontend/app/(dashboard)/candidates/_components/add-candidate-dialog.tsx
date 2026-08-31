"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAddCandidate } from "@/hooks/queries/use-candidates";
import {
  useImportCandidates,
  useImportRun,
  type ImportReport,
  type ImportRow,
} from "@/hooks/queries/use-candidate-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Adding someone a recruiter already knew about.
 *
 * Not the same act as applying, and the screen says so. The person did not
 * choose to be here: they are labelled `sourced` rather than counted as an
 * applicant, and no consent to message them exists — a phone number off an old
 * CV is not permission to open a WhatsApp thread, and nobody can agree to that
 * on their behalf.
 *
 * The job is chosen here rather than afterwards because a candidate with no
 * application is not something this product has a place for: every stage,
 * interview and offer hangs off a submission to a specific job.
 */
export function AddCandidateDialog({
  open,
  onClose,
  jobs,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  jobs: { id: number; title: string }[];
  onAdded: () => void;
}) {
  const [mode, setMode] = useState<"one" | "many">("one");
  const [jobId, setJobId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useAddCandidate();

  const ready = jobId && firstName.trim() && lastName.trim() && email.trim();

  function reset() {
    setJobId(""); setFirstName(""); setLastName(""); setEmail("");
    setPhone(""); setResumeUrl(null);
  }

  async function uploadResume(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/resume", { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as
        | { data?: { url: string }; error?: string }
        | null;
      if (!res.ok || !json?.data) throw new Error(json?.error ?? "Upload failed");
      setResumeUrl(json.data.url);
      toast.success("CV attached");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload the CV");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSaving(true);
    try {
      // Through serverFetch, not a browser fetch at /api/…: the dashboard's
      // API calls are server actions. A direct fetch reaches Next, which has
      // no such route, and answers 404.
      await add.mutateAsync({
        jobId: Number(jobId),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        ...(phone.trim() && { phone: phone.trim() }),
        ...(resumeUrl && { resumeUrl }),
      });

      toast.success(`${firstName.trim()} added to the pipeline`);
      reset();
      onClose();
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a candidate</DialogTitle>
        </DialogHeader>

        {/*
          Two ways in, one dialog. The job is chosen once and applies to both,
          which is what makes re-importing the same list against another role
          the way to reuse it rather than adding people one at a time.
        */}
        <div className="mb-3 flex gap-1.5">
          {(["one", "many"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-sm font-semibold ${
                mode === m
                  ? "bg-[var(--theme-color)] text-white"
                  : "bg-neutral-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {m === "one" ? "One candidate" : "Import a list"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-job">Job</Label>
            <select
              id="add-job"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Choose a job…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
          </div>

          {mode === "many" && (
            <ImportPanel
              jobId={jobId}
              onImported={() => {
                onClose();
                onAdded();
              }}
            />
          )}

          {mode === "one" && (
          <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="add-first">First name</Label>
              <Input id="add-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-last">Last name</Label>
              <Input id="add-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-email">Email</Label>
            <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-xs text-slate-400">
              How they are recognised. Adding an email that is already here
              attaches this job to that person rather than creating a second one.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-phone">Phone (optional)</Label>
            <Input id="add-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49301234567" />
          </div>

          <div className="space-y-1.5">
            <Label>CV (optional)</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => void uploadResume(e.target.files?.[0])}
            />
            <Button
              variant="ghost"
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="w-full justify-start border border-dashed border-slate-200 dark:border-neutral-700"
            >
              {uploading ? "Uploading…" : resumeUrl ? "CV attached — replace" : "Attach a CV"}
            </Button>
          </div>

          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-neutral-800/60">
            Added by hand, so this is recorded as sourced rather than an
            application. They have not agreed to be messaged on WhatsApp or
            Telegram — that consent only comes from them.
          </p>
          </>
          )}
        </div>

        {mode === "one" && (
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!ready || saving || uploading}>
              {saving ? "Adding…" : "Add to pipeline"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Importing a list, in two passes: see, then do.
 *
 * The dry run and the real import are the same code on the server, so the
 * preview cannot promise something the import then does differently — which is
 * the failure a separate validator always eventually has.
 *
 * Re-uploading a corrected file is safe. Rows already on the job come back as
 * "already on this job" rather than errors, so fixing line 7 and sending the
 * whole file again does not duplicate lines 1 to 6.
 */
function ImportPanel({
  jobId,
  onImported,
}: {
  jobId: string;
  onImported: () => void;
}) {
  const importer = useImportCandidates();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(dryRun: boolean) {
    if (!file || !jobId) return;
    try {
      const result = await importer.mutateAsync({
        jobId: Number(jobId),
        file,
        dryRun,
      });

      if (dryRun) {
        setPreview(result as ImportReport);
        return;
      }

      // The real run is a job, so this is an id rather than a report. The
      // work outlives this dialog: closing it does not cancel the import, it
      // just stops watching.
      setRunId((result as { importId: number }).importId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The import failed");
    }
  }

  const run_ = useImportRun(runId);
  const live = run_.data?.data;

  // Reported once, when it lands. `finishedAt` is the edge to watch: the
  // query keeps returning the same finished row afterwards.
  useEffect(() => {
    if (live?.status !== "done") return;
    toast.success(`Imported ${live.counts.imported ?? 0} candidates`);
    onImported();
  }, [live?.status, live?.finishedAt]);

  const problems = preview?.rows.filter(
    (r) => r.outcome !== "would_import" && r.outcome !== "imported",
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        A CSV with an email and a name. Headers are matched loosely, so
        <code className="mx-1">Email</code>,<code className="mx-1">e-mail</code>
        and <code className="mx-1">Email Address</code> all work.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
        }}
      />
      <Button
        variant="ghost"
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full justify-start border border-dashed border-slate-200 dark:border-neutral-700"
      >
        {file ? file.name : "Choose a CSV"}
      </Button>

      {preview && (
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
            {preview.counts.would_import ?? 0} will be added
            {preview.counts.already_on_job
              ? `, ${preview.counts.already_on_job} already on this job`
              : ""}
          </p>

          {problems && problems.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {problems.map((r) => (
                <p key={r.line} className="text-xs text-amber-700 dark:text-amber-400">
                  {/* The spreadsheet's own line number, so it can be found. */}
                  Line {r.line}: {describe(r.outcome)}
                  {r.email ? ` — ${r.email}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {live && live.status !== "done" && (
        <div className="space-y-1 rounded-md border border-slate-200 p-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
            {live.status === "queued"
              ? "Queued…"
              : `Importing ${live.processed} of ${live.total || "…"}`}
          </p>
          <p className="text-xs text-slate-400">
            This runs in the background. Closing this does not stop it.
          </p>
          {live.status === "failed" && (
            <p className="text-xs text-red-600">{live.error}</p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={!file || !jobId || importer.isPending}
          onClick={() => run(true)}
        >
          {importer.isPending ? "Checking…" : "Check the file"}
        </Button>
        <Button
          // Only after a preview: importing several hundred people is not
          // something to do without having seen what it will do.
          disabled={!preview || importer.isPending || runId !== null}
          onClick={() => run(false)}
        >
          Import {preview?.counts.would_import ?? 0}
        </Button>
      </div>
    </div>
  );
}

function describe(outcome: ImportRow["outcome"]): string {
  switch (outcome) {
    case "missing_email":
      return "no email";
    case "invalid_email":
      return "that is not an email address";
    case "missing_name":
      return "no name";
    case "duplicate_in_file":
      return "appears earlier in this file";
    case "already_on_job":
      return "already on this job";
    case "failed":
      return "could not be added";
    default:
      return outcome;
  }
}
