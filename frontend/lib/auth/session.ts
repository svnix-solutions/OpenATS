import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { authorizerConfig } from "./config";

/**
 * The app owns its session cookie; the provider is only asked to authenticate.
 *
 * The obvious alternative — forwarding the browser's cookies to the provider
 * and asking who it is — was tried first and is worse in two ways. It couples
 * every server render to the provider being reachable, and it only works while
 * the app and the provider share a domain, because a cookie set on the
 * provider's host is not sent to the app's. That happens to be true on
 * localhost, where ports do not separate cookies, and stops being true the
 * moment either moves.
 *
 * So the sign-in form hands the token to a route on this app, which stores it
 * in an httpOnly cookie, and this verifies the signature against the
 * provider's public keys. Stateless, no round trip, and it survives the two
 * living on different hosts.
 */
export const SESSION_COOKIE = "openats_session";

const JWKS = createRemoteJWKSet(
  new URL(`${authorizerConfig.authorizerURL}/.well-known/jwks.json`),
);

export type ServerSession = {
  accessToken: string;
  user: {
    id: string;
    email: string | null;
    givenName: string | null;
    familyName: string | null;
    roles: string[];
  };
};

export const getServerSession = cache(async (): Promise<ServerSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: authorizerConfig.authorizerURL,
    });

    const roles = payload.roles;

    return {
      accessToken: token,
      user: {
        id: String(payload.sub ?? ""),
        email: (payload.email as string | undefined) ?? null,
        givenName: (payload.given_name as string | undefined) ?? null,
        familyName: (payload.family_name as string | undefined) ?? null,
        roles: Array.isArray(roles) ? (roles as string[]) : [],
      },
    };
  } catch {
    // Expired, tampered with, or signed by a provider we do not know. All of
    // them mean "not signed in" rather than "error".
    return null;
  }
});

/** The access token, or null. Most callers only want this. */
export async function getAccessToken(): Promise<string | null> {
  return (await getServerSession())?.accessToken ?? null;
}
