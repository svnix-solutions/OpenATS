import { useMutation, useQuery } from "@tanstack/react-query";
import { serverFetch } from "@/lib/auth-action";

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

export type ImportRun = {
  id: number;
  jobId: number;
  filename: string | null;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  processed: number;
  counts: Partial<Record<ImportOutcome, number>>;
  problems: ImportRow[];
  error: string | null;
  finishedAt: string | null;
};

/**
 * Where a running import has got to.
 *
 * Polled while it runs and then left alone. The run outlives this screen, so
 * closing the browser mid-import does not lose it — reopening shows the same
 * row, finished.
 */
export function useImportRun(importId: number | null) {
  return useQuery({
    queryKey: ["candidate-import", importId],
    queryFn: () =>
      serverFetch<{ data: ImportRun }>(`/candidates/imports/${importId}`),
    enabled: importId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.data.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });
}

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
        | { data?: ImportReport | { importId: number }; error?: string }
        | null;
      if (!res.ok || !json?.data) {
        throw new Error(json?.error ?? "The import failed");
      }
      // A dry run answers with the report itself; a real one answers 202 with
      // an id, because the work has not happened yet.
      return json.data;
    },
  });
}
