import type { Request, Response, NextFunction } from "express";
import { isClientScoped } from "../shared/auth/job-access";

export function requireManager(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.user.role !== "super_admin" && req.user.role !== "hiring_manager") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user.role !== "super_admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/**
 * Refuses a client contact outright.
 *
 * For endpoints that aggregate across an organization and have no client
 * dimension to narrow by — analytics counts every submission in the agency,
 * so a client reading it would see the agency's whole book of business as a
 * number. Narrowing it is a real feature; refusing it is the honest thing to
 * do until someone builds that.
 */
export function denyClients(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (isClientScoped(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
