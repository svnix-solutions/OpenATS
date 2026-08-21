import { NextFunction, Request, Response } from "express";
import {
  canAccessCandidate,
  canAccessJob,
  canReadAttempt,
  canReadCandidate,
  canReadInterview,
  canReadJob,
  canReadJobSlug,
  canReadOffer,
  parseRoomId,
} from "../shared/auth/job-access";
import type { AuthenticatedUser } from "../shared/auth/verify-token";
import logger from "../utils/logger";

// HTTP version of the socket room guards. Mount after `authMiddleware`.
//
// `requireXAccess` guards team-owned conversations (hiring-team membership).
// `requireXRead`   guards record reads (interviewers only; managers are
//                  company-wide). See shared/auth/job-access.ts for why the
//                  two rules differ.

function deny(res: Response, userId: number, what: string) {
  logger.warn(`[access] user ${userId} denied ${what}`);
  res.status(403).json({ error: "You do not have access to this resource" });
}

type IdCheck = (user: AuthenticatedUser, id: number) => Promise<boolean>;

function guardById(check: IdCheck, param: string, label: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const id = parseRoomId(req.params[param]);
    if (id === null) {
      res.status(400).json({ error: `Invalid ${label} id` });
      return;
    }

    try {
      if (!(await check(req.user, id))) {
        deny(res, req.user.id, `${label} ${id}`);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireJobAccess = (param = "jobId") =>
  guardById(canAccessJob, param, "job");

export const requireCandidateAccess = (param = "candidateId") =>
  guardById(canAccessCandidate, param, "candidate");

export const requireJobRead = (param = "jobId") =>
  guardById(canReadJob, param, "job");

export const requireCandidateRead = (param = "candidateId") =>
  guardById(canReadCandidate, param, "candidate");

export const requireOfferRead = (param = "id") =>
  guardById(canReadOffer, param, "offer");

export const requireInterviewRead = (param = "id") =>
  guardById(canReadInterview, param, "interview");

export const requireAttemptRead = (param = "attemptId") =>
  guardById(canReadAttempt, param, "attempt");

// Slugs are strings, so they do not go through `parseRoomId`.
export function requireJobSlugRead(param = "slug") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const slug = (req.params[param] ?? "").toString();
    if (!slug) {
      res.status(400).json({ error: "Invalid job slug" });
      return;
    }

    try {
      if (!(await canReadJobSlug(req.user, slug))) {
        deny(res, req.user.id, `job slug ${slug}`);
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
