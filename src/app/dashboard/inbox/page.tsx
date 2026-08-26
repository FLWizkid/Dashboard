import type { Metadata } from "next";

import { InboxView } from "@/components/reports/inbox-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Digest",
};

/**
 * Delivered digests.
 *
 * The copy that always exists: the in-app message is written before any email
 * is attempted, so a relay outage costs the email and never the brief.
 */
export default function InboxPage() {
  return <InboxView />;
}
