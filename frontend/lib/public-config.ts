/**
 * The handful of values the browser needs, read at runtime rather than baked
 * into the bundle.
 *
 * `NEXT_PUBLIC_*` cannot do this. Next replaces those expressions with string
 * literals when it builds — in the server output as well as the browser's,
 * verified by building with a sentinel value and finding it in 43 files under
 * `.next/standalone`. A non-prefixed variable is the opposite: it survives to
 * runtime on the server and does not reach the browser at all.
 *
 * So the browser is handed them instead. The root layout is `force-dynamic`,
 * so it renders per request; it reads the environment then and writes the
 * result into the document, and this reads it back. One image serves any
 * deployment, and changing a URL is a restart rather than a rebuild.
 *
 * Nothing secret goes in here. It is in the HTML of every page, served to
 * anyone — the same audience `NEXT_PUBLIC_` always meant.
 */

export type PublicConfig = {
  /** Origin of the API, no `/api` suffix — callers append their own path. */
  apiUrl: string;
  /** Origin this app is served from. */
  appUrl: string;
  /** Origin of the identity provider. */
  authorizerUrl: string;
  authorizerClientId: string;
};

/** Where the server leaves it for the browser to find. */
export const PUBLIC_CONFIG_KEY = "__OPENATS_PUBLIC__";

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/**
 * Blank counts as unset, the same way it does in the backend's `envOr`.
 * `.env.example` ships keys with no value and `${VAR:-}` in a compose file
 * passes an empty string, so `??` would take neither branch anyone wanted.
 */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Read from the environment. Server-side only — in the browser `process.env`
 * holds whatever the build inlined, which is the thing being avoided.
 *
 * `NEXT_PUBLIC_*` is still accepted as a fallback so an existing deployment
 * that sets only those keeps working.
 */
export function publicConfigFromEnv(): PublicConfig {
  return {
    apiUrl: trimSlash(
      env("API_URL", "NEXT_PUBLIC_API_URL") ?? "http://localhost:8080",
    ),
    appUrl: trimSlash(
      env("APP_URL", "NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
    ),
    authorizerUrl: trimSlash(
      env("AUTHORIZER_URL", "NEXT_PUBLIC_AUTHORIZER_URL") ??
        "http://localhost:8090",
    ),
    authorizerClientId:
      env("AUTHORIZER_CLIENT_ID", "NEXT_PUBLIC_AUTHORIZER_CLIENT_ID") ?? "",
  };
}

/**
 * The configuration, wherever this is running.
 *
 * On the server that is the environment, read fresh. In the browser it is what
 * the layout wrote into the document. Falls back to the environment in the
 * browser too, which is what makes `next dev` work without the layout having
 * rendered yet — there `NEXT_PUBLIC_*` is inlined and perfectly good.
 */
export function publicConfig(): PublicConfig {
  if (typeof window === "undefined") return publicConfigFromEnv();

  const injected = (window as unknown as Record<string, unknown>)[
    PUBLIC_CONFIG_KEY
  ] as Partial<PublicConfig> | undefined;

  const fallback = publicConfigFromEnv();
  return {
    apiUrl: injected?.apiUrl || fallback.apiUrl,
    appUrl: injected?.appUrl || fallback.appUrl,
    authorizerUrl: injected?.authorizerUrl || fallback.authorizerUrl,
    authorizerClientId:
      injected?.authorizerClientId || fallback.authorizerClientId,
  };
}

/**
 * The script the layout emits.
 *
 * `<` is escaped because this goes inside a `<script>` element: a value
 * containing `</script>` would otherwise close it early and the rest would be
 * parsed as markup. These values come from an operator rather than a visitor,
 * so this is a guard against a typo rather than an attacker — but it is one
 * character, and the failure it prevents is arbitrary markup in every page.
 */
export function publicConfigScript(config: PublicConfig): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `window.${PUBLIC_CONFIG_KEY}=${json};`;
}
