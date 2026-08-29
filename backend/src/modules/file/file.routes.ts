import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { serveLogo, serveResume } from "./file.controller";

const router: Router = Router();

/**
 * Logos are served to anyone, so this is keyed by IP rather than by user —
 * there is no user. A careers page pulls one logo per render, so the ceiling
 * only matters to something enumerating keys, which is the point.
 */
const logoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

router.get("/logos/:name", logoLimiter, serveLogo);

// `authMiddleware` on this line and not the one above is the whole difference
// between the two folders. It is also what puts the request in an organization,
// which is what scopes the candidate lookup that authorizes it.
router.get("/resumes/:name", authMiddleware, serveResume);

export default router;
