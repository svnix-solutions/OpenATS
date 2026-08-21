import { Router } from "express";
import {
  inviteCandidateToAssessment,
  getAssessmentForCandidate,
  startAssessment,
  submitAssessmentAnswer,
  completeAssessment,
  getCandidateAttempts,
  getAttemptResults,
} from "./assessment-execution.controller";
import {
  requireAttemptRead,
  requireCandidateRead,
} from "../../middlewares/job-access.middleware";

const router: Router = Router();

router.post("/invite", inviteCandidateToAssessment);
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

router.get("/public/:token", getAssessmentForCandidate);

router.post("/public/:token/start", startAssessment);

router.post("/public/:token/answer", submitAssessmentAnswer);

router.post("/public/:token/complete", completeAssessment);

export default router;
