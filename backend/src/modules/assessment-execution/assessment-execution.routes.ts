import { Router } from "express";
import {
  inviteCandidateToAssessment,
  getCandidateAttempts,
  getAttemptResults,
} from "./assessment-execution.controller";
import {
  requireAttemptRead,
  requireCandidateRead,
} from "../../middlewares/job-access.middleware";

import { denyClients } from "../../middlewares/role.middleware";

const router: Router = Router();

router.post("/invite", denyClients, inviteCandidateToAssessment);
router.get(
  "/candidate/:candidateId",
  requireCandidateRead(),
  getCandidateAttempts,
);
router.get(
  "/attempts/:attemptId/results",
  requireAttemptRead(),
  getAttemptResults,
);

// The candidate-facing assessment routes are mounted in routes/public.routes.ts
// and only there. They used to be duplicated here as well, under /api, which
// meant a second way in that skipped everything the intended one applies:
// withPublicOrganization resolves the tenant from the attempt token, the public
// limiters bound how fast answers can be submitted, and denyClients keeps
// client contacts out. Behind /api they instead ran as whichever staff member
// was signed in — so anyone in the organization holding a token, a client
// contact included, could read an assessment and answer it as the candidate.
//
// Nothing called them. Deleting the routes is the fix; the handlers they named
// are the same ones public.routes.ts uses.

export default router;
