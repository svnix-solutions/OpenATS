import type { Request, Response } from "express";
import { parseFileKey, r2Service } from "../../shared/services/r2.service";
import { canReadResumeKey } from "../../shared/auth/job-access";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Handing out short-lived URLs so the bucket can stay private.
 *
 * Nothing in the bucket is world-readable. A stored `resume_url` or `logo_url`
 * addresses this API instead, and reading one is two steps: decide whether the
 * caller may have it, then redirect to a signed URL that expires. The bytes
 * still travel from the bucket to the browser directly — this process never
 * sees them — which is what keeps range requests, the ones every PDF viewer
 * makes, out of Node's hands.
 *
 * The two folders are deliberately not the same endpoint with a flag:
 *
 *   logos    — anonymous. They render on `/careers/:slug` for visitors who
 *              have no account, and in the `/public/clients` feed an agency
 *              points its own website at. A logo key is therefore readable by
 *              anyone holding it, across tenants. That is what a brand mark
 *              published on a public careers page already is.
 *
 *   resumes  — authorised per candidate. A CV is the most sensitive thing
 *              this application stores.
 */

/** Long enough to load a page; short enough that a copied URL dies quickly. */
const LOGO_TTL_SECONDS = 60 * 60;

/**
 * Long enough to read a CV without the viewer expiring mid-scroll, since a PDF
 * viewer re-requests byte ranges for the whole time it is open.
 */
const RESUME_TTL_SECONDS = 15 * 60;

/** `logos/<uuid>.png` from `/files/logos/<uuid>.png`. */
function keyFrom(req: Request, folder: "logos" | "resumes"): string | null {
  const name = req.params.name;
  if (typeof name !== "string") return null;
  return parseFileKey(`${folder}/${name}`) ? `${folder}/${name}` : null;
}

export const serveLogo = async (req: Request, res: Response) => {
  const key = keyFrom(req, "logos");
  if (!key) return res.status(404).json({ error: "Not found" });

  try {
    const url = await r2Service.presignedUrl(key, LOGO_TTL_SECONDS);
    // Cached well inside the signed URL's life, so a browser reuses the
    // redirect for a while but always renews before the target expires.
    res.set("Cache-Control", "public, max-age=300");
    return res.redirect(302, url);
  } catch (error) {
    logger.error(`Failed to sign logo ${key}: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Failed to read file" });
  }
};

export const serveResume = async (req: Request, res: Response) => {
  const key = keyFrom(req, "resumes");
  if (!key) return res.status(404).json({ error: "Not found" });

  const user = req.user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  try {
    // 404 rather than 403, and the same 404 as a key that does not exist: the
    // two must not be distinguishable, or this endpoint answers "does this
    // organization hold a CV under this key" for anyone who asks.
    if (!(await canReadResumeKey(user, key))) {
      return res.status(404).json({ error: "Not found" });
    }

    const url = await r2Service.presignedUrl(key, RESUME_TTL_SECONDS);
    // An authorization decision about one user. Never store it.
    res.set("Cache-Control", "private, no-store");
    return res.redirect(302, url);
  } catch (error) {
    logger.error(`Failed to sign resume ${key}: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Failed to read file" });
  }
};
