"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authorizerConfig } from "@/lib/auth/config";

const AUTHORIZER_URL = authorizerConfig.authorizerURL;

/**
 * Email and password against the identity provider.
 *
 * Hand-written rather than the SDK's prebuilt widget: this is the first screen
 * anyone sees, and a vendor widget brings its own styling to fight — the
 * previous provider's needed CSS overrides just to hide its own heading.
 */
export function SignInForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Called directly rather than through the SDK. Authorizer rejects
      // state-changing requests without an Origin or Referer header, and the
      // SDK does not set them — from Node it fails with a bare HTTP 403, and
      // the browser's automatic Origin was not enough to make its client work
      // here either. A plain fetch is one dependency fewer on the path that
      // matters most, and the browser supplies Origin itself.
      const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          query:
            "mutation($p: LoginRequest!){ login(params:$p){ access_token message } }",
          variables: { p: { email, password } },
        }),
      }).then((r) => r.json());

      if (res?.errors?.length) {
        setError(res.errors[0]?.message ?? "Could not sign in");
        return;
      }

      const token = res?.data?.login?.access_token;
      if (!token) {
        setError("Sign-in did not return a token");
        return;
      }

      // Exchange it for this app's own session cookie. The provider's cookie
      // is on its own host and is not sent here once the two are not sharing
      // a domain.
      const stored = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      if (!stored.ok) {
        setError("Could not start a session");
        return;
      }
      // A hard navigation: middleware reads the session cookie on the server,
      // and a client transition would render the dashboard from a payload
      // fetched while signed out.
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setError("Could not reach the sign-in service");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
