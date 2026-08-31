import { Router } from "express";
import multer from "multer";
import { expensiveLimiter } from "../../middlewares/rate-limit.middleware";
import {
  applyForJob,
  getCandidateImport,
  importCandidatesToJob,
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
  findOnTelegram,
  getConversation,
  sendMessage,
  sendTemplateMessage,
} from "../messaging/messaging.controller";

const router: Router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// Multipart: a recruiter's list is a file. Behind the same job-access check
// as adding one by hand, and manager-only, because an import writes hundreds
// of rows in one action.
router.post(
  "/jobs/:jobId/import",
  denyClients,
  requireManager,
  requireJobRead("jobId"),
  expensiveLimiter,
  upload.single("file"),
  importCandidatesToJob,
);

router.post(
  "/jobs/:jobId/apply",
  denyClients,
  requireJobRead("jobId"),
  applyForJob,
);

// Before "/:id", or an import id is read as a candidate id.
router.get("/imports/:importId", requireManager, getCandidateImport);

router.get("/", getCandidates);
router.get("/jobs/:jobId", getCandidates);
router.get("/:id", requireCandidateRead("id"), getCandidateById);

// The conversation. Authorized inside the handler rather than by
// requireCandidateRead, because messages hang off the person and that
// middleware answers a question about one application.
router.get("/:id/messages", getConversation);
// Every send leaves the building. `apiLimiter` allows a thousand of these in
// fifteen minutes, which for WhatsApp is real money and a quality rating, and
// for Telegram is an account that stops working. `expensiveLimiter` exists for
// exactly this and was not on any of them.
router.post("/:id/messages", expensiveLimiter, sendMessage);
// One candidate, on purpose. Telegram limits accounts that look up numbers in
// bulk, so this is never a sweep.
router.post("/:id/messages/find-on-telegram", expensiveLimiter, findOnTelegram);
// A template is a different request from a message: different arguments,
// different failures, and it is the only thing that reaches a candidate whose
// WhatsApp window has shut.
router.post("/:id/messages/template", expensiveLimiter, sendTemplateMessage);
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
