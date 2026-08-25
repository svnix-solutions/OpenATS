import type { NextFunction, Request, Response } from "express";
import { pageSettingsService } from "../modules/settings/page-settings.service";

const FORWARDED = "x-openats-browser-origin";

function norm(s: string): string {
  return s.trim().replace(/\/$/, "");
}

function getOrigin(req: Request): string | null {
  const forwarded = req.headers[FORWARDED];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return norm(forwarded);
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.trim()) return norm(origin);
  const ref = req.headers.referer;
  if (typeof ref === "string" && ref.trim()) {
    try {
      return norm(new URL(ref).origin);
    } catch {
      return null;
    }
  }
  return null;
}

export async function checkOrigins(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // This organization's own list. The global one exists for the CORS callback,
    // which runs before routing and cannot know the tenant; using it here would
    // mean one organization configuring an origin starts refusing every other
    // organization's careers page.
    const allowed = await pageSettingsService.getAllowedOriginsForOrganization();
    if (allowed.length === 0) {
      next();
      return;
    }

    const o = getOrigin(req);
    if (!o) {
      next();
      return;
    }

    const ok = allowed.map((x) => norm(x)).includes(o);
    if (!ok) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
