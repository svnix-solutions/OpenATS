import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import logger from "../../utils/logger";

// Any S3-compatible object store, not only R2 — the SDK, the endpoint and the
// public URL base are all provider-agnostic. See `docs-draft/STORAGE.md`.
const r2Client = new S3Client({
  region: process.env.R2_REGION ?? "us-east-1",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});

// Server-controlled extension per content type. We never trust the client
// filename for the stored key (an attacker could upload a `.html`/`.svg`).
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/**
 * Keys this application writes, and the only shape it will sign a URL for.
 *
 * `uploadFile` builds every key as `<folder>/<uuid><ext>`, so anything else in
 * the bucket was not put there by us. Matching the shape rather than sanitising
 * the input means a traversal attempt (`logos/../…`) is not a case to get
 * right — it simply does not match.
 */
const KEY_PATTERN = /^(resumes|logos)\/[0-9a-f-]{36}\.[a-z]{3,4}$/;

export type FileFolder = "resumes" | "logos";

/** The folder half of a key we are willing to serve, or null. */
export function parseFileKey(key: string): FileFolder | null {
  if (!KEY_PATTERN.test(key)) return null;
  return key.startsWith("resumes/") ? "resumes" : "logos";
}

export const r2Service = {
  /**
   * A URL that reads one object, valid for `expiresIn` seconds.
   *
   * This is what lets the bucket stay private. The browser fetches the bytes
   * from the bucket directly — the API only decides whether to hand over a
   * signed URL — so a CV never crosses this process and range requests, which
   * every PDF viewer makes, stay the bucket's problem.
   */
  /** The whole object, for server-side readers. Used by CV analysis. */
  async downloadFile(key: string): Promise<Buffer> {
    const response = await r2Client.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
    );

    if (!response.Body) throw new Error(`Empty response body for key: ${key}`);

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  },

  async presignedUrl(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
      { expiresIn },
    );
  },

  async uploadFile(
    file: Express.Multer.File,
    folder: "resumes" | "logos" = "resumes",
  ): Promise<string> {
    const fileExt = EXT_BY_MIME[file.mimetype] ?? "";
    const fileName = `${folder}/${crypto.randomUUID()}${fileExt}`;

    // Logos are raster images (png/jpeg/webp — never svg) meant to render
    // inline in the UI. Everything else (resumes, and any svg) is forced to
    // download so an uploaded file can never execute as HTML/SVG when its
    // URL is opened directly in a browser.
    const isInlineableLogo =
      folder === "logos" &&
      ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: isInlineableLogo ? "inline" : "attachment",
    });

    try {
      await r2Client.send(command);
    } catch (error) {
      logger.error(
        `Attempting upload to Bucket: ${process.env.R2_BUCKET_NAME}`,
      );
      throw error;
    }

    const publicUrl = process.env.R2_PUBLIC_URL?.endsWith("/")
      ? process.env.R2_PUBLIC_URL.slice(0, -1)
      : process.env.R2_PUBLIC_URL;

    return `${publicUrl}/${fileName}`;
  },

  /**
   * The object key inside a stored URL, or null if it holds none.
   *
   * Read off the end of the path rather than by stripping R2_PUBLIC_URL. It
   * used to be the latter, which quietly tied every stored row to whatever the
   * base happened to be when it was written: change the base — moving provider,
   * or putting the API in front of a private bucket — and `deleteByUrl` starts
   * treating every existing file as "not ours" and returning without deleting
   * it. Nothing errors. The files just accumulate.
   *
   * The shape is enough to identify our own keys, because `uploadFile` is the
   * only thing that writes them and it writes exactly one shape.
   */
  extractKeyFromUrl(fileUrl: string): string | null {
    if (!fileUrl) return null;

    const segments = fileUrl.split("?")[0]?.split("/") ?? [];
    const key = segments.slice(-2).join("/");

    return parseFileKey(key) ? key : null;
  },

  async deleteByUrl(fileUrl: string): Promise<void> {
    const key = this.extractKeyFromUrl(fileUrl);
    if (!key) return;

    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    });

    await r2Client.send(command);
  },
};
