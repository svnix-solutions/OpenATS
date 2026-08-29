import { Router } from "express";
import {
  inviteCandidateToAssessment,
  getCandidateAttempts,
  getAttemptResults,
  scoreWrittenAnswer,
} from "./assessment-execution.controller";
import {
  requireAttemptRead,
  requireCandidateRead,
} from "../../middlewares/job-access.middleware";

import { denyClients, requireManager } from "../../middlewares/role.middleware";

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

// Recording what a written answer was worth. A manager, and never a client
// contact: the score decides how a candidate is read, and a client sees the
// result rather than setting it.
router.patch(
  "/attempts/:attemptId/answers/:answerId/score",
  denyClients,
  requireManager,
  requireAttemptRead(),
  scoreWrittenAnswer,
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
