/**
 * Identity provider configuration, in one place.
 *
 * The app previously reached for the provider's SDK in eleven files, which is
 * why swapping one was a survey rather than an edit. Everything
 * provider-specific now lives under `lib/auth/`, so the next change is here
 * and not spread through the tree.
 */
export const authorizerConfig = {
  authorizerURL: (
    process.env.NEXT_PUBLIC_AUTHORIZER_URL ?? "http://localhost:8090"
  ).replace(/\/$/, ""),
  redirectURL: (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, ""),
  clientID: process.env.NEXT_PUBLIC_AUTHORIZER_CLIENT_ID ?? "",
};
