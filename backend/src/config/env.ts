import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  OIDC_JWKS_URL: z.string().url("OIDC_JWKS_URL must be a valid URL"),
  OIDC_ISSUER: z.string().min(1, "OIDC_ISSUER is required"),

  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),
  FRONTEND_URL: z.string().min(1, "FRONTEND_URL is required"),

  R2_ENDPOINT: z.string().min(1, "R2_ENDPOINT is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET_NAME: z.string().min(1, "R2_BUCKET_NAME is required"),
  R2_PUBLIC_URL: z.string().min(1, "R2_PUBLIC_URL is required"),
  // Which region the request is signed for. R2 ignores it and signs everything
  // as us-east-1, which is why it was hardcoded — and Backblaze B2 ignores it
  // too, verified against a live bucket where put, get and a presigned read all
  // succeed with us-east-1 against a eu-central-003 endpoint. AWS S3 does check
  // it, and MinIO checks when one is configured; there a mismatch is a
  // signature error that never mentions the region. Optional, so the providers
  // that do not care need no setting at all.
  // Blank counts as absent, the same way SENTRY_DSN does below — `.env.example`
  // ships it empty and `make setup` copies that file verbatim.
  R2_REGION: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),

  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  RESEND_FROM_EMAIL: z.string().min(1, "RESEND_FROM_EMAIL is required"),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),

  PORT: z.coerce.number().int().positive().default(8080),

  // Optional on purpose: without it error tracking is simply off, which is
  // what development, CI and the test suite want. Required nowhere.
  //
  // Empty counts as absent. `.env.example` ships `SENTRY_DSN=` with no value
  // and `make setup` copies that file verbatim, so an optional variable that
  // rejected the empty string meant a fresh checkout refused to boot —
  // "SENTRY_DSN must be a valid URL" — before anyone had opted into Sentry at
  // all. The same applies to any deployment template, which writes every
  // variable it knows about whether or not it has a value.
  SENTRY_DSN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url("SENTRY_DSN must be a valid URL").optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error(
      `\nMissing or invalid environment variables:\n${issues}\n\nCheck backend/.env against backend/.env.example.\n`,
    );
    process.exit(1);
  }

  return result.data;
}
