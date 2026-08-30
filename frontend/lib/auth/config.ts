/**
 * Identity provider configuration, in one place.
 *
 * The app previously reached for the provider's SDK in eleven files, which is
 * why swapping one was a survey rather than an edit. Everything
 * provider-specific now lives under `lib/auth/`, so the next change is here
 * and not spread through the tree.
 */
import { publicConfig } from "../public-config";
//
// Getters rather than plain fields. The values are read at runtime — in the
// browser, from what the root layout wrote into the document — and a plain
// field would capture them when this module is first imported, which in a
// client bundle is before that script has necessarily been seen. Every call
// site reads `authorizerConfig.authorizerURL` exactly as before.
/**
 * The provider's address, for a call made by this server rather than a browser.
 *
 * Not the same answer. `authorizerConfig.authorizerURL` is the public hostname
 * — it is what a browser must use, and it is the `iss` claim on every token —
 * but from inside a container that address leaves the network, goes out to
 * whatever terminates TLS, and comes back. It may be slow, it may be blocked
 * outright, and it fails at the point of use rather than at startup.
 *
 * `AUTHORIZER_INTERNAL_URL` names the container directly. Falls back to the
 * public URL, which is right for development, where they are the same thing.
 */
export function serverAuthorizerUrl(): string {
  return (
    process.env.AUTHORIZER_INTERNAL_URL || authorizerConfig.authorizerURL
  ).replace(/\/$/, "");
}

export const authorizerConfig = {
  get authorizerURL(): string {
    return publicConfig().authorizerUrl;
  },
  get redirectURL(): string {
    return publicConfig().appUrl;
  },
  get clientID(): string {
    return publicConfig().authorizerClientId;
  },
};
