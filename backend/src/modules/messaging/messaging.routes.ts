import { Router } from "express";
import {
  connectWhatsapp,
  disconnectChannel,
  getMessagingConnections,
  startTelegramLogin,
  verifyTelegramLogin,
} from "./connections.controller";
import { listTemplates } from "./messaging.controller";
import { requireManager } from "../../middlewares/role.middleware";

const router: Router = Router();

// Organization-wide settings: connecting decides which number every
// conversation comes from, and disconnecting ends every thread on it.
router.get("/connections", requireManager, getMessagingConnections);
// Not manager-only: a recruiter sending to a candidate needs to see what they
// may send, and a template's text is already going to that candidate.
router.get("/templates", listTemplates);
router.post("/connections/whatsapp", requireManager, connectWhatsapp);
// Two steps, because MTProto is: the code cannot be asked for until Telegram
// has sent it, and the password cannot be asked for until Telegram says the
// account has one.
router.post("/connections/telegram/start", requireManager, startTelegramLogin);
router.post("/connections/telegram/verify", requireManager, verifyTelegramLogin);
router.delete("/connections/:channel", requireManager, disconnectChannel);

export default router;
