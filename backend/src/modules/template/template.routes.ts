import { Router } from "express";
import {
  getAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  bulkDeleteTemplates,
  previewTemplate,
} from "./template.controller";

import {
  denyClients,
  requireManager,
} from "../../middlewares/role.middleware";

const router: Router = Router();

router.get("/", denyClients, getAllTemplates);
router.post("/", requireManager, createTemplate);
router.delete("/bulk", requireManager, bulkDeleteTemplates);
router.get("/:id", denyClients, getTemplateById);
router.put("/:id", requireManager, updateTemplate);
router.delete("/:id", requireManager, deleteTemplate);
router.post("/:id/preview", denyClients, previewTemplate);

export default router;
