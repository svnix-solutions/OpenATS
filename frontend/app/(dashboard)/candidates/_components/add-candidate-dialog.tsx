"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAddCandidate } from "@/hooks/queries/use-candidates";
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
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || saving || uploading}>
            {saving ? "Adding…" : "Add to pipeline"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
