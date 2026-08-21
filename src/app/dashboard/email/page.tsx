import type { Metadata } from "next";

import { EmailView } from "@/components/mail/email-view";
import { MailboxPolicy } from "@/components/mail/mailbox-policy";

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
 *
 * The policy panel sits below the inbox rather than in a settings page of its
 * own: it answers "what is this thing keeping about my mail", and that gets
 * asked while looking at the mail, not while looking for preferences.
 */
export default function EmailPage() {
  return (
    <div className="space-y-6">
      <EmailView />
      <MailboxPolicy />
    </div>
  );
}
