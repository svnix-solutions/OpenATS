import { Request, Response, NextFunction } from "express";
import { errors as joseErrors } from "jose";
import { AuthError, verifyAccessToken } from "../shared/auth/verify-token";
import { runInOrganization } from "../db";
import logger from "../utils/logger";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  let user;

  // Only the verification is guarded. Calling next() inside the try would
  // funnel a synchronous downstream error into the catch below, which would
  // report a route failure as an auth failure and attempt a second response.
  try {
    user = await verifyAccessToken(authHeader.slice(7));
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      logger.warn(`[authMiddleware] ${err.status}: ${err.message}`);
      res.status(err.status).json({ error: err.message });
      return;
    }

    if (err instanceof joseErrors.JOSEError) {
      logger.warn(
        `[authMiddleware] token rejected (${err.code}): ${err.message}`,
      );
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    logger.error("[authMiddleware] unexpected error:", err);
    res.status(500).json({ error: "Authentication failed" });
    return;
  }

  req.user = user;

  // Everything downstream runs inside a transaction carrying this user's
  // organization, which is what every row-level-security policy reads. A
  // handler that escapes it sees an empty database rather than another
  // tenant's rows.
  runInOrganization(user.organizationId, async () => {
    await new Promise<void>((resolve, reject) => {
      res.on("finish", resolve);
      res.on("close", resolve);
      // next(), not next(err): passing anything here tells Express the
      // request failed. Errors from the handler travel to the error
      // middleware as usual; this promise only waits for the response.
      try {
        next();
      } catch (err) {
        reject(err);
      }
    });
  }).catch((err: unknown) => {
    logger.error("[authMiddleware] request context failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
