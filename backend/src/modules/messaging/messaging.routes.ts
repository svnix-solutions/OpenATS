import { Router } from "express";
import {
  connectWhatsapp,
  disconnectChannel,
  getMessagingConnections,
} from "./connections.controller";
import { requireManager } from "../../middlewares/role.middleware";

const router: Router = Router();

// Organization-wide settings: connecting decides which number every
// conversation comes from, and disconnecting ends every thread on it.
router.get("/connections", requireManager, getMessagingConnections);
router.post("/connections/whatsapp", requireManager, connectWhatsapp);
router.delete("/connections/:channel", requireManager, disconnectChannel);

export default router;
