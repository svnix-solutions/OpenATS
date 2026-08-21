import { Router } from "express";
import multer from "multer";
import {
  applyForJob,
  getCandidates,
  getCandidateById,
  moveCandidateStage,
  deleteCandidate,
  bulkDeleteCandidates,
  updateCandidateBasicDetails,
} from "./candidate.controller";

import { requireManager } from "../../middlewares/role.middleware";
import { requireCandidateRead } from "../../middlewares/job-access.middleware";

const router: Router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.post("/jobs/:jobId/apply", applyForJob);

router.get("/", getCandidates);
router.get("/jobs/:jobId", getCandidates);
router.get("/:id", requireCandidateRead("id"), getCandidateById);
router.patch("/:id", requireManager, upload.single("resume"), updateCandidateBasicDetails);
router.put("/:id/stage", requireManager, moveCandidateStage);
router.delete("/bulk", requireManager, bulkDeleteCandidates);
router.delete("/:id", requireManager, deleteCandidate);

export default router;
