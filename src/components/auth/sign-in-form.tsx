"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "sign-in" | "sign-up";

export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter both your email and password.");
      setLoading(false);
      return;
    }

    try {
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        if (signUpError) {
          setError(signUpError.message);
          setLoading(false);
          return;
        }

        // Supabase returns a user with no session when the email is already
        // registered (anti-enumeration). Without this check the flow would
        // look like a silent no-op.
        if (!data.session) {
          setError(
            "An account already exists with that email. Switch to Sign in.",
          );
          setLoading(false);
          return;
        }

        router.push("/dashboard");
        router.refresh();
        return;
      }

      const { data, error: signInError } = await supabase.auth
        .signInWithPassword({
          email: trimmedEmail,
          password,
        });

      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "The email or password is not correct."
            : signInError.message,
        );
        setLoading(false);
        return;
      }

      // Use the session from the sign-in response itself — the server in this
      // hosting environment cannot re-fetch it, and a separate getSession()
      // round-trip here can race the cookie write.
      if (!data.session) {
        setError(
          "Sign-in succeeded but no session was returned. Please try again.",
        );
        setLoading(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-lg border border-line bg-surface-raised p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            Executive Dashboard
          </h1>
          <p className="text-sm text-fg-muted">
            {mode === "sign-in"
              ? "Sign in to continue."
              : "Create your account."}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Authentication mode"
          className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface p-1"
        >
          <ModeTab
            active={mode === "sign-in"}
            onClick={() => switchMode("sign-in")}
          >
            Sign in
          </ModeTab>
          <ModeTab
            active={mode === "sign-up"}
            onClick={() => switchMode("sign-up")}
          >
            Create account
          </ModeTab>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
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
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
          {mode === "sign-in" ? (
            <button
              type="button"
              onClick={() => {
                setEmail("doug@theonefor.ai");
                setPassword("bolt2026");
              }}
              className="text-xs text-fg-muted underline decoration-dotted underline-offset-4 hover:text-fg"
            >
              Fill my credentials
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm text-fg-muted" role="status">
            {notice}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading
            ? mode === "sign-in"
              ? "Signing in..."
              : "Creating account..."
            : mode === "sign-in"
              ? "Sign in"
              : "Create account"}
        </Button>
      </form>
    </main>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1.5 text-sm font-medium transition-colors duration-fast",
        active
          ? "bg-surface-raised text-fg shadow-sm"
          : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
