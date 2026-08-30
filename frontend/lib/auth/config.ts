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
