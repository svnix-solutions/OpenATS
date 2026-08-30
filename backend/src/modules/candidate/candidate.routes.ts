import { Router } from "express";
import multer from "multer";
import {
  applyForJob,
  getCandidates,
  getCandidateById,
  moveCandidateStage,
  sendCandidateEmail,
  getCandidateEmails,
  deleteCandidate,
  bulkDeleteCandidates,
  updateCandidateBasicDetails,
} from "./candidate.controller";

import {
  denyClients,
  requireManager,
} from "../../middlewares/role.middleware";
import {
  requireCandidateRead,
  requireJobRead,
} from "../../middlewares/job-access.middleware";
import {
  getConversation,
  sendMessage,
} from "../messaging/messaging.controller";

const router: Router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.post(
  "/jobs/:jobId/apply",
  denyClients,
  requireJobRead("jobId"),
  applyForJob,
);

router.get("/", getCandidates);
router.get("/jobs/:jobId", getCandidates);
router.get("/:id", requireCandidateRead("id"), getCandidateById);

// The conversation. Authorized inside the handler rather than by
// requireCandidateRead, because messages hang off the person and that
// middleware answers a question about one application.
router.get("/:id/messages", getConversation);
router.post("/:id/messages", sendMessage);
router.patch("/:id", requireManager, upload.single("resume"), updateCandidateBasicDetails);
router.put("/:id/stage", requireManager, moveCandidateStage);
// Correspondence with a candidate: readable by anyone who may read the
// candidate, writable only by a manager — the same split the rest of the
// module uses.
router.get("/:id/emails", requireCandidateRead("id"), getCandidateEmails);
router.post("/:id/emails", requireManager, requireCandidateRead("id"), sendCandidateEmail);
router.delete("/bulk", requireManager, bulkDeleteCandidates);
router.delete("/:id", requireManager, deleteCandidate);

export default router;
