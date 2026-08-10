import type { Metadata } from "next";

import { EmailView } from "@/components/mail/email-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Email",
};

/**
 * The unified inbox.
 *
 * Mail is synced to this box and encrypted at rest; nothing is sent anywhere
 * else. What is stored depends on each account's caching policy, which the
 * database enforces rather than trusting this page. See
 * `docs/caching-policy.md`.
 */
export default function EmailPage() {
  return <EmailView />;
}
