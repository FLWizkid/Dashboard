"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * The sign-in form.
 *
 * Lives here rather than in `app/login/page.tsx` so that the page itself can
 * be a server component. That is not tidiness: route segment config is only
 * read from server components, and the login route has to be `force-dynamic`
 * so it is rendered per request and can carry a CSP nonce. Prerendered, its
 * bootstrap script would have no nonce, the policy would block it, and the
 * form would render without ever hydrating — a sign-in button that looks
 * perfectly normal and does nothing.
 */
export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    // Skips credential validation for now: the dashboard session is supplied
    // by memory mode, so there is nothing to check the fields against yet.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSignIn}
        className="w-full max-w-sm space-y-5 rounded-lg border border-line bg-surface-raised p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            Executive Dashboard
          </h1>
          <p className="text-sm text-fg-muted">Sign in to continue.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Signing in…" : "Sign in"}
        </Button>

        <p className="text-center text-xs text-fg-subtle">
          Access is restricted. Accounts are provisioned by the administrator.
        </p>
      </form>
    </main>
  );
}
