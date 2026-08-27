import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, candidates, jobs, departments, company } from "../../db/schema";
import { TemplateContext } from "./template-engine.service";
import { offerReviewUrl } from "../../shared/links";

export const variableService = {
  async getContextForCandidate(candidateId: number): Promise<TemplateContext> {
    const [result] = await db
      .select({
        candidate: candidates,
        job: jobs,
        department: departments,
        company: company,
      })
      .from(candidates)
      .innerJoin(applications, eq(applications.candidateId, candidates.id))
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .innerJoin(departments, eq(jobs.departmentId, departments.id))
      .innerJoin(company, eq(departments.companyId, company.id))
      .where(eq(candidates.id, candidateId));

    if (!result) return {};

    return {
      candidate_name: `${result.candidate.firstName} ${result.candidate.lastName}`,
      job_title: result.job.title,
      company_name: result.company.name,
      start_date: "TBD",
      salary: "TBD",
      currency: "",
      employment_type: result.job.employmentType,
      reporting_manager: "TBD",
      benefits: "TBD",
    };
  },

  async getContextForOffer(
    candidateId: number,
    offerData: {
      salary?: number | null;
      currency?: string | null;
      startDate?: string | null;
      employmentType?: string | null;
      reportingManager?: string | null;
      benefits?: string | null;
      reviewToken?: string | null;
    },
  ): Promise<TemplateContext> {
    const baseContext = await this.getContextForCandidate(candidateId);

    return {
      ...baseContext,
      salary: offerData.salary ?? "TBD",
      currency: offerData.currency ?? "",
      start_date: offerData.startDate || "TBD",
      employment_type: offerData.employmentType ?? "TBD",
      reporting_manager: offerData.reportingManager ?? "TBD",
      benefits: offerData.benefits ?? "TBD",
      offer_review_url: offerData.reviewToken
        ? offerReviewUrl(offerData.reviewToken)
        : "",
    };
  },
};
