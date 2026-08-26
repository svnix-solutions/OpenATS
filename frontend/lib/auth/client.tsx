"use client";

import { AuthorizerProvider, useAuthorizer } from "@authorizerdev/authorizer-react";
import { authorizerConfig } from "./config";

/**
 * The provider context, wrapped so the rest of the app never imports the
 * vendor SDK directly.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthorizerProvider
      config={{
        authorizerURL: authorizerConfig.authorizerURL,
        redirectURL: authorizerConfig.redirectURL,
        clientID: authorizerConfig.clientID,
      }}
    >
      {children}
    </AuthorizerProvider>
  );
}

/**
 * Signing out, and whether the session is still being resolved.
 *
 * A hard navigation rather than a router push: the session cookie is read by
 * middleware on the server, and a client-side transition would leave a cached
 * RSC payload rendered for a user who has just left.
 */
export function useAuthSession() {
  const { logout, loading } = useAuthorizer();

  return {
    isLoading: loading,
    signOut: async () => {
      // Both sides: the provider's session, and this app's cookie.
      await logout().catch(() => {});
      await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
      window.location.href = "/login";
    },
  };
}
