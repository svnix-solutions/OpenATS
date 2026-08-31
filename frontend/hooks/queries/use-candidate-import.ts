import { useMutation } from "@tanstack/react-query";

export type ImportOutcome =
  | "imported"
  | "would_import"
  | "already_on_job"
  | "duplicate_in_file"
  | "missing_email"
  | "invalid_email"
  | "missing_name"
  | "failed";

export type ImportRow = {
  /** Matches the line a spreadsheet shows, header included. */
  line: number;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  outcome: ImportOutcome;
  detail?: string;
};

export type ImportReport = {
  rows: ImportRow[];
  counts: Partial<Record<ImportOutcome, number>>;
};

/**
 * Sends the file twice on purpose: once to see, once to do.
 *
 * The dry run and the real run are the same pass on the server, so the preview
 * cannot promise something the import then does differently. Sending the file
 * again rather than holding it server-side keeps the request stateless — and
 * an import that arrived at a different moment would be a different answer
 * anyway, since someone else may have added a candidate meanwhile.
 */
export function useImportCandidates() {
  return useMutation({
    mutationFn: async ({
      jobId,
      file,
      dryRun,
    }: {
      jobId: number;
      file: File;
      dryRun: boolean;
    }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("dryRun", String(dryRun));

      const res = await fetch(`/api/candidates/jobs/${jobId}/import`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => null)) as
        | { data?: ImportReport; error?: string }
        | null;
      if (!res.ok || !json?.data) {
        throw new Error(json?.error ?? "The import failed");
      }
      return json.data;
    },
  });
}
