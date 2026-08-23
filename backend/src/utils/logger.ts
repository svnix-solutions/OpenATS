import winston from "winston";

/**
 * Extra arguments (`logger.error("msg:", err)`) arrive as winston "splat"
 * metadata rather than as part of the message. Without pulling them out they
 * are silently dropped, which is how an error object logs as nothing.
 */
function splatOf(info: winston.Logform.TransformableInfo): unknown[] {
  return (info[Symbol.for("splat") as unknown as string] as
    | unknown[]
    | undefined) ?? [];
}

function renderValue(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular references reach here, usually via a request or socket object.
    return String(value);
  }
}

/** One line of JSON per event, for a log shipper to parse. */
const json = winston.format.printf((info) => {
  const extra = splatOf(info);

  // An Error among the extras is the reason most of these lines exist, so it
  // gets named fields rather than being flattened into the message.
  const error = extra.find((v): v is Error => v instanceof Error);
  const rest = extra.filter((v) => !(v instanceof Error));

  return JSON.stringify({
    timestamp: info.timestamp,
    level: info.level,
    message: String(info.message),
    ...(error && {
      error: { name: error.name, message: error.message, stack: error.stack },
    }),
    ...(rest.length && { details: rest.map(renderValue) }),
  });
});

/** Readable in a terminal, for development. */
const pretty = winston.format.printf((info) => {
  const extra = splatOf(info);
  const suffix = extra.length ? " " + extra.map(renderValue).join(" ") : "";
  return `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}${suffix}`;
});

// Console only, on purpose. pm2 already writes stdout and stderr to files and
// rotates them; a file transport here would write every line to disk twice,
// in a second place nothing is configured to rotate. The file transports that
// used to sit here commented out have been removed rather than left as a
// standing suggestion to do that.
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    process.env.NODE_ENV === "production" ? json : pretty,
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
