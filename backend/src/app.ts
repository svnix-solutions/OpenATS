import express, { type Express } from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import router from "./routes";
import publicRouter from "./routes/public.routes";
import fileRouter from "./modules/file/file.routes";
import oauthRouter from "./modules/integrations/oauth.routes";
import { errorMiddleware } from "./middlewares/error.middleware";
import { swaggerUi, swaggerDocument } from "./config/swagger";
import { authMiddleware } from "./middlewares/auth.middleware";
import { Sentry } from "./config/sentry";
import { apiLimiter } from "./middlewares/rate-limit.middleware";
import { pageSettingsService } from "./modules/settings/page-settings.service";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { createRedisConnection } from "./config/redis";
import logger from "./utils/logger";

const healthRedis = createRedisConnection();

const app: Express = express();

/**
 * How many proxies sit in front of this process.
 *
 * Express reads the client address off the socket unless told otherwise, so
 * behind any proxy — Cloudflare Tunnel, Traefik, nginx — every request appears
 * to come from that proxy. Nothing breaks loudly: the IP-keyed limiters on
 * `/public/*` and `/files/logos` simply collapse into one bucket shared by the
 * entire internet, and one bot exhausts the application form for every real
 * candidate.
 *
 * A count rather than `true`. `true` trusts the whole `X-Forwarded-For` chain,
 * which a client writes freely — so every request could claim a fresh address
 * and IP rate limiting would stop meaning anything at all. A count makes
 * Express take the entry that many hops from the right, which is the one the
 * nearest proxy wrote and a client cannot forge past.
 *
 * Default 0: a process reachable directly must not trust the header. Set it to
 * the number of proxies you actually run — 1 behind a single tunnel or reverse
 * proxy.
 */
const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
if (Number.isInteger(trustProxy) && trustProxy > 0) {
  app.set("trust proxy", trustProxy);
}

app.use(helmet());

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, "");
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const requestOrigin = normalizeOrigin(origin);
      const fallbackFrontend = normalizeOrigin(
        process.env.FRONTEND_URL ?? "http://localhost:3000",
      );

      if (requestOrigin === fallbackFrontend) {
        callback(null, true);
        return;
      }

      pageSettingsService
        .getAllowedOrigins()
        .then((origins) => {
          const allowed = origins.map(normalizeOrigin);
          callback(null, allowed.includes(requestOrigin));
        })
        .catch((err) => callback(err));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use(
  morgan(
    ":remote-addr :method :url :status :res[content-length] - :response-time ms",
    {
      skip: (req) => req.url.startsWith("/api-docs"),
      stream: {
        write: (message: string) => logger.info(message.trim()),
      },
    },
  ),
);
app.get("/health", async (req, res) => {
  const checks: Record<string, "ok" | "error"> = {
    db: "ok",
    redis: "ok",
  };

  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    checks.db = "error";
    logger.error(
      `[health] db check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const pong = await healthRedis.ping();
    if (pong !== "PONG") checks.redis = "error";
  } catch (err) {
    checks.redis = "error";
    logger.error(
      `[health] redis check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks,
  });
});

// Not under /api: logos are read by anonymous visitors on careers pages, so
// the auth boundary is inside this router, per folder, rather than in front of
// it. See modules/file/file.routes.ts.
app.use("/files", fileRouter);
app.use("/public", publicRouter);
app.use("/oauth", oauthRouter);

app.use("/api", authMiddleware, apiLimiter, router);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Before errorMiddleware, which ends the request: Sentry's handler passes the
// error along, but only sees what reaches it first.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(errorMiddleware);

export default app;
