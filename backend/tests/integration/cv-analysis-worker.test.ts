import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The analysis itself is the one part that cannot run here: it calls Gemini.
// Everything around it — the enqueue guard, the tenancy hop, the failure
// path — is real, including Redis and BullMQ.
const runAnalysis = vi.hoisted(() => vi.fn());
const markFailed = vi.hoisted(() => vi.fn());
const markPending = vi.hoisted(() => vi.fn());

vi.mock("../../src/modules/candidate/cv-analysis.service", () => ({
  cvAnalysisService: {
    runAnalysis: (...a: unknown[]) => runAnalysis(...a),
    markFailed: (...a: unknown[]) => markFailed(...a),
    markPending: (...a: unknown[]) => markPending(...a),
  },
}));

import { Worker } from "bullmq";
import { currentOrganizationId, runInOrganization } from "../../src/db";
import {
  cvAnalysisQueue,
  requestCvAnalysis,
} from "../../src/queues/cv-analysis/queue";
import { startCvAnalysisWorker } from "../../src/queues/cv-analysis/worker";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `cvw-${Date.now()}`;
let organizationId: number;
let worker: Worker | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drain() {
  await cvAnalysisQueue.drain(true);
  await cvAnalysisQueue.clean(0, 1000, "completed");
  await cvAnalysisQueue.clean(0, 1000, "failed");
}

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  await drain();
});

afterAll(async () => {
  if (worker) await worker.close();
  await drain();
  await cvAnalysisQueue.close();
  await dropTestOrganization(organizationId);
});

describe("enqueuing an analysis", () => {
  it("refuses outside an organization", async () => {
    // A job with no tenant is one the worker cannot run: it would act for no
    // organization and see an empty database. Better to fail where there is
    // a stack trace.
    await expect(
      requestCvAnalysis({ candidateId: 1, jobId: 1, resumeUrl: "http://x" }),
    ).rejects.toThrow();
  });

  it("carries the organization onto the job", async () => {
    await runInOrganization(organizationId, () =>
      requestCvAnalysis({ candidateId: 7, jobId: 9, resumeUrl: "http://cv" }),
    );

    const [job] = await cvAnalysisQueue.getJobs(["waiting", "delayed"]);
    expect(job?.data.organizationId).toBe(organizationId);
    expect(markPending).toHaveBeenCalledWith(7, 9);
    await drain();
  });
});

describe("the worker", () => {
  it("runs the analysis inside the organization the job names", async () => {
    // The worker is a separate process with no request behind it, so the job
    // is the only thing that can say which tenant to act for. If this hop
    // broke, every query in the analysis would quietly see nothing.
    let seenOrganization: number | null | undefined;
    runAnalysis.mockImplementation(async () => {
      seenOrganization = currentOrganizationId();
    });

    worker = startCvAnalysisWorker();
    await runInOrganization(organizationId, () =>
      requestCvAnalysis({ candidateId: 11, jobId: 13, resumeUrl: "http://cv" }),
    );

    for (let i = 0; i < 40 && seenOrganization === undefined; i++) await wait(100);

    expect(runAnalysis).toHaveBeenCalledWith(11, 13, "http://cv");
    expect(seenOrganization).toBe(organizationId);
  });

  it("records the failure only once retries are exhausted", async () => {
    // A transient failure that later succeeds should not mark the analysis
    // failed, or raise an alert nobody needs to act on. Only the last attempt
    // does either.
    markFailed.mockClear();
    runAnalysis.mockImplementation(async () => {
      throw new Error("gemini exploded");
    });

    await runInOrganization(organizationId, () =>
      cvAnalysisQueue.add(
        "analyze",
        {
          candidateId: 21,
          jobId: 23,
          resumeUrl: "http://cv",
          organizationId,
        },
        // Two attempts with no backoff: the real queue waits 5s and doubles,
        // which is right in production and untestable here.
        { attempts: 2, backoff: { type: "fixed", delay: 1 } },
      ),
    );

    for (let i = 0; i < 60 && markFailed.mock.calls.length === 0; i++)
      await wait(100);

    expect(markFailed).toHaveBeenCalledTimes(1);
    // The job as well as the person: one CV is scored once per role, so a
    // failure belongs to one of them. Without the job id this marked every
    // application that candidate had as failed.
    expect(markFailed).toHaveBeenCalledWith(21, 23, "gemini exploded");
    // Two attempts were made before it gave up.
    expect(runAnalysis.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("marks the failure inside the right organization", async () => {
    // markFailed writes to a policy-filtered table; outside a context it
    // would match no rows and the analysis would sit "pending" forever.
    markFailed.mockClear();
    let seen: number | null | undefined;
    markFailed.mockImplementation(async () => {
      seen = currentOrganizationId();
    });
    runAnalysis.mockImplementation(async () => {
      throw new Error("boom");
    });

    await runInOrganization(organizationId, () =>
      cvAnalysisQueue.add(
        "analyze",
        { candidateId: 31, jobId: 33, resumeUrl: "http://cv", organizationId },
        { attempts: 1 },
      ),
    );

    for (let i = 0; i < 60 && seen === undefined; i++) await wait(100);
    expect(seen).toBe(organizationId);
  });
});
