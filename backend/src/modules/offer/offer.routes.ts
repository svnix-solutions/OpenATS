import { Router } from "express";
import {
  acceptOffer,
  bulkDeleteOffers,
  createOffer,
  declineOffer,
  deleteOffer,
  getAllOffers,
  getAllOffersByJob,
  getOfferById,
  markCandidateHired,
  sendOffer,
  updateOffer,
} from "./offer.controller";

import { requireManager } from "../../middlewares/role.middleware";
import {
  requireJobRead,
  requireOfferRead,
} from "../../middlewares/job-access.middleware";

const router: Router = Router();

router.get("/", getAllOffers);
router.delete("/bulk", requireManager, bulkDeleteOffers);
router.get("/job/:jobId", requireJobRead(), getAllOffersByJob);
router.get("/:id", requireOfferRead(), getOfferById);
router.post("/", requireManager, createOffer);
router.patch("/:id", requireManager, updateOffer);
router.delete("/:id", requireManager, deleteOffer);
router.post("/:id/send", requireManager, sendOffer);
router.post("/:id/accept", requireOfferRead(), acceptOffer);
router.post("/:id/decline", requireOfferRead(), declineOffer);
router.post("/:id/mark-hired", requireManager, markCandidateHired);

export default router;
