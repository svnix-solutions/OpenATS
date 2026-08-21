import { Router } from "express";
import {
  getAllJobs,
  getJobById,
  getJobBySlug,
  createJob,
  updateJob,
  deleteJob,
  bulkDeleteJobs,
  getAssessments,
  attachAssessment,
  detachAssessment,
} from "./job.controller";
import {
  getPipeline,
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
} from "../pipeline/pipeline.controller";
import {
  getHiringTeam,
  addTeamMember,
  removeTeamMember,
} from "../hiring-team/hiring-team.controller";
import customQuestionRoutes from "../custom-question/custom-question.routes";
import { requireManager } from "../../middlewares/role.middleware";
import {
  requireJobRead,
  requireJobSlugRead,
} from "../../middlewares/job-access.middleware";

const router: Router = Router();

router.get("/", getAllJobs);
router.post("/", requireManager, createJob);
router.delete("/bulk", requireManager, bulkDeleteJobs);
router.get("/slug/:slug", requireJobSlugRead(), getJobBySlug);
router.get("/:id", requireJobRead("id"), getJobById);
router.put("/:id", requireManager, updateJob);
router.delete("/:id", requireManager, deleteJob);

router.get("/:jobId/pipeline", requireJobRead(), getPipeline);
router.post("/:jobId/pipeline", requireManager, createStage);
router.post("/:jobId/pipeline/reorder", requireManager, reorderStages);
router.put("/:jobId/pipeline/:stageId", requireManager, updateStage);
router.delete("/:jobId/pipeline/:stageId", requireManager, deleteStage);

router.get("/:jobId/team", requireJobRead(), getHiringTeam);
router.post("/:jobId/team", requireManager, addTeamMember);
router.delete("/:jobId/team/:userId", requireManager, removeTeamMember);

router.get("/:id/assessments", requireJobRead("id"), getAssessments);
router.post("/:id/assessments", requireManager, attachAssessment);
router.delete("/:id/assessments/:attachmentId", requireManager, detachAssessment);

router.use("/:jobId/questions", requireJobRead(), customQuestionRoutes);

export default router;
