import { Router } from "express";
import {
  exportReportsAnalytics,
  getReportsAnalytics,
} from "./report.controller";

import {
  denyClients,
  requireManager,
} from "../../middlewares/role.middleware";

const router: Router = Router();

router.get("/analytics", denyClients, getReportsAnalytics);
router.get("/analytics/export", denyClients, requireManager, exportReportsAnalytics);

export default router;
