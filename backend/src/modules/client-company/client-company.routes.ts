import { Router } from "express";
import {
  getClientCompanies,
  getClientCompany,
  createClientCompany,
  updateClientCompany,
  deleteClientCompany,
} from "./client-company.controller";
import { requireManager } from "../../middlewares/role.middleware";
import { denyClients } from "../../middlewares/role.middleware";

const router: Router = Router();

// denyClients on everything: which companies an agency recruits for is the
// agency's book of business, and a contact at one of them has no business
// seeing the others — let alone editing them.
router.use(denyClients);

router.get("/", getClientCompanies);
router.get("/:id", getClientCompany);
router.post("/", requireManager, createClientCompany);
router.put("/:id", requireManager, updateClientCompany);
router.delete("/:id", requireManager, deleteClientCompany);

export default router;
