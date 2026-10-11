import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Rendered per request, deliberately.
 *
 * Prerendered, this page's HTML would be written once at build time with no
 * CSP nonce in it, and the per-request policy would then refuse to run the
 * bootstrap script that hydrates the form. The page would look right and the
 * Sign in button would do nothing — the worst kind of failure, because it
 * produces no error anyone sees.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <SignInForm />;
}
